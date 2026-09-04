import { useEffect, useRef, useState, type MouseEvent } from 'react'
import Hls from 'hls.js'
import { useAppStore } from '../store'
import { cueAt, formatTime, parseSrt, type Cue } from '../lib/subtitles'

function formatSpeed(bps: number): string {
  if (!bps) return '—'
  if (bps < 1024) return `${bps.toFixed(0)} B/s`
  if (bps < 1024 ** 2) return `${(bps / 1024).toFixed(1)} KB/s`
  return `${(bps / 1024 ** 2).toFixed(2)} MB/s`
}

export function PlayerPage(): JSX.Element {
  const session = useAppStore((s) => s.session)!
  const stashLastSession = useAppStore((s) => s.stashLastSession)
  const setSession = useAppStore((s) => s.setSession)

  const videoRef = useRef<HTMLVideoElement>(null)
  const scrubVideoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)

  const [playing, setPlaying] = useState(true)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [showStats, setShowStats] = useState(false)
  const [showSubs, setShowSubs] = useState(false)
  const [subSize, setSubSize] = useState(28)
  const [subOffset, setSubOffset] = useState(0)
  const [cues, setCues] = useState<Cue[]>([])
  const [subText, setSubText] = useState('')
  const [scrub, setScrub] = useState<{ x: number; t: number; visible: boolean }>({
    x: 0,
    t: 0,
    visible: false
  })
  const [dl, setDl] = useState<{ speed: number; received: number; total: number; done: boolean } | null>(
    null
  )
  const [videoWidth, setVideoWidth] = useState(0)
  const [videoHeight, setVideoHeight] = useState(0)
  const [fullscreen, setFullscreen] = useState(false)

  // Load media + HLS
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    let hls: Hls | null = null
    const src = session.source.url

    if (session.source.kind === 'hls' && Hls.isSupported()) {
      hls = new Hls({ enableWorker: true })
      hls.loadSource(src)
      hls.attachMedia(video)
    } else {
      video.src = src
    }

    if (session.resumeSeconds) video.currentTime = session.resumeSeconds
    void video.play().catch(() => setPlaying(false))

    if (scrubVideoRef.current) scrubVideoRef.current.src = src

    return () => {
      hls?.destroy()
    }
  }, [session.cacheId, session.source.url, session.source.kind, session.resumeSeconds])

  // Subtitles file
  useEffect(() => {
    if (!session.subtitlePath || !window.cinevault) return
    void (async () => {
      try {
        const url = await window.cinevault.download.toFileUrl(session.subtitlePath!)
        const res = await fetch(url)
        const text = await res.text()
        setCues(parseSrt(text))
      } catch {
        setCues([])
      }
    })()
  }, [session.subtitlePath])

  // Download stats polling
  useEffect(() => {
    if (session.source.kind === 'local') return
    const id = session.cacheId
    const t = setInterval(() => {
      void window.cinevault?.download.status(id).then((s) => {
        if (!s) return
        setDl({
          speed: s.speed,
          received: s.bytesReceived,
          total: s.bytesTotal,
          done: s.done
        })
      })
    }, 800)
    return () => clearInterval(t)
  }, [session.cacheId, session.source.kind])

  // Time updates + cache progress
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const onTime = (): void => {
      setCurrent(video.currentTime)
      setSubText(cueAt(cues, video.currentTime, subOffset))
    }
    const onMeta = (): void => {
      setDuration(video.duration || 0)
      setVideoWidth(video.videoWidth)
      setVideoHeight(video.videoHeight)
    }
    const onPlay = (): void => setPlaying(true)
    const onPause = (): void => setPlaying(false)

    video.addEventListener('timeupdate', onTime)
    video.addEventListener('loadedmetadata', onMeta)
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    return () => {
      video.removeEventListener('timeupdate', onTime)
      video.removeEventListener('loadedmetadata', onMeta)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
    }
  }, [cues, subOffset])

  // Persist progress
  useEffect(() => {
    const video = videoRef.current
    if (!video || !window.cinevault) return
    const t = setInterval(() => {
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
    }, 5000)
    return () => clearInterval(t)
  }, [session])

  const togglePlay = (): void => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) void video.play()
    else video.pause()
  }

  const stop = async (): Promise<void> => {
    const video = videoRef.current
    if (video && window.cinevault) {
      const nearEnd = video.duration > 0 && video.currentTime / video.duration > 0.92
      if (nearEnd) await window.cinevault.cache.markComplete(session.cacheId)
    }
    setSession(null)
  }

  const backToLibrary = (): void => {
    const video = videoRef.current
    if (video) {
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

  const onTimelineHover = (e: MouseEvent<HTMLDivElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    const t = ratio * (duration || 0)
    setScrub({ x: e.clientX - rect.left, t, visible: true })

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

  const detectedRes =
    videoHeight >= 2160 ? '4K' : videoHeight >= 1440 ? '2K' : videoHeight >= 1080 ? '1080p' : videoHeight >= 720 ? '720p' : `${videoWidth}×${videoHeight}`

  return (
    <div className="player-root">
      <div className="player-top">
        <button className="icon-btn" type="button" title="Back to library" onClick={backToLibrary}>
          ←
        </button>
        <div style={{ flex: 1 }}>
          <h1>{session.title}</h1>
          <div className="muted" style={{ color: '#9aa5b5', fontSize: 12 }}>
            {session.resolution} · live {detectedRes}
            {session.source.hdr ? ' · HDR/DV flagged' : ''}
            {session.source.spatialAudio ? ' · Spatial flagged' : ''}
          </div>
        </div>
        <button className="icon-btn" type="button" title="Stats for nerds" onClick={() => setShowStats((v) => !v)}>
          i
        </button>
        <button className="icon-btn" type="button" title="Always-on-top mini player" onClick={() => void enterPip()}>
          ▢
        </button>
        <button
          className="icon-btn"
          type="button"
          title="Fullscreen"
          onClick={() => {
            const root = document.querySelector('.player-root')
            if (!document.fullscreenElement) {
              void root?.requestFullscreen()
              setFullscreen(true)
            } else {
              void document.exitFullscreen()
              setFullscreen(false)
            }
          }}
        >
          {fullscreen ? '⛶' : '⛶'}
        </button>
        <button className="icon-btn" type="button" title="Close player" onClick={() => void stop()}>
          ×
        </button>
      </div>

      <div className="player-stage" onDoubleClick={togglePlay}>
        <video ref={videoRef} playsInline />
        <video ref={scrubVideoRef} muted playsInline style={{ display: 'none' }} />
        {subText && (
          <div className="subtitle-layer" style={{ fontSize: subSize }}>
            {subText}
          </div>
        )}
        {showStats && (
          <div className="stats-panel">
            <div>
              <strong>Stats for nerds</strong>
            </div>
            <div>Resolution: {videoWidth}×{videoHeight} ({detectedRes})</div>
            <div>Source: {session.source.kind}</div>
            <div>URL host: {(() => { try { return new URL(session.source.url).host } catch { return 'local' } })()}</div>
            <div>
              Buffer: {videoRef.current?.buffered.length
                ? `${formatTime(videoRef.current.buffered.end(videoRef.current.buffered.length - 1))}`
                : '—'}
            </div>
            <div>Download speed: {dl ? formatSpeed(dl.speed) : '—'}</div>
            <div>
              Cached: {dl ? `${(dl.received / 1024 / 1024).toFixed(1)} / ${(dl.total / 1024 / 1024 || 0).toFixed(1)} MB` : '—'}
            </div>
            <div>HDR prefer: {session.source.hdr ? 'yes' : 'no'}</div>
            <div>Spatial prefer: {session.source.spatialAudio ? 'yes' : 'no'}</div>
            <div>Subtitle offset: {subOffset.toFixed(1)}s</div>
          </div>
        )}
        {showSubs && (
          <div className="sub-panel">
            <strong>Subtitles</strong>
            <div className="muted" style={{ color: '#9aa5b5' }}>
              {session.subtitleLabel || (cues.length ? 'Loaded' : 'None loaded')}
            </div>
            <label>
              Size ({subSize}px)
              <input
                type="range"
                min={16}
                max={64}
                value={subSize}
                onChange={(e) => setSubSize(Number(e.target.value))}
                style={{ width: '100%' }}
              />
            </label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span>Offset</span>
              <button className="icon-btn" type="button" onClick={() => setSubOffset((v) => +(v - 0.1).toFixed(1))}>
                −0.1
              </button>
              <span>{subOffset.toFixed(1)}s</span>
              <button className="icon-btn" type="button" onClick={() => setSubOffset((v) => +(v + 0.1).toFixed(1))}>
                +0.1
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
        >
          {scrub.visible && (
            <div className="scrub-preview" style={{ left: scrub.x }}>
              <canvas ref={canvasRef} width={160} height={90} />
              <div className="t">{formatTime(scrub.t)}</div>
            </div>
          )}
          <input
            className="timeline"
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={current}
            onChange={(e) => {
              const v = Number(e.target.value)
              if (videoRef.current) videoRef.current.currentTime = v
              setCurrent(v)
            }}
          />
        </div>
        <div className="controls-row">
          <button className="icon-btn" type="button" onClick={togglePlay}>
            {playing ? '❚❚' : '▶'}
          </button>
          <button className="icon-btn" type="button" onClick={() => void stop()} title="Stop">
            ■
          </button>
          <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 13 }}>
            {formatTime(current)} / {formatTime(duration)} · −{formatTime(Math.max(0, duration - current))}
          </span>
          <input
            className="volume"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(e) => {
              const v = Number(e.target.value)
              setVolume(v)
              if (videoRef.current) videoRef.current.volume = v
            }}
          />
          <div className="spacer" />
          <button className="btn ghost" type="button" style={{ color: '#fff' }} onClick={() => setShowSubs((v) => !v)}>
            CC
          </button>
          <button className="btn ghost" type="button" style={{ color: '#fff' }} onClick={backToLibrary}>
            Library
          </button>
        </div>
      </div>
    </div>
  )
}
