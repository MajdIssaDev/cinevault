/**
 * Local playback history — no accounts; persists in localStorage.
 */

import type { MediaType } from '../types'

const STORAGE_KEY = 'cinevault-playback-history'
const CHANGE_EVENT = 'cinevault-playback-history'
const THROTTLE_MS = 5000
const CONTINUE_MIN = 3
const CONTINUE_MAX = 92
const COMPLETE_AT = 92

export interface PlaybackProgress {
  mediaId: string
  mediaType: MediaType
  externalId: number
  title: string
  posterPath?: string
  backdropPath?: string
  season?: number
  episode?: number
  episodeTitle?: string
  currentTime: number
  duration: number
  percentage: number
  updatedAt: number
  completed?: boolean
}

type HistoryMap = Record<string, PlaybackProgress>

const throttleTimers = new Map<string, ReturnType<typeof setTimeout>>()
const pendingEntries = new Map<string, PlaybackProgress>()

export function mediaIdFromParts(
  mediaType: MediaType,
  externalId: number
): string {
  return `${mediaType}-${externalId}`
}

export function progressKey(
  mediaId: string,
  season?: number,
  episode?: number
): string {
  if (season != null && episode != null) return `${mediaId}:s${season}e${episode}`
  return mediaId
}

function readAll(): HistoryMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as HistoryMap
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeAll(map: HistoryMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT))
  } catch {
    /* quota / private mode */
  }
}

function normalizeEntry(entry: PlaybackProgress): PlaybackProgress {
  const duration = Math.max(0, entry.duration || 0)
  const currentTime = Math.max(0, Math.min(entry.currentTime || 0, duration || entry.currentTime || 0))
  const percentage =
    duration > 0 ? Math.min(100, (currentTime / duration) * 100) : entry.percentage || 0
  return {
    ...entry,
    currentTime,
    duration,
    percentage,
    updatedAt: entry.updatedAt || Date.now()
  }
}

function commit(entry: PlaybackProgress): void {
  const next = normalizeEntry(entry)
  const key = progressKey(next.mediaId, next.season, next.episode)
  const map = readAll()

  if (next.percentage >= COMPLETE_AT) {
    map[key] = { ...next, completed: true, percentage: 100 }
  } else {
    map[key] = { ...next, completed: false }
  }
  writeAll(map)
}

/** Persist progress. Throttled to ~5s during playback; pass `immediate` on pause/seek/unmount. */
export function saveProgress(
  entry: PlaybackProgress,
  opts?: { immediate?: boolean }
): void {
  const key = progressKey(entry.mediaId, entry.season, entry.episode)
  const normalized = normalizeEntry({ ...entry, updatedAt: Date.now() })
  pendingEntries.set(key, normalized)

  if (opts?.immediate) {
    const timer = throttleTimers.get(key)
    if (timer) clearTimeout(timer)
    throttleTimers.delete(key)
    pendingEntries.delete(key)
    commit(normalized)
    return
  }

  if (throttleTimers.has(key)) return
  const timer = setTimeout(() => {
    throttleTimers.delete(key)
    const pending = pendingEntries.get(key)
    pendingEntries.delete(key)
    if (pending) commit(pending)
  }, THROTTLE_MS)
  throttleTimers.set(key, timer)
}

export function flushProgress(mediaId: string, season?: number, episode?: number): void {
  const key = progressKey(mediaId, season, episode)
  const timer = throttleTimers.get(key)
  if (timer) clearTimeout(timer)
  throttleTimers.delete(key)
  const pending = pendingEntries.get(key)
  pendingEntries.delete(key)
  if (pending) commit(pending)
}

export function getProgress(
  mediaId: string,
  season?: number,
  episode?: number
): PlaybackProgress | null {
  const map = readAll()
  const key = progressKey(mediaId, season, episode)
  const hit = map[key]
  if (!hit || hit.completed) return null
  if (hit.percentage < CONTINUE_MIN) return null
  return hit
}

/** Latest in-progress entry for a title (any episode). */
export function getLatestProgressForTitle(mediaId: string): PlaybackProgress | null {
  const map = readAll()
  let best: PlaybackProgress | null = null
  for (const entry of Object.values(map)) {
    if (entry.mediaId !== mediaId) continue
    if (entry.completed) continue
    if (entry.percentage < CONTINUE_MIN || entry.percentage >= CONTINUE_MAX) continue
    if (!best || entry.updatedAt > best.updatedAt) best = entry
  }
  return best
}

export function getContinueWatchingList(): PlaybackProgress[] {
  const map = readAll()
  const byTitle = new Map<string, PlaybackProgress>()

  for (const entry of Object.values(map)) {
    if (entry.completed) continue
    if (entry.percentage <= CONTINUE_MIN || entry.percentage >= CONTINUE_MAX) continue
    const prev = byTitle.get(entry.mediaId)
    if (!prev || entry.updatedAt > prev.updatedAt) byTitle.set(entry.mediaId, entry)
  }

  return [...byTitle.values()].sort((a, b) => b.updatedAt - a.updatedAt)
}

export function markAsCompleted(
  mediaId: string,
  season?: number,
  episode?: number
): void {
  const key = progressKey(mediaId, season, episode)
  const map = readAll()
  const existing = map[key]
  if (existing) {
    map[key] = {
      ...existing,
      completed: true,
      percentage: 100,
      currentTime: existing.duration || existing.currentTime,
      updatedAt: Date.now()
    }
  } else {
    // Drop any pending throttle for this key
  }
  const timer = throttleTimers.get(key)
  if (timer) clearTimeout(timer)
  throttleTimers.delete(key)
  pendingEntries.delete(key)
  writeAll(map)
}

export function clearProgress(
  mediaId: string,
  season?: number,
  episode?: number
): void {
  const key = progressKey(mediaId, season, episode)
  const map = readAll()
  delete map[key]
  const timer = throttleTimers.get(key)
  if (timer) clearTimeout(timer)
  throttleTimers.delete(key)
  pendingEntries.delete(key)
  writeAll(map)
}

/** Remove every progress row for a title (all seasons/episodes). */
export function clearProgressForMedia(mediaId: string): void {
  if (!mediaId) return
  const map = readAll()
  let changed = false
  for (const key of Object.keys(map)) {
    const entry = map[key]
    if (entry?.mediaId !== mediaId && !key.startsWith(`${mediaId}:`) && key !== mediaId) {
      continue
    }
    delete map[key]
    const timer = throttleTimers.get(key)
    if (timer) clearTimeout(timer)
    throttleTimers.delete(key)
    pendingEntries.delete(key)
    changed = true
  }
  if (changed) writeAll(map)
}

export function subscribePlaybackHistory(cb: () => void): () => void {
  const handler = (): void => cb()
  window.addEventListener(CHANGE_EVENT, handler)
  return () => window.removeEventListener(CHANGE_EVENT, handler)
}

export function formatRemaining(entry: PlaybackProgress): string {
  const left = Math.max(0, (entry.duration || 0) - (entry.currentTime || 0))
  if (left < 60) return `${Math.round(left)}s left`
  const mins = Math.round(left / 60)
  if (mins < 60) return `${mins}m left`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? `${h}h ${m}m left` : `${h}h left`
}

export function formatResumeLabel(entry: PlaybackProgress): string {
  if (entry.season != null && entry.episode != null) {
    return `Resume S${entry.season}:E${entry.episode}`
  }
  const t = Math.floor(entry.currentTime || 0)
  const m = Math.floor(t / 60)
  const s = t % 60
  return `Resume from ${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export { CONTINUE_MIN, CONTINUE_MAX, COMPLETE_AT }
