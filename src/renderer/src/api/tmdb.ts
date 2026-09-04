import type { CatalogItem, EpisodeInfo, SeasonInfo } from '../types'
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
    backdropUrl: m.backdrop_path ? `${IMG}/w1280${m.backdrop_path}` : null,
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
    backdropUrl: m.backdrop_path ? `${IMG}/w1280${m.backdrop_path}` : null,
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

export async function fetchPopularSeries(apiKey: string, page = 1): Promise<CatalogItem[]> {
  const data = await tmdb<{ results: Parameters<typeof mapTv>[0][] }>(apiKey, '/tv/popular', {
    page: String(page)
  })
  return data.results.map(mapTv)
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
    backdropUrl: m.backdrop_path ? `${IMG}/w1280${m.backdrop_path}` : null,
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
      backdropUrl: m.backdrop_path ? `${IMG}/w1280${m.backdrop_path}` : null,
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
