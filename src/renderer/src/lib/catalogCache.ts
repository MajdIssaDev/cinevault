import type { CatalogItem } from '../types'

const TTL_MS = 15 * 60 * 1000

interface CacheEntry {
  at: number
  items: CatalogItem[]
  lastPage: number
}

const cache = new Map<string, CacheEntry>()

export function catalogCacheKey(
  mediaType: string,
  searchQuery: string,
  genreFilter: string
): string {
  return `${mediaType}|${searchQuery.trim().toLowerCase()}|${genreFilter}`
}

export function getCatalogCache(key: string): { items: CatalogItem[]; lastPage: number } | null {
  const hit = cache.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > TTL_MS) {
    cache.delete(key)
    return null
  }
  return { items: hit.items, lastPage: hit.lastPage }
}

export function setCatalogCache(key: string, items: CatalogItem[], lastPage: number): void {
  cache.set(key, { at: Date.now(), items, lastPage })
}
