import type { CatalogItem } from '../types'

const TMDB_MUSIC = 10402
const TMDB_DOCUMENTARY = 99
const TMDB_TV_MOVIE = 10770

const CONCERT_TITLE_RE =
  /\b(concert|live\s+(at|from|in|on)|summer\s+night\s+concert|sommernachtskonzert|philharmoniker|philharmonic|orchestra\s+live|music\s+festival|new\s+year'?s?\s+(concert|eve)|gala\s+concert)\b/i

/**
 * Concerts / filmed performances tagged Music — not narrative musical movies.
 * Keeps musicals (Music + Drama/Comedy/Romance/…) and drops Music-only
 * (or Music + Documentary / TV Movie) and obvious concert titles.
 */
export function isNonNarrativeMusicContent(item: {
  title?: string | null
  overview?: string | null
  genres?: string[] | null
  genreIds?: number[] | null
}): boolean {
  const title = (item.title || '').trim()
  if (title && CONCERT_TITLE_RE.test(title)) return true

  const names = (item.genres || []).map((g) => g.trim().toLowerCase()).filter(Boolean)
  const ids = item.genreIds || []
  const hasMusic = names.includes('music') || ids.includes(TMDB_MUSIC)
  if (!hasMusic) return false

  const narrativeNames = names.filter(
    (n) => n !== 'music' && n !== 'documentary' && n !== 'tv movie'
  )
  const narrativeIds = ids.filter(
    (id) => id !== TMDB_MUSIC && id !== TMDB_DOCUMENTARY && id !== TMDB_TV_MOVIE
  )

  return narrativeNames.length === 0 && narrativeIds.length === 0
}

export function filterNarrativeCatalogItems<T extends CatalogItem>(items: T[]): T[] {
  return items.filter((item) => !isNonNarrativeMusicContent(item))
}
