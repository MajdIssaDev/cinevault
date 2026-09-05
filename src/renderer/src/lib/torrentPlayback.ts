import type { Quality, StreamSource } from '../types'
import type { PublicSearchResult } from '../services/publicSearchService'
import { isBrowserPreferredVideo, parseTorrentVideo } from './torrentParser'

export function guessQualityFromName(name: string): Quality | 'unknown' {
  const n = name.toLowerCase()
  if (/\b(2160p|4k|uhd)\b/.test(n)) return '2160p'
  if (/\b(1440p|2k)\b/.test(n)) return '1440p'
  if (/\b1080p\b/.test(n)) return '1080p'
  if (/\b720p\b/.test(n)) return '720p'
  return 'unknown'
}

export function qualityLabel(q: Quality | 'unknown'): string {
  switch (q) {
    case '2160p':
      return '4K'
    case '1440p':
      return '2K'
    case '1080p':
      return '1080p'
    case '720p':
      return '720p'
    default:
      return '—'
  }
}

export function qualityRank(q: Quality | 'unknown'): number {
  switch (q) {
    case '2160p':
      return 4
    case '1440p':
      return 3
    case '1080p':
      return 2
    case '720p':
      return 1
    default:
      return 0
  }
}

/** Prefer preferred quality, then native audio, then playable codecs (mp4/x264), then seeders. */
export function sortTorrentResults(
  results: PublicSearchResult[],
  preferred: Quality
): PublicSearchResult[] {
  const pref = qualityRank(preferred)
  const playability = (name: string): number => {
    const v = parseTorrentVideo(name)
    const n = name.toLowerCase()
    if (v.isX264 && !v.isHevc && /\bmp4\b/.test(n)) return 4
    if (isBrowserPreferredVideo(name)) return 3
    if (/\bmp4\b/.test(n) && !v.isHevc) return 2
    if (v.isHevc) return 0
    if (/\bmkv\b/.test(n)) return 1
    return 1
  }
  const audioRank = (t: PublicSearchResult): number => {
    const meta = t.audioCodec
      ? { codec: t.audioCodec, ok: t.isAudioSupported, label: t.audioLabel }
      : null
    if (meta && !meta.ok) return 0
    if (meta?.codec === 'AAC' && meta.label) return 3
    if (meta?.ok && meta.label) return 2
    return 1
  }
  return [...results].sort((a, b) => {
    const aq = qualityRank(guessQualityFromName(a.name))
    const bq = qualityRank(guessQualityFromName(b.name))
    const aDist = aq === 0 ? 99 : Math.abs(aq - pref)
    const bDist = bq === 0 ? 99 : Math.abs(bq - pref)
    if (aDist !== bDist) return aDist - bDist
    const aa = audioRank(a)
    const ba = audioRank(b)
    if (aa !== ba) return ba - aa
    const ap = playability(a.name)
    const bp = playability(b.name)
    if (ap !== bp) return bp - ap
    return b.seeders - a.seeders
  })
}

export function buildCatalogSearchQuery(opts: {
  title: string
  mediaType: 'movie' | 'series' | 'anime'
  releaseDate?: string | null
  season?: number
  episode?: number
}): string {
  const title = opts.title.trim()
  if (opts.mediaType === 'movie') {
    const year = opts.releaseDate?.slice(0, 4)
    return year ? `${title} ${year}` : title
  }
  const s = String(opts.season ?? 1).padStart(2, '0')
  const e = String(opts.episode ?? 1).padStart(2, '0')
  return `${title} S${s}E${e}`
}

export async function startTorrentPlayback(opts: {
  cacheId: string
  magnetUri: string
  label: string
  preferredQuality?: Quality
}): Promise<StreamSource> {
  if (!window.cinevault?.torrent) {
    throw new Error('Torrent playback requires the desktop app')
  }
  const startPromise = window.cinevault.torrent.start({
    id: opts.cacheId,
    magnetUri: opts.magnetUri
  })
  // Renderer-side guard so the Play button can't stick forever if IPC hangs.
  const started = await Promise.race([
    startPromise,
    new Promise<never>((_, reject) => {
      window.setTimeout(
        () => reject(new Error('Torrent start timed out — try another source')),
        35_000
      )
    })
  ])
  const quality = guessQualityFromName(opts.label)
  return {
    id: opts.cacheId,
    label: opts.label || started.fileName,
    quality: quality === 'unknown' ? opts.preferredQuality || 'unknown' : quality,
    url: started.streamUrl,
    kind: 'torrent',
    hdr: /hdr|dv|dolby.?vision/i.test(opts.label),
    spatialAudio: /atmos|truehd|dts.?x/i.test(opts.label)
  }
}
