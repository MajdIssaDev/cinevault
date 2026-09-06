/**
 * Pick the healthiest torrent for a target resolution.
 * Prefer x264/H.264 over HEVC/x265 for default in-app playback.
 * Reject bonus/sample/aux material and rank by seeder health + size credibility.
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

/** Bonus / sample / soundtrack / trailer noise — never offer as Watch Now. */
const JUNK_REGEX =
  /\b(making\.?\s*of|behind\.?\s*the\.?\s*scenes|featurette|interview|extras?|sample|trailer|soundtrack|ost|preview|deleted\.?\s*scenes?|blooper|gag\.?\s*reel|bonus\.?\s*(disc|content|material)|rarbg\.?sample)\b/i

const MIN_MOVIE_SIZE_MB = 450
const MIN_EPISODE_SIZE_MB = 80

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

export function isJunkTorrentName(name: string): boolean {
  return JUNK_REGEX.test((name || '').replace(/[._-]/g, ' '))
}

/**
 * Strip auxiliary / sample / soundtrack releases before the streams list is shown.
 * Size floor applies when sizeBytes is known (unknown sizes are kept).
 */
export function filterValidStreams(
  torrents: PublicSearchResult[],
  opts?: { isMovieLike?: boolean }
): PublicSearchResult[] {
  const isMovieLike = opts?.isMovieLike !== false
  const minMb = isMovieLike ? MIN_MOVIE_SIZE_MB : MIN_EPISODE_SIZE_MB
  return torrents.filter((t) => {
    if (isJunkTorrentName(t.name)) return false
    const sizeInMB = t.sizeBytes > 0 ? t.sizeBytes / (1024 * 1024) : 0
    if (sizeInMB > 0 && sizeInMB < minMb) return false
    return true
  })
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

function sizeCredibilityScore(bytes: number, quality: Quality | 'unknown', isMovieLike: boolean): number {
  if (!bytes || bytes <= 0) return 1
  const gb = bytes / (1024 * 1024 * 1024)
  if (!isMovieLike) {
    if (gb >= 0.3 && gb <= 4) return 3
    if (gb >= 0.15 && gb <= 8) return 2
    return 1
  }
  // Plausible encode sizes — sweet spots for real features (not docs/samples)
  if (quality === '1080p' && gb >= 1.5 && gb <= 14) return 6
  if (quality === '2160p' && gb >= 4 && gb <= 45) return 6
  if (quality === '720p' && gb >= 0.7 && gb <= 8) return 5
  if (gb >= 1.2 && gb <= 20) return 3
  if (gb >= 0.7 && gb <= 25) return 2
  if (gb < 0.45) return 0
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

/**
 * Composite rank: seeder health first, then resolution/size credibility.
 * Does not boost WEB-DL over BluRay — health + size decide.
 */
function scoreTorrent(
  t: PublicSearchResult,
  isMovieLike: boolean,
  targetQuality: Quality
): number {
  let score = 0
  const q = guessQualityFromName(t.name)

  // 1. Seeder health (log scale) — massive seed advantage beats dead WEB-DLs
  score += Math.min(Math.log10(Math.max(1, t.seeders)) * 30, 100)
  if (t.seeders < 3) score -= 150

  // 2. Resolution match (pool is already filtered, small reinforcing bonus)
  if (q === targetQuality) score += 40

  // 3. Cam / TS trash
  if (isCamOrTs(t.name)) score -= 80

  // 4. Size credibility for the claimed resolution
  score += sizeCredibilityScore(t.sizeBytes, q, isMovieLike) * 4

  // 5. Browser playability (x264 > HEVC) — secondary to health
  score += playabilityScore(t.name) * 6

  if (t.leechers > 0 && t.seeders / Math.max(1, t.leechers) >= 2) score += 4

  const audio = audioMeta(t)
  if (
    hasExplicitUnsupportedAudio(t.name) ||
    (!audio.isAudioSupported && audio.audioCodec !== 'UNKNOWN')
  ) {
    score -= 40
  } else if (audio.audioCodec === 'AAC' && audio.audioLabel) {
    score += 16
  } else if (audio.isAudioSupported && audio.audioLabel) {
    score += 10
  }

  const video = videoMeta(t)
  if (video.isX264 && !video.isHevc) score += 18
  else if (video.isHevc) score -= 25

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
  // Only fall through to HEVC when no healthy x264 exists for this resolution.
  return healthy.length > 0 ? healthy : x264
}

/** Alias matching the selector API — same as getBestStream(...).bestStream */
export function pickDefaultStream(
  torrents: PublicSearchResult[],
  targetRes: TargetRes = '1080p',
  opts?: { isMovieLike?: boolean; preferX264?: boolean }
): PublicSearchResult | null {
  return getBestStream(torrents, targetRes, opts).bestStream
}

export function getBestStream(
  torrents: PublicSearchResult[],
  targetRes: TargetRes,
  opts?: { isMovieLike?: boolean; preferX264?: boolean }
): StreamPick {
  const isMovieLike = opts?.isMovieLike !== false
  const preferX264 = opts?.preferX264 !== false
  const cleaned = filterValidStreams(torrents, { isMovieLike })
  const availableResolutions = listAvailableTargets(cleaned)
  const highestAvailableRes =
    highestWithMinSeeders(cleaned, 5) || availableResolutions[0] || null

  let effective: TargetRes | null = targetRes
  if (targetRes === 'Auto') {
    effective = highestAvailableRes
  }

  if (!effective || effective === 'Auto') {
    return emptyPick(highestAvailableRes, availableResolutions)
  }

  const want = TARGET_TO_QUALITY[effective]
  const candidates = cleaned.filter((t) => {
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
    const as = scoreTorrent(a, isMovieLike, want)
    const bs = scoreTorrent(b, isMovieLike, want)
    if (bs !== as) return bs - as
    const aAac = audioMeta(a).audioCodec === 'AAC' && Boolean(audioMeta(a).audioLabel) ? 1 : 0
    const bAac = audioMeta(b).audioCodec === 'AAC' && Boolean(audioMeta(b).audioLabel) ? 1 : 0
    if (bAac !== aAac) return bAac - aAac
    return b.seeders - a.seeders
  })

  const best = ranked[0] || null
  const hasUnsupportedAudio = Boolean(
    best && (!audioMeta(best).isAudioSupported || hasExplicitUnsupportedAudio(best.name))
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
