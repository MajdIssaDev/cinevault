import {
  buildTrailerInfo,
  fetchTmdbVideos,
  resolveTmdbApiKey,
  youtubeTrailerSearchUrl,
  type TrailerInfo
} from '../api/tmdb'
import { fetchMovieDetails } from '../api/ytsCatalog'
import type { CatalogItem } from '../types'
import { openExternal } from './openExternal'

/**
 * Resolve the best in-app trailer for a catalog item.
 * Order: known YouTube id → TMDB videos → YTS movie trailer → YouTube search (external).
 */
export async function resolveTrailerForItem(
  item: Pick<CatalogItem, 'title' | 'mediaType' | 'externalId' | 'imdbId'>,
  opts?: {
    youtubeId?: string | null
    tmdbApiKey?: string | null
  }
): Promise<{ trailer: TrailerInfo | null; searchUrl: string }> {
  const searchUrl = youtubeTrailerSearchUrl(item.title)

  if (opts?.youtubeId) {
    return { trailer: buildTrailerInfo(opts.youtubeId, `${item.title} Trailer`), searchUrl }
  }

  const key = resolveTmdbApiKey(opts?.tmdbApiKey)
  if (key && item.mediaType !== 'anime') {
    // YTS / TVMaze ids ≠ TMDB ids for movies/series — try enrich path via existing id only when TMDB-native
    // Catalog movies use YTS ids; series use TVMaze. Prefer IMDb enrich when available.
    if (item.imdbId) {
      try {
        const { enrichFromImdb } = await import('../api/tmdb')
        const enrich = await enrichFromImdb(
          key,
          item.imdbId,
          item.mediaType === 'series' ? 'tv' : 'movie'
        )
        if (enrich?.extras.trailerYoutubeId) {
          return {
            trailer: buildTrailerInfo(
              enrich.extras.trailerYoutubeId,
              `${item.title} Trailer`
            ),
            searchUrl
          }
        }
      } catch {
        /* continue */
      }
    }
  }

  if (item.mediaType === 'movie') {
    try {
      const { extras } = await fetchMovieDetails(item.externalId)
      if (extras.trailerYoutubeId) {
        return {
          trailer: buildTrailerInfo(extras.trailerYoutubeId, `${item.title} Trailer`),
          searchUrl
        }
      }
    } catch {
      /* continue */
    }
  }

  return { trailer: null, searchUrl }
}

export async function openTrailerSearch(title: string): Promise<void> {
  await openExternal(youtubeTrailerSearchUrl(title))
}

export { openExternal, fetchTmdbVideos }
