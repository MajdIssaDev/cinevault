import type { CatalogItem } from '../types'
import { resolveHeroBackdropUrl, upgradeImageUrl } from './heroImage'
import { selectOptimalHeroBackdrop } from './heroBackdrop'
import { resolveTitleLogoForItem, preloadTitleLogo } from './titleLogoCache'
import { fetchTitleBackdrops, resolveTmdbApiKey } from '../api/tmdb'
import { fetchMovieDetails } from '../api/ytsCatalog'

export const FEATURED_DECK_MAX = 5
export const FEATURED_SLIDE_MS = 7000

export interface FeaturedSlide {
  id: string
  item: CatalogItem
  title: string
  overview: string
  year: string
  rating: number
  genres: string[]
  backdropUrl: string
  logoUrl: string | null
}

function preloadImage(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => resolve(true)
    img.onerror = () => resolve(false)
    img.src = url
    if (img.complete && img.naturalWidth > 0) resolve(true)
  })
}

/** Top N trending catalog rows that have a landscape backdrop. */
export function pickFeaturedCandidates(items: CatalogItem[], max = FEATURED_DECK_MAX): CatalogItem[] {
  const out: CatalogItem[] = []
  const seen = new Set<string>()
  for (const item of items) {
    if (!item.backdropUrl) continue
    if (seen.has(item.id)) continue
    seen.add(item.id)
    out.push(item)
    if (out.length >= max) break
  }
  return out
}

function fallbackBackdropPath(url: string | null | undefined): string | null {
  if (!url) return null
  const m = url.match(/\/t\/p\/(?:original|w\d+)(\/[^?#]+)/i)
  return m?.[1] || null
}

/**
 * Prefer TMDB textless scenic hero art; fall back to YTS stills / list backdrop.
 */
async function resolveBackdrop(
  item: CatalogItem,
  tmdbApiKey?: string | null
): Promise<string> {
  const listFallback =
    resolveHeroBackdropUrl(item.backdropUrl) || item.backdropUrl || ''
  const apiKey = resolveTmdbApiKey(tmdbApiKey)

  if (apiKey) {
    try {
      let imdbId = item.imdbId || null
      // YTS catalog rows often lack imdb until details — resolve for hero art.
      if (!imdbId && item.provider !== 'tmdb' && item.mediaType === 'movie' && item.externalId) {
        try {
          const { item: full } = await fetchMovieDetails(item.externalId)
          imdbId = full.imdbId || null
        } catch {
          /* keep going without imdb */
        }
      }

      const { backdrops, fallbackPath } = await fetchTitleBackdrops(apiKey, {
        imdbId,
        mediaType: item.mediaType,
        provider: item.provider,
        externalId: item.externalId,
        tmdbId: item.provider === 'tmdb' ? item.externalId : null
      })

      const chosen = selectOptimalHeroBackdrop(
        backdrops,
        fallbackPath || fallbackBackdropPath(item.backdropUrl)
      )
      if (chosen) return upgradeImageUrl(chosen)
    } catch {
      /* fall through */
    }
  }

  // Legacy YTS still sharpening when TMDB art unavailable
  if (item.mediaType === 'movie' && item.externalId && item.provider !== 'tmdb') {
    try {
      const { item: full, extras } = await fetchMovieDetails(item.externalId)
      const sharp =
        extras.stills?.find((u) => /large[-_]?screenshot|\/(?:original|w1280|w1920)\//i.test(u)) ||
        extras.stills?.[0]
      if (sharp) return upgradeImageUrl(sharp)
      if (full.backdropUrl) {
        return resolveHeroBackdropUrl(full.backdropUrl) || listFallback
      }
    } catch {
      /* keep list backdrop */
    }
  }

  return upgradeImageUrl(listFallback)
}

/**
 * Build a ≤5 slide deck with optimal TMDB backdrops + logos, then eagerly decode every asset.
 */
export async function buildFeaturedDeck(
  items: CatalogItem[],
  tmdbApiKey?: string | null
): Promise<FeaturedSlide[]> {
  const candidates = pickFeaturedCandidates(items)
  const slides = await Promise.all(
    candidates.map(async (item) => {
      const [backdropUrl, logoUrl] = await Promise.all([
        resolveBackdrop(item, tmdbApiKey),
        resolveTitleLogoForItem(item, tmdbApiKey)
      ])
      return {
        id: item.id,
        item: logoUrl ? { ...item, titleLogoUrl: logoUrl } : item,
        title: item.title,
        overview: item.overview?.replace(/\.{2,}$/, '').trim() || '',
        year: item.releaseDate?.slice(0, 4) || '',
        rating: item.rating > 0 ? item.rating : 0,
        genres: item.genres.slice(0, 3),
        backdropUrl,
        logoUrl
      } satisfies FeaturedSlide
    })
  )

  await Promise.all(
    slides.flatMap((s) => {
      const jobs: Promise<boolean>[] = [preloadImage(s.backdropUrl)]
      if (s.logoUrl) jobs.push(preloadTitleLogo(s.logoUrl))
      return jobs
    })
  )

  return slides.filter((s) => Boolean(s.backdropUrl))
}
