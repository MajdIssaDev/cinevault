import { GENRE_MOVIE, GENRE_TV } from '../types'

/** Combined TMDB genre id → name map (movies + TV). */
export const TMDB_GENRE_MAP: Record<number, string> = {
  ...GENRE_TV,
  ...GENRE_MOVIE
}

export function mediaTypeLabel(mediaType: string | undefined): string {
  switch (mediaType) {
    case 'movie':
      return 'Movie'
    case 'series':
    case 'tv':
      return 'Series'
    case 'anime':
      return 'Anime'
    default:
      return mediaType ? mediaType.charAt(0).toUpperCase() + mediaType.slice(1) : ''
  }
}

export type GenreResolvable = {
  genre?: string | null
  genres?: Array<string | { name: string }> | null
  genre_ids?: number[] | null
  genreIds?: number[] | null
  mediaType?: string | null
}

/** Pick a primary genre string for card subtitles / Watch Later persistence. */
export function resolveGenre(item: GenreResolvable): string {
  if (item.genre && String(item.genre).trim()) return String(item.genre).trim()

  if (item.genres && item.genres.length > 0) {
    const first = item.genres[0]
    if (typeof first === 'string' && first.trim()) return first.trim()
    if (first && typeof first === 'object' && 'name' in first && first.name) {
      return String(first.name).trim()
    }
  }

  const ids = item.genre_ids || item.genreIds
  if (ids && ids.length > 0) {
    const name = TMDB_GENRE_MAP[ids[0]]
    if (name) return name
  }

  const typeLabel = mediaTypeLabel(item.mediaType || undefined)
  return typeLabel || 'Feature'
}
