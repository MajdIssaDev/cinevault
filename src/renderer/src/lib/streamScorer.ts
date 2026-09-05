/**
 * Pick the healthiest torrent for a target resolution.
 */
import type { PublicSearchResult } from '../services/publicSearchService'
import { guessQualityFromName, qualityLabel, qualityRank } from './torrentPlayback'
import {
  hasExplicitUnsupportedAudio,
  parseTorrentAudio
} from './torrentParser'
import type { Quality } from '../types'

export type TargetRes = '4K' | '1080p' | '720p' | 'Auto'

export type StreamPick = {
  bestStream: PublicSearchResult | null
  highestAvailableRes: TargetRes | null
  isTargetAvailable: boolean
  availableResolutions: TargetRes[]
  matchedRes: TargetRes | null
  /** True when the chosen stream has AC3/DTS/Atmos-style audio. */
  hasUnsupportedAudio: boolean
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

function audioMeta(t: PublicSearchResult): ReturnType<typeof parseTorrentAudio> {
  if (t.audioCodec && t.audioLabel !== undefined && typeof t.isAudioSupported === 'boolean') {
    return {
      audioCodec: t.audioCodec,
      isAudioSupported: t.isAudioSupported,
      audioLabel: t.audioLabel
    }
  }
  return parseTorrentAudio(t.name)
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

  const audio = audioMeta(t)
  if (hasExplicitUnsupportedAudio(t.name) || (!audio.isAudioSupported && audio.audioCodec !== 'UNKNOWN')) {
    score -= 55
  } else if (audio.audioCodec === 'AAC' && audio.audioLabel) {
    // Prefer labeled native AAC over unlabeled / other native
    score += 22
  } else if (audio.isAudioSupported && audio.audioLabel) {
    score += 14
  }

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

function emptyPick(
  highestAvailableRes: TargetRes | null,
  availableResolutions: TargetRes[]
): StreamPick {
  return {
    bestStream: null,
    highestAvailableRes,
    isTargetAvailable: false,
    availableResolutions,
    matchedRes: null,
    hasUnsupportedAudio: false
  }
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
    return emptyPick(highestAvailableRes, availableResolutions)
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
    return emptyPick(highestAvailableRes, availableResolutions)
  }

  const compatible = candidates.filter((t) => {
    const audio = audioMeta(t)
    return audio.isAudioSupported || audio.audioCodec === 'UNKNOWN'
  })
  // Prefer native-friendly audio when any exist; otherwise fall back to cinema codecs.
  const pool = compatible.length > 0 ? compatible : candidates

  const ranked = [...pool].sort((a, b) => {
    const as = scoreTorrent(a, isMovieLike)
    const bs = scoreTorrent(b, isMovieLike)
    if (bs !== as) return bs - as
    // Tie-break: labeled AAC beats everything else at same score
    const aAac = audioMeta(a).audioCodec === 'AAC' && Boolean(audioMeta(a).audioLabel) ? 1 : 0
    const bAac = audioMeta(b).audioCodec === 'AAC' && Boolean(audioMeta(b).audioLabel) ? 1 : 0
    if (bAac !== aAac) return bAac - aAac
    return b.seeders - a.seeders
  })

  const best = ranked[0] || null
  const hasUnsupportedAudio = Boolean(
    best &&
      (!audioMeta(best).isAudioSupported || hasExplicitUnsupportedAudio(best.name))
  )

  return {
    bestStream: best,
    highestAvailableRes,
    isTargetAvailable: Boolean(best),
    availableResolutions,
    matchedRes: effective,
    hasUnsupportedAudio
  }
}

export function formatTargetRes(res: TargetRes | null): string {
  if (!res) return '—'
  if (res === 'Auto') return 'Auto'
  return res === '4K' ? '4K' : res
}

export { qualityLabel, qualityRank }
