/**
 * Pick the healthiest torrent for a target resolution.
 */
import type { PublicSearchResult } from '../services/publicSearchService'
import { guessQualityFromName, qualityLabel, qualityRank } from './torrentPlayback'
import type { Quality } from '../types'

export type TargetRes = '4K' | '1080p' | '720p' | 'Auto'

export type StreamPick = {
  bestStream: PublicSearchResult | null
  highestAvailableRes: TargetRes | null
  isTargetAvailable: boolean
  availableResolutions: TargetRes[]
  matchedRes: TargetRes | null
}

const TARGET_TO_QUALITY: Record<Exclude<TargetRes, 'Auto'>, Quality> = {
  '4K': '2160p',
  '1080p': '1080p',
  '720p': '720p'
}

const QUALITY_TO_TARGET: Partial<Record<Quality | 'unknown', TargetRes>> = {
  '2160p': '4K',
  '1080p': '1080p',
  '720p': '720p'
}

export function qualityToTargetRes(q: Quality | 'unknown'): TargetRes | null {
  return QUALITY_TO_TARGET[q] || null
}

export function targetResToQuality(res: Exclude<TargetRes, 'Auto'>): Quality {
  return TARGET_TO_QUALITY[res]
}

export function defaultTargetFromQuality(q: Quality): TargetRes {
  if (q === '2160p' || q === '1440p') return '4K'
  if (q === '720p') return '720p'
  return '1080p'
}

function isCamOrTs(name: string): boolean {
  return /\b(cam|camrip|hdcam|tele.?sync|ts|telesync|hdts|tc|telecine|scr|screener|dvdscr)\b/i.test(
    name
  )
}

function playabilityScore(name: string): number {
  const n = name.toLowerCase()
  if (/\bmp4\b/.test(n) && /\b(x264|h\.?264|avc)\b/.test(n)) return 4
  if (/\b(x264|h\.?264|avc)\b/.test(n)) return 3
  if (/\bmp4\b/.test(n)) return 2
  if (/\b(hevc|x265|h\.?265)\b/.test(n)) return 1
  return 1
}

function sizeScore(bytes: number, isMovieLike: boolean): number {
  if (!bytes || bytes <= 0) return 1
  const gb = bytes / (1024 * 1024 * 1024)
  if (isMovieLike) {
    if (gb >= 1.2 && gb <= 15) return 3
    if (gb >= 0.7 && gb <= 20) return 2
    if (gb < 0.4) return 0
    return 1
  }
  // Episodes: prefer smaller packs
  if (gb >= 0.3 && gb <= 4) return 3
  if (gb >= 0.15 && gb <= 8) return 2
  return 1
}

function scoreTorrent(t: PublicSearchResult, isMovieLike: boolean): number {
  let score = 0
  if (t.seeders >= 50) score += 40
  else if (t.seeders >= 20) score += 30
  else if (t.seeders >= 10) score += 22
  else if (t.seeders >= 5) score += 12
  else score += Math.max(0, t.seeders)

  if (isCamOrTs(t.name)) score -= 80
  score += playabilityScore(t.name) * 6
  score += sizeScore(t.sizeBytes, isMovieLike) * 4
  if (t.leechers > 0 && t.seeders / Math.max(1, t.leechers) >= 2) score += 4
  return score
}

function listAvailableTargets(torrents: PublicSearchResult[]): TargetRes[] {
  const found = new Set<TargetRes>()
  for (const t of torrents) {
    const mapped = qualityToTargetRes(guessQualityFromName(t.name))
    if (mapped) found.add(mapped)
  }
  const order: TargetRes[] = ['4K', '1080p', '720p']
  return order.filter((r) => found.has(r))
}

function highestWithMinSeeders(
  torrents: PublicSearchResult[],
  minSeeders: number
): TargetRes | null {
  const order: Array<Exclude<TargetRes, 'Auto'>> = ['4K', '1080p', '720p']
  for (const res of order) {
    const q = TARGET_TO_QUALITY[res]
    const hit = torrents.some(
      (t) => guessQualityFromName(t.name) === q && t.seeders >= minSeeders && !isCamOrTs(t.name)
    )
    if (hit) return res
  }
  // Fallback: highest present regardless of seed floor
  const available = listAvailableTargets(torrents)
  return available[0] || null
}

export function getBestStream(
  torrents: PublicSearchResult[],
  targetRes: TargetRes,
  opts?: { isMovieLike?: boolean }
): StreamPick {
  const isMovieLike = opts?.isMovieLike !== false
  const availableResolutions = listAvailableTargets(torrents)
  const highestAvailableRes =
    highestWithMinSeeders(torrents, 5) || availableResolutions[0] || null

  let effective: TargetRes | null = targetRes
  if (targetRes === 'Auto') {
    effective = highestAvailableRes
  }

  if (!effective || effective === 'Auto') {
    return {
      bestStream: null,
      highestAvailableRes,
      isTargetAvailable: false,
      availableResolutions,
      matchedRes: null
    }
  }

  const want = TARGET_TO_QUALITY[effective]
  const candidates = torrents.filter((t) => {
    const q = guessQualityFromName(t.name)
    if (q !== want) return false
    if (isCamOrTs(t.name)) return false
    return true
  })

  const isTargetAvailable = candidates.length > 0
  if (!isTargetAvailable) {
    return {
      bestStream: null,
      highestAvailableRes,
      isTargetAvailable: false,
      availableResolutions,
      matchedRes: null
    }
  }

  const ranked = [...candidates].sort(
    (a, b) => scoreTorrent(b, isMovieLike) - scoreTorrent(a, isMovieLike)
  )

  return {
    bestStream: ranked[0] || null,
    highestAvailableRes,
    isTargetAvailable: Boolean(ranked[0]),
    availableResolutions,
    matchedRes: effective
  }
}

export function formatTargetRes(res: TargetRes | null): string {
  if (!res) return '—'
  if (res === 'Auto') return 'Auto'
  return res === '4K' ? '4K' : res
}

export { qualityLabel, qualityRank }
