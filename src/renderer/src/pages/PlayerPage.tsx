import { useEffect, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import Hls from 'hls.js'
import {
  ArrowLeft,
  Captions,
  Info,
  Keyboard,
  Maximize2,
  Minimize2,
  Minus,
  Pause,
  PictureInPicture2,
  Play,
  Plus,
  RotateCcw,
  RotateCw,
  Square,
  Volume2,
  VolumeX
} from 'lucide-react'
import { useAppStore } from '../store'
import { findActiveCue, formatSubtitleDelayMs, formatTime, parseSrt, type Cue } from '../lib/subtitles'
import {
  formatSubtitleMenuLabel,
  getAvailableSubtitles,
  rankSubtitlesByRelease,
  resolveSubtitleTrack,
  type UnifiedSubtitle
} from '../services/subtitleService'
import { SelectMenu } from '../components/ui/SelectMenu'
import { Tooltip } from '../components/ui/Tooltip'
import {
  COMPLETE_AT,
  flushProgress,
  markAsCompleted,
  mediaIdFromParts,
  saveProgress,
  type PlaybackProgress
} from '../services/playbackHistoryService'
import {
  LocalAffinityEngine,
  genreNamesToIds,
  toAffinityType
} from '../services/recommendationEngine'
import { resolveNextEpisode, type NextEpisodeTarget } from '../lib/nextEpisode'
import {
  buildCatalogSearchQuery,
  sortTorrentResults,
  startTorrentPlayback
} from '../lib/torrentPlayback'
import { useAniSkip, isInSkipWindow } from '../hooks/useAniSkip'
import { useAudioEnhancer } from '../hooks/useAudioEnhancer'
import { filterValidStreams, getBestStream } from '../lib/streamScorer'
import { searchPublicIndexers } from '../services/publicSearchService'
import { isBrowserPreferredVideo, parseTorrentVideo } from '../lib/torrentParser'
import { buildAudioRemuxUrl, needsAudioRemux } from '../lib/audioRemux'
import {
  checkIsFinished,
  releaseVideoElement
} from '../lib/playbackCompletion'
import {
  PlayerProgressBar,
  computeBufferedPercent,
  formatTimestamp,
  resolveTrueDuration,
  type BufferRange
} from '../components/PlayerProgressBar'

const ICON = { size: 20, strokeWidth: 1.75 } as const

const SUB_LANGS = [
  'en',
  'es',
  'fr',
  'de',
  'ar',
  'pt',
  'ru',
  'zh',
  'ja',
  'ko',
  'hi',
  'it',
  'tr',
  'pl',
  'he',
  'nl',
  'uk',
  'id',
  'vi',
  'th',
  'sv',
  'ro',
  'cs',
  'hu',
  'el'
] as const

const SUB_LANG_LABELS: Record<string, string> = {
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  ar: 'Arabic',
  pt: 'Portuguese',
  ru: 'Russian',
  zh: 'Chinese',
  ja: 'Japanese',
  ko: 'Korean',
  hi: 'Hindi',
  it: 'Italian',
  tr: 'Turkish',
  pl: 'Polish',
  he: 'Hebrew',
  nl: 'Dutch',
  uk: 'Ukrainian',
  id: 'Indonesian',
  vi: 'Vietnamese',
  th: 'Thai',
  sv: 'Swedish',
  ro: 'Romanian',
  cs: 'Czech',
  hu: 'Hungarian',
  el: 'Greek'
}


function SeekGlyph({ dir }: { dir: 'back' | 'forward' }): JSX.Element {
  const Icon = dir === 'back' ? RotateCcw : RotateCw
  return (
    <span className="seek-glyph" aria-hidden>
      <Icon size={28} strokeWidth={1.75} />
      <span className="seek-glyph-num">10</span>
    </span>
  )
}

function formatSpeed(bps: number): string {
  if (!bps) return '—'
  if (bps < 1024) return `${bps.toFixed(0)} B/s`
  if (bps < 1024 ** 2) return `${(bps / 1024).toFixed(1)} KB/s`
  return `${(bps / 1024 ** 2).toFixed(2)} MB/s`
}

function bufferedEnd(video: HTMLVideoElement | null): number {
  if (!video?.buffered?.length) return 0
  try {
    return video.buffered.end(video.buffered.length - 1)
  } catch {
    return 0
  }
}

/** How far ahead of currentTime the HTML5 buffer extends (target window → %). */
const unstickAtByVideo = new WeakMap<HTMLVideoElement, number>()

/** Start / resume once we have this much contiguous time ahead of the playhead. */
const PREBUFFER_SECONDS = 10
/** Or this many contiguous verified bytes ahead of the playhead. */
const PREBUFFER_BYTES = 35 * 1024 * 1024

function calculateForwardBuffer(
  video: HTMLVideoElement,
  targetSeconds = PREBUFFER_SECONDS
): { forwardSec: number; pct: number } {
  const current = video.currentTime
  try {
    for (let i = 0; i < video.buffered.length; i++) {
      const start = video.buffered.start(i)
      const end = video.buffered.end(i)

      // 1. Playhead is inside a buffered range
      if (current >= start && current <= end) {
        const forwardSec = Math.max(0, end - current)
        return {
          forwardSec,
          pct: Math.min(100, Math.round((forwardSec / targetSeconds) * 100))
        }
      }

      // 2. Keyframe deadlock: playhead is stuck just before a valid chunk
      if (current < start && start - current <= 1.5) {
        const last = unstickAtByVideo.get(video) || 0
        if (Date.now() - last > 400) {
          unstickAtByVideo.set(video, Date.now())
          try {
            video.currentTime = start + 0.05
          } catch {
            /* ignore seek errors */
          }
        }
        const t = video.currentTime
        const forwardSec = Math.max(0, end - t)
        return {
          forwardSec,
          pct: Math.min(100, Math.round((forwardSec / targetSeconds) * 100))
        }
      }
    }
  } catch {
    /* ignore */
  }
  return { forwardSec: 0, pct: 0 }
}

function isReadyToPlay(
  video: HTMLVideoElement | null,
  streamStats: { contiguousForwardBytes?: number; done?: boolean; total?: number } | null,
  durationHint = 0
): boolean {
  if (streamStats?.done) return true
  const t = video?.currentTime || 0
  const vd = video?.duration
  const dur =
    typeof vd === 'number' && Number.isFinite(vd) && vd > 1 && vd !== Number.POSITIVE_INFINITY
      ? vd
      : durationHint > 1
        ? durationHint
        : 0
  const remaining = dur > 1 ? Math.max(0, dur - t) : Number.POSITIVE_INFINITY
  // Near EOF we cannot wait for a full 10s / 35MB window.
  const needSec = Number.isFinite(remaining)
    ? Math.min(PREBUFFER_SECONDS, Math.max(0.25, remaining * 0.85))
    : PREBUFFER_SECONDS

  if (video) {
    try {
      for (let i = 0; i < video.buffered.length; i++) {
        const start = video.buffered.start(i)
        const end = video.buffered.end(i)
        if (t >= start && t <= end) {
          if (end - t >= needSec) return true
        }
      }
    } catch {
      /* ignore */
    }
  }

  const contig = streamStats?.contiguousForwardBytes || 0
  if (Number.isFinite(remaining) && remaining <= PREBUFFER_SECONDS + 1) {
    const total = streamStats?.total || 0
    const needBytes =
      total > 0 && dur > 1
        ? Math.min(
            PREBUFFER_BYTES,
            Math.max(32 * 1024, Math.ceil((remaining / dur) * total) + 64 * 1024)
          )
        : Math.min(PREBUFFER_BYTES, 2 * 1024 * 1024)
    if (contig >= needBytes) return true
    if (remaining < 1.25 && contig > 0) return true
  }
  return contig >= PREBUFFER_BYTES
}

/** Duration for torrent byte↔time mapping — never use inflated catalog runtimes. */
function torrentPriorityDuration(video: HTMLVideoElement | null, fallback = 0): number {
  const vd = video?.duration
  if (typeof vd === 'number' && Number.isFinite(vd) && vd > 1 && vd !== Number.POSITIVE_INFINITY) {
    return vd
  }
  return fallback > 1 ? fallback : 0
}

function readBufferedRanges(video: HTMLVideoElement | null): BufferRange[] {
  if (!video) return []
  const ranges: BufferRange[] = []
  try {
    for (let i = 0; i < video.buffered.length; i++) {
      ranges.push({ start: video.buffered.start(i), end: video.buffered.end(i) })
    }
  } catch {
    /* ignore */
  }
  return ranges
}

function isHevcRelease(label: string): boolean {
  return parseTorrentVideo(label).isHevc
}

function playbackWarning(label: string): string | null {
  // HEVC uses the interactive recovery card — keep only soft MKV tip here.
  if (isHevcRelease(label)) return null
  const n = label.toLowerCase()
  if (n.includes('.mkv') || /\bmkv\b/.test(n)) {
    return 'MKV can take longer to start in-app. Prefer an MP4 release if playback stays black.'
  }
  return null
}

export function PlayerPage(): JSX.Element {
  const session = useAppStore((s) => s.session)!
  const stashLastSession = useAppStore((s) => s.stashLastSession)
  const setSession = useAppStore((s) => s.setSession)
  const settings = useAppStore((s) => s.settings)
  const qualityPref = useAppStore((s) => s.qualityPref)

  const videoRef = useRef<HTMLVideoElement>(null)
  const scrubVideoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const waitingSinceRef = useRef<number | null>(null)
  const sourceAttachedRef = useRef(false)
  /** After seek / underrun: block play until contiguous 10s or 35 MB ahead. */
  const needsContiguousBufferRef = useRef(true)
  const initialStartedRef = useRef(false)
  /** User/app wants playback; stays true across waiting-induced pauses. */
  const wantPlaybackRef = useRef(true)
  const dlProgressRef = useRef(0)
  const holdTimersRef = useRef<
    Map<string, { delay?: ReturnType<typeof setTimeout>; interval?: ReturnType<typeof setInterval> }>
  >(new Map())
  const durationRef = useRef(0)
  const currentRef = useRef(0)
  const bufferUiRef = useRef({ pct: 0, fwdPct: 0, fwdSec: 0, rangesKey: '' })
  const seekFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const subToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const subOffsetMsRef = useRef(0)
  const cuesRef = useRef<Cue[]>([])

  const [playing, setPlaying] = useState(true)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [proxyOffset, setProxyOffset] = useState(() =>
    session.resumeSeconds &&
    (session.source.needsAudioRemux || needsAudioRemux(session.source.label || ''))
      ? session.resumeSeconds
      : 0
  )
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [nativePip, setNativePip] = useState(false)
  const [showStats, setShowStats] = useState(false)
  const [showSubs, setShowSubs] = useState(false)
  const [subSize, setSubSize] = useState(28)
  const [subtitleOffsetMs, setSubtitleOffsetMs] = useState(0)
  const [audioOffsetMs, setAudioOffsetMs] = useState(0)
  const [cues, setCues] = useState<Cue[]>([])
  const [subText, setSubText] = useState('')
  const [scrub, setScrub] = useState<{ x: number; t: number; visible: boolean }>({
    x: 0,
    t: 0,
    visible: false
  })
  /** While dragging the timeline, show this time without committing a network seek. */
  const [scrubTime, setScrubTime] = useState<number | null>(null)
  const scrubbingRef = useRef(false)
  const scrubTimeRef = useRef<number | null>(null)
  const [dl, setDl] = useState<{
    speed: number
    received: number
    total: number
    done: boolean
    peers?: number
    progress?: number
    contiguousForwardBytes?: number
  } | null>(null)
  const [bufferedRanges, setBufferedRanges] = useState<BufferRange[]>([])
  const [videoWidth, setVideoWidth] = useState(0)
  const [videoHeight, setVideoHeight] = useState(0)
  const [fullscreen, setFullscreen] = useState(false)
  const [chromeVisible, setChromeVisible] = useState(true)
  const [buffering, setBuffering] = useState(true)
  const [mediaError, setMediaError] = useState<string | null>(null)
  const [mediaAttached, setMediaAttached] = useState(false)
  const [forwardBufferPct, setForwardBufferPct] = useState(0)
  const [forwardBufferSec, setForwardBufferSec] = useState(0)
  const [stallRecovery, setStallRecovery] = useState<{ speedLabel: string } | null>(null)
  const [stallSwitchBusy, setStallSwitchBusy] = useState(false)
  const [hevcSwitchBusy, setHevcSwitchBusy] = useState(false)
  const [vlcBusy, setVlcBusy] = useState(false)
  const stallNudgedRef = useRef(false)
  const completedMarkedRef = useRef(false)
  const isFinishedRef = useRef(false)
  const finishedPurgedRef = useRef(false)
  const sessionRef = useRef(session)
  sessionRef.current = session
  const prioritizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [seekFlash, setSeekFlash] = useState<{ dir: -1 | 1; seconds: number } | null>(null)
  const [subToast, setSubToast] = useState<string | null>(null)
  const [availableSubs, setAvailableSubs] = useState<UnifiedSubtitle[]>([])
  const [activeSubId, setActiveSubId] = useState<string>('')
  const [subsLoading, setSubsLoading] = useState(false)
  const [subLang, setSubLang] = useState(
    () => session.subtitleLang || settings?.defaultSubtitleLanguage || 'en'
  )
  const [upNext, setUpNext] = useState<NextEpisodeTarget | null>(null)
  const [upNextSeconds, setUpNextSeconds] = useState(10)
  const [upNextBusy, setUpNextBusy] = useState(false)
  const upNextDismissedRef = useRef(false)
  const upNextShownRef = useRef(false)
  /** FFmpeg remux `-ss` origin — wall clock = proxyOffset + video.currentTime */
  const remuxOriginRef = useRef(proxyOffset)
  const isProxiedStream =
    (Boolean(session.source.needsAudioRemux) ||
      needsAudioRemux(session.source.label || session.title)) &&
    Boolean(window.cinevault) &&
    session.source.kind !== 'hls'
  const useAudioRemux = isProxiedStream
  const codecHint = playbackWarning(session.source.label || session.title)
  const hevcBlocked = isHevcRelease(session.source.label || session.title) && videoWidth === 0

  /** TMDB / catalog runtime wins for the scrubber; HTML5 duration is fallback only. */
  const trueDuration = resolveTrueDuration(
    session.runtimeSeconds,
    Number.isFinite(duration) && duration > 0 && duration !== Number.POSITIVE_INFINITY
      ? duration
      : durationRef.current || 0
  )
  /** Keep a max() hint for completion / up-next when both sources exist. */
  const totalDurationSeconds = Math.max(
    trueDuration,
    Number.isFinite(duration) && duration > 0 && duration !== Number.POSITIVE_INFINITY
      ? duration
      : 0,
    durationRef.current || 0
  )

  const currentPlaybackTime = current

  const nightMode = Boolean(settings?.nightMode)
  const volumeBoost = settings?.volumeBoost ?? 1.25
  useAudioEnhancer(videoRef, nightMode, volumeBoost, audioOffsetMs)

  const aniSkip = useAniSkip(
    session.mediaType === 'anime' ? session.malId : null,
    session.mediaType === 'anime' ? session.episode : null
  )
  const showSkipIntro = isInSkipWindow(currentPlaybackTime, aniSkip.op)

  useEffect(() => {
    setSubLang(session.subtitleLang || settings?.defaultSubtitleLanguage || 'en')
    completedMarkedRef.current = false
    isFinishedRef.current = false
    finishedPurgedRef.current = false
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset language only for a new playback session
  }, [session.cacheId])

  /** Mark finished when hitting credits / AniSkip ED / ≤2 min remaining. */
  useEffect(() => {
    if (checkIsFinished(currentPlaybackTime, totalDurationSeconds, aniSkip.ed)) {
      isFinishedRef.current = true
    }
  }, [currentPlaybackTime, totalDurationSeconds, aniSkip.ed])

  /**
   * Wipe torrent cache after finishing. For binge, pass `purgeMedia: false` so only
   * this episode's cache id is destroyed (next episode shares mediaId).
   */
  const purgeTorrentCacheId = async (
    cacheId: string,
    opts?: { purgeMedia?: boolean; mediaId?: string }
  ): Promise<void> => {
    const snap = sessionRef.current
    const mediaId = opts?.mediaId || mediaIdFromParts(snap.mediaType, snap.externalId)
    const purgeMedia = opts?.purgeMedia !== false
    try {
      await window.cinevault?.torrent.stop(cacheId, { destroyStore: true })
      await window.cinevault?.torrent.destroyData({ id: cacheId, destroyStore: true })
      await window.cinevault?.cache.remove(cacheId)
      if (purgeMedia) {
        await window.cinevault?.torrent.deleteByMedia?.(mediaId)
      }
      console.log(`[Storage] Auto-purged completed media: ${mediaId} (${cacheId})`)
    } catch (err) {
      console.error('[Storage] Failed to auto-purge completed media:', err)
      throw err
    }
  }

  const triggerFinishedCleanup = async (opts?: {
    purgeMedia?: boolean
    cacheId?: string
    skipVideoRelease?: boolean
  }): Promise<void> => {
    if (!isFinishedRef.current) return
    if (finishedPurgedRef.current) return
    finishedPurgedRef.current = true

    const snap = sessionRef.current
    const cacheId = opts?.cacheId || snap.cacheId
    const mediaId = mediaIdFromParts(snap.mediaType, snap.externalId)
    const purgeMedia = opts?.purgeMedia !== false

    if (!opts?.skipVideoRelease) {
      releaseVideoElement(videoRef.current)
      releaseVideoElement(scrubVideoRef.current)
    }

    markAsCompleted(mediaId, snap.season, snap.episode)
    completedMarkedRef.current = true

    if (snap.source.kind !== 'torrent') {
      try {
        await window.cinevault?.cache.markComplete(cacheId)
      } catch {
        /* ignore */
      }
      return
    }

    try {
      await purgeTorrentCacheId(cacheId, { purgeMedia, mediaId })
    } catch {
      finishedPurgedRef.current = false
    }
  }

  // Natural end of file — movies purge immediately; series wait for binge / exit.
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const onEnded = (): void => {
      isFinishedRef.current = true
      if (sessionRef.current.mediaType === 'movie') {
        void triggerFinishedCleanup({ purgeMedia: true })
      }
    }
    video.addEventListener('ended', onEnded)
    return () => video.removeEventListener('ended', onEnded)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebind per stream
  }, [session.cacheId])

  // Leaving the player after credits → reclaim disk (true unmount only).
  useEffect(() => {
    return () => {
      if (!isFinishedRef.current || finishedPurgedRef.current) return
      const snap = sessionRef.current
      const mediaId = mediaIdFromParts(snap.mediaType, snap.externalId)
      const cacheId = snap.cacheId
      releaseVideoElement(videoRef.current)
      markAsCompleted(mediaId, snap.season, snap.episode)
      if (snap.source.kind === 'torrent') {
        void (async () => {
          try {
            await window.cinevault?.torrent.stop(cacheId, { destroyStore: true })
            await window.cinevault?.torrent.destroyData({ id: cacheId, destroyStore: true })
            await window.cinevault?.cache.remove(cacheId)
            await window.cinevault?.torrent.deleteByMedia?.(mediaId)
            console.log(`[Storage] Auto-purged completed media on exit: ${mediaId}`)
          } catch (err) {
            console.error('[Storage] Failed to auto-purge on exit:', err)
          }
        })()
      } else {
        void window.cinevault?.cache.markComplete(cacheId)
      }
    }
  }, [])

  const bumpChrome = (): void => {
    setChromeVisible(true)
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    idleTimerRef.current = setTimeout(() => {
      const v = videoRef.current
      if (v && !v.paused && !showSubs && !showStats) setChromeVisible(false)
    }, 2500)
  }

  useEffect(() => {
    document.documentElement.classList.toggle('player-chrome-hidden', !chromeVisible)
    return () => document.documentElement.classList.remove('player-chrome-hidden')
  }, [chromeVisible])

  useEffect(() => {
    bumpChrome()
    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset idle when playback or panels change
  }, [session.cacheId, playing, showSubs, showStats])

  const tryStartPlayback = (): void => {
    const video = videoRef.current
    if (!video || !sourceAttachedRef.current) return
    if (!wantPlaybackRef.current) return
    if (
      session.source.kind === 'torrent' &&
      needsContiguousBufferRef.current &&
      !isReadyToPlay(video, dl, durationRef.current)
    ) {
      setBuffering(true)
      return
    }
    void video.play().then(() => {
      initialStartedRef.current = true
      needsContiguousBufferRef.current = false
      setBuffering(false)
      waitingSinceRef.current = null
      setPlaying(true)
    }).catch(() => {
      setBuffering(true)
    })
  }

  useEffect(() => {
    const meta = session.runtimeSeconds || 0
    if (meta > 0) {
      setDuration((prev) => Math.max(prev, meta))
      durationRef.current = Math.max(durationRef.current, meta)
    }
  }, [session.cacheId, session.runtimeSeconds])

  const wallClockTime = (videoTime: number): number => remuxOriginRef.current + videoTime

  const resolvePlayableUrl = (rawUrl: string, startSeconds = 0): string => {
    if (!useAudioRemux) return rawUrl
    if (!window.cinevault) return rawUrl
    if (session.source.kind === 'hls') return rawUrl
    return buildAudioRemuxUrl(rawUrl, startSeconds)
  }

  const attachMediaSource = (src: string, resumeAt: number): void => {
    const video = videoRef.current
    if (!video || sourceAttachedRef.current) return
    sourceAttachedRef.current = true
    wantPlaybackRef.current = true

    const remuxing = useAudioRemux
    const origin = remuxing ? Math.max(0, resumeAt) : 0
    const playUrl = resolvePlayableUrl(src, origin)
    remuxOriginRef.current = origin
    setProxyOffset(origin)

    video.src = playUrl
    // Scrub preview binds lazily on first timeline hover — a second <video> on the
    // same torrent URL probes mid/end ranges and used to yank piece priority.
    setMediaAttached(true)

    const onMeta = (): void => {
      if (!remuxing && resumeAt > 0) video.currentTime = resumeAt
    }
    const resumeIfWanted = (): void => {
      if (wantPlaybackRef.current && video.paused) tryStartPlayback()
    }
    video.addEventListener('loadedmetadata', onMeta, { once: true })
    video.addEventListener('canplay', resumeIfWanted)
    video.addEventListener('canplaythrough', resumeIfWanted)
    video.addEventListener('loadeddata', () => tryStartPlayback(), { once: true })

    if (session.source.kind === 'torrent') {
      void window.cinevault?.torrent.prioritize({
        id: session.cacheId,
        currentTime: remuxing ? 0 : Math.max(0, resumeAt),
        duration: torrentPriorityDuration(video)
      })
    }
  }

  /** Re-pipe FFmpeg from a new absolute timestamp (fragmented remux has no byte-range seek). */
  const reattachRemuxAt = (absoluteSeconds: number): void => {
    const video = videoRef.current
    if (!video) return
    const target = Math.max(0, absoluteSeconds)
    video.pause()
    remuxOriginRef.current = target
    setProxyOffset(target)
    setCurrent(target)
    setBuffering(true)
    waitingSinceRef.current = Date.now()
    wantPlaybackRef.current = true

    const playUrl = buildAudioRemuxUrl(session.source.url, target)
    video.src = playUrl
    video.load()
    const kick = (): void => {
      void video.play().then(() => {
        setPlaying(true)
        setBuffering(false)
        waitingSinceRef.current = null
      }).catch(() => {
        setBuffering(true)
      })
    }
    video.addEventListener('loadeddata', kick, { once: true })
    video.addEventListener('canplay', kick, { once: true })

    if (session.source.kind === 'torrent') {
      void window.cinevault?.torrent.prioritize({
        id: session.cacheId,
        currentTime: target,
        duration: torrentPriorityDuration(video, durationRef.current),
        invalidate: true
      })
    }
    bumpChrome()
  }

  // Load media — torrents attach immediately; play waits for contiguous 10s / 35 MB ahead
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    let hls: Hls | null = null
    const src = session.source.url
    setMediaError(null)
    setBuffering(true)
    setMediaAttached(false)
    waitingSinceRef.current = Date.now()
    sourceAttachedRef.current = false
    initialStartedRef.current = false
    wantPlaybackRef.current = true
    needsContiguousBufferRef.current = session.source.kind === 'torrent'
    dlProgressRef.current = 0

    remuxOriginRef.current = 0
    setProxyOffset(0)
    const resumeAt = session.resumeSeconds || 0

    if (session.source.kind === 'hls' && Hls.isSupported()) {
      sourceAttachedRef.current = true
      setMediaAttached(true)
      needsContiguousBufferRef.current = false
      hls = new Hls({ enableWorker: true })
      hls.loadSource(src)
      hls.attachMedia(video)
      video.addEventListener('canplay', () => tryStartPlayback(), { once: true })
    } else {
      attachMediaSource(src, resumeAt)
    }

    bumpChrome()

    const stallTimer = window.setInterval(() => {
      if (!waitingSinceRef.current) return
      const waited = Date.now() - waitingSinceRef.current
      if (waited < 12_000) return
      if (isHevcRelease(session.source.label || session.title) && sourceAttachedRef.current && !video.videoWidth) {
        // Surface HEVC recovery card via hevcBlocked (videoWidth stays 0).
        setBuffering(true)
      } else if (codecHint && sourceAttachedRef.current && !video.videoWidth) {
        setMediaError(codecHint)
      }
    }, 4000)

    return () => {
      window.clearInterval(stallTimer)
      hls?.destroy()
      sourceAttachedRef.current = false
    }
  }, [session.cacheId, session.source.url, session.source.kind, session.resumeSeconds, session.source.label, codecHint])

  // Contiguous forward buffer gate (10s HTML5 or 35 MB engine) for torrents
  useEffect(() => {
    if (session.source.kind !== 'torrent') return
    const progress = dl?.progress ?? (dl && dl.total > 0 ? dl.received / dl.total : 0)
    dlProgressRef.current = progress

    if (!sourceAttachedRef.current) return
    if (!needsContiguousBufferRef.current && !waitingSinceRef.current) return

    const video = videoRef.current
    const fwd = video ? calculateForwardBuffer(video) : { forwardSec: 0, pct: 0 }
    setForwardBufferPct(fwd.pct)
    setForwardBufferSec(fwd.forwardSec)

    if (isReadyToPlay(video, dl, durationRef.current)) {
      tryStartPlayback()
    } else {
      setBuffering(true)
    }
  }, [dl, session.source.kind])

  // Keep cue + offset refs fresh for seeked / rAF-free handlers
  useEffect(() => {
    cuesRef.current = cues
  }, [cues])

  useEffect(() => {
    subOffsetMsRef.current = subtitleOffsetMs
  }, [subtitleOffsetMs])

  const refreshSubText = (videoTime?: number): void => {
    const video = videoRef.current
    const t = videoTime ?? video?.currentTime ?? 0
    const cue = findActiveCue(cuesRef.current, t, subOffsetMsRef.current)
    setSubText(cue?.text || '')
  }

  // Load cues from path or HTTP/blob URL
  useEffect(() => {
    let cancelled = false
    const run = async (): Promise<void> => {
      try {
        if (session.subtitlePath && window.cinevault) {
          const url = await window.cinevault.download.toFileUrl(session.subtitlePath)
          const res = await fetch(url)
          const text = await res.text()
          if (!cancelled) {
            const next = parseSrt(text)
            cuesRef.current = next
            setCues(next)
            refreshSubText()
          }
          return
        }
        if (session.subtitleUrl) {
          const res = await fetch(session.subtitleUrl)
          const text = await res.text()
          if (!cancelled) {
            const next = parseSrt(text)
            cuesRef.current = next
            setCues(next)
            refreshSubText()
          }
          return
        }
        if (!cancelled) {
          cuesRef.current = []
          setCues([])
          setSubText('')
        }
      } catch {
        if (!cancelled) {
          cuesRef.current = []
          setCues([])
          setSubText('')
        }
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [session.subtitlePath, session.subtitleUrl])

  // Fetch available tracks when playback starts or language changes
  useEffect(() => {
    if (!session.imdbId) return
    let cancelled = false
    setSubsLoading(true)
    void getAvailableSubtitles({
      imdbId: session.imdbId,
      type: session.mediaType === 'movie' ? 'movie' : 'series',
      lang: subLang,
      season: session.season,
      episode: session.episode,
      title: session.title,
      releaseHint: session.source.label
    })
      .then((list) => {
        if (cancelled) return
        const ranked = rankSubtitlesByRelease(list, session.source.label)
        setAvailableSubs(ranked)
        setActiveSubId((prev) => {
          if (prev && ranked.some((s) => s.id === prev)) return prev
          if (session.subtitleLabel && session.subtitleLang === subLang) {
            const match = ranked.find((s) => formatSubtitleMenuLabel(s) === session.subtitleLabel)
            if (match) return match.id
          }
          // Auto-pick best release match when nothing loaded yet
          if (!session.subtitleUrl && !session.subtitlePath && ranked[0]) {
            return ranked[0].id
          }
          return prev
        })
      })
      .catch(() => {
        if (!cancelled) setAvailableSubs([])
      })
      .finally(() => {
        if (!cancelled) setSubsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [
    session.imdbId,
    session.mediaType,
    session.season,
    session.episode,
    session.title,
    session.source.label,
    subLang
  ])

  const applySubtitleTrack = async (id: string): Promise<void> => {
    setActiveSubId(id)
    const currentSession = useAppStore.getState().session
    if (!currentSession) return
    if (!id) {
      cuesRef.current = []
      setCues([])
      setSubText('')
      setSession({
        ...currentSession,
        subtitlePath: null,
        subtitleUrl: null,
        subtitleLabel: undefined,
        subtitleLang: subLang
      })
      return
    }
    const track = availableSubs.find((s) => s.id === id)
    if (!track) return
    setSubsLoading(true)
    try {
      const resolved = await resolveSubtitleTrack(track, subLang)
      let text = resolved.content || ''
      if (!text && resolved.path && window.cinevault) {
        const u = await window.cinevault.download.toFileUrl(resolved.path)
        text = await (await fetch(u)).text()
      } else if (!text && (resolved.url || resolved.blobUrl)) {
        text = await (await fetch(resolved.url || resolved.blobUrl!)).text()
      }
      const next = parseSrt(text || '')
      cuesRef.current = next
      setCues(next)
      setSession({
        ...currentSession,
        subtitlePath: resolved.path,
        subtitleUrl: resolved.url || resolved.blobUrl,
        subtitleLabel: formatSubtitleMenuLabel(track),
        subtitleLang: subLang
      })
      refreshSubText()
    } catch {
      setSubToast('Could not load subtitle track')
      if (subToastTimerRef.current) clearTimeout(subToastTimerRef.current)
      subToastTimerRef.current = setTimeout(() => setSubToast(null), 2500)
    } finally {
      setSubsLoading(false)
    }
  }

  const autoAppliedRef = useRef(false)

  const changeSubLang = (lang: string): void => {
    if (lang === subLang) return
    setSubLang(lang)
    autoAppliedRef.current = false
    cuesRef.current = []
    setCues([])
    setSubText('')
    setActiveSubId('')
    setAvailableSubs([])
    const currentSession = useAppStore.getState().session
    if (currentSession) {
      setSession({
        ...currentSession,
        subtitlePath: null,
        subtitleUrl: null,
        subtitleLabel: undefined,
        subtitleLang: lang
      })
    }
    setSubToast(`Searching ${SUB_LANG_LABELS[lang] || lang.toUpperCase()}…`)
    if (subToastTimerRef.current) clearTimeout(subToastTimerRef.current)
    subToastTimerRef.current = setTimeout(() => setSubToast(null), 1800)
  }

  // Auto-apply best release match when player opens without a preselected track,
  // or after the user switches language in-panel.
  useEffect(() => {
    autoAppliedRef.current = false
  }, [session.cacheId, subLang])

  useEffect(() => {
    if (autoAppliedRef.current) return
    if (subsLoading || !availableSubs.length) return
    if (cues.length > 0) return
    if (session.subtitleUrl || session.subtitlePath) return
    const id = activeSubId || availableSubs[0]?.id
    if (!id) return
    autoAppliedRef.current = true
    void applySubtitleTrack(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot when ranked list arrives
  }, [availableSubs, subsLoading, session.subtitleUrl, session.subtitlePath, activeSubId, cues.length])

  // Download / torrent stats polling
  useEffect(() => {
    if (session.source.kind === 'local') return
    const id = session.cacheId
    const isTorrent = session.source.kind === 'torrent'
    const pull = (): void => {
      if (isTorrent) {
        void window.cinevault?.torrent.status(id).then((s) => {
          if (!s) return
          setDl((prev) => {
            const next = {
              speed: s.downloadSpeed,
              received: s.downloaded,
              total: s.total,
              done: s.done,
              peers: s.peers,
              progress: s.progress,
              contiguousForwardBytes: s.contiguousForwardBytes
            }
            if (
              prev &&
              prev.done === next.done &&
              prev.peers === next.peers &&
              Math.abs((prev.progress || 0) - (next.progress || 0)) < 0.004 &&
              Math.abs((prev.speed || 0) - (next.speed || 0)) < 2048 &&
              Math.abs((prev.contiguousForwardBytes || 0) - (next.contiguousForwardBytes || 0)) <
                256 * 1024
            ) {
              return prev
            }
            return next
          })
        })
      } else {
        void window.cinevault?.download.status(id).then((s) => {
          if (!s) return
          setDl({
            speed: s.speed,
            received: s.bytesReceived,
            total: s.bytesTotal,
            done: s.done,
            progress: s.bytesTotal > 0 ? s.bytesReceived / s.bytesTotal : 0
          })
        })
      }
    }
    pull()
    const t = setInterval(pull, 1000)
    return () => clearInterval(t)
  }, [session.cacheId, session.source.kind])

  // Time updates + buffer + stall detection
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const refreshBuffer = (force = false): void => {
      const fwd = calculateForwardBuffer(video)
      const mediaDur = resolveTrueDuration(
        session.runtimeSeconds,
        torrentPriorityDuration(video, duration || durationRef.current || 0)
      )
      const ranges = readBufferedRanges(video)
      const pct = computeBufferedPercent(mediaDur, video.currentTime, ranges, null)
      const rangesKey = ranges.map((r) => `${r.start.toFixed(2)}-${r.end.toFixed(2)}`).join('|')
      const prev = bufferUiRef.current
      if (
        !force &&
        Math.abs(prev.pct - pct) < 0.4 &&
        Math.abs(prev.fwdPct - fwd.pct) < 0.5 &&
        Math.abs(prev.fwdSec - fwd.forwardSec) < 0.25 &&
        prev.rangesKey === rangesKey
      ) {
        return
      }
      bufferUiRef.current = { pct, fwdPct: fwd.pct, fwdSec: fwd.forwardSec, rangesKey }
      setForwardBufferPct(fwd.pct)
      setForwardBufferSec(fwd.forwardSec)
      setBufferedRanges(ranges)
    }

    const syncTorrentWindow = (): void => {
      if (session.source.kind !== 'torrent') return
      if (prioritizeTimerRef.current) clearTimeout(prioritizeTimerRef.current)
      prioritizeTimerRef.current = setTimeout(() => {
        void window.cinevault?.torrent.prioritize({
          id: session.cacheId,
          currentTime: wallClockTime(video.currentTime),
          duration: torrentPriorityDuration(video, durationRef.current)
        })
      }, 180)
    }

    const onTime = (): void => {
      const t = wallClockTime(video.currentTime)
      // Throttle React commits — timeupdate fires ~4–10Hz otherwise
      const prevQ = Math.floor((currentRef.current || 0) * 4)
      const nextQ = Math.floor(t * 4)
      if (nextQ !== prevQ || Math.abs(t - (currentRef.current || 0)) >= 0.35) {
        setCurrent(t)
      }
      currentRef.current = t
      const cue = findActiveCue(cuesRef.current, t, subOffsetMsRef.current)
      const text = cue?.text || ''
      setSubText((prevText) => (prevText === text ? prevText : text))
      refreshBuffer(false)
    }
    const onSeeked = (): void => {
      const t = wallClockTime(video.currentTime)
      setCurrent(t)
      const cue = findActiveCue(cuesRef.current, t, subOffsetMsRef.current)
      setSubText(cue?.text || '')
      refreshBuffer()
      syncTorrentWindow()
    }
    const onMeta = (): void => {
      const d = video.duration
      if (useAudioRemux) {
        // Fragmented remux streams often report remaining length or Infinity — prefer metadata.
        const meta = session.runtimeSeconds || 0
        if (meta > 0) {
          setDuration(meta)
          durationRef.current = meta
        } else if (Number.isFinite(d) && d > 0 && d !== Number.POSITIVE_INFINITY) {
          const absolute = d + remuxOriginRef.current
          setDuration((prev) => Math.max(prev, absolute))
          durationRef.current = Math.max(durationRef.current, absolute)
        }
      } else if (Number.isFinite(d) && d > 0 && d !== Number.POSITIVE_INFINITY) {
        setDuration(d)
        durationRef.current = d
      }
      setVideoWidth(video.videoWidth)
      setVideoHeight(video.videoHeight)
      refreshBuffer()
      syncTorrentWindow()
    }
    const onPlay = (): void => {
      wantPlaybackRef.current = true
      setPlaying(true)
      bumpChrome()
      syncTorrentWindow()
    }
    const onPause = (): void => {
      // Waiting-induced pause keeps wantPlayback; intentional pause clears it below via togglePlay.
      setChromeVisible(true)
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
      if (!waitingSinceRef.current) {
        setPlaying(false)
      }
    }
    const onWaiting = (): void => {
      setBuffering(true)
      waitingSinceRef.current = Date.now()
      stallNudgedRef.current = false
      const fwd = calculateForwardBuffer(video)
      setForwardBufferPct(fwd.pct)
      setForwardBufferSec(fwd.forwardSec)
      // Pause to stop decoder thrash, but keep wantPlayback so canplay can resume.
      if (!video.paused) video.pause()
      if (session.source.kind === 'torrent') {
        needsContiguousBufferRef.current = true
      }
      syncTorrentWindow()
    }
    const onPlaying = (): void => {
      wantPlaybackRef.current = true
      setPlaying(true)
      setBuffering(false)
      setStallRecovery(null)
      stallNudgedRef.current = false
      needsContiguousBufferRef.current = false
      setVideoWidth(video.videoWidth)
      setVideoHeight(video.videoHeight)
      if (waitingSinceRef.current) {
        waitingSinceRef.current = null
      }
    }
    const onResize = (): void => {
      setVideoWidth(video.videoWidth)
      setVideoHeight(video.videoHeight)
    }
    const onStalled = (): void => {
      setBuffering(true)
      if (!waitingSinceRef.current) waitingSinceRef.current = Date.now()
      const fwd = calculateForwardBuffer(video)
      setForwardBufferPct(fwd.pct)
      setForwardBufferSec(fwd.forwardSec)
      if (session.source.kind === 'torrent') {
        needsContiguousBufferRef.current = true
      }
      syncTorrentWindow()
    }
    const onCanPlay = (): void => {
      if (wantPlaybackRef.current && video.paused) {
        tryStartPlayback()
      }
    }
    const onError = (): void => {
      const err = video.error
      const code = err?.code
      const labels: Record<number, string> = {
        1: 'Playback aborted',
        2: 'Network error while loading media',
        3: 'Media decode failed',
        4: 'Stream unavailable or format not supported'
      }
      const msg =
        code && labels[code]
          ? labels[code]
          : err
            ? `Media error ${code}`
            : 'Playback failed'
      setMediaError(msg)
      setBuffering(false)
    }
    const onProgress = (): void => refreshBuffer()

    video.addEventListener('timeupdate', onTime)
    video.addEventListener('seeked', onSeeked)
    video.addEventListener('loadedmetadata', onMeta)
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    video.addEventListener('waiting', onWaiting)
    video.addEventListener('playing', onPlaying)
    video.addEventListener('stalled', onStalled)
    video.addEventListener('error', onError)
    video.addEventListener('progress', onProgress)
    video.addEventListener('resize', onResize)
    video.addEventListener('canplay', onCanPlay)
    video.addEventListener('canplaythrough', onCanPlay)
    // Immediate sync after attach / cue changes
    onSeeked()
    return () => {
      if (prioritizeTimerRef.current) clearTimeout(prioritizeTimerRef.current)
      video.removeEventListener('timeupdate', onTime)
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('loadedmetadata', onMeta)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('waiting', onWaiting)
      video.removeEventListener('playing', onPlaying)
      video.removeEventListener('stalled', onStalled)
      video.removeEventListener('error', onError)
      video.removeEventListener('progress', onProgress)
      video.removeEventListener('resize', onResize)
      video.removeEventListener('canplay', onCanPlay)
      video.removeEventListener('canplaythrough', onCanPlay)
    }
  }, [cues, subtitleOffsetMs, duration, session.source.url, session.source.kind, session.cacheId])

  // Stall watchdog: nudge peers after 6s slow buffer; offer switch after 12s
  useEffect(() => {
    if (!buffering || session.source.kind !== 'torrent') return
    const tick = window.setInterval(() => {
      const since = waitingSinceRef.current
      if (!since) return
      const waited = Date.now() - since
      const speed = dl?.speed ?? 0
      if (waited >= 6000 && speed < 50 * 1024) {
        if (!stallNudgedRef.current) {
          stallNudgedRef.current = true
          void window.cinevault?.torrent.nudge(session.cacheId)
          const video = videoRef.current
          if (video) {
            void window.cinevault?.torrent.prioritize({
              id: session.cacheId,
              currentTime: video.currentTime,
              duration: torrentPriorityDuration(video, durationRef.current)
            })
          }
        }
      }
      if (waited >= 12_000 && speed < 50 * 1024) {
        setStallRecovery({ speedLabel: formatSpeed(speed) })
      }
    }, 1000)
    return () => window.clearInterval(tick)
  }, [buffering, dl?.speed, session.cacheId, session.source.kind])

  // Persist progress
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const mediaId = mediaIdFromParts(session.mediaType, session.externalId)
    const showTitle = session.showTitle || session.title.split(' · ')[0]

    const buildEntry = (): PlaybackProgress => {
      const t = useAudioRemux
        ? remuxOriginRef.current + (video.currentTime || 0)
        : video.currentTime || 0
      const dur = Math.max(
        session.runtimeSeconds || 0,
        durationRef.current || 0,
        Number.isFinite(video.duration) && video.duration !== Infinity ? video.duration : 0
      )
      return {
        mediaId,
        mediaType: session.mediaType,
        externalId: session.externalId,
        provider: session.provider,
        title: showTitle,
        posterPath: session.posterUrl || undefined,
        backdropPath: session.backdropUrl || undefined,
        season: session.season,
        episode: session.episode,
        episodeTitle: session.episodeTitle,
        currentTime: t,
        duration: dur,
        percentage: dur > 0 ? (t / dur) * 100 : 0,
        updatedAt: Date.now()
      }
    }

    const persistHistory = (immediate: boolean): void => {
      const dur = Math.max(session.runtimeSeconds || 0, durationRef.current || 0)
      const hasDur =
        dur > 0 ||
        (Number.isFinite(video.duration) && video.duration > 0 && video.duration !== Infinity)
      if (!hasDur) return
      const entry = buildEntry()
      saveProgress(entry, { immediate })

      const affinityType = toAffinityType(session.mediaType)
      const isFavorite = useAppStore
        .getState()
        .favorites.some(
          (f) => f.mediaType === session.mediaType && f.externalId === session.externalId
        )
      const genreIds =
        session.genreIds?.length
          ? session.genreIds
          : genreNamesToIds(session.genres || [], affinityType)
      LocalAffinityEngine.recordSession({
        id: session.externalId,
        type: affinityType,
        genreIds,
        watchedSeconds: entry.currentTime,
        totalSeconds: entry.duration,
        isFavorite
      })
    }

    const persistCache = (): void => {
      if (!window.cinevault) return
      const entry = buildEntry()
      const mediaId = mediaIdFromParts(session.mediaType, session.externalId)
      const done = entry.percentage >= COMPLETE_AT || isFinishedRef.current
      void window.cinevault.cache.upsert({
        id: session.cacheId,
        mediaId,
        title: session.title,
        mediaType: session.mediaType,
        filePath: session.source.kind === 'local' ? session.source.url : '',
        createdAt: Date.now(),
        lastWatchedAt: Date.now(),
        completed: done,
        progressSeconds: entry.currentTime,
        durationSeconds: entry.duration,
        sourceUrl: session.source.kind !== 'local' ? session.source.url : undefined
      })
      if (done) {
        isFinishedRef.current = true
        if (!completedMarkedRef.current) {
          completedMarkedRef.current = true
          // Schedule backup wipe; primary wipe runs on exit / binge / movie ended.
          void window.cinevault.cache.markComplete(session.cacheId)
        }
      }
    }

    const onPause = (): void => {
      persistHistory(true)
      persistCache()
    }
    const onSeeked = (): void => {
      persistHistory(true)
    }

    const t = setInterval(() => {
      persistHistory(false)
      persistCache()
    }, 5000)

    video.addEventListener('pause', onPause)
    video.addEventListener('seeked', onSeeked)

    return () => {
      clearInterval(t)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('seeked', onSeeked)
      persistHistory(true)
      flushProgress(mediaId, session.season, session.episode)
    }
  }, [session])

  // Credits / Up Next detection
  useEffect(() => {
    upNextDismissedRef.current = false
    upNextShownRef.current = false
    setUpNext(null)
    setUpNextSeconds(10)
  }, [session.cacheId])

  useEffect(() => {
    if (session.mediaType === 'movie') return
    if (upNextDismissedRef.current || upNextShownRef.current) return
    if (!totalDurationSeconds || totalDurationSeconds < 120) return
    const inOutro =
      current >= totalDurationSeconds - 30 ||
      (totalDurationSeconds > 0 && (current / totalDurationSeconds) * 100 >= 94)
    if (!inOutro) return

    upNextShownRef.current = true
    let cancelled = false
    void resolveNextEpisode({
      mediaType: session.mediaType,
      externalId: session.externalId,
      season: session.season,
      episode: session.episode
    }).then((next) => {
      if (cancelled || upNextDismissedRef.current) return
      if (!next) return
      setUpNext(next)
      setUpNextSeconds(10)
      bumpChrome()
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, totalDurationSeconds, session.cacheId, session.mediaType, session.externalId, session.season, session.episode])

  useEffect(() => {
    if (!upNext || upNextBusy) return
    if (upNextSeconds <= 0) {
      void playNextEpisode(upNext)
      return
    }
    const t = window.setTimeout(() => setUpNextSeconds((s) => s - 1), 1000)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upNext, upNextSeconds, upNextBusy])

  const dismissUpNext = (): void => {
    upNextDismissedRef.current = true
    setUpNext(null)
  }

  const playNextEpisode = async (target: NextEpisodeTarget): Promise<void> => {
    if (upNextBusy) return
    setUpNextBusy(true)
    setSubToast('Loading next episode…')
    const prevCacheId = session.cacheId
    const prevKind = session.source.kind
    const mediaId = mediaIdFromParts(session.mediaType, session.externalId)
    try {
      isFinishedRef.current = true
      markAsCompleted(mediaId, session.season, session.episode)
      completedMarkedRef.current = true

      const query = buildCatalogSearchQuery({
        title: target.showTitle,
        mediaType: session.mediaType,
        season: target.season,
        episode: target.episode
      })
      const raw = await searchPublicIndexers(query)
      const sorted = sortTorrentResults(
        filterValidStreams(raw, { isMovieLike: false }),
        qualityPref
      )
      const pick = getBestStream(sorted, 'Auto', { isMovieLike: false })
      const candidates = [
        pick.bestStream,
        ...sorted.filter((s) => s.id !== pick.bestStream?.id)
      ]
        .filter((s): s is NonNullable<typeof s> => Boolean(s?.magnetUri))
        .slice(0, 4)

      if (!candidates.length) {
        setSubToast('No torrents found for next episode')
        if (subToastTimerRef.current) clearTimeout(subToastTimerRef.current)
        subToastTimerRef.current = setTimeout(() => setSubToast(null), 2800)
        setUpNextBusy(false)
        setUpNextSeconds(10)
        return
      }

      // Keep the current episode streaming until a next-episode torrent is ready.
      let source: Awaited<ReturnType<typeof startTorrentPlayback>> | null = null
      let lastError: unknown = null
      for (let i = 0; i < candidates.length; i++) {
        const chosen = candidates[i]
        setSubToast(
          candidates.length > 1
            ? `Loading next episode… (${i + 1}/${candidates.length})`
            : 'Loading next episode…'
        )
        try {
          source = await startTorrentPlayback({
            cacheId: `${session.mediaType}-${session.externalId}-${target.season}-${target.episode}-${Date.now()}`,
            magnetUri: chosen.magnetUri!,
            label: chosen.name,
            preferredQuality: qualityPref,
            mediaId
          })
          break
        } catch (e) {
          lastError = e
        }
      }

      if (!source) {
        throw lastError instanceof Error
          ? lastError
          : new Error('Could not start next episode')
      }

      const cacheId = source.id

      // Drop OS locks on the finished episode, then wipe its torrent store (not the whole mediaId).
      releaseVideoElement(videoRef.current)
      releaseVideoElement(scrubVideoRef.current)
      if (prevKind === 'torrent' && prevCacheId && prevCacheId !== cacheId) {
        try {
          await purgeTorrentCacheId(prevCacheId, { purgeMedia: false, mediaId })
        } catch {
          /* startTorrentPlayback already removeByMedia(keepId) — best-effort extra wipe */
        }
      }
      finishedPurgedRef.current = true

      sourceAttachedRef.current = false
      initialStartedRef.current = false
      needsContiguousBufferRef.current = true
      cuesRef.current = []
      setCues([])
      setSubText('')
      setMediaError(null)
      setUpNext(null)
      setUpNextBusy(false)
      setSubToast(null)

      setSession({
        cacheId,
        title: `${target.showTitle} · S${target.season}E${target.episode}`,
        mediaType: session.mediaType,
        externalId: session.externalId,
        season: target.season,
        episode: target.episode,
        episodeTitle: target.episodeTitle,
        showTitle: target.showTitle,
        posterUrl: target.posterUrl,
        backdropUrl: target.backdropUrl,
        imdbId: target.imdbId || session.imdbId,
        malId: session.malId ?? null,
        source,
        subtitlePath: null,
        subtitleUrl: null,
        subtitleLabel: undefined,
        subtitleLang: subLang,
        resolution:
          source.quality !== 'unknown' ? source.quality : qualityPref,
        resumeSeconds: 0
      })
    } catch (e) {
      setUpNextBusy(false)
      setUpNextSeconds(10)
      setSubToast(e instanceof Error ? e.message : 'Could not start next episode')
      if (subToastTimerRef.current) clearTimeout(subToastTimerRef.current)
      subToastTimerRef.current = setTimeout(() => setSubToast(null), 3200)
    }
  }

  const switchToHealthierStream = async (): Promise<void> => {
    if (stallSwitchBusy || session.source.kind !== 'torrent') return
    setStallSwitchBusy(true)
    setSubToast('Finding a healthier 1080p stream…')
    const prevCacheId = session.cacheId
    try {
      const title = session.showTitle || session.title.replace(/\s·\sS\d+E\d+.*$/, '')
      const query = buildCatalogSearchQuery({
        title,
        mediaType: session.mediaType,
        season: session.season,
        episode: session.episode
      })
      const raw = await searchPublicIndexers(query)
      const sorted = sortTorrentResults(
        filterValidStreams(raw, { isMovieLike: session.mediaType === 'movie' }),
        qualityPref
      )
      const pick = getBestStream(sorted, '1080p', {
        isMovieLike: session.mediaType === 'movie'
      })
      const fallback = getBestStream(sorted, 'Auto', {
        isMovieLike: session.mediaType === 'movie'
      })
      const chosen = pick.bestStream || fallback.bestStream || sorted[0]
      if (!chosen?.magnetUri) {
        setSubToast('No alternate streams found')
        if (subToastTimerRef.current) clearTimeout(subToastTimerRef.current)
        subToastTimerRef.current = setTimeout(() => setSubToast(null), 2800)
        return
      }

      const source = await startTorrentPlayback({
        cacheId: `${session.mediaType}-${session.externalId}-${session.season || 0}-${session.episode || 0}-${Date.now()}`,
        magnetUri: chosen.magnetUri,
        label: chosen.name,
        preferredQuality: qualityPref,
        mediaId: mediaIdFromParts(session.mediaType, session.externalId)
      })

      sourceAttachedRef.current = false
      initialStartedRef.current = false
      needsContiguousBufferRef.current = true
      setMediaError(null)
      setStallRecovery(null)
      setBuffering(true)
      setSubToast(null)

      setSession({
        ...session,
        cacheId: source.id,
        source,
        resolution: source.quality !== 'unknown' ? source.quality : qualityPref,
        resumeSeconds: useAudioRemux
          ? wallClockTime(videoRef.current?.currentTime || 0)
          : videoRef.current?.currentTime || session.resumeSeconds || 0,
        runtimeSeconds: session.runtimeSeconds
      })

      void window.cinevault?.torrent.stop(prevCacheId)
    } catch (e) {
      setSubToast(e instanceof Error ? e.message : 'Could not switch stream')
      if (subToastTimerRef.current) clearTimeout(subToastTimerRef.current)
      subToastTimerRef.current = setTimeout(() => setSubToast(null), 3200)
    } finally {
      setStallSwitchBusy(false)
    }
  }

  const switchToX264Stream = async (): Promise<void> => {
    if (hevcSwitchBusy || session.source.kind !== 'torrent') return
    setHevcSwitchBusy(true)
    setSubToast('Finding an x264 stream…')
    const prevCacheId = session.cacheId
    const currentLabel = session.source.label || ''
    try {
      const title = session.showTitle || session.title.replace(/\s·\sS\d+E\d+.*$/, '')
      const query = buildCatalogSearchQuery({
        title,
        mediaType: session.mediaType,
        season: session.season,
        episode: session.episode
      })
      const raw = await searchPublicIndexers(query)
      const sorted = sortTorrentResults(
        filterValidStreams(raw, { isMovieLike: session.mediaType === 'movie' }),
        qualityPref
      )
      const target =
        session.resolution === '2160p' || session.resolution === '1440p'
          ? ('4K' as const)
          : session.resolution === '720p'
            ? ('720p' as const)
            : ('1080p' as const)
      const pick = getBestStream(sorted, target, {
        isMovieLike: session.mediaType === 'movie',
        preferX264: true
      })
      const fallback = getBestStream(sorted, 'Auto', {
        isMovieLike: session.mediaType === 'movie',
        preferX264: true
      })
      const x264Candidates = sorted.filter(
        (t) => t.magnetUri && isBrowserPreferredVideo(t.name) && t.name !== currentLabel
      )
      const chosen =
        (pick.bestStream && isBrowserPreferredVideo(pick.bestStream.name)
          ? pick.bestStream
          : null) ||
        (fallback.bestStream && isBrowserPreferredVideo(fallback.bestStream.name)
          ? fallback.bestStream
          : null) ||
        x264Candidates[0] ||
        null

      if (!chosen?.magnetUri) {
        setSubToast('No x264 streams found for this title')
        if (subToastTimerRef.current) clearTimeout(subToastTimerRef.current)
        subToastTimerRef.current = setTimeout(() => setSubToast(null), 3200)
        return
      }

      const source = await startTorrentPlayback({
        cacheId: `${session.mediaType}-${session.externalId}-${session.season || 0}-${session.episode || 0}-${Date.now()}`,
        magnetUri: chosen.magnetUri,
        label: chosen.name,
        preferredQuality: qualityPref,
        mediaId: mediaIdFromParts(session.mediaType, session.externalId)
      })

      sourceAttachedRef.current = false
      initialStartedRef.current = false
      needsContiguousBufferRef.current = true
      setMediaError(null)
      setStallRecovery(null)
      setVideoWidth(0)
      setVideoHeight(0)
      setBuffering(true)
      setSubToast(null)

      setSession({
        ...session,
        cacheId: source.id,
        source,
        resolution: source.quality !== 'unknown' ? source.quality : qualityPref,
        resumeSeconds: useAudioRemux
          ? wallClockTime(videoRef.current?.currentTime || 0)
          : videoRef.current?.currentTime || session.resumeSeconds || 0,
        runtimeSeconds: session.runtimeSeconds
      })

      void window.cinevault?.torrent.stop(prevCacheId)
    } catch (e) {
      setSubToast(e instanceof Error ? e.message : 'Could not switch to x264')
      if (subToastTimerRef.current) clearTimeout(subToastTimerRef.current)
      subToastTimerRef.current = setTimeout(() => setSubToast(null), 3200)
    } finally {
      setHevcSwitchBusy(false)
    }
  }

  const openInExternalPlayer = async (): Promise<void> => {
    if (vlcBusy) return
    const url = session.source.url
    if (!url) {
      setSubToast('Stream URL not ready yet')
      if (subToastTimerRef.current) clearTimeout(subToastTimerRef.current)
      subToastTimerRef.current = setTimeout(() => setSubToast(null), 2800)
      return
    }
    if (!window.cinevault?.shell?.openExternalPlayer) {
      setSubToast('External player requires the desktop app')
      if (subToastTimerRef.current) clearTimeout(subToastTimerRef.current)
      subToastTimerRef.current = setTimeout(() => setSubToast(null), 2800)
      return
    }
    setVlcBusy(true)
    try {
      const result = await window.cinevault.shell.openExternalPlayer(url)
      if (!result.success) {
        setSubToast(result.error || 'Could not open VLC — is it installed?')
        if (subToastTimerRef.current) clearTimeout(subToastTimerRef.current)
        subToastTimerRef.current = setTimeout(() => setSubToast(null), 3600)
      } else {
        setSubToast(
          result.player === 'system'
            ? 'Opened with system default player'
            : 'Opened in external player'
        )
        if (subToastTimerRef.current) clearTimeout(subToastTimerRef.current)
        subToastTimerRef.current = setTimeout(() => setSubToast(null), 2400)
      }
    } catch (e) {
      setSubToast(e instanceof Error ? e.message : 'Could not open external player')
      if (subToastTimerRef.current) clearTimeout(subToastTimerRef.current)
      subToastTimerRef.current = setTimeout(() => setSubToast(null), 3200)
    } finally {
      setVlcBusy(false)
    }
  }

  useEffect(() => {
    durationRef.current = duration
  }, [duration])

  useEffect(() => {
    return () => {
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current)
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
      if (seekFlashTimerRef.current) clearTimeout(seekFlashTimerRef.current)
      if (subToastTimerRef.current) clearTimeout(subToastTimerRef.current)
      for (const timers of holdTimersRef.current.values()) {
        if (timers.delay) clearTimeout(timers.delay)
        if (timers.interval) clearInterval(timers.interval)
      }
      holdTimersRef.current.clear()
    }
  }, [])

  const clearHold = (id: string): void => {
    const timers = holdTimersRef.current.get(id)
    if (!timers) return
    if (timers.delay) clearTimeout(timers.delay)
    if (timers.interval) clearInterval(timers.interval)
    holdTimersRef.current.delete(id)
  }

  const startHold = (id: string, action: () => void, intervalMs = 90, delayMs = 380): void => {
    if (holdTimersRef.current.has(id)) return
    action()
    bumpChrome()
    const delay = setTimeout(() => {
      const interval = setInterval(() => {
        action()
        bumpChrome()
      }, intervalMs)
      const entry = holdTimersRef.current.get(id)
      if (entry) entry.interval = interval
      else holdTimersRef.current.set(id, { interval })
    }, delayMs)
    holdTimersRef.current.set(id, { delay })
  }

  const flashSeek = (deltaSec: number): void => {
    const dir: -1 | 1 = deltaSec < 0 ? -1 : 1
    const step = Math.abs(deltaSec)
    setSeekFlash((prev) => {
      if (prev && prev.dir === dir) return { dir, seconds: prev.seconds + step }
      return { dir, seconds: step }
    })
    if (seekFlashTimerRef.current) clearTimeout(seekFlashTimerRef.current)
    seekFlashTimerRef.current = setTimeout(() => setSeekFlash(null), 900)
  }

  const skipBy = (deltaSec: number): void => {
    const video = videoRef.current
    if (!video) return
    const mediaDur = torrentPriorityDuration(video, durationRef.current || totalDurationSeconds || 0)
    const now = useAudioRemux ? wallClockTime(video.currentTime) : video.currentTime || 0
    const maxT = mediaDur > 1 ? Math.max(0, mediaDur - 0.35) : now + deltaSec
    const target = Math.max(0, Math.min(now + deltaSec, maxT))
    seekTo(target)
    flashSeek(deltaSec)
  }

  const clampOffsetMs = (ms: number): number => Math.max(-10000, Math.min(10000, Math.round(ms)))

  const clampAudioOffsetMs = (ms: number): number =>
    Math.max(-500, Math.min(500, Math.round(ms / 50) * 50))

  const toastAudioSync = (ms: number): void => {
    const label = `Audio Sync: ${ms > 0 ? '+' : ''}${ms}ms`
    setSubToast(label)
    if (subToastTimerRef.current) clearTimeout(subToastTimerRef.current)
    subToastTimerRef.current = setTimeout(() => setSubToast(null), 1400)
  }

  const nudgeAudioSync = (deltaMs: number): void => {
    setAudioOffsetMs((prev) => {
      const next = clampAudioOffsetMs(prev + deltaMs)
      toastAudioSync(next)
      return next
    })
  }

  const setOffsetMs = (ms: number, toast = true): void => {
    const next = clampOffsetMs(ms)
    subOffsetMsRef.current = next
    setSubtitleOffsetMs(next)
    const video = videoRef.current
    const cue = findActiveCue(cuesRef.current, video?.currentTime || 0, next)
    setSubText(cue?.text || '')
    if (toast) {
      setSubToast(formatSubtitleDelayMs(next))
      if (subToastTimerRef.current) clearTimeout(subToastTimerRef.current)
      subToastTimerRef.current = setTimeout(() => setSubToast(null), 1400)
    }
  }

  const nudgeSubs = (deltaMs: number): void => {
    setOffsetMs(subOffsetMsRef.current + deltaMs)
  }

  const togglePlay = (): void => {
    const video = videoRef.current
    if (!video) return
    bumpChrome()
    if (video.paused) {
      wantPlaybackRef.current = true
      void video.play().catch(() => undefined)
    } else {
      wantPlaybackRef.current = false
      waitingSinceRef.current = null
      video.pause()
      setPlaying(false)
    }
  }

  const toggleFullscreen = (): void => {
    const root = document.querySelector('.player-root')
    bumpChrome()
    if (!document.fullscreenElement) {
      void root?.requestFullscreen()
      setFullscreen(true)
    } else {
      void document.exitFullscreen()
      setFullscreen(false)
    }
  }

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.ctrlKey || e.metaKey || e.altKey) return

      const key = e.key
      if (key === '?' || (key === '/' && e.shiftKey)) {
        e.preventDefault()
        setShowShortcuts((v) => !v)
        bumpChrome()
        return
      }
      if (key === 'Escape' && showShortcuts) {
        e.preventDefault()
        setShowShortcuts(false)
        return
      }
      if (e.repeat && key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== 'ArrowUp' && key !== 'ArrowDown' && key !== '[' && key !== ']' && key !== '{' && key !== '}' && key !== 'z' && key !== 'Z' && key !== 'x' && key !== 'X' && key !== 'j' && key !== 'J' && key !== 'l' && key !== 'L') {
        return
      }

      // Audio sync (hardware DSP latency) — Shift+[ / Shift+]
      if (e.shiftKey && (e.code === 'BracketLeft' || key === '[' || key === '{')) {
        e.preventDefault()
        nudgeAudioSync(-50)
        bumpChrome()
        return
      }
      if (e.shiftKey && (e.code === 'BracketRight' || key === ']' || key === '}')) {
        e.preventDefault()
        nudgeAudioSync(50)
        bumpChrome()
        return
      }

      if (key === ' ' || key === 'k' || key === 'K') {
        e.preventDefault()
        togglePlay()
      } else if (key === 'ArrowLeft' || key === 'j' || key === 'J') {
        e.preventDefault()
        startHold('seek-left', () => skipBy(-10))
      } else if (key === 'ArrowRight' || key === 'l' || key === 'L') {
        e.preventDefault()
        startHold('seek-right', () => skipBy(10))
      } else if (key === 'ArrowUp') {
        e.preventDefault()
        setVolume((v) => {
          const next = Math.min(1, Math.round((v + 0.05) * 100) / 100)
          if (videoRef.current) {
            videoRef.current.volume = next
            videoRef.current.muted = false
          }
          setMuted(false)
          return next
        })
        bumpChrome()
      } else if (key === 'ArrowDown') {
        e.preventDefault()
        setVolume((v) => {
          const next = Math.max(0, Math.round((v - 0.05) * 100) / 100)
          if (videoRef.current) videoRef.current.volume = next
          return next
        })
        bumpChrome()
      } else if (key === 'm' || key === 'M') {
        e.preventDefault()
        setMuted((prev) => {
          const next = !prev
          if (videoRef.current) videoRef.current.muted = next
          return next
        })
        bumpChrome()
      } else if ((key === 'z' || key === 'Z' || key === '[') && !e.shiftKey) {
        e.preventDefault()
        startHold('sub-earlier', () => nudgeSubs(-250), 70, 320)
      } else if ((key === 'x' || key === 'X' || key === ']') && !e.shiftKey) {
        e.preventDefault()
        startHold('sub-later', () => nudgeSubs(250), 70, 320)
      } else if (key === 'g' || key === 'G') {
        e.preventDefault()
        startHold('sub-earlier', () => nudgeSubs(-100), 70, 320)
      } else if (key === 'h' || key === 'H') {
        e.preventDefault()
        startHold('sub-later', () => nudgeSubs(100), 70, 320)
      } else if (key === 'f' || key === 'F') {
        e.preventDefault()
        toggleFullscreen()
      } else if (key === 'n' || key === 'N') {
        e.preventDefault()
        if (upNext) void playNextEpisode(upNext)
        else if (session.mediaType !== 'movie') {
          void resolveNextEpisode({
            mediaType: session.mediaType,
            externalId: session.externalId,
            season: session.season,
            episode: session.episode
          }).then((next) => {
            if (next) void playNextEpisode(next)
          })
        }
      } else if (key === 'i' || key === 'I') {
        if (showSkipIntro && aniSkip.op) {
          e.preventDefault()
          seekTo(aniSkip.op.endTime)
        }
      }
    }

    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowLeft' || e.key === 'j' || e.key === 'J') clearHold('seek-left')
      else if (e.key === 'ArrowRight' || e.key === 'l' || e.key === 'L') clearHold('seek-right')
      else if (e.key === 'z' || e.key === 'Z' || e.key === '[') clearHold('sub-earlier')
      else if (e.key === 'x' || e.key === 'X' || e.key === ']') clearHold('sub-later')
      else if (e.key === 'g' || e.key === 'G') clearHold('sub-earlier')
      else if (e.key === 'h' || e.key === 'H') clearHold('sub-later')
    }

    const onBlur = (): void => {
      for (const id of [...holdTimersRef.current.keys()]) clearHold(id)
    }

    const onFsChange = (): void => {
      setFullscreen(Boolean(document.fullscreenElement))
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    document.addEventListener('fullscreenchange', onFsChange)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('fullscreenchange', onFsChange)
      onBlur()
    }
  }, [session.source.kind, session.mediaType, session.externalId, session.season, session.episode, upNext, showShortcuts, showSkipIntro, aniSkip.op])

  const onStageClick = (): void => {
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current)
    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null
      togglePlay()
    }, 220)
  }

  const onStageDoubleClick = (): void => {
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current)
      clickTimerRef.current = null
    }
    toggleFullscreen()
  }

  const seekTo = (t: number): void => {
    const video = videoRef.current
    if (!video) return
    const fwd = calculateForwardBuffer(video)
    // Byte-map with real container duration; clamp UI seeks to the scrubber runtime.
    const mapDur = torrentPriorityDuration(video, durationRef.current || duration || 0)
    const scrubDur = trueDuration > 1 ? trueDuration : mapDur
    const maxT = scrubDur > 1 ? Math.max(0, scrubDur - 0.35) : t
    const target = Math.max(0, Math.min(t, maxT))

    if (useAudioRemux) {
      reattachRemuxAt(target)
      const cue = findActiveCue(cuesRef.current, target, subOffsetMsRef.current)
      setSubText(cue?.text || '')
      return
    }

    const outsideBuffer =
      fwd.forwardSec < 1.5 ||
      target < video.currentTime - 1 ||
      target > video.currentTime + fwd.forwardSec + 0.5
    // HTML5 can still report buffered ranges after rolling torrent cache purged those
    // bytes — jumps ≥15s must re-anchor torrent priority even if fwdSec looks fine.
    const farSeek = Math.abs(target - video.currentTime) >= 15
    if (session.source.kind === 'torrent' && (outsideBuffer || farSeek)) {
      setBuffering(true)
      waitingSinceRef.current = Date.now()
      needsContiguousBufferRef.current = true
      setForwardBufferPct(0)
      setForwardBufferSec(0)
      setBufferedRanges([])
      if (!video.paused) video.pause()
      void window.cinevault?.torrent.prioritize({
        id: session.cacheId,
        currentTime: target,
        duration: torrentPriorityDuration(video, mapDur),
        invalidate: true
      })
    }
    video.currentTime = target
    setCurrent(target)
    const cue = findActiveCue(cuesRef.current, target, subOffsetMsRef.current)
    setSubText(cue?.text || '')
    if (session.source.kind === 'torrent' && !(outsideBuffer || farSeek)) {
      void window.cinevault?.torrent.prioritize({
        id: session.cacheId,
        currentTime: target,
        duration: torrentPriorityDuration(video, mapDur)
      })
    }
    bumpChrome()
  }

  const stop = async (): Promise<void> => {
    const video = videoRef.current
    const mediaId = mediaIdFromParts(session.mediaType, session.externalId)
    const wall =
      video && useAudioRemux
        ? remuxOriginRef.current + (video.currentTime || 0)
        : video?.currentTime || 0
    const dur = totalDurationSeconds || video?.duration || 0
    if (checkIsFinished(wall, dur, aniSkip.ed)) {
      isFinishedRef.current = true
    }
    if (isFinishedRef.current) {
      await triggerFinishedCleanup({ purgeMedia: true })
      setSession(null)
      return
    }
    if (video) {
      const pct = dur > 0 ? (wall / dur) * 100 : 0
      saveProgress(
        {
          mediaId,
          mediaType: session.mediaType,
          externalId: session.externalId,
          provider: session.provider,
          title: session.showTitle || session.title.split(' · ')[0],
          posterPath: session.posterUrl || undefined,
          backdropPath: session.backdropUrl || undefined,
          season: session.season,
          episode: session.episode,
          episodeTitle: session.episodeTitle,
          currentTime: wall,
          duration: dur,
          percentage: pct,
          updatedAt: Date.now()
        },
        { immediate: true }
      )
    }
    if (session.source.kind === 'torrent') {
      await window.cinevault?.torrent.stop(session.cacheId)
    }
    setSession(null)
  }

  const backToLibrary = (): void => {
    const video = videoRef.current
    const mediaId = mediaIdFromParts(session.mediaType, session.externalId)
    const wall =
      video && useAudioRemux
        ? remuxOriginRef.current + (video.currentTime || 0)
        : video?.currentTime || 0
    const dur = totalDurationSeconds || video?.duration || 0
    if (checkIsFinished(wall, dur, aniSkip.ed)) {
      isFinishedRef.current = true
    }
    if (isFinishedRef.current) {
      void triggerFinishedCleanup({ purgeMedia: true }).finally(() => setSession(null))
      return
    }
    if (video) {
      video.pause()
      saveProgress(
        {
          mediaId,
          mediaType: session.mediaType,
          externalId: session.externalId,
          provider: session.provider,
          title: session.showTitle || session.title.split(' · ')[0],
          posterPath: session.posterUrl || undefined,
          backdropPath: session.backdropUrl || undefined,
          season: session.season,
          episode: session.episode,
          episodeTitle: session.episodeTitle,
          currentTime: wall,
          duration: dur,
          percentage: dur > 0 ? (wall / dur) * 100 : 0,
          updatedAt: Date.now()
        },
        { immediate: true }
      )
      useAppStore.setState({
        lastSession: { ...session, resumeSeconds: wall }
      })
    } else {
      stashLastSession()
    }
    setSession(null)
  }

  const enterPip = async (): Promise<void> => {
    const video = videoRef.current
    if (video) {
      video.pause()
      useAppStore.setState({
        lastSession: { ...session, resumeSeconds: video.currentTime }
      })
      localStorage.setItem(
        'cinevault-pip',
        JSON.stringify({ ...session, resumeSeconds: video.currentTime })
      )
    }
    await window.cinevault?.pip.open()
    setSession(null)
  }

  const toggleNativePip = async (): Promise<void> => {
    const video = videoRef.current
    if (!video) return
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture()
        setNativePip(false)
        return
      }
      if (document.pictureInPictureEnabled) {
        await video.requestPictureInPicture()
        setNativePip(true)
        bumpChrome()
        return
      }
    } catch {
      /* fall through to Electron PiP */
    }
    await enterPip()
  }

  useEffect(() => {
    const onLeave = (): void => setNativePip(false)
    const onEnter = (): void => setNativePip(true)
    videoRef.current?.addEventListener('leavepictureinpicture', onLeave)
    videoRef.current?.addEventListener('enterpictureinpicture', onEnter)
    return () => {
      videoRef.current?.removeEventListener('leavepictureinpicture', onLeave)
      videoRef.current?.removeEventListener('enterpictureinpicture', onEnter)
    }
  }, [session.cacheId])

  const ratioFromEvent = (e: { clientX: number }, el: HTMLElement): number => {
    const rect = el.getBoundingClientRect()
    return Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
  }

  const onTimelineHover = (e: MouseEvent<HTMLDivElement>): void => {
    if (scrubbingRef.current) return
    const mediaDur = trueDuration
    const t = ratioFromEvent(e, e.currentTarget) * mediaDur
    setScrub({ x: e.clientX - e.currentTarget.getBoundingClientRect().left, t, visible: true })

    // Torrent streams can't afford a second <video> fighting for range pipes.
    if (session.source.kind === 'torrent') return

    const sv = scrubVideoRef.current
    const canvas = canvasRef.current
    const mainSrc = session.source.url
    if (sv && canvas && mediaDur > 0 && mainSrc) {
      if (!sv.src) {
        try {
          sv.src = mainSrc
        } catch {
          /* ignore */
        }
      }
      const draw = (): void => {
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.drawImage(sv, 0, 0, canvas.width, canvas.height)
      }
      const seek = (): void => {
        sv.removeEventListener('seeked', seek)
        draw()
      }
      sv.addEventListener('seeked', seek)
      sv.currentTime = Math.min(t, Math.max(0, mediaDur - 0.35))
    }
  }

  const previewTimelineAt = (el: HTMLElement, clientX: number): number => {
    const mediaDur = trueDuration
    const t = ratioFromEvent({ clientX }, el) * mediaDur
    const rect = el.getBoundingClientRect()
    setScrub({
      x: Math.min(Math.max(0, clientX - rect.left), rect.width),
      t,
      visible: true
    })
    scrubTimeRef.current = t
    setScrubTime(t)
    return t
  }

  const onTimelinePointer = (e: ReactPointerEvent<HTMLDivElement>): void => {
    e.preventDefault()
    scrubbingRef.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
    // Visual scrub only — commit on pointer up to avoid a burst of range requests.
    previewTimelineAt(e.currentTarget, e.clientX)
  }

  const onTimelinePointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    previewTimelineAt(e.currentTarget, e.clientX)
  }

  const onTimelinePointerUp = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (!scrubbingRef.current) return
    scrubbingRef.current = false
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    const mediaDur = trueDuration
    const t =
      scrubTimeRef.current != null
        ? scrubTimeRef.current
        : ratioFromEvent(e, e.currentTarget) * mediaDur
    scrubTimeRef.current = null
    setScrubTime(null)
    seekTo(t)
  }

  const detectedRes = (() => {
    const w = videoWidth
    const h = videoHeight
    // Prefer width: widescreen 1080p is often 1920×800 (height < 1080)
    if (w >= 3800 || h >= 2100) return '4K'
    if (w >= 2500 || h >= 1400) return '2K'
    if (w >= 1900 || h >= 1000) return '1080p'
    if (w >= 1200 || h >= 700) return '720p'
    if (w > 0 && h > 0) return `${w}×${h}`
    return '—'
  })()

  const timelineDuration = trueDuration
  const displayTime = scrubTime != null ? scrubTime : currentPlaybackTime
  const bufferedPercent = computeBufferedPercent(
    timelineDuration,
    currentPlaybackTime,
    bufferedRanges,
    session.source.kind === 'torrent' && dl?.total
      ? (dl.received || 0) / Math.max(1, dl.total)
      : dl?.progress ?? null
  )
  // Prebuffer orbit: once media is attached, HTML5 buffer is often still 0 while the
  // torrent is filling sequential pieces — use the better of HTML5 seconds vs contig bytes.
  const htmlPrebufferPct = Math.min(
    100,
    Math.round((forwardBufferSec / PREBUFFER_SECONDS) * 100)
  )
  const contigPrebufferPct = Math.min(
    100,
    Math.round(((dl?.contiguousForwardBytes || 0) / PREBUFFER_BYTES) * 100)
  )
  const orbitPrebufferPct = Math.max(htmlPrebufferPct, contigPrebufferPct)

  return (
    <div
      className={`player-root${chromeVisible ? '' : ' chrome-hidden'}`}
      onMouseMove={bumpChrome}
      onPointerDown={bumpChrome}
    >
      <div className="player-top">
        <Tooltip content="Back to library" side="bottom">
          <button
            className="player-ctrl player-no-drag"
            type="button"
            onClick={backToLibrary}
          >
            <ArrowLeft {...ICON} />
          </button>
        </Tooltip>
        <div className="player-title-block">
          <h1>{session.title}</h1>
          <div className="muted" style={{ color: '#9aa5b5', fontSize: 12 }}>
            {session.resolution} · live {detectedRes}
            {videoWidth > 0 ? ` (${videoWidth}×${videoHeight})` : ''}
            {session.source.hdr ? ' · HDR/DV flagged' : ''}
            {session.source.spatialAudio ? ' · Spatial flagged' : ''}
            {dl && session.source.kind === 'torrent'
              ? ` · ↓ ${formatSpeed(dl.speed)}${dl.peers != null ? ` · ${dl.peers} peers` : ''}`
              : ''}
          </div>
        </div>
        <div className="player-drag-spacer" aria-hidden />
      </div>
      {subToast && (
        <div className="sub-offset-toast" aria-live="polite">
          {subToast}
        </div>
      )}
      {stallRecovery && (
        <div className="stall-recovery-toast" role="status" onClick={(e) => e.stopPropagation()}>
          <span>
            Stream speed dropped ({stallRecovery.speedLabel}) · Switch to a 1080p stream with more
            seeders?
          </span>
          <button
            type="button"
            className="stall-recovery-btn"
            disabled={stallSwitchBusy}
            onClick={() => void switchToHealthierStream()}
          >
            {stallSwitchBusy ? 'Switching…' : 'Switch'}
          </button>
          <button
            type="button"
            className="stall-recovery-dismiss"
            onClick={() => setStallRecovery(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      <div
        className={`player-stage${buffering && !seekFlash ? ' is-buffering' : ''}`}
        onClick={onStageClick}
        onDoubleClick={onStageDoubleClick}
      >
        <video ref={videoRef} playsInline />
        <video ref={scrubVideoRef} muted playsInline style={{ display: 'none' }} />
        {subText && (
          <div className="subtitle-layer" style={{ fontSize: subSize }}>
            {subText}
          </div>
        )}
        {seekFlash && (
          <div
            className={`seek-flash ${seekFlash.dir < 0 ? 'left' : 'right'}`}
            aria-live="polite"
          >
            {seekFlash.dir < 0 ? `−${seekFlash.seconds}s` : `+${seekFlash.seconds}s`}
          </div>
        )}
        {(buffering || mediaError || hevcBlocked) && !seekFlash && (
          <div
            className={`player-buffering${
              hevcBlocked
                ? ' is-hevc-card'
                : mediaError || (codecHint && !videoWidth)
                  ? ' is-message'
                  : ' is-orbit'
            }`}
            onClick={(e) => e.stopPropagation()}
            role="status"
            aria-live="polite"
          >
            {hevcBlocked ? (
              <div className="hevc-recovery-card">
                <h2 className="hevc-recovery-title">HEVC / 10-Bit Codec Detected</h2>
                <p className="hevc-recovery-sub">
                  Your browser engine cannot decode this video track directly.
                </p>
                <div className="hevc-recovery-actions">
                  <button
                    type="button"
                    className="hevc-btn-primary"
                    disabled={hevcSwitchBusy || session.source.kind !== 'torrent'}
                    onClick={() => void switchToX264Stream()}
                  >
                    {hevcSwitchBusy ? 'Switching…' : 'Switch to x264 Stream'}
                  </button>
                  <button
                    type="button"
                    className="hevc-btn-secondary"
                    disabled={vlcBusy || !session.source.url}
                    onClick={() => void openInExternalPlayer()}
                  >
                    {vlcBusy ? 'Opening…' : 'Open in VLC'}
                  </button>
                </div>
                {dl?.progress != null ? (
                  <p className="hevc-recovery-meta">
                    {(dl.progress * 100).toFixed(0)}% downloaded
                    {dl.speed ? ` · ↓ ${formatSpeed(dl.speed)}` : ''}
                  </p>
                ) : null}
              </div>
            ) : mediaError ? (
              <span className="player-buffering-msg">{mediaError}</span>
            ) : codecHint && !videoWidth ? (
              <span className="player-buffering-msg">
                {codecHint}
                {dl?.progress != null ? ` · ${(dl.progress * 100).toFixed(0)}% downloaded` : ''}
              </span>
            ) : (
              <>
                <div className="orbit-loader">
                  <div className="orbit-ring" aria-hidden>
                    {Array.from({ length: 24 }, (_, i) => (
                      <span key={i} className="orbit-dot" style={{ ['--i' as string]: i } as CSSProperties} />
                    ))}
                  </div>
                  <div className="orbit-core">
                    <div className="orbit-pct">{`${orbitPrebufferPct}%`}</div>
                    <div className="orbit-speed">{dl ? formatSpeed(dl.speed) : '…'}</div>
                  </div>
                </div>
                <p className="orbit-note">
                  {htmlPrebufferPct > 0
                    ? `Buffering ${Math.min(PREBUFFER_SECONDS, Math.floor(forwardBufferSec))}s / ${PREBUFFER_SECONDS}s`
                    : contigPrebufferPct > 0
                      ? `Pre-buffering ${(
                          (dl?.contiguousForwardBytes || 0) /
                          (1024 * 1024)
                        ).toFixed(0)} MB / ${PREBUFFER_BYTES / (1024 * 1024)} MB`
                      : 'Pre-buffering stream...'}
                </p>
              </>
            )}
          </div>
        )}
        {showStats && (
          <div className="stats-panel" onClick={(e) => e.stopPropagation()}>
            <div>
              <strong>Stats for nerds</strong>
            </div>
            <div>
              Resolution: {videoWidth}×{videoHeight} ({detectedRes})
            </div>
            <div>Source: {session.source.kind}</div>
            <div>Audio remux: {useAudioRemux ? 'on (AAC stereo)' : 'off'}</div>
            {useAudioRemux && <div>Proxy offset: {formatTime(proxyOffset)}</div>}
            <div>Effective duration: {formatTime(totalDurationSeconds)}</div>
            <div>
              URL host:{' '}
              {(() => {
                try {
                  return new URL(session.source.url).host
                } catch {
                  return 'local'
                }
              })()}
            </div>
            <div>Buffer end: {formatTime(bufferedEnd(videoRef.current))}</div>
            <div>Download speed: {dl ? formatSpeed(dl.speed) : '—'}</div>
            <div>
              Cached:{' '}
              {dl
                ? `${(dl.received / 1024 / 1024).toFixed(1)} / ${(dl.total / 1024 / 1024 || 0).toFixed(1)} MB`
                : '—'}
            </div>
            {session.source.kind === 'torrent' && (
              <div>
                Torrent: {dl?.progress != null ? `${(dl.progress * 100).toFixed(1)}%` : '—'}
                {dl?.peers != null ? ` · ${dl.peers} peers` : ''}
              </div>
            )}
            <div>HDR prefer: {session.source.hdr ? 'yes' : 'no'}</div>
            <div>Spatial prefer: {session.source.spatialAudio ? 'yes' : 'no'}</div>
            <div>Subtitle delay: {subtitleOffsetMs} ms</div>
            <div className="sub-panel-field" style={{ marginTop: 8 }}>
              <div className="sub-panel-delay-head">
                <span>Audio sync ({audioOffsetMs > 0 ? '+' : ''}{audioOffsetMs} ms)</span>
                <button
                  type="button"
                  className="sub-panel-reset"
                  onClick={() => {
                    setAudioOffsetMs(0)
                    toastAudioSync(0)
                  }}
                  disabled={audioOffsetMs === 0}
                >
                  Reset
                </button>
              </div>
              <input
                type="range"
                min={-500}
                max={500}
                step={50}
                value={audioOffsetMs}
                onChange={(e) => {
                  const next = clampAudioOffsetMs(Number(e.target.value))
                  setAudioOffsetMs(next)
                }}
                onPointerUp={(e) =>
                  toastAudioSync(clampAudioOffsetMs(Number((e.target as HTMLInputElement).value)))
                }
                onKeyUp={(e) =>
                  toastAudioSync(clampAudioOffsetMs(Number((e.target as HTMLInputElement).value)))
                }
              />
              <div className="sub-panel-status">Shift+[ earlier · Shift+] later · 50 ms</div>
            </div>
          </div>
        )}
        {showSubs && (
          <div
            className="sub-panel"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <strong>Subtitles</strong>
            <div className="sub-panel-field">
              <span>Language</span>
              <SelectMenu
                aria-label="Subtitle language"
                value={subLang}
                onChange={changeSubLang}
                disabled={subsLoading}
                menuMinWidth={180}
                options={SUB_LANGS.map((l) => ({
                  value: l,
                  label: SUB_LANG_LABELS[l] || l.toUpperCase()
                }))}
              />
            </div>
            <div className="sub-panel-field">
              <span>Track</span>
              <SelectMenu
                className="sub-panel-track-select"
                aria-label="Subtitle track"
                value={activeSubId}
                onChange={(v) => void applySubtitleTrack(v)}
                menuMinWidth={300}
                options={[
                  { value: '', label: 'Off' },
                  ...availableSubs.map((s) => ({
                    value: s.id,
                    label: formatSubtitleMenuLabel(s)
                  }))
                ]}
                disabled={subsLoading}
              />
              {(subsLoading || !activeSubId) && (
                <div className="sub-panel-status">
                  {subsLoading
                    ? 'Loading tracks…'
                    : availableSubs.length === 0
                      ? `No ${SUB_LANG_LABELS[subLang] || subLang} tracks`
                      : cues.length
                        ? 'Loaded'
                        : session.imdbId
                          ? 'Pick a track'
                          : 'No IMDb id'}
                </div>
              )}
            </div>
            <div className="sub-panel-field">
              <span>Size ({subSize}px)</span>
              <input
                type="range"
                min={16}
                max={64}
                value={subSize}
                onChange={(e) => setSubSize(Number(e.target.value))}
              />
            </div>
            <div className="sub-panel-field">
              <div className="sub-panel-delay-head">
                <span>Delay ({subtitleOffsetMs} ms)</span>
                <button
                  type="button"
                  className="sub-panel-reset"
                  onClick={() => setOffsetMs(0)}
                  disabled={subtitleOffsetMs === 0}
                >
                  Reset
                </button>
              </div>
              <input
                type="range"
                min={-10000}
                max={10000}
                step={100}
                value={subtitleOffsetMs}
                onChange={(e) => setOffsetMs(Number(e.target.value), false)}
                onPointerUp={() => {
                  setSubToast(formatSubtitleDelayMs(subOffsetMsRef.current))
                  if (subToastTimerRef.current) clearTimeout(subToastTimerRef.current)
                  subToastTimerRef.current = setTimeout(() => setSubToast(null), 1400)
                }}
                aria-label="Subtitle delay"
              />
              <div className="sub-panel-offset">
                <Tooltip content="Show earlier" shortcut="Z / [">
                  <button
                    className="player-ctrl"
                    type="button"
                    onPointerDown={(e) => {
                      e.preventDefault()
                      startHold('btn-sub-earlier', () => nudgeSubs(-100), 70, 320)
                    }}
                    onPointerUp={() => clearHold('btn-sub-earlier')}
                    onPointerLeave={() => clearHold('btn-sub-earlier')}
                    onPointerCancel={() => clearHold('btn-sub-earlier')}
                  >
                    <Minus {...ICON} />
                  </button>
                </Tooltip>
                <span className="player-time">{subtitleOffsetMs} ms</span>
                <Tooltip content="Show later" shortcut="X / ]">
                  <button
                    className="player-ctrl"
                    type="button"
                    onPointerDown={(e) => {
                      e.preventDefault()
                      startHold('btn-sub-later', () => nudgeSubs(100), 70, 320)
                    }}
                    onPointerUp={() => clearHold('btn-sub-later')}
                    onPointerLeave={() => clearHold('btn-sub-later')}
                    onPointerCancel={() => clearHold('btn-sub-later')}
                  >
                    <Plus {...ICON} />
                  </button>
                </Tooltip>
              </div>
              <div className="sub-panel-status">Z / [ earlier · X / ] later · 100 ms</div>
            </div>
          </div>
        )}

        {showSkipIntro && aniSkip.op && (
          <button
            type="button"
            className="skip-intro-btn"
            onClick={(e) => {
              e.stopPropagation()
              seekTo(aniSkip.op!.endTime)
            }}
          >
            Skip Intro
          </button>
        )}

        {upNext && (
          <div className="up-next-dock" onClick={(e) => e.stopPropagation()}>
            <div className="up-next-head">
              <svg className="up-next-ring" viewBox="0 0 36 36" aria-hidden>
                <circle className="up-next-ring-bg" cx="18" cy="18" r="15" />
                <circle
                  className="up-next-ring-fg"
                  cx="18"
                  cy="18"
                  r="15"
                  strokeDasharray={`${2 * Math.PI * 15}`}
                  strokeDashoffset={`${2 * Math.PI * 15 * (1 - upNextSeconds / 10)}`}
                />
              </svg>
              <div>
                <div className="up-next-label">
                  {upNextBusy
                    ? 'Starting…'
                    : `Up Next in ${upNextSeconds}s: Episode ${upNext.episode}`}
                </div>
                <div className="up-next-title">
                  S{upNext.season}:E{upNext.episode} · {upNext.episodeTitle}
                </div>
              </div>
            </div>
            <div className="up-next-actions">
              <button
                type="button"
                className="up-next-play"
                disabled={upNextBusy}
                onClick={() => void playNextEpisode(upNext)}
              >
                <Play size={14} fill="currentColor" strokeWidth={0} />
                Play Now
              </button>
              <button
                type="button"
                className="up-next-dismiss"
                disabled={upNextBusy}
                onClick={dismissUpNext}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="player-controls">
        <div
          className="timeline-wrap"
          ref={trackRef}
          onMouseMove={onTimelineHover}
          onMouseLeave={() => {
            if (!scrubbingRef.current) setScrub((s) => ({ ...s, visible: false }))
          }}
          onPointerDown={onTimelinePointer}
          onPointerMove={onTimelinePointerMove}
          onPointerUp={onTimelinePointerUp}
          onPointerCancel={onTimelinePointerUp}
          role="slider"
          aria-valuemin={0}
          aria-valuemax={timelineDuration || 0}
          aria-valuenow={displayTime}
          tabIndex={0}
        >
          {scrub.visible && (
            <div className="scrub-preview" style={{ left: scrub.x }}>
              <canvas ref={canvasRef} width={160} height={90} />
              <div className="t">{formatTimestamp(scrub.t)}</div>
            </div>
          )}
          <PlayerProgressBar
            trueDuration={timelineDuration}
            currentTime={displayTime}
            bufferedPercent={bufferedPercent}
          />
        </div>
        <div className="controls-row">
          <Tooltip content="Rewind 10 seconds" shortcut="J / ←">
            <button
              className="player-ctrl"
              type="button"
              aria-label="Rewind 10 seconds"
              onPointerDown={(e) => {
                e.preventDefault()
                startHold('btn-seek-left', () => skipBy(-10))
              }}
              onPointerUp={() => clearHold('btn-seek-left')}
              onPointerLeave={() => clearHold('btn-seek-left')}
              onPointerCancel={() => clearHold('btn-seek-left')}
            >
              <SeekGlyph dir="back" />
            </button>
          </Tooltip>
          <Tooltip content={playing ? 'Pause' : 'Play'} shortcut="Space">
            <button
              className="player-ctrl"
              type="button"
              onClick={togglePlay}
              aria-label={playing ? 'Pause' : 'Play'}
            >
              {playing ? (
                <Pause size={20} fill="currentColor" strokeWidth={0} />
              ) : (
                <Play size={20} fill="currentColor" strokeWidth={0} />
              )}
            </button>
          </Tooltip>
          <Tooltip content="Forward 10 seconds" shortcut="L / →">
            <button
              className="player-ctrl"
              type="button"
              aria-label="Forward 10 seconds"
              onPointerDown={(e) => {
                e.preventDefault()
                startHold('btn-seek-right', () => skipBy(10))
              }}
              onPointerUp={() => clearHold('btn-seek-right')}
              onPointerLeave={() => clearHold('btn-seek-right')}
              onPointerCancel={() => clearHold('btn-seek-right')}
            >
              <SeekGlyph dir="forward" />
            </button>
          </Tooltip>
          <Tooltip content="Stop">
            <button
              className="player-ctrl"
              type="button"
              onClick={() => void stop()}
              aria-label="Stop"
            >
              <Square size={18} fill="currentColor" strokeWidth={0} />
            </button>
          </Tooltip>
          <span className="player-time">
            {formatTimestamp(displayTime)} / {formatTimestamp(timelineDuration)}
            <span className="player-time-remain">
              {' '}
              (−{formatTimestamp(Math.max(0, timelineDuration - displayTime))})
            </span>
          </span>
          <Tooltip content={muted ? 'Unmute' : 'Mute'} shortcut="M">
            <button
              className="player-ctrl"
              type="button"
              aria-label={muted ? 'Unmute' : 'Mute'}
              onClick={() => {
                setMuted((prev) => {
                  const next = !prev
                  if (videoRef.current) videoRef.current.muted = next
                  return next
                })
                bumpChrome()
              }}
            >
              {muted || volume === 0 ? <VolumeX {...ICON} /> : <Volume2 {...ICON} />}
            </button>
          </Tooltip>
          <Tooltip content="Volume">
            <input
              className="volume"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={muted ? 0 : volume}
              style={{ ['--vol' as string]: `${(muted ? 0 : volume) * 100}%` } as CSSProperties}
              aria-label="Volume"
              onChange={(e) => {
                const v = Number(e.target.value)
                setVolume(v)
                setMuted(false)
                if (videoRef.current) {
                  videoRef.current.volume = v
                  videoRef.current.muted = false
                }
                bumpChrome()
              }}
            />
          </Tooltip>
          <div className="spacer" />
          <Tooltip content="Keyboard shortcuts" shortcut="?">
            <button
              className={`player-ctrl${showShortcuts ? ' is-active' : ''}`}
              type="button"
              aria-label="Keyboard shortcuts"
              aria-pressed={showShortcuts}
              onClick={() => {
                setShowShortcuts((v) => !v)
                bumpChrome()
              }}
            >
              <Keyboard {...ICON} />
            </button>
          </Tooltip>
          <Tooltip content="Stats for nerds">
            <button
              className={`player-ctrl${showStats ? ' is-active' : ''}`}
              type="button"
              aria-label="Stats for nerds"
              aria-pressed={showStats}
              onClick={() => {
                setShowStats((v) => !v)
                bumpChrome()
              }}
            >
              <Info {...ICON} />
            </button>
          </Tooltip>
          <Tooltip content="Picture in picture" shortcut="P">
            <button
              className={`player-ctrl${nativePip ? ' is-active' : ''}`}
              type="button"
              aria-label="Picture in picture"
              onClick={() => void toggleNativePip()}
            >
              <PictureInPicture2 {...ICON} />
            </button>
          </Tooltip>
          <Tooltip content={fullscreen ? 'Exit fullscreen' : 'Fullscreen'} shortcut="F">
            <button
              className="player-ctrl"
              type="button"
              aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              onClick={() => toggleFullscreen()}
            >
              {fullscreen ? <Minimize2 {...ICON} /> : <Maximize2 {...ICON} />}
            </button>
          </Tooltip>
          <Tooltip content="Captions">
            <button
              className={`player-ctrl player-ctrl-captions${showSubs ? ' is-on' : ''}`}
              type="button"
              aria-label="Captions"
              aria-pressed={showSubs}
              onClick={() => {
                setShowSubs((v) => !v)
                bumpChrome()
              }}
            >
              <Captions {...ICON} />
            </button>
          </Tooltip>
        </div>
      </div>

      {showShortcuts && (
        <div
          className="player-shortcuts-modal"
          role="dialog"
          aria-label="Keyboard shortcuts"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="player-shortcuts-card">
            <div className="player-shortcuts-head">
              <strong>Keyboard shortcuts</strong>
              <button type="button" className="player-ctrl" onClick={() => setShowShortcuts(false)}>
                ✕
              </button>
            </div>
            <ul className="player-shortcuts-list">
              <li>
                <kbd>Space</kbd> / <kbd>K</kbd>
                <span>Play / Pause</span>
              </li>
              <li>
                <kbd>F</kbd>
                <span>Fullscreen</span>
              </li>
              <li>
                <kbd>M</kbd>
                <span>Mute</span>
              </li>
              <li>
                <kbd>J</kbd> / <kbd>←</kbd>
                <span>Seek −10s</span>
              </li>
              <li>
                <kbd>L</kbd> / <kbd>→</kbd>
                <span>Seek +10s</span>
              </li>
              <li>
                <kbd>↑</kbd> / <kbd>↓</kbd>
                <span>Volume ±5%</span>
              </li>
              <li>
                <kbd>[</kbd> / <kbd>]</kbd>
                <span>Subtitle ±250ms</span>
              </li>
              <li>
                <kbd>Shift</kbd>+<kbd>[</kbd> / <kbd>]</kbd>
                <span>Audio sync ±50ms</span>
              </li>
              <li>
                <kbd>N</kbd>
                <span>Next episode</span>
              </li>
              <li>
                <kbd>I</kbd>
                <span>Skip intro</span>
              </li>
              <li>
                <kbd>?</kbd>
                <span>This help</span>
              </li>
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}
