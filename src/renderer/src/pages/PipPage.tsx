import { useEffect, useRef, useState } from 'react'
import Hls from 'hls.js'
import type { PlaybackSession } from '../types'
import { Tooltip } from '../components/ui/Tooltip'

export function PipPage(): JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [session, setSession] = useState<PlaybackSession | null>(null)

  useEffect(() => {
    try {
      const raw = localStorage.getItem('cinevault-pip')
      if (raw) setSession(JSON.parse(raw) as PlaybackSession)
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !session) return
    let hls: Hls | null = null
    if (session.source.kind === 'hls' && Hls.isSupported()) {
      hls = new Hls()
      hls.loadSource(session.source.url)
      hls.attachMedia(video)
    } else {
      video.src = session.source.url
    }
    if (session.resumeSeconds) video.currentTime = session.resumeSeconds
    void video.play().catch(() => undefined)
    return () => hls?.destroy()
  }, [session])

  return (
    <div className="pip-root">
      <video ref={videoRef} playsInline />
      <div className="pip-bar">
        <button
          className="icon-btn"
          type="button"
          onClick={() => {
            const v = videoRef.current
            if (!v) return
            if (v.paused) void v.play()
            else v.pause()
          }}
        >
          ▶/❚❚
        </button>
        <Tooltip content="Return to app">
          <button
            className="icon-btn"
            type="button"
            onClick={() => {
              const v = videoRef.current
              if (session && v) {
                localStorage.setItem(
                  'cinevault-pip',
                  JSON.stringify({ ...session, resumeSeconds: v.currentTime })
                )
                // Persist for main window resume chip via storage event
                localStorage.setItem(
                  'cinevault-resume',
                  JSON.stringify({ ...session, resumeSeconds: v.currentTime })
                )
              }
              void window.cinevault?.pip.close()
            }}
          >
            ↗ App
          </button>
        </Tooltip>
        <button className="icon-btn" type="button" onClick={() => void window.cinevault?.pip.close()}>
          ×
        </button>
      </div>
    </div>
  )
}
