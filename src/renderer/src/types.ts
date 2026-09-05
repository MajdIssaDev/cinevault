export type MediaType = 'movie' | 'series' | 'anime'

export type Quality = '720p' | '1080p' | '1440p' | '2160p'

export interface CatalogItem {
  id: string
  externalId: number
  mediaType: MediaType
  title: string
  overview: string
  posterUrl: string | null
  backdropUrl: string | null
  releaseDate: string | null
  rating: number
  genres: string[]
  imdbId?: string | null
}

export interface CastMember {
  name: string
  character?: string | null
  photoUrl?: string | null
  role: 'director' | 'cast'
  /** IMDb person id (nm…) when known */
  imdbId?: string | null
  /** TMDB person id when known */
  tmdbPersonId?: number | null
}

export interface MediaExtras {
  tagline?: string | null
  runtimeMinutes?: number | null
  ageRating?: string | null
  trailerYoutubeId?: string | null
  stills?: string[]
  cast?: CastMember[]
}

export interface SeasonInfo {
  seasonNumber: number
  name: string
  episodeCount: number
  posterUrl?: string | null
}

export interface EpisodeInfo {
  id: string
  seasonNumber: number
  episodeNumber: number
  title: string
  overview: string
  stillUrl?: string | null
  airDate?: string | null
  runtime?: number | null
}

export interface StreamSource {
  id: string
  label: string
  quality: Quality | 'unknown'
  url: string
  kind: 'local' | 'http' | 'hls' | 'torrent'
  hdr?: boolean
  spatialAudio?: boolean
  /** Cinema audio (DDP/AC3/DTS/…) — play via local FFmpeg remux proxy. */
  needsAudioRemux?: boolean
}

export interface FavoriteEntry {
  id: string
  mediaType: MediaType
  externalId: number
  title: string
  posterUrl: string | null
  releaseDate: string | null
}

export interface PlaybackSession {
  cacheId: string
  title: string
  mediaType: MediaType
  externalId: number
  season?: number
  episode?: number
  episodeTitle?: string
  showTitle?: string
  posterUrl?: string | null
  backdropUrl?: string | null
  imdbId?: string | null
  source: StreamSource
  subtitlePath?: string | null
  subtitleUrl?: string | null
  subtitleLabel?: string
  /** ISO subtitle language used when starting playback (e.g. en, ar) */
  subtitleLang?: string
  resolution: Quality
  resumeSeconds?: number
  /** Catalog/TMDB runtime in seconds — used when remuxed streams omit duration. */
  runtimeSeconds?: number
}

export const GENRE_MOVIE: Record<number, string> = {
  28: 'Action',
  12: 'Adventure',
  16: 'Animation',
  35: 'Comedy',
  80: 'Crime',
  99: 'Documentary',
  18: 'Drama',
  10751: 'Family',
  14: 'Fantasy',
  36: 'History',
  27: 'Horror',
  10402: 'Music',
  9648: 'Mystery',
  10749: 'Romance',
  878: 'Sci-Fi',
  10770: 'TV Movie',
  53: 'Thriller',
  10752: 'War',
  37: 'Western'
}

export const GENRE_TV: Record<number, string> = {
  10759: 'Action & Adventure',
  16: 'Animation',
  35: 'Comedy',
  80: 'Crime',
  99: 'Documentary',
  18: 'Drama',
  10751: 'Family',
  10762: 'Kids',
  9648: 'Mystery',
  10763: 'News',
  10764: 'Reality',
  10765: 'Sci-Fi & Fantasy',
  10766: 'Soap',
  10767: 'Talk',
  10768: 'War & Politics',
  37: 'Western'
}
