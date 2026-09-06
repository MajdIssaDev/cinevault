import type { Quality, StreamSource } from '../types'
import type { PublicSearchResult } from '../services/publicSearchService'
import { isBrowserPreferredVideo, parseTorrentVideo } from './torrentParser'
import { needsAudioRemux } from './audioRemux'

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
  /** When set, keep only this title's new torrent and wipe prior downloads for it. */
  mediaId?: string
  /** Cancel metadata fetch / start; stops the torrent and rejects with AbortError. */
  signal?: AbortSignal
}): Promise<StreamSource> {
  if (!window.cinevault?.torrent) {
    throw new Error('Torrent playback requires the desktop app')
  }

  const abortError = (): Error => {
    const err = new Error('Aborted')
    err.name = 'AbortError'
    return err
  }

  const throwIfAborted = (): void => {
    if (opts.signal?.aborted) throw abortError()
  }

  const cleanupStarted = async (): Promise<void> => {
    try {
      await window.cinevault?.torrent?.stop(opts.cacheId, { destroyStore: true })
    } catch {
      /* best-effort */
    }
  }

  throwIfAborted()

  const startPromise = window.cinevault.torrent.start({
    id: opts.cacheId,
    magnetUri: opts.magnetUri
  })

  try {
    // Race start against timeout + user abort so Play can't stick forever.
    const started = await new Promise<{
      streamUrl: string
      fileName: string
      size: number
    }>((resolve, reject) => {
      let settled = false
      const finish = (fn: () => void): void => {
        if (settled) return
        settled = true
        fn()
      }

      const timer = window.setTimeout(() => {
        finish(() => reject(new Error('Torrent start timed out — try another source')))
      }, 35_000)

      const onAbort = (): void => {
        window.clearTimeout(timer)
        finish(() => reject(abortError()))
      }

      if (opts.signal) {
        if (opts.signal.aborted) {
          onAbort()
          return
        }
        opts.signal.addEventListener('abort', onAbort, { once: true })
      }

      startPromise.then(
        (value) => {
          window.clearTimeout(timer)
          opts.signal?.removeEventListener('abort', onAbort)
          finish(() => resolve(value))
        },
        (err) => {
          window.clearTimeout(timer)
          opts.signal?.removeEventListener('abort', onAbort)
          finish(() => reject(err instanceof Error ? err : new Error(String(err))))
        }
      )
    })

    throwIfAborted()

    // One torrent per title: remove prior downloads only after the new stream is ready.
    if (opts.mediaId && window.cinevault.cache?.removeByMedia) {
      await window.cinevault.cache.removeByMedia(opts.mediaId, { keepId: opts.cacheId })
      throwIfAborted()
    }

    const hashMatch = opts.magnetUri.match(/xt=urn:btih:([a-fA-F0-9]{40}|[a-zA-Z2-7]{32})/i)
    const infoHash = hashMatch?.[1]?.toLowerCase() || ''
    if (opts.mediaId && infoHash && window.cinevault.torrent.prepareStream) {
      await window.cinevault.torrent.prepareStream({
        mediaId: opts.mediaId,
        infoHash,
        cacheId: opts.cacheId
      })
      throwIfAborted()
    }

    const quality = guessQualityFromName(opts.label)
    return {
      id: opts.cacheId,
      label: opts.label || started.fileName,
      quality: quality === 'unknown' ? opts.preferredQuality || 'unknown' : quality,
      url: started.streamUrl,
      kind: 'torrent',
      hdr: /hdr|dv|dolby.?vision/i.test(opts.label),
      spatialAudio: /atmos|truehd|dts.?x/i.test(opts.label),
      needsAudioRemux: needsAudioRemux(opts.label || started.fileName || '')
    }
  } catch (e) {
    const aborted =
      opts.signal?.aborted ||
      (e instanceof Error && (e.name === 'AbortError' || e.message === 'Aborted'))
    if (aborted) {
      await cleanupStarted()
      throw abortError()
    }
    throw e
  }
}
