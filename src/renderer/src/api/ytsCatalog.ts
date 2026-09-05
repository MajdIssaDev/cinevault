import type { CatalogItem, CastMember, MediaExtras } from '../types'
import { fetchJson } from '../lib/http'
import { upgradeImageUrl } from '../lib/heroImage'

const YTS_HOSTS = ['https://yts.mx', 'https://yts.lt', 'https://yts.ag']

export const YTS_GENRES = [
  'Action',
  'Adventure',
  'Animation',
  'Comedy',
  'Crime',
  'Documentary',
  'Drama',
  'Family',
  'Fantasy',
  'History',
  'Horror',
  'Music',
  'Mystery',
  'Romance',
  'Sci-Fi',
  'Thriller',
  'War',
  'Western'
]

interface YtsCast {
  name?: string
  character_name?: string
  url_small_image?: string | null
}

interface YtsMovie {
  id: number
  url?: string
  imdb_code?: string
  title: string
  title_long?: string
  year: number
  rating: number
  runtime?: number
  genres?: string[]
  summary?: string
  description_intro?: string
  description_full?: string
  synopsis?: string
  yt_trailer_code?: string
  mpa_rating?: string
  large_cover_image?: string
  medium_cover_image?: string
  background_image_original?: string
  background_image?: string
  large_screenshot_image1?: string | null
  large_screenshot_image2?: string | null
  large_screenshot_image3?: string | null
  medium_screenshot_image1?: string | null
  medium_screenshot_image2?: string | null
  medium_screenshot_image3?: string | null
  cast?: YtsCast[]
}

interface YtsListResponse {
  status: string
  data?: {
    movie_count?: number
    movies?: YtsMovie[]
  }
}

interface YtsDetailsResponse {
  status: string
  data?: {
    movie?: YtsMovie
  }
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, '').trim()
}

function mapMovie(m: YtsMovie): CatalogItem {
  const backdrop = m.background_image_original || m.background_image || null
  return {
    id: `movie-${m.id}`,
    externalId: m.id,
    mediaType: 'movie',
    title: m.title,
    overview: stripHtml(m.description_full || m.description_intro || m.summary || m.synopsis || ''),
    posterUrl: m.large_cover_image || m.medium_cover_image || null,
    backdropUrl: backdrop ? upgradeImageUrl(backdrop) : null,
    releaseDate: m.year ? `${m.year}-01-01` : null,
    rating: m.rating || 0,
    genres: m.genres || [],
    imdbId: m.imdb_code || null
  }
}

function mapExtras(m: YtsMovie): MediaExtras {
  const large = [
    m.large_screenshot_image1,
    m.large_screenshot_image2,
    m.large_screenshot_image3
  ].filter((u): u is string => Boolean(u))
  const medium = [
    m.medium_screenshot_image1,
    m.medium_screenshot_image2,
    m.medium_screenshot_image3
  ]
    .filter((u): u is string => Boolean(u))
    .map((u) => upgradeImageUrl(u))
  // Prefer large stills only — mediums are soft and won't enlarge cleanly
  const stills = large.length ? large : medium

  const cast: CastMember[] = (m.cast || [])
    .filter((c) => c.name)
    .slice(0, 6)
    .map((c) => ({
      name: c.name!,
      character: c.character_name || null,
      photoUrl: c.url_small_image || null,
      role: 'cast' as const
    }))

  const summary = m.summary ? stripHtml(m.summary) : ''
  const full = m.description_full ? stripHtml(m.description_full) : ''

  return {
    tagline: summary && full && summary !== full ? summary.slice(0, 180) : null,
    runtimeMinutes: m.runtime && m.runtime > 0 ? m.runtime : null,
    ageRating: m.mpa_rating?.trim() || null,
    trailerYoutubeId: m.yt_trailer_code?.trim() || null,
    stills: [...new Set(stills)],
    cast
  }
}

async function ytsJson<T>(pathAndQuery: string): Promise<T> {
  let lastError: Error | null = null
  for (const host of YTS_HOSTS) {
    try {
      return await fetchJson<T>(`${host}${pathAndQuery}`)
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
    }
  }
  throw lastError || new Error('YTS request failed')
}

async function listMovies(
  params: Record<string, string>
): Promise<{ items: CatalogItem[]; movieCount: number }> {
  const qs = new URLSearchParams({ limit: '24', page: '1', ...params })
  const data = await ytsJson<YtsListResponse>(`/api/v2/list_movies.json?${qs.toString()}`)
  if (data.status !== 'ok' || !data.data?.movies?.length) {
    return { items: [], movieCount: data.data?.movie_count || 0 }
  }
  return {
    items: data.data.movies.map(mapMovie),
    movieCount: data.data.movie_count || data.data.movies.length
  }
}

export async function fetchPopularMovies(page = 1): Promise<CatalogItem[]> {
  const { items } = await listMovies({
    sort_by: 'download_count',
    order_by: 'desc',
    page: String(page)
  })
  return items
}

export async function fetchNewMovies(page = 1): Promise<CatalogItem[]> {
  const { items } = await listMovies({ sort_by: 'year', order_by: 'desc', page: String(page) })
  return items
}

/** Page 1 mixes new + popular. Page N (N>=2) = popular page N — avoid re-fetching page 1. */
export async function fetchNewAndPopularMovies(page = 1): Promise<CatalogItem[]> {
  if (page <= 1) {
    const [fresh, popular] = await Promise.all([fetchNewMovies(1), fetchPopularMovies(1)])
    const seen = new Set<number>()
    const out: CatalogItem[] = []
    for (const item of [...fresh, ...popular]) {
      if (seen.has(item.externalId)) continue
      seen.add(item.externalId)
      out.push(item)
    }
    return out
  }
  return fetchPopularMovies(page)
}

export async function searchMovies(query: string, page = 1): Promise<CatalogItem[]> {
  const { items } = await listMovies({
    query_term: query.trim(),
    sort_by: 'download_count',
    page: String(page)
  })
  return items
}

export async function fetchMoviesByGenre(genre: string, page = 1): Promise<CatalogItem[]> {
  const { items } = await listMovies({
    genre,
    sort_by: 'download_count',
    order_by: 'desc',
    page: String(page)
  })
  return items
}

export async function fetchMovieDetails(id: number): Promise<{
  item: CatalogItem & { imdbId: string | null }
  extras: MediaExtras
}> {
  const data = await ytsJson<YtsDetailsResponse>(
    `/api/v2/movie_details.json?movie_id=${id}&with_images=true&with_cast=true`
  )
  const movie = data.data?.movie
  if (!movie) throw new Error('Movie not found')
  const item = mapMovie(movie)
  return {
    item: { ...item, imdbId: item.imdbId || null },
    extras: mapExtras(movie)
  }
}
