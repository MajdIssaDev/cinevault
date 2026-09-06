import type { CatalogItem, EpisodeInfo, SeasonInfo } from '../types'
import { fetchJson } from '../lib/http'

export const TVMAZE_GENRES = [
  'Action',
  'Adventure',
  'Anime',
  'Comedy',
  'Crime',
  'Drama',
  'Family',
  'Fantasy',
  'Horror',
  'Mystery',
  'Romance',
  'Science-Fiction',
  'Thriller',
  'War',
  'Western'
]

interface TvMazeImage {
  medium?: string | null
  original?: string | null
}

interface TvMazeShow {
  id: number
  name: string
  genres?: string[]
  summary?: string | null
  premiered?: string | null
  rating?: { average?: number | null }
  image?: TvMazeImage | null
  externals?: { imdb?: string | null }
}

interface TvMazeEpisode {
  id: number
  name: string
  season: number
  number: number | null
  summary?: string | null
  airdate?: string | null
  runtime?: number | null
  image?: TvMazeImage | null
}

interface TvMazeSearchHit {
  score: number
  show: TvMazeShow
}

interface TvMazeScheduleItem {
  id: number
  show: TvMazeShow
}

function stripHtml(html: string | null | undefined): string {
  return (html || '').replace(/<[^>]+>/g, '').trim()
}

function mapShow(show: TvMazeShow): CatalogItem {
  return {
    id: `series-${show.id}`,
    externalId: show.id,
    mediaType: 'series',
    title: show.name,
    overview: stripHtml(show.summary),
    posterUrl: show.image?.original || show.image?.medium || null,
    backdropUrl: show.image?.original || show.image?.medium || null,
    releaseDate: show.premiered || null,
    rating: show.rating?.average ?? 0,
    genres: show.genres || [],
    imdbId: show.externals?.imdb || null
  }
}

function dateOffset(daysAgo: number): string {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  return d.toISOString().slice(0, 10)
}

/** Recent US schedule + catalog pages (`page` 1 = schedule+shows0, later = shows page N-1). */
export async function fetchNewAndPopularSeries(page = 1): Promise<CatalogItem[]> {
  if (page <= 1) {
    const dates = [0, 1, 2, 3, 4, 5, 6].map(dateOffset)
    const scheduleLists = await Promise.all(
      dates.map((date) =>
        fetchJson<TvMazeScheduleItem[]>(
          `https://api.tvmaze.com/schedule?country=US&date=${date}`
        ).catch(() => [] as TvMazeScheduleItem[])
      )
    )

    const seen = new Set<number>()
    const out: CatalogItem[] = []
    for (const list of scheduleLists) {
      for (const row of list) {
        const show = row.show
        if (!show?.id || seen.has(show.id)) continue
        seen.add(show.id)
        out.push(mapShow(show))
      }
    }

    const page0 = await fetchJson<TvMazeShow[]>('https://api.tvmaze.com/shows?page=0').catch(
      () => [] as TvMazeShow[]
    )
    for (const show of page0) {
      if (seen.has(show.id)) continue
      seen.add(show.id)
      out.push(mapShow(show))
      if (out.length >= 48) break
    }
    return out
  }

  const shows = await fetchJson<TvMazeShow[]>(`https://api.tvmaze.com/shows?page=${page - 1}`).catch(
    () => [] as TvMazeShow[]
  )
  return shows.map(mapShow)
}

export async function searchSeries(query: string, _page = 1): Promise<CatalogItem[]> {
  // TVMaze search is not paginated — only return on first page
  if (_page > 1) return []
  const hits = await fetchJson<TvMazeSearchHit[]>(
    `https://api.tvmaze.com/search/shows?q=${encodeURIComponent(query.trim())}`
  )
  return hits.map((h) => mapShow(h.show))
}

export async function fetchSeriesByGenre(genre: string, page = 1): Promise<CatalogItem[]> {
  // Each "page" scans 3 TVMaze index pages and filters by genre
  const start = (page - 1) * 3
  const pages = await Promise.all(
    [start, start + 1, start + 2].map((p) =>
      fetchJson<TvMazeShow[]>(`https://api.tvmaze.com/shows?page=${p}`).catch(() => [] as TvMazeShow[])
    )
  )
  const needle = genre.toLowerCase()
  const seen = new Set<number>()
  const out: CatalogItem[] = []
  for (const chunk of pages) {
    for (const show of chunk) {
      if (seen.has(show.id)) continue
      const genres = (show.genres || []).map((g) => g.toLowerCase())
      const match =
        genres.includes(needle) ||
        genres.some((g) => g.includes(needle) || needle.includes(g))
      if (!match) continue
      seen.add(show.id)
      out.push(mapShow(show))
    }
  }
  return out
}

/** TVMaze show id for an IMDb id, or null when unknown. */
export async function lookupSeriesByImdb(imdbId: string): Promise<number | null> {
  const q = imdbId.trim()
  if (!q) return null
  try {
    const show = await fetchJson<TvMazeShow>(
      `https://api.tvmaze.com/lookup/shows?imdb=${encodeURIComponent(q)}`
    )
    return show?.id ?? null
  } catch {
    return null
  }
}

export async function fetchSeriesDetails(id: number): Promise<{
  item: CatalogItem
  seasons: SeasonInfo[]
  episodes: EpisodeInfo[]
  imdbId: string | null
}> {
  const [show, episodesRaw] = await Promise.all([
    fetchJson<TvMazeShow>(`https://api.tvmaze.com/shows/${id}`),
    fetchJson<TvMazeEpisode[]>(`https://api.tvmaze.com/shows/${id}/episodes`)
  ])

  const item = mapShow(show)
  const episodes: EpisodeInfo[] = episodesRaw
    .filter((e) => e.number != null && e.season > 0)
    .map((e) => ({
      id: `ep-${e.id}`,
      seasonNumber: e.season,
      episodeNumber: e.number as number,
      title: e.name || `Episode ${e.number}`,
      overview: stripHtml(e.summary),
      stillUrl: e.image?.original || e.image?.medium || null,
      airDate: e.airdate || null,
      runtime: e.runtime ?? null
    }))

  const seasonMap = new Map<number, number>()
  for (const ep of episodes) {
    seasonMap.set(ep.seasonNumber, (seasonMap.get(ep.seasonNumber) || 0) + 1)
  }
  const seasons: SeasonInfo[] = [...seasonMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([seasonNumber, episodeCount]) => ({
      seasonNumber,
      name: `Season ${seasonNumber}`,
      episodeCount,
      posterUrl: item.posterUrl
    }))

  return {
    item,
    seasons,
    episodes,
    imdbId: item.imdbId || null
  }
}

export function episodesForSeason(all: EpisodeInfo[], season: number): EpisodeInfo[] {
  return all.filter((e) => e.seasonNumber === season)
}
