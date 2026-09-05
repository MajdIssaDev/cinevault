import type { CatalogItem, CastMember, EpisodeInfo, MediaExtras, SeasonInfo } from '../types'
import { GENRE_MOVIE, GENRE_TV } from '../types'

const IMG = 'https://image.tmdb.org/t/p'

function key(apiKey: string): string {
  if (!apiKey) throw new Error('Add your TMDB API key in Settings.')
  return apiKey
}

async function tmdb<T>(apiKey: string, path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`https://api.themoviedb.org/3${path}`)
  url.searchParams.set('api_key', key(apiKey))
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`TMDB ${res.status}`)
  return res.json() as Promise<T>
}

function mapMovie(m: {
  id: number
  title: string
  overview: string
  poster_path: string | null
  backdrop_path: string | null
  release_date?: string
  vote_average: number
  genre_ids?: number[]
}): CatalogItem {
  return {
    id: `movie-${m.id}`,
    externalId: m.id,
    mediaType: 'movie',
    title: m.title,
    overview: m.overview,
    posterUrl: m.poster_path ? `${IMG}/w500${m.poster_path}` : null,
    backdropUrl: m.backdrop_path ? `${IMG}/original${m.backdrop_path}` : null,
    releaseDate: m.release_date || null,
    rating: m.vote_average,
    genres: (m.genre_ids || []).map((id) => GENRE_MOVIE[id]).filter(Boolean)
  }
}

function mapTv(m: {
  id: number
  name: string
  overview: string
  poster_path: string | null
  backdrop_path: string | null
  first_air_date?: string
  vote_average: number
  genre_ids?: number[]
}): CatalogItem {
  return {
    id: `series-${m.id}`,
    externalId: m.id,
    mediaType: 'series',
    title: m.name,
    overview: m.overview,
    posterUrl: m.poster_path ? `${IMG}/w500${m.poster_path}` : null,
    backdropUrl: m.backdrop_path ? `${IMG}/original${m.backdrop_path}` : null,
    releaseDate: m.first_air_date || null,
    rating: m.vote_average,
    genres: (m.genre_ids || []).map((id) => GENRE_TV[id]).filter(Boolean)
  }
}

export async function fetchPopularMovies(apiKey: string, page = 1): Promise<CatalogItem[]> {
  const data = await tmdb<{ results: Parameters<typeof mapMovie>[0][] }>(apiKey, '/movie/popular', {
    page: String(page)
  })
  return data.results.map(mapMovie)
}

export async function fetchNowPlayingMovies(apiKey: string, page = 1): Promise<CatalogItem[]> {
  const data = await tmdb<{ results: Parameters<typeof mapMovie>[0][] }>(apiKey, '/movie/now_playing', {
    page: String(page)
  })
  return data.results.map(mapMovie)
}

export async function fetchUpcomingMovies(apiKey: string, page = 1): Promise<CatalogItem[]> {
  const data = await tmdb<{ results: Parameters<typeof mapMovie>[0][] }>(apiKey, '/movie/upcoming', {
    page: String(page)
  })
  return data.results.map(mapMovie)
}

/** Merge now-playing + popular, dedupe by id, now-playing first. */
export async function fetchNewAndPopularMovies(apiKey: string): Promise<CatalogItem[]> {
  const [nowPlaying, popular] = await Promise.all([
    fetchNowPlayingMovies(apiKey),
    fetchPopularMovies(apiKey)
  ])
  const seen = new Set<number>()
  const out: CatalogItem[] = []
  for (const item of [...nowPlaying, ...popular]) {
    if (seen.has(item.externalId)) continue
    seen.add(item.externalId)
    out.push(item)
  }
  return out
}

export async function fetchPopularSeries(apiKey: string, page = 1): Promise<CatalogItem[]> {
  const data = await tmdb<{ results: Parameters<typeof mapTv>[0][] }>(apiKey, '/tv/popular', {
    page: String(page)
  })
  return data.results.map(mapTv)
}

export async function fetchOnTheAirSeries(apiKey: string, page = 1): Promise<CatalogItem[]> {
  const data = await tmdb<{ results: Parameters<typeof mapTv>[0][] }>(apiKey, '/tv/on_the_air', {
    page: String(page)
  })
  return data.results.map(mapTv)
}

/** Merge on-the-air + popular TV, on-the-air first. */
export async function fetchNewAndPopularSeries(apiKey: string): Promise<CatalogItem[]> {
  const [onAir, popular] = await Promise.all([fetchOnTheAirSeries(apiKey), fetchPopularSeries(apiKey)])
  const seen = new Set<number>()
  const out: CatalogItem[] = []
  for (const item of [...onAir, ...popular]) {
    if (seen.has(item.externalId)) continue
    seen.add(item.externalId)
    out.push(item)
  }
  return out
}

export async function searchMovies(apiKey: string, query: string): Promise<CatalogItem[]> {
  const data = await tmdb<{ results: Parameters<typeof mapMovie>[0][] }>(apiKey, '/search/movie', {
    query
  })
  return data.results.map(mapMovie)
}

export async function searchSeries(apiKey: string, query: string): Promise<CatalogItem[]> {
  const data = await tmdb<{ results: Parameters<typeof mapTv>[0][] }>(apiKey, '/search/tv', {
    query
  })
  return data.results.map(mapTv)
}

export async function fetchMovieDetails(apiKey: string, id: number): Promise<CatalogItem & { imdbId: string | null }> {
  const m = await tmdb<{
    id: number
    title: string
    overview: string
    poster_path: string | null
    backdrop_path: string | null
    release_date?: string
    vote_average: number
    genres: { id: number; name: string }[]
    imdb_id: string | null
  }>(apiKey, `/movie/${id}`)
  return {
    id: `movie-${m.id}`,
    externalId: m.id,
    mediaType: 'movie',
    title: m.title,
    overview: m.overview,
    posterUrl: m.poster_path ? `${IMG}/w500${m.poster_path}` : null,
    backdropUrl: m.backdrop_path ? `${IMG}/original${m.backdrop_path}` : null,
    releaseDate: m.release_date || null,
    rating: m.vote_average,
    genres: m.genres.map((g) => g.name),
    imdbId: m.imdb_id
  }
}

export async function fetchSeriesDetails(apiKey: string, id: number): Promise<{
  item: CatalogItem
  seasons: SeasonInfo[]
  imdbId: string | null
}> {
  const m = await tmdb<{
    id: number
    name: string
    overview: string
    poster_path: string | null
    backdrop_path: string | null
    first_air_date?: string
    vote_average: number
    genres: { id: number; name: string }[]
    seasons: {
      season_number: number
      name: string
      episode_count: number
      poster_path: string | null
    }[]
    external_ids?: { imdb_id: string | null }
  }>(apiKey, `/tv/${id}`, { append_to_response: 'external_ids' })

  return {
    item: {
      id: `series-${m.id}`,
      externalId: m.id,
      mediaType: 'series',
      title: m.name,
      overview: m.overview,
      posterUrl: m.poster_path ? `${IMG}/w500${m.poster_path}` : null,
      backdropUrl: m.backdrop_path ? `${IMG}/original${m.backdrop_path}` : null,
      releaseDate: m.first_air_date || null,
      rating: m.vote_average,
      genres: m.genres.map((g) => g.name),
      imdbId: m.external_ids?.imdb_id
    },
    seasons: m.seasons
      .filter((s) => s.season_number > 0)
      .map((s) => ({
        seasonNumber: s.season_number,
        name: s.name,
        episodeCount: s.episode_count,
        posterUrl: s.poster_path ? `${IMG}/w300${s.poster_path}` : null
      })),
    imdbId: m.external_ids?.imdb_id || null
  }
}

export async function fetchSeasonEpisodes(
  apiKey: string,
  seriesId: number,
  season: number
): Promise<EpisodeInfo[]> {
  const data = await tmdb<{
    episodes: {
      id: number
      name: string
      overview: string
      still_path: string | null
      air_date: string | null
      episode_number: number
      season_number: number
      runtime: number | null
    }[]
  }>(apiKey, `/tv/${seriesId}/season/${season}`)

  return data.episodes.map((e) => ({
    id: `ep-${e.id}`,
    seasonNumber: e.season_number,
    episodeNumber: e.episode_number,
    title: e.name,
    overview: e.overview,
    stillUrl: e.still_path ? `${IMG}/w300${e.still_path}` : null,
    airDate: e.air_date,
    runtime: e.runtime
  }))
}

export async function discoverByGenre(
  apiKey: string,
  type: 'movie' | 'tv',
  genreName: string,
  page = 1
): Promise<CatalogItem[]> {
  const map = type === 'movie' ? GENRE_MOVIE : GENRE_TV
  const genreId = Object.entries(map).find(([, n]) => n === genreName)?.[0]
  if (!genreId) return type === 'movie' ? fetchPopularMovies(apiKey, page) : fetchPopularSeries(apiKey, page)
  const data = await tmdb<{ results: never[] }>(apiKey, `/discover/${type}`, {
    with_genres: genreId,
    page: String(page),
    sort_by: 'popularity.desc'
  })
  return type === 'movie'
    ? (data.results as Parameters<typeof mapMovie>[0][]).map(mapMovie)
    : (data.results as Parameters<typeof mapTv>[0][]).map(mapTv)
}

/** Enrich by IMDb id — original backdrop, tagline, cert, cast, stills, trailer. */
export async function enrichFromImdb(
  apiKey: string,
  imdbId: string,
  kind: 'movie' | 'tv' = 'movie'
): Promise<{
  backdropUrl: string | null
  overview?: string
  extras: MediaExtras
} | null> {
  if (!apiKey || !imdbId) return null
  const find = await tmdb<{
    movie_results: { id: number }[]
    tv_results: { id: number }[]
  }>(apiKey, `/find/${encodeURIComponent(imdbId)}`, { external_source: 'imdb_id' })

  const tmdbId =
    kind === 'tv' ? find.tv_results[0]?.id : find.movie_results[0]?.id || find.tv_results[0]?.id
  if (!tmdbId) return null

  if (kind === 'tv' || find.movie_results.length === 0) {
    const m = await tmdb<{
      overview: string
      tagline?: string
      episode_run_time?: number[]
      backdrop_path: string | null
      credits?: {
        crew: { job: string; name: string; profile_path: string | null }[]
        cast: { name: string; character: string; profile_path: string | null }[]
      }
      images?: { backdrops: { file_path: string }[] }
      videos?: { results: { site: string; type: string; key: string; name?: string; official?: boolean }[] }
      content_ratings?: { results: { iso_3166_1: string; rating: string }[] }
    }>(apiKey, `/tv/${tmdbId}`, {
      append_to_response: 'credits,images,videos,content_ratings'
    })
    const director = m.credits?.crew.find((c) => c.job === 'Director' || c.job === 'Series Director')
    const cast: CastMember[] = []
    if (director) {
      cast.push({
        name: director.name,
        character: 'Director',
        photoUrl: director.profile_path ? `${IMG}/w185${director.profile_path}` : null,
        role: 'director'
      })
    }
    for (const c of (m.credits?.cast || []).slice(0, 4)) {
      cast.push({
        name: c.name,
        character: c.character,
        photoUrl: c.profile_path ? `${IMG}/w185${c.profile_path}` : null,
        role: 'cast'
      })
    }
    const trailer = pickBestTrailer(m.videos?.results)
    const us = m.content_ratings?.results.find((r) => r.iso_3166_1 === 'US')
    return {
      backdropUrl: m.backdrop_path ? `${IMG}/original${m.backdrop_path}` : null,
      overview: m.overview,
      extras: {
        tagline: m.tagline || null,
        runtimeMinutes: m.episode_run_time?.[0] || null,
        ageRating: us?.rating || null,
        trailerYoutubeId: trailer?.key || null,
        stills: (m.images?.backdrops || []).slice(0, 12).map((b) => `${IMG}/original${b.file_path}`),
        cast
      }
    }
  }

  const m = await tmdb<{
    overview: string
    tagline?: string
    runtime?: number
    backdrop_path: string | null
    credits?: {
      crew: { job: string; name: string; profile_path: string | null }[]
      cast: { name: string; character: string; profile_path: string | null }[]
    }
    images?: { backdrops: { file_path: string }[] }
    videos?: { results: { site: string; type: string; key: string; name?: string; official?: boolean }[] }
    release_dates?: {
      results: { iso_3166_1: string; release_dates: { certification: string }[] }[]
    }
  }>(apiKey, `/movie/${tmdbId}`, {
    append_to_response: 'credits,images,videos,release_dates'
  })

  const director = m.credits?.crew.find((c) => c.job === 'Director')
  const cast: CastMember[] = []
  if (director) {
    cast.push({
      name: director.name,
      character: 'Director',
      photoUrl: director.profile_path ? `${IMG}/w185${director.profile_path}` : null,
      role: 'director'
    })
  }
  for (const c of (m.credits?.cast || []).slice(0, 4)) {
    cast.push({
      name: c.name,
      character: c.character,
      photoUrl: c.profile_path ? `${IMG}/w185${c.profile_path}` : null,
      role: 'cast'
    })
  }
  const trailer = pickBestTrailer(m.videos?.results)
  const us = m.release_dates?.results.find((r) => r.iso_3166_1 === 'US')
  const cert = us?.release_dates.find((r) => r.certification)?.certification || null

  return {
    backdropUrl: m.backdrop_path ? `${IMG}/original${m.backdrop_path}` : null,
    overview: m.overview,
    extras: {
      tagline: m.tagline || null,
      runtimeMinutes: m.runtime || null,
      ageRating: cert || null,
      trailerYoutubeId: trailer?.key || null,
      stills: (m.images?.backdrops || []).slice(0, 12).map((b) => `${IMG}/original${b.file_path}`),
      cast
    }
  }
}

export function mergeExtras(base: MediaExtras, enrich: MediaExtras): MediaExtras {
  return {
    tagline: enrich.tagline || base.tagline || null,
    runtimeMinutes: enrich.runtimeMinutes || base.runtimeMinutes || null,
    ageRating: enrich.ageRating || base.ageRating || null,
    trailerYoutubeId: enrich.trailerYoutubeId || base.trailerYoutubeId || null,
    stills: [...new Set([...(enrich.stills || []), ...(base.stills || [])])].slice(0, 16),
    cast: enrich.cast?.length ? enrich.cast : base.cast || []
  }
}

export type TmdbVideo = {
  site: string
  type: string
  key: string
  name?: string
  official?: boolean
  published_at?: string
}

export type TrailerInfo = {
  key: string
  name: string
  youtubeUrl: string
  embedUrl: string
}

export function buildTrailerInfo(key: string, name = 'Official Trailer'): TrailerInfo {
  return {
    key,
    name,
    youtubeUrl: `https://www.youtube.com/watch?v=${key}`,
    embedUrl: `https://www.youtube-nocookie.com/embed/${key}?autoplay=1&rel=0&modestbranding=1&playsinline=1`
  }
}

export function youtubeTrailerSearchUrl(title: string): string {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(`${title} official trailer`)}`
}

/** Prefer official YouTube Trailer, then any Trailer, then Teaser. */
export function pickBestTrailer(videos: TmdbVideo[] | undefined | null): TrailerInfo | null {
  if (!videos?.length) return null
  const yt = videos.filter((v) => v.site === 'YouTube' && v.key)
  const officialTrailer = yt.find((v) => v.type === 'Trailer' && v.official)
  const anyTrailer = yt.find((v) => v.type === 'Trailer')
  const teaser =
    yt.find((v) => v.type === 'Teaser' && v.official) || yt.find((v) => v.type === 'Teaser')
  const best = officialTrailer || anyTrailer || teaser
  if (!best) return null
  return buildTrailerInfo(best.key, best.name || 'Official Trailer')
}

export async function fetchTmdbVideos(
  apiKey: string,
  mediaType: 'movie' | 'tv',
  id: number
): Promise<TrailerInfo | null> {
  if (!apiKey || !id) return null
  try {
    const data = await tmdb<{ results: TmdbVideo[] }>(apiKey, `/${mediaType}/${id}/videos`)
    return pickBestTrailer(data.results)
  } catch {
    return null
  }
}

type TmdbLogo = {
  file_path: string
  iso_639_1: string | null
  aspect_ratio?: number
  width?: number
  height?: number
}

/** Official transparent title logo for hero (English preferred). */
export async function fetchTitleLogoUrl(
  apiKey: string,
  opts: {
    imdbId?: string | null
    tmdbId?: number | null
    mediaType: 'movie' | 'series' | 'anime'
  }
): Promise<string | null> {
  if (!apiKey) return null
  const kind: 'movie' | 'tv' = opts.mediaType === 'series' || opts.mediaType === 'anime' ? 'tv' : 'movie'

  let tmdbId = opts.tmdbId || null
  if (!tmdbId && opts.imdbId) {
    try {
      const find = await tmdb<{
        movie_results: { id: number }[]
        tv_results: { id: number }[]
      }>(apiKey, `/find/${encodeURIComponent(opts.imdbId)}`, { external_source: 'imdb_id' })
      tmdbId =
        kind === 'tv'
          ? find.tv_results[0]?.id || null
          : find.movie_results[0]?.id || find.tv_results[0]?.id || null
    } catch {
      return null
    }
  }
  if (!tmdbId) return null

  try {
    const data = await tmdb<{ logos: TmdbLogo[] }>(apiKey, `/${kind}/${tmdbId}/images`, {
      include_image_language: 'en,null'
    })
    const logos = data.logos || []
    if (!logos.length) return null
    const en = logos.find((l) => l.iso_639_1 === 'en')
    const neutral = logos.find((l) => !l.iso_639_1)
    const pick = en || neutral || logos[0]
    if (!pick?.file_path) return null
    return `${IMG}/original${pick.file_path}`
  } catch {
    return null
  }
}

