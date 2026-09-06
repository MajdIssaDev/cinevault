/**
 * Local Watch Later bookmarks — no accounts; persists in localStorage.
 */

import { resolveGenre } from '../lib/genres'

export type WatchLaterMediaType = 'movie' | 'tv' | 'anime'

export interface WatchLaterItem {
  id: string | number
  mediaType: WatchLaterMediaType
  title: string
  posterPath?: string
  backdropPath?: string
  voteAverage?: number
  releaseYear?: string
  /** Primary genre label persisted at bookmark time. */
  genre?: string
  addedAt: number
}

const STORAGE_KEY = 'cinevault_watch_later'
const CHANGE_EVENT = 'cinevault-watch-later'

function readAll(): WatchLaterItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as WatchLaterItem[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeAll(items: WatchLaterItem[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT))
  } catch {
    /* quota / private mode */
  }
}

function sameId(a: string | number, b: string | number): boolean {
  return String(a) === String(b)
}

export function getWatchLaterItems(): WatchLaterItem[] {
  return readAll().sort((a, b) => b.addedAt - a.addedAt)
}

export function isInWatchLater(id: string | number): boolean {
  return readAll().some((item) => sameId(item.id, id))
}

export function getWatchLaterByType(mediaType: WatchLaterMediaType): WatchLaterItem[] {
  return readAll()
    .filter((item) => item.mediaType === mediaType)
    .sort((a, b) => b.addedAt - a.addedAt)
}

/** Adds if missing, removes if already present. Returns whether the item is now saved. */
export function toggleWatchLater(item: WatchLaterItem): boolean {
  const list = readAll()
  const idx = list.findIndex((entry) => sameId(entry.id, item.id))
  if (idx >= 0) {
    list.splice(idx, 1)
    writeAll(list)
    return false
  }
  list.push({
    ...item,
    genre: item.genre || resolveGenre(item),
    addedAt: item.addedAt || Date.now()
  })
  writeAll(list)
  return true
}

export function removeWatchLater(id: string | number): void {
  const next = readAll().filter((item) => !sameId(item.id, id))
  writeAll(next)
}

export function subscribeWatchLater(cb: () => void): () => void {
  const handler = (): void => cb()
  window.addEventListener(CHANGE_EVENT, handler)
  return () => window.removeEventListener(CHANGE_EVENT, handler)
}

/** Map app MediaType (`series`) ↔ Watch Later (`tv`). */
export function toWatchLaterType(
  mediaType: 'movie' | 'series' | 'anime'
): WatchLaterMediaType {
  return mediaType === 'series' ? 'tv' : mediaType
}

export function fromWatchLaterType(
  mediaType: WatchLaterMediaType
): 'movie' | 'series' | 'anime' {
  return mediaType === 'tv' ? 'series' : mediaType
}

export function catalogToWatchLaterItem(item: {
  id: string
  mediaType: 'movie' | 'series' | 'anime'
  title: string
  posterUrl?: string | null
  backdropUrl?: string | null
  rating?: number
  releaseDate?: string | null
  genres?: string[]
  genre?: string
  genre_ids?: number[]
}): WatchLaterItem {
  return {
    id: item.id,
    mediaType: toWatchLaterType(item.mediaType),
    title: item.title,
    posterPath: item.posterUrl || undefined,
    backdropPath: item.backdropUrl || undefined,
    voteAverage: item.rating && item.rating > 0 ? item.rating : undefined,
    releaseYear: item.releaseDate?.slice(0, 4) || undefined,
    genre: resolveGenre(item),
    addedAt: Date.now()
  }
}
