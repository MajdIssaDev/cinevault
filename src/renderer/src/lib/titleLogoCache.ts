import { fetchTitleLogoUrl, resolveTmdbApiKey } from '../api/tmdb'
import type { CatalogItem, MediaType } from '../types'

const urlByKey = new Map<string, string | null>()
const inflight = new Map<string, Promise<string | null>>()
const preloaded = new Set<string>()

function cacheKey(mediaType: MediaType, id: string, imdbId?: string | null): string {
  return `${mediaType}:${id}:${imdbId || ''}`
}

/** `undefined` = not fetched yet; `null` = fetched, no logo. */
export function getCachedTitleLogoUrl(
  mediaType: MediaType,
  id: string,
  imdbId?: string | null
): string | null | undefined {
  const key = cacheKey(mediaType, id, imdbId)
  if (!urlByKey.has(key)) return undefined
  return urlByKey.get(key) ?? null
}

export function rememberTitleLogoUrl(
  mediaType: MediaType,
  id: string,
  imdbId: string | null | undefined,
  url: string | null
): void {
  urlByKey.set(cacheKey(mediaType, id, imdbId), url)
}

/** Decode into the browser image cache so the first paint can use the logo. */
export function preloadTitleLogo(url: string | null | undefined): Promise<boolean> {
  if (!url) return Promise.resolve(false)
  if (preloaded.has(url)) return Promise.resolve(true)
  return new Promise((resolve) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => {
      preloaded.add(url)
      resolve(true)
    }
    img.onerror = () => resolve(false)
    img.src = url
    if (img.complete && img.naturalWidth > 0) {
      preloaded.add(url)
      resolve(true)
    }
  })
}

export function isTitleLogoPreloaded(url: string | null | undefined): boolean {
  return Boolean(url && preloaded.has(url))
}

/**
 * Resolve + cache + preload a title logo for a catalog item.
 * Hits return the cached URL after ensuring the bitmap is warm.
 */
export async function resolveTitleLogoForItem(
  item: Pick<CatalogItem, 'id' | 'mediaType' | 'imdbId' | 'titleLogoUrl'>,
  tmdbApiKey?: string | null
): Promise<string | null> {
  if (item.titleLogoUrl) {
    rememberTitleLogoUrl(item.mediaType, item.id, item.imdbId, item.titleLogoUrl)
    await preloadTitleLogo(item.titleLogoUrl)
    return item.titleLogoUrl
  }

  const key = cacheKey(item.mediaType, item.id, item.imdbId)
  if (urlByKey.has(key)) {
    const cached = urlByKey.get(key) ?? null
    if (cached) await preloadTitleLogo(cached)
    return cached
  }

  const existing = inflight.get(key)
  if (existing) return existing

  const apiKey = resolveTmdbApiKey(tmdbApiKey)
  if (!apiKey) {
    urlByKey.set(key, null)
    return null
  }

  const task = fetchTitleLogoUrl(apiKey, {
    imdbId: item.imdbId,
    mediaType: item.mediaType
  })
    .then(async (url) => {
      urlByKey.set(key, url)
      if (url) await preloadTitleLogo(url)
      return url
    })
    .finally(() => {
      inflight.delete(key)
    })

  inflight.set(key, task)
  return task
}
