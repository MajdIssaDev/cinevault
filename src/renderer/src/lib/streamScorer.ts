/**
 * Pick the healthiest torrent for a target resolution.
 * Prefer x264/H.264 over HEVC/x265 for default in-app playback.
 */
import type { PublicSearchResult } from '../services/publicSearchService'
import { guessQualityFromName, qualityLabel, qualityRank } from './torrentPlayback'
import {
  hasExplicitUnsupportedAudio,
  isBrowserPreferredVideo,
  parseTorrentAudio,
  parseTorrentVideo
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

/** Minimum seeders to treat an x264 candidate as "healthy". */
const HEALTHY_X264_SEEDERS = 3

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

function videoMeta(t: PublicSearchResult): ReturnType<typeof parseTorrentVideo> {
  if (typeof t.isHevc === 'boolean' && typeof t.isX264 === 'boolean') {
    return {
      isHevc: t.isHevc,
      isX264: t.isX264,
      videoLabel: t.videoLabel ?? null
    }
  }
  return parseTorrentVideo(t.name)
}

function playabilityScore(name: string): number {
  const v = parseTorrentVideo(name)
  const n = name.toLowerCase()
  if (v.isX264 && !v.isHevc && /\bmp4\b/.test(n)) return 5
  if (v.isX264 && !v.isHevc) return 4
  if (/\bmp4\b/.test(n) && !v.isHevc) return 2
  if (v.isHevc) return 0
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
  score += playabilityScore(t.name) * 8
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

  const video = videoMeta(t)
  if (video.isX264 && !video.isHevc) score += 28
  else if (video.isHevc) score -= 35

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

function preferX264Pool(pool: PublicSearchResult[]): PublicSearchResult[] {
  const x264 = pool.filter((t) => isBrowserPreferredVideo(t.name))
  if (!x264.length) return pool
  const healthy = x264.filter((t) => t.seeders >= HEALTHY_X264_SEEDERS)
  // Only fall through to HEVC when no x264 exists at all for this resolution.
  return healthy.length > 0 ? healthy : x264
}

export function getBestStream(
  torrents: PublicSearchResult[],
  targetRes: TargetRes,
  opts?: { isMovieLike?: boolean; preferX264?: boolean }
): StreamPick {
  const isMovieLike = opts?.isMovieLike !== false
  const preferX264 = opts?.preferX264 !== false
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
  let pool = compatible.length > 0 ? compatible : candidates

  // Prefer x264 / H.264 over HEVC for Chromium; only use HEVC if no x264 exists.
  if (preferX264) {
    pool = preferX264Pool(pool)
  }

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
