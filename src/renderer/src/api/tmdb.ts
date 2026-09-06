import type { CatalogItem, CastMember, EpisodeInfo, MediaExtras, SeasonInfo } from '../types'
import { GENRE_MOVIE, GENRE_TV } from '../types'
import { filterNarrativeCatalogItems } from '../lib/catalogContentFilter'

const IMG = 'https://image.tmdb.org/t/p'

const STILL_LIMIT = 24
const MAIN_CAST_LIMIT = 10

/**
 * Built-in TMDB v3 key so cast / stills / logos work without a Settings step.
 * A user key in Settings (or VITE_TMDB_API_KEY) overrides this.
 */
const BUILTIN_TMDB_API_KEY = '8265bd1679663a7ea12ac168da84d2e8'

/** Prefer Settings → Vite env → built-in app key. */
export function resolveTmdbApiKey(settingsKey?: string | null): string {
  const fromSettings = settingsKey?.trim() || ''
  if (fromSettings) return fromSettings
  try {
    const fromEnv = String(
      (import.meta as ImportMeta & { env?: { VITE_TMDB_API_KEY?: string } }).env
        ?.VITE_TMDB_API_KEY || ''
    ).trim()
    if (fromEnv) return fromEnv
  } catch {
    /* non-Vite */
  }
  return BUILTIN_TMDB_API_KEY
}

type TmdbCastCredit = {
  id?: number
  order?: number
  name: string
  character: string
  profile_path: string | null
}
type TmdbCrewCredit = {
  id?: number
  job: string
  name: string
  profile_path: string | null
}
type TmdbBackdrop = {
  file_path: string
  vote_average?: number
  vote_count?: number
  iso_639_1?: string | null
  width?: number
  height?: number
  aspect_ratio?: number
}

/** Top-billed cast + a few key crew (director, writer, composer, DoP). */
function pickCastAndCrew(credits?: {
  cast?: TmdbCastCredit[]
  crew?: TmdbCrewCredit[]
}): CastMember[] {
  const out: CastMember[] = []
  const seen = new Set<string>()

  const push = (member: CastMember): void => {
    const key = `${member.tmdbPersonId ?? member.name}|${member.role}|${member.character ?? ''}`
    if (seen.has(key)) return
    seen.add(key)
    out.push(member)
  }

  const castSorted = [...(credits?.cast || [])].sort(
    (a, b) => (a.order ?? 9999) - (b.order ?? 9999)
  )
  for (const c of castSorted.slice(0, MAIN_CAST_LIMIT)) {
    push({
      name: c.name,
      character: c.character || null,
      photoUrl: c.profile_path ? `${IMG}/w185${c.profile_path}` : null,
      role: 'cast',
      tmdbPersonId: c.id ?? null
    })
  }

  const crewJobs: { job: string; label: string; role: CastMember['role'] }[] = [
    { job: 'Director', label: 'Director', role: 'director' },
    { job: 'Series Director', label: 'Director', role: 'director' },
    { job: 'Screenplay', label: 'Screenplay', role: 'crew' },
    { job: 'Writer', label: 'Writer', role: 'crew' },
    { job: 'Story', label: 'Story', role: 'crew' },
    { job: 'Original Music Composer', label: 'Composer', role: 'crew' },
    { job: 'Director of Photography', label: 'Cinematography', role: 'crew' },
    { job: 'Producer', label: 'Producer', role: 'crew' }
  ]

  const crew = credits?.crew || []
  let crewAdded = 0
  for (const { job, label, role } of crewJobs) {
    if (crewAdded >= 5) break
    const person = crew.find((c) => c.job === job)
    if (!person) continue
    if (role === 'director' && out.some((m) => m.role === 'director')) continue
    push({
      name: person.name,
      character: label,
      photoUrl: person.profile_path ? `${IMG}/w185${person.profile_path}` : null,
      role,
      tmdbPersonId: person.id ?? null
    })
    crewAdded++
  }

  return out
}

/** Prefer highly voted official backdrops; include untagged language images. */
function mapOfficialStills(backdrops: TmdbBackdrop[] | undefined, limit = STILL_LIMIT): string[] {
  const ranked = [...(backdrops || [])].sort((a, b) => {
    const score = (x: TmdbBackdrop): number =>
      (x.vote_average || 0) * 10 + (x.vote_count || 0) * 0.01
    return score(b) - score(a)
  })
  const urls: string[] = []
  const seen = new Set<string>()
  for (const b of ranked) {
    if (!b.file_path || seen.has(b.file_path)) continue
    seen.add(b.file_path)
    urls.push(`${IMG}/original${b.file_path}`)
    if (urls.length >= limit) break
  }
  return urls
}

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
    genres: (m.genre_ids || []).map((id) => GENRE_MOVIE[id]).filter(Boolean),
    genreIds: m.genre_ids || []
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
    genres: (m.genre_ids || []).map((id) => GENRE_TV[id]).filter(Boolean),
    genreIds: m.genre_ids || []
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
    query,
    include_adult: 'false'
  })
  return filterNarrativeCatalogItems(
    data.results.map((row) => ({ ...mapMovie(row), provider: 'tmdb' as const }))
  )
}

export async function searchSeries(apiKey: string, query: string): Promise<CatalogItem[]> {
  const data = await tmdb<{ results: Parameters<typeof mapTv>[0][] }>(apiKey, '/search/tv', {
    query,
    include_adult: 'false'
  })
  return filterNarrativeCatalogItems(
    data.results.map((row) => ({ ...mapTv(row), provider: 'tmdb' as const }))
  )
}

type TmdbMultiRow = {
  id: number
  media_type: 'movie' | 'tv' | 'person'
  title?: string
  name?: string
  overview?: string
  poster_path?: string | null
  backdrop_path?: string | null
  release_date?: string
  first_air_date?: string
  vote_average?: number
  genre_ids?: number[]
}

/**
 * Literal multi-search. Do not pass year / vote_count filters — relevance order only.
 * Drops `person` results.
 */
export async function searchMulti(
  apiKey: string,
  query: string,
  page = 1
): Promise<CatalogItem[]> {
  const data = await tmdb<{ results: TmdbMultiRow[] }>(apiKey, '/search/multi', {
    query,
    include_adult: 'false',
    page: String(page)
  })

  const out: CatalogItem[] = []
  for (const row of data.results || []) {
    if (row.media_type === 'person') continue
    if (row.media_type === 'movie') {
      out.push({
        ...mapMovie({
          id: row.id,
          title: row.title || row.name || 'Untitled',
          overview: row.overview || '',
          poster_path: row.poster_path ?? null,
          backdrop_path: row.backdrop_path ?? null,
          release_date: row.release_date,
          vote_average: row.vote_average || 0,
          genre_ids: row.genre_ids
        }),
        provider: 'tmdb'
      })
    } else if (row.media_type === 'tv') {
      out.push({
        ...mapTv({
          id: row.id,
          name: row.name || row.title || 'Untitled',
          overview: row.overview || '',
          poster_path: row.poster_path ?? null,
          backdrop_path: row.backdrop_path ?? null,
          first_air_date: row.first_air_date,
          vote_average: row.vote_average || 0,
          genre_ids: row.genre_ids
        }),
        provider: 'tmdb'
      })
    }
  }
  return filterNarrativeCatalogItems(out)
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

/**
 * Personalized / fallback shelf rows.
 * - With genres: discover sorted by popularity, vote_average ≥ 6.5
 * - Without: weekly trending
 * Anime uses TV discover with Animation + ja (or trending TV filtered to anime).
 */
export async function fetchForYouRecommendations(
  apiKey: string,
  catalogType: 'movie' | 'series' | 'anime',
  genreIds: number[],
  excludeIds: Set<number>,
  page = 1
): Promise<CatalogItem[]> {
  const api = key(apiKey)
  if (!api) return []

  const mapResults = (
    results: Array<Parameters<typeof mapMovie>[0] | Parameters<typeof mapTv>[0]>,
    asAnime: boolean
  ): CatalogItem[] => {
    const out: CatalogItem[] = []
    for (const row of results) {
      if (excludeIds.has(row.id)) continue
      if (asAnime) {
        const gids = row.genre_ids || []
        const lang = 'original_language' in row ? (row as { original_language?: string }).original_language : undefined
        // Prefer anime signature; keep Animation-heavy rows if language missing on discover
        if (lang != null && lang !== 'ja') continue
        if (!gids.includes(16) && lang !== 'ja') continue
        const mapped = mapTv(row as Parameters<typeof mapTv>[0])
        out.push({ ...mapped, id: `anime-${row.id}`, mediaType: 'anime', provider: 'tmdb' })
      } else if (catalogType === 'movie') {
        out.push({ ...mapMovie(row as Parameters<typeof mapMovie>[0]), provider: 'tmdb' })
      } else {
        out.push({ ...mapTv(row as Parameters<typeof mapTv>[0]), provider: 'tmdb' })
      }
      if (out.length >= 24) break
    }
    return filterNarrativeCatalogItems(out)
  }

  if (catalogType === 'anime') {
    const params: Record<string, string> = {
      page: String(page),
      sort_by: 'popularity.desc',
      with_genres: genreIds.length ? [...new Set([16, ...genreIds])].join(',') : '16',
      with_original_language: 'ja',
      'vote_average.gte': '6.5'
    }
    try {
      const data = await tmdb<{
        results: Array<Parameters<typeof mapTv>[0] & { original_language?: string }>
      }>(api, '/discover/tv', params)
      const mapped = mapResults(data.results, true)
      if (mapped.length) return mapped
    } catch {
      /* fall through to trending */
    }
    const trend = await tmdb<{
      results: Array<Parameters<typeof mapTv>[0] & { original_language?: string }>
    }>(api, '/trending/tv/week', { page: String(page) })
    return mapResults(trend.results, true)
  }

  const tmdbType = catalogType === 'movie' ? 'movie' : 'tv'
  if (genreIds.length > 0) {
    const data = await tmdb<{
      results: Array<(Parameters<typeof mapMovie>[0] | Parameters<typeof mapTv>[0]) & { original_language?: string }>
    }>(api, `/discover/${tmdbType}`, {
      with_genres: genreIds.join(','),
      page: String(page),
      sort_by: 'popularity.desc',
      'vote_average.gte': '6.5'
    })
    // Movies/TV shelves exclude anime signature
    const filtered = data.results.filter((row) => {
      const gids = row.genre_ids || []
      const lang = row.original_language
      if (gids.includes(16) && lang === 'ja') return false
      return true
    })
    return mapResults(filtered, false)
  }

  const trend = await tmdb<{
    results: Array<(Parameters<typeof mapMovie>[0] | Parameters<typeof mapTv>[0]) & { original_language?: string }>
  }>(api, `/trending/${tmdbType}/week`, { page: String(page) })
  const filtered = trend.results.filter((row) => {
    const gids = row.genre_ids || []
    const lang = row.original_language
    if (gids.includes(16) && lang === 'ja') return false
    return true
  })
  return mapResults(filtered, false)
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
        crew: TmdbCrewCredit[]
        cast: TmdbCastCredit[]
      }
      images?: { backdrops: TmdbBackdrop[] }
      videos?: { results: { site: string; type: string; key: string; name?: string; official?: boolean }[] }
      content_ratings?: { results: { iso_3166_1: string; rating: string }[] }
    }>(apiKey, `/tv/${tmdbId}`, {
      append_to_response: 'credits,images,videos,content_ratings',
      // en + null so untagged official stills are included (otherwise often ~3)
      include_image_language: 'en,null'
    })
    const cast = pickCastAndCrew(m.credits)
    const stills = mapOfficialStills(m.images?.backdrops)
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
        stills,
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
      crew: TmdbCrewCredit[]
      cast: TmdbCastCredit[]
    }
    images?: { backdrops: TmdbBackdrop[] }
    videos?: { results: { site: string; type: string; key: string; name?: string; official?: boolean }[] }
    release_dates?: {
      results: { iso_3166_1: string; release_dates: { certification: string }[] }[]
    }
  }>(apiKey, `/movie/${tmdbId}`, {
    append_to_response: 'credits,images,videos,release_dates',
    include_image_language: 'en,null'
  })

  const cast = pickCastAndCrew(m.credits)
  const stills = mapOfficialStills(m.images?.backdrops)
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
      stills,
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
    stills: [...new Set([...(enrich.stills || []), ...(base.stills || [])])].slice(0, STILL_LIMIT),
    // Prefer TMDB top-billed + crew over YTS bit-part lists
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

async function resolveTmdbIdForMedia(
  apiKey: string,
  opts: {
    imdbId?: string | null
    tmdbId?: number | null
    mediaType: 'movie' | 'series' | 'anime'
    provider?: CatalogItem['provider']
    externalId?: number
  }
): Promise<{ kind: 'movie' | 'tv'; tmdbId: number } | null> {
  const kind: 'movie' | 'tv' =
    opts.mediaType === 'series' || opts.mediaType === 'anime' ? 'tv' : 'movie'

  if (opts.provider === 'tmdb' && opts.externalId) {
    return { kind, tmdbId: opts.externalId }
  }
  if (opts.tmdbId) return { kind, tmdbId: opts.tmdbId }

  if (opts.imdbId) {
    try {
      const find = await tmdb<{
        movie_results: { id: number }[]
        tv_results: { id: number }[]
      }>(apiKey, `/find/${encodeURIComponent(opts.imdbId)}`, { external_source: 'imdb_id' })
      const id =
        kind === 'tv'
          ? find.tv_results[0]?.id || null
          : find.movie_results[0]?.id || find.tv_results[0]?.id || null
      if (id) return { kind, tmdbId: id }
    } catch {
      return null
    }
  }
  return null
}

/** Full backdrop set for hero selection (`include_image_language=en,null`). */
export async function fetchTitleBackdrops(
  apiKey: string,
  opts: {
    imdbId?: string | null
    tmdbId?: number | null
    mediaType: 'movie' | 'series' | 'anime'
    provider?: CatalogItem['provider']
    externalId?: number
  }
): Promise<{
  backdrops: Array<{
    file_path: string
    width: number
    height: number
    aspect_ratio: number
    vote_average: number
    vote_count: number
    iso_639_1: string | null
  }>
  fallbackPath: string | null
}> {
  if (!apiKey) return { backdrops: [], fallbackPath: null }
  const resolved = await resolveTmdbIdForMedia(apiKey, opts)
  if (!resolved) return { backdrops: [], fallbackPath: null }

  try {
    const data = await tmdb<{
      backdrops?: TmdbBackdrop[]
    }>(apiKey, `/${resolved.kind}/${resolved.tmdbId}/images`, {
      include_image_language: 'en,null'
    })

    const backdrops = (data.backdrops || [])
      .filter((b) => Boolean(b.file_path))
      .map((b) => ({
        file_path: b.file_path,
        width: b.width || 0,
        height: b.height || 0,
        aspect_ratio:
          b.aspect_ratio || (b.width && b.height ? b.width / b.height : 1.778),
        vote_average: b.vote_average || 0,
        vote_count: b.vote_count || 0,
        iso_639_1: b.iso_639_1 ?? null
      }))

    return {
      backdrops,
      fallbackPath: backdrops[0]?.file_path || null
    }
  } catch {
    return { backdrops: [], fallbackPath: null }
  }
}

const personImdbCache = new Map<number, string | null>()

/** Resolve a TMDB person id → IMDb `nm…` id (cached). */
export async function getPersonImdbId(
  apiKey: string,
  personId: number
): Promise<string | null> {
  if (!apiKey || !personId) return null
  if (personImdbCache.has(personId)) return personImdbCache.get(personId) ?? null
  try {
    const data = await tmdb<{ imdb_id?: string | null }>(
      apiKey,
      `/person/${personId}/external_ids`
    )
    const id = data.imdb_id?.trim() || null
    personImdbCache.set(personId, id)
    return id
  } catch (err) {
    console.error('Failed to fetch person external IDs:', err)
    personImdbCache.set(personId, null)
    return null
  }
}

