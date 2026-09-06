/**
 * Catalog text search — literal queries, TMDB relevance order, no year hijacking.
 */
import type { CatalogItem, MediaType } from '../types'
import { resolveTmdbApiKey, searchMulti } from '../api/tmdb'
import { filterNarrativeCatalogItems } from '../lib/catalogContentFilter'

const SPARSE_RESULT_THRESHOLD = 4

/** Normalize whitespace only — never reinterpret digits as release years. */
export function buildSearchQuery(rawQuery: string): string {
  return rawQuery.trim().replace(/\s+/g, ' ')
}

/**
 * For single-token queries like "spiderman", suggest a hyphenated form
 * ("spider-man") so TMDB can match punctuated titles.
 */
export function alternateHyphenQuery(query: string): string | null {
  const q = buildSearchQuery(query)
  if (!q || /[\s-]/.test(q)) return null

  const camel = q.replace(/([a-z])([A-Z])/g, '$1-$2')
  if (camel !== q) return camel.toLowerCase()

  const suffix = q.replace(
    /(man|men|woman|boy|girl|wars|trek|verse|force|panther|widow|pool)$/i,
    '-$1'
  )
  if (suffix !== q && suffix.includes('-') && !suffix.startsWith('-')) {
    return suffix.toLowerCase()
  }

  return null
}

function mergeUnique(existing: CatalogItem[], next: CatalogItem[]): CatalogItem[] {
  const seen = new Set(existing.map((i) => i.id))
  const out = [...existing]
  for (const item of next) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    out.push(item)
  }
  return out
}

function filterForCatalogTab(items: CatalogItem[], mediaType: MediaType): CatalogItem[] {
  if (mediaType === 'movie') {
    return filterNarrativeCatalogItems(
      items
        .filter((i) => i.mediaType === 'movie')
        .map((i) => ({ ...i, provider: 'tmdb' as const }))
    )
  }
  if (mediaType === 'series') {
    return filterNarrativeCatalogItems(
      items
        .filter((i) => i.mediaType === 'series')
        .map((i) => ({ ...i, mediaType: 'series' as const, provider: 'tmdb' as const }))
    )
  }
  // Anime tab: TMDB tv rows remapped as anime (detail resolves via tmdb- prefix).
  return filterNarrativeCatalogItems(
    items
      .filter((i) => i.mediaType === 'series' || i.mediaType === 'anime')
      .map((i) => ({
        ...i,
        id: `anime-${i.externalId}`,
        mediaType: 'anime' as const,
        provider: 'tmdb' as const
      }))
  )
}

/**
 * TMDB `/search/multi` text search.
 * - Query is always literal (`query=`), never `primary_release_year` / `year`.
 * - No client re-sort; TMDB relevance order is preserved.
 * - No `vote_count.gte` filters.
 * - People (`media_type=person`) are dropped.
 * - Sparse single-token hits also try a hyphenated alternate (e.g. spiderman → spider-man).
 */
export async function searchCatalog(
  apiKey: string | null | undefined,
  rawQuery: string,
  mediaType: MediaType,
  page = 1
): Promise<CatalogItem[]> {
  const key = resolveTmdbApiKey(apiKey)
  const query = buildSearchQuery(rawQuery)
  if (!key || !query) return []

  const primary = filterForCatalogTab(await searchMulti(key, query, page), mediaType)

  if (page === 1 && primary.length < SPARSE_RESULT_THRESHOLD) {
    const alt = alternateHyphenQuery(query)
    if (alt && alt.toLowerCase() !== query.toLowerCase()) {
      const secondary = filterForCatalogTab(await searchMulti(key, alt, page), mediaType)
      return mergeUnique(primary, secondary)
    }
  }

  return primary
}
