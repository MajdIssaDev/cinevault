import { useEffect, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import Hls from 'hls.js'
import {
  ArrowLeft,
  Captions,
  Info,
  Maximize2,
  Minimize2,
  Minus,
  Pause,
  PictureInPicture2,
  Play,
  Plus,
  RotateCcw,
  RotateCw,
  Square
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
import { ThemedSelect } from '../components/ThemedSelect'
import {
  COMPLETE_AT,
  flushProgress,
  markAsCompleted,
  mediaIdFromParts,
  saveProgress
} from '../services/playbackHistoryService'
import { resolveNextEpisode, type NextEpisodeTarget } from '../lib/nextEpisode'
import {
  buildCatalogSearchQuery,
  sortTorrentResults,
  startTorrentPlayback
} from '../lib/torrentPlayback'
import { getBestStream } from '../lib/streamScorer'
import { searchPublicIndexers } from '../services/publicSearchService'

const ICON = { size: 20, strokeWidth: 1.75 } as const

const SUB_LANGS = ['en', 'es', 'fr', 'de', 'it', 'pt', 'pl', 'ar', 'he', 'ja', 'ko', 'zh', 'ru'] as const

const SUB_LANG_LABELS: Record<string, string> = {
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  pt: 'Portuguese',
  pl: 'Polish',
  ar: 'Arabic',
  he: 'Hebrew',
  ja: 'Japanese',
  ko: 'Korean',
  zh: 'Chinese',
  ru: 'Russian'
}

function SeekGlyph({ dir }: { dir: 'back' | 'forward' }): JSX.Element {
  const Icon = dir === 'back' ? RotateCcw : RotateCw
  return (
    <span className="seek-glyph" aria-hidden>
      <Icon {...ICON} />
      <span className="seek-glyph-num">5</span>
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

function playbackWarning(label: string): string | null {
  const n = label.toLowerCase()
  if (/\b(hevc|x265|h\.?265)\b/.test(n) || /\b10.?bit\b/.test(n)) {
    return 'This release is HEVC/x265 (often 10-bit). The built-in player frequently cannot decode it — pick an x264 / MP4 torrent instead.'
  }
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
  const resumeGateRef = useRef<number | null>(null)
  const initialStartedRef = useRef(false)
  const dlProgressRef = useRef(0)
  const holdTimersRef = useRef<
    Map<string, { delay?: ReturnType<typeof setTimeout>; interval?: ReturnType<typeof setInterval> }>
  >(new Map())
  const durationRef = useRef(0)
  const seekFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const subToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const subOffsetMsRef = useRef(0)
  const cuesRef = useRef<Cue[]>([])

  const [playing, setPlaying] = useState(true)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [showStats, setShowStats] = useState(false)
  const [showSubs, setShowSubs] = useState(false)
  const [subSize, setSubSize] = useState(28)
  const [subtitleOffsetMs, setSubtitleOffsetMs] = useState(0)
  const [cues, setCues] = useState<Cue[]>([])
  const [subText, setSubText] = useState('')
  const [scrub, setScrub] = useState<{ x: number; t: number; visible: boolean }>({
    x: 0,
    t: 0,
    visible: false
  })
  const [dl, setDl] = useState<{
    speed: number
    received: number
    total: number
    done: boolean
    peers?: number
    progress?: number
  } | null>(null)
  const [bufferPct, setBufferPct] = useState(0)
  const [videoWidth, setVideoWidth] = useState(0)
  const [videoHeight, setVideoHeight] = useState(0)
  const [fullscreen, setFullscreen] = useState(false)
  const [chromeVisible, setChromeVisible] = useState(true)
  const [buffering, setBuffering] = useState(true)
  const [mediaError, setMediaError] = useState<string | null>(null)
  const [mediaAttached, setMediaAttached] = useState(false)
  const [waitTargetPct, setWaitTargetPct] = useState<number | null>(null)
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
  const codecHint = playbackWarning(session.source.label || session.title)

  useEffect(() => {
    setSubLang(session.subtitleLang || settings?.defaultSubtitleLanguage || 'en')
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset language only for a new playback session
  }, [session.cacheId])

  const bumpChrome = (): void => {
    setChromeVisible(true)
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    idleTimerRef.current = setTimeout(() => {
      const v = videoRef.current
      if (v && !v.paused) setChromeVisible(false)
    }, 10_000)
  }

  const tryStartPlayback = (): void => {
    const video = videoRef.current
    if (!video || !sourceAttachedRef.current) return
    void video.play().then(() => {
      initialStartedRef.current = true
      resumeGateRef.current = null
      setWaitTargetPct(null)
      setBuffering(false)
      waitingSinceRef.current = null
    }).catch(() => {
      setPlaying(false)
      setBuffering(true)
    })
  }

  const attachMediaSource = (src: string, resumeAt: number): void => {
    const video = videoRef.current
    if (!video || sourceAttachedRef.current) return
    sourceAttachedRef.current = true
    video.src = src
    if (scrubVideoRef.current) scrubVideoRef.current.src = src
    setMediaAttached(true)
    setWaitTargetPct(null)

    const onMeta = (): void => {
      if (resumeAt > 0) video.currentTime = resumeAt
    }
    video.addEventListener('loadedmetadata', onMeta, { once: true })
    video.addEventListener('canplay', () => tryStartPlayback(), { once: true })
    video.addEventListener('loadeddata', () => tryStartPlayback(), { once: true })
  }

  // Load media — for torrents wait until ~5% downloaded so the start of the file exists
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    let hls: Hls | null = null
    const src = session.source.url
    setMediaError(null)
    setBuffering(true)
    setMediaAttached(false)
    setWaitTargetPct(5)
    waitingSinceRef.current = Date.now()
    sourceAttachedRef.current = false
    initialStartedRef.current = false
    resumeGateRef.current = 0.05
    dlProgressRef.current = 0

    const resumeAt = session.resumeSeconds || 0

    if (session.source.kind === 'hls' && Hls.isSupported()) {
      sourceAttachedRef.current = true
      setMediaAttached(true)
      setWaitTargetPct(null)
      hls = new Hls({ enableWorker: true })
      hls.loadSource(src)
      hls.attachMedia(video)
      video.addEventListener('canplay', () => tryStartPlayback(), { once: true })
    } else if (session.source.kind !== 'torrent') {
      attachMediaSource(src, resumeAt)
    }
    // torrent: attachMediaSource called from progress gate effect

    bumpChrome()

    const stallTimer = window.setInterval(() => {
      if (!waitingSinceRef.current) return
      const waited = Date.now() - waitingSinceRef.current
      if (waited < 12_000) return
      if (codecHint && sourceAttachedRef.current && !video.videoWidth) {
        setMediaError(codecHint)
      }
    }, 4000)

    return () => {
      window.clearInterval(stallTimer)
      hls?.destroy()
      sourceAttachedRef.current = false
    }
  }, [session.cacheId, session.source.url, session.source.kind, session.resumeSeconds, session.source.label, codecHint])

  // 5% start gate + mid-playback resume gate for progressive downloads
  useEffect(() => {
    if (session.source.kind === 'local' || session.source.kind === 'hls') return
    const progress = dl?.progress ?? (dl && dl.total > 0 ? dl.received / dl.total : 0)
    const done = Boolean(dl?.done) || progress >= 0.999
    dlProgressRef.current = progress

    const src = session.source.url
    const resumeAt = session.resumeSeconds || 0

    // Initial attach after 5% (or complete)
    if (!sourceAttachedRef.current && (done || progress >= 0.05)) {
      resumeGateRef.current = null
      setWaitTargetPct(null)
      attachMediaSource(src, resumeAt)
      return
    }

    // Resume after underrun once we gained another ~5% (or finished / have buffer)
    const gate = resumeGateRef.current
    if (gate != null && sourceAttachedRef.current) {
      const video = videoRef.current
      const hasLead = video ? bufferedEnd(video) > video.currentTime + 1.5 : false
      if (done || progress >= gate || hasLead) {
        tryStartPlayback()
      }
    }
  }, [dl, session.source.url, session.source.kind, session.resumeSeconds])

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
          setDl({
            speed: s.downloadSpeed,
            received: s.downloaded,
            total: s.total,
            done: s.done,
            peers: s.peers,
            progress: s.progress
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
    const t = setInterval(pull, 500)
    return () => clearInterval(t)
  }, [session.cacheId, session.source.kind])

  // Time updates + buffer + stall detection
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const refreshBuffer = (): void => {
      const end = bufferedEnd(video)
      const dur = video.duration || duration || 0
      setBufferPct(dur > 0 ? Math.min(100, (end / dur) * 100) : 0)
    }

    const onTime = (): void => {
      setCurrent(video.currentTime)
      const cue = findActiveCue(cuesRef.current, video.currentTime, subOffsetMsRef.current)
      setSubText(cue?.text || '')
      refreshBuffer()
    }
    const onSeeked = (): void => {
      setCurrent(video.currentTime)
      const cue = findActiveCue(cuesRef.current, video.currentTime, subOffsetMsRef.current)
      setSubText(cue?.text || '')
      refreshBuffer()
    }
    const onMeta = (): void => {
      setDuration(video.duration || 0)
      setVideoWidth(video.videoWidth)
      setVideoHeight(video.videoHeight)
      refreshBuffer()
    }
    const onPlay = (): void => {
      setPlaying(true)
      bumpChrome()
    }
    const onPause = (): void => {
      setPlaying(false)
      setChromeVisible(true)
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    }
    const onWaiting = (): void => {
      setBuffering(true)
      waitingSinceRef.current = Date.now()
      if (!video.paused) video.pause()
      const p = dlProgressRef.current
      if (p < 0.999) {
        const gate = Math.min(1, p + 0.05)
        resumeGateRef.current = gate
        setWaitTargetPct(Math.ceil(gate * 100))
      } else {
        resumeGateRef.current = null
        setWaitTargetPct(null)
      }
    }
    const onPlaying = (): void => {
      setBuffering(false)
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
    // Immediate sync after attach / cue changes
    onSeeked()
    return () => {
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
    }
  }, [cues, subtitleOffsetMs, duration, session.source.url, dl?.peers, dl?.speed, dl?.progress])

  // Persist progress
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const mediaId = mediaIdFromParts(session.mediaType, session.externalId)
    const showTitle = session.showTitle || session.title.split(' · ')[0]

    const buildEntry = () => ({
      mediaId,
      mediaType: session.mediaType,
      externalId: session.externalId,
      title: showTitle,
      posterPath: session.posterUrl || undefined,
      backdropPath: session.backdropUrl || undefined,
      season: session.season,
      episode: session.episode,
      episodeTitle: session.episodeTitle,
      currentTime: video.currentTime || 0,
      duration: video.duration || durationRef.current || 0,
      percentage: 0,
      updatedAt: Date.now()
    })

    const persistHistory = (immediate: boolean): void => {
      if (!video.duration || !Number.isFinite(video.duration)) return
      saveProgress(buildEntry(), { immediate })
    }

    const persistCache = (): void => {
      if (!window.cinevault) return
      void window.cinevault.cache.upsert({
        id: session.cacheId,
        title: session.title,
        mediaType: session.mediaType,
        filePath: session.source.kind === 'local' ? session.source.url : '',
        createdAt: Date.now(),
        lastWatchedAt: Date.now(),
        completed: false,
        progressSeconds: video.currentTime,
        durationSeconds: video.duration || 0,
        sourceUrl: session.source.kind !== 'local' ? session.source.url : undefined
      })
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
    if (!duration || duration < 120) return
    const inOutro =
      current >= duration - 85 || (duration > 0 && (current / duration) * 100 >= 94)
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
  }, [current, duration, session.cacheId, session.mediaType, session.externalId, session.season, session.episode])

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
    try {
      const mediaId = mediaIdFromParts(session.mediaType, session.externalId)
      markAsCompleted(mediaId, session.season, session.episode)

      const query = buildCatalogSearchQuery({
        title: target.showTitle,
        mediaType: session.mediaType,
        season: target.season,
        episode: target.episode
      })
      const raw = await searchPublicIndexers(query)
      const sorted = sortTorrentResults(raw, qualityPref)
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
            preferredQuality: qualityPref
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
      sourceAttachedRef.current = false
      initialStartedRef.current = false
      resumeGateRef.current = null
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
        source,
        subtitlePath: null,
        subtitleUrl: null,
        subtitleLabel: undefined,
        subtitleLang: subLang,
        resolution:
          source.quality !== 'unknown' ? source.quality : qualityPref,
        resumeSeconds: 0
      })

      // Stop the previous torrent only after the next one is live.
      if (prevKind === 'torrent' && prevCacheId && prevCacheId !== cacheId) {
        void window.cinevault?.torrent.stop(prevCacheId)
      }
    } catch (e) {
      setUpNextBusy(false)
      setUpNextSeconds(10)
      setSubToast(e instanceof Error ? e.message : 'Could not start next episode')
      if (subToastTimerRef.current) clearTimeout(subToastTimerRef.current)
      subToastTimerRef.current = setTimeout(() => setSubToast(null), 3200)
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
    const dur = video.duration || durationRef.current || 0
    const target = Math.max(
      0,
      Math.min((video.currentTime || 0) + deltaSec, dur || video.currentTime + deltaSec)
    )
    video.currentTime = target
    setCurrent(target)
    // seeked will refresh; also sync immediately for snappy UI
    const cue = findActiveCue(cuesRef.current, target, subOffsetMsRef.current)
    setSubText(cue?.text || '')
    flashSeek(deltaSec)
  }

  const clampOffsetMs = (ms: number): number => Math.max(-10000, Math.min(10000, Math.round(ms)))

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
    if (video.paused) void video.play()
    else video.pause()
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
      if (e.repeat) return

      const key = e.key
      if (key === ' ' || key === 'k' || key === 'K') {
        e.preventDefault()
        togglePlay()
      } else if (key === 'ArrowLeft') {
        e.preventDefault()
        startHold('seek-left', () => skipBy(-5))
      } else if (key === 'ArrowRight') {
        e.preventDefault()
        startHold('seek-right', () => skipBy(5))
      } else if (key === 'z' || key === 'Z' || key === '[') {
        e.preventDefault()
        startHold('sub-earlier', () => nudgeSubs(-100), 70, 320)
      } else if (key === 'x' || key === 'X' || key === ']') {
        e.preventDefault()
        startHold('sub-later', () => nudgeSubs(100), 70, 320)
      } else if (key === 'g' || key === 'G') {
        e.preventDefault()
        startHold('sub-earlier', () => nudgeSubs(-100), 70, 320)
      } else if (key === 'h' || key === 'H') {
        e.preventDefault()
        startHold('sub-later', () => nudgeSubs(100), 70, 320)
      } else if (key === 'f' || key === 'F') {
        e.preventDefault()
        toggleFullscreen()
      }
    }

    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowLeft') clearHold('seek-left')
      else if (e.key === 'ArrowRight') clearHold('seek-right')
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
  }, [session.source.kind])

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
    const end = bufferedEnd(video)
    const dur = video.duration || duration || 0
    const target = Math.max(0, Math.min(t, dur || t))
    if (session.source.kind === 'torrent' && end > 1 && target > end + 1.5) {
      setBuffering(true)
    }
    video.currentTime = target
    setCurrent(target)
    const cue = findActiveCue(cuesRef.current, target, subOffsetMsRef.current)
    setSubText(cue?.text || '')
    bumpChrome()
  }

  const stop = async (): Promise<void> => {
    const video = videoRef.current
    const mediaId = mediaIdFromParts(session.mediaType, session.externalId)
    if (video) {
      const pct = video.duration > 0 ? (video.currentTime / video.duration) * 100 : 0
      if (pct >= COMPLETE_AT) {
        markAsCompleted(mediaId, session.season, session.episode)
      } else {
        saveProgress(
          {
            mediaId,
            mediaType: session.mediaType,
            externalId: session.externalId,
            title: session.showTitle || session.title.split(' · ')[0],
            posterPath: session.posterUrl || undefined,
            backdropPath: session.backdropUrl || undefined,
            season: session.season,
            episode: session.episode,
            episodeTitle: session.episodeTitle,
            currentTime: video.currentTime || 0,
            duration: video.duration || 0,
            percentage: pct,
            updatedAt: Date.now()
          },
          { immediate: true }
        )
      }
      if (window.cinevault) {
        const nearEnd = video.duration > 0 && video.currentTime / video.duration > 0.92
        if (nearEnd) await window.cinevault.cache.markComplete(session.cacheId)
      }
    }
    if (session.source.kind === 'torrent') {
      await window.cinevault?.torrent.stop(session.cacheId)
    }
    setSession(null)
  }

  const backToLibrary = (): void => {
    const video = videoRef.current
    const mediaId = mediaIdFromParts(session.mediaType, session.externalId)
    if (video) {
      video.pause()
      saveProgress(
        {
          mediaId,
          mediaType: session.mediaType,
          externalId: session.externalId,
          title: session.showTitle || session.title.split(' · ')[0],
          posterPath: session.posterUrl || undefined,
          backdropPath: session.backdropUrl || undefined,
          season: session.season,
          episode: session.episode,
          episodeTitle: session.episodeTitle,
          currentTime: video.currentTime || 0,
          duration: video.duration || 0,
          percentage: 0,
          updatedAt: Date.now()
        },
        { immediate: true }
      )
      useAppStore.setState({
        lastSession: { ...session, resumeSeconds: video.currentTime }
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

  const ratioFromEvent = (e: { clientX: number }, el: HTMLElement): number => {
    const rect = el.getBoundingClientRect()
    return Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
  }

  const onTimelineHover = (e: MouseEvent<HTMLDivElement>): void => {
    const ratio = ratioFromEvent(e, e.currentTarget)
    const t = ratio * (duration || 0)
    setScrub({ x: e.clientX - e.currentTarget.getBoundingClientRect().left, t, visible: true })

    const sv = scrubVideoRef.current
    const canvas = canvasRef.current
    if (sv && canvas && duration) {
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
      sv.currentTime = t
    }
  }

  const onTimelinePointer = (e: ReactPointerEvent<HTMLDivElement>): void => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    seekTo(ratioFromEvent(e, e.currentTarget) * (duration || 0))
  }

  const onTimelinePointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    seekTo(ratioFromEvent(e, e.currentTarget) * (duration || 0))
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

  const progressPct = duration > 0 ? Math.min(100, (current / duration) * 100) : 0
  const torrentPct = dl?.progress != null ? Math.min(100, dl.progress * 100) : 0
  // Show the farther of HTML5 buffer vs torrent completion so the light track is visible
  const downloadedPct = Math.max(bufferPct, torrentPct)

  return (
    <div
      className={`player-root${chromeVisible ? '' : ' chrome-hidden'}`}
      onMouseMove={bumpChrome}
      onPointerDown={bumpChrome}
    >
      <div className="player-top">
        <button
          className="player-ctrl player-no-drag"
          type="button"
          title="Back to library"
          onClick={backToLibrary}
        >
          <ArrowLeft {...ICON} />
        </button>
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
        {(buffering || mediaError) && !seekFlash && (
          <div
            className={`player-buffering${mediaError || (codecHint && !videoWidth) ? ' is-message' : ' is-orbit'}`}
            onClick={(e) => e.stopPropagation()}
            role="status"
            aria-live="polite"
          >
            {mediaError ? (
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
                    <div className="orbit-pct">
                      {dl?.progress != null ? `${Math.min(100, Math.round(dl.progress * 100))}%` : '—'}
                    </div>
                    <div className="orbit-speed">{dl ? formatSpeed(dl.speed) : '…'}</div>
                  </div>
                </div>
                <p className="orbit-note">
                  {!mediaAttached
                    ? '~5% to start playback'
                    : waitTargetPct != null
                      ? `~${waitTargetPct}% to continue`
                      : 'Buffering…'}
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
          </div>
        )}
        {showSubs && (
          <div className="sub-panel" onClick={(e) => e.stopPropagation()}>
            <strong>Subtitles</strong>
            {(availableSubs.length > 0 || session.imdbId) && (
              <>
                <div className="sub-panel-field">
                  <span>Language</span>
                  <ThemedSelect
                    aria-label="Subtitle language"
                    value={subLang}
                    onChange={changeSubLang}
                    disabled={!session.imdbId || subsLoading}
                    menuMinWidth={160}
                    options={SUB_LANGS.map((l) => ({
                      value: l,
                      label: SUB_LANG_LABELS[l] || l.toUpperCase()
                    }))}
                  />
                </div>
                <div className="sub-panel-field">
                  <span>Track</span>
                  <ThemedSelect
                    aria-label="Subtitle track"
                    value={activeSubId}
                    onChange={(v) => void applySubtitleTrack(v)}
                    title={
                      availableSubs.find((s) => s.id === activeSubId)
                        ? formatSubtitleMenuLabel(
                            availableSubs.find((s) => s.id === activeSubId)!
                          )
                        : undefined
                    }
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
              </>
            )}
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
                <button
                  className="player-ctrl"
                  type="button"
                  title="Show earlier (Z / [)"
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
                <span className="player-time">{subtitleOffsetMs} ms</span>
                <button
                  className="player-ctrl"
                  type="button"
                  title="Show later (X / ])"
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
              </div>
              <div className="sub-panel-status">Z / [ earlier · X / ] later · 100 ms</div>
            </div>
          </div>
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
                  {upNextBusy ? 'Starting…' : `Up Next in ${upNextSeconds}s`}
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
                Next Episode
              </button>
              <button
                type="button"
                className="up-next-dismiss"
                disabled={upNextBusy}
                onClick={dismissUpNext}
              >
                Watch Credits
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
          onMouseLeave={() => setScrub((s) => ({ ...s, visible: false }))}
          onPointerDown={onTimelinePointer}
          onPointerMove={onTimelinePointerMove}
          role="slider"
          aria-valuemin={0}
          aria-valuemax={duration || 0}
          aria-valuenow={current}
          tabIndex={0}
        >
          {scrub.visible && (
            <div className="scrub-preview" style={{ left: scrub.x }}>
              <canvas ref={canvasRef} width={160} height={90} />
              <div className="t">{formatTime(scrub.t)}</div>
            </div>
          )}
          <div className="timeline-track">
            <div className="timeline-download" style={{ width: `${downloadedPct}%` }} />
            <div className="timeline-progress" style={{ width: `${progressPct}%` }} />
            <div className="timeline-thumb" style={{ left: `${progressPct}%` }} />
          </div>
        </div>
        <div className="controls-row">
          <button
            className="player-ctrl"
            type="button"
            title="Rewind 5 seconds (←)"
            aria-label="Rewind 5 seconds"
            onPointerDown={(e) => {
              e.preventDefault()
              startHold('btn-seek-left', () => skipBy(-5))
            }}
            onPointerUp={() => clearHold('btn-seek-left')}
            onPointerLeave={() => clearHold('btn-seek-left')}
            onPointerCancel={() => clearHold('btn-seek-left')}
          >
            <SeekGlyph dir="back" />
          </button>
          <button
            className="player-ctrl"
            type="button"
            onClick={togglePlay}
            title={playing ? 'Pause (Space)' : 'Play (Space)'}
            aria-label={playing ? 'Pause' : 'Play'}
          >
            {playing ? (
              <Pause size={20} fill="currentColor" strokeWidth={0} />
            ) : (
              <Play size={20} fill="currentColor" strokeWidth={0} />
            )}
          </button>
          <button
            className="player-ctrl"
            type="button"
            title="Forward 5 seconds (→)"
            aria-label="Forward 5 seconds"
            onPointerDown={(e) => {
              e.preventDefault()
              startHold('btn-seek-right', () => skipBy(5))
            }}
            onPointerUp={() => clearHold('btn-seek-right')}
            onPointerLeave={() => clearHold('btn-seek-right')}
            onPointerCancel={() => clearHold('btn-seek-right')}
          >
            <SeekGlyph dir="forward" />
          </button>
          <button
            className="player-ctrl"
            type="button"
            onClick={() => void stop()}
            title="Stop"
            aria-label="Stop"
          >
            <Square size={18} fill="currentColor" strokeWidth={0} />
          </button>
          <span className="player-time">
            {formatTime(current)} / {formatTime(duration)}
            <span className="player-time-remain">
              · −{formatTime(Math.max(0, duration - current))}
            </span>
          </span>
          <input
            className="volume"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            style={{ ['--vol' as string]: `${volume * 100}%` } as CSSProperties}
            title="Volume"
            aria-label="Volume"
            onChange={(e) => {
              const v = Number(e.target.value)
              setVolume(v)
              if (videoRef.current) videoRef.current.volume = v
              bumpChrome()
            }}
          />
          <div className="spacer" />
          <button
            className={`player-ctrl${showStats ? ' is-active' : ''}`}
            type="button"
            title="Stats for nerds"
            aria-label="Stats for nerds"
            aria-pressed={showStats}
            onClick={() => {
              setShowStats((v) => !v)
              bumpChrome()
            }}
          >
            <Info {...ICON} />
          </button>
          <button
            className="player-ctrl"
            type="button"
            title="Picture in picture"
            aria-label="Picture in picture"
            onClick={() => void enterPip()}
          >
            <PictureInPicture2 {...ICON} />
          </button>
          <button
            className="player-ctrl"
            type="button"
            title={fullscreen ? 'Exit fullscreen (F)' : 'Fullscreen (F)'}
            aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            onClick={toggleFullscreen}
          >
            {fullscreen ? <Minimize2 {...ICON} /> : <Maximize2 {...ICON} />}
          </button>
          <button
            className={`player-ctrl player-ctrl-captions${showSubs ? ' is-on' : ''}`}
            type="button"
            title="Captions"
            aria-label="Captions"
            aria-pressed={showSubs}
            onClick={() => {
              setShowSubs((v) => !v)
              bumpChrome()
            }}
          >
            <Captions {...ICON} />
          </button>
        </div>
      </div>
    </div>
  )
}
