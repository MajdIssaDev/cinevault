/**
 * Local affinity recommendations — completion tiers + half-life decay.
 * Persists watch sessions in localStorage (no accounts).
 */

import { GENRE_MOVIE, GENRE_TV, type MediaType as CatalogMediaType } from '../types'

export type AffinityMediaType = 'movie' | 'tv' | 'anime'

export interface WatchSession {
  id: number
  type: AffinityMediaType
  genreIds: number[]
  watchedSeconds: number
  totalSeconds: number
  timestamp: number
  isFavorite?: boolean
}

const STORAGE_KEY = 'cinevault_user_sessions'
const HALF_LIFE_MS = 21 * 24 * 60 * 60 * 1000
const MAX_HISTORY_AGE_MS = 60 * 24 * 60 * 60 * 1000
const ANIMATION_GENRE_ID = 16

export function toAffinityType(mediaType: CatalogMediaType): AffinityMediaType {
  if (mediaType === 'anime') return 'anime'
  if (mediaType === 'series') return 'tv'
  return 'movie'
}

export function fromAffinityType(type: AffinityMediaType): CatalogMediaType {
  if (type === 'anime') return 'anime'
  if (type === 'tv') return 'series'
  return 'movie'
}

/** Anime signature: Animation (16) + Japanese original language. */
export function isAnimeTitle(genreIds: number[], originalLanguage?: string | null): boolean {
  return genreIds.includes(ANIMATION_GENRE_ID) && originalLanguage === 'ja'
}

export function genreNamesToIds(names: string[], type: AffinityMediaType): number[] {
  const map = type === 'movie' ? GENRE_MOVIE : GENRE_TV
  const reverse = new Map<string, number>()
  for (const [id, name] of Object.entries(map)) {
    reverse.set(name.toLowerCase(), Number(id))
  }
  const out: number[] = []
  const seen = new Set<number>()
  for (const name of names) {
    const id = reverse.get(name.toLowerCase())
    if (id == null || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

function readHistory(): WatchSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as WatchSession[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeHistory(history: WatchSession[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history))
  } catch {
    /* quota / private mode */
  }
}

export class LocalAffinityEngine {
  static recordSession(session: Omit<WatchSession, 'timestamp'>): void {
    if (!session.id || !session.totalSeconds || session.totalSeconds <= 0) return
    const ratio = session.watchedSeconds / session.totalSeconds
    // Skip pure bounce noise entirely
    if (ratio < 0.15 && !session.isFavorite) return

    const history = readHistory().filter((s) => !(s.id === session.id && s.type === session.type))
    history.push({ ...session, timestamp: Date.now() })
    writeHistory(history)
  }

  private static getCompletionWeight(watched: number, total: number, isFav?: boolean): number {
    if (!total || total <= 0) return 0
    const ratio = Math.min(1, watched / total)

    let weight = 0
    if (ratio >= 0.8) weight = 1.0
    else if (ratio >= 0.5) weight = 0.6
    else if (ratio >= 0.15) weight = 0.2
    else return 0

    if (isFav) weight += 0.5
    return weight
  }

  /** Affinity(e) = W(P) × 2^(-Δt / τ); returns top genre ids for the shelf. */
  static getTopAffinityGenres(targetType: AffinityMediaType, limit = 3): number[] {
    const now = Date.now()
    let history = readHistory().filter((s) => now - s.timestamp <= MAX_HISTORY_AGE_MS)
    writeHistory(history)

    const genreScores: Record<number, number> = {}

    for (const session of history) {
      if (session.type !== targetType) continue
      const weight = this.getCompletionWeight(
        session.watchedSeconds,
        session.totalSeconds,
        session.isFavorite
      )
      if (weight === 0) continue

      const decay = Math.pow(0.5, (now - session.timestamp) / HALF_LIFE_MS)
      const sessionScore = weight * decay
      for (const gid of session.genreIds) {
        if (!gid) continue
        // Keep anime shelf free of non-animation noise already filtered by type
        genreScores[gid] = (genreScores[gid] || 0) + sessionScore
      }
    }

    return Object.entries(genreScores)
      .sort(([, a], [, b]) => b - a)
      .map(([gid]) => Number(gid))
      .slice(0, limit)
  }

  /** IDs already in affinity history (used to hide finished / watched titles). */
  static getExcludedIds(targetType?: AffinityMediaType): Set<number> {
    const sessions = readHistory()
    const set = new Set<number>()
    for (const s of sessions) {
      if (targetType && s.type !== targetType) continue
      set.add(s.id)
    }
    return set
  }
}
