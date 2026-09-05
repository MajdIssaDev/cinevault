import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Clapperboard, ExternalLink, X } from 'lucide-react'
import type { TrailerInfo } from '../api/tmdb'
import { openExternal } from '../lib/openExternal'

export function TrailerModal({
  trailer,
  onClose
}: {
  trailer: TrailerInfo
  onClose: () => void
}): JSX.Element {
  const [loading, setLoading] = useState(true)
  const [restricted, setRestricted] = useState(false)
  const timeoutRef = useRef<number | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    setLoading(true)
    setRestricted(false)
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current)
    timeoutRef.current = window.setTimeout(() => {
      // Embed still not ready → assume YouTube blocked it
      setLoading((was) => {
        if (was) setRestricted(true)
        return false
      })
    }, 6000)
    return () => {
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current)
    }
  }, [trailer.key])

  const markLoaded = (): void => {
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current)
    setLoading(false)
    setRestricted(false)
  }

  const watchOnYoutube = (): void => {
    void openExternal(trailer.youtubeUrl)
    onClose()
  }

  return createPortal(
    <div
      className="trailer-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={trailer.name}
      onClick={onClose}
    >
      <div className="trailer-modal" onClick={(e) => e.stopPropagation()}>
        <header className="trailer-modal-header">
          <div className="trailer-modal-title">
            <Clapperboard size={16} strokeWidth={1.75} aria-hidden />
            <span>{trailer.name}</span>
          </div>
          <div className="trailer-modal-actions">
            <button
              type="button"
              className="trailer-modal-btn"
              onClick={() => void openExternal(trailer.youtubeUrl)}
              title="Open in browser"
            >
              <ExternalLink size={15} strokeWidth={2} />
              Open in Browser
            </button>
            <button
              type="button"
              className="trailer-modal-icon"
              onClick={onClose}
              aria-label="Close trailer"
            >
              <X size={18} strokeWidth={2} />
            </button>
          </div>
        </header>

        <div className="trailer-modal-stage">
          {loading && !restricted && (
            <div className="trailer-modal-loading" aria-live="polite">
              <span className="feed-spinner" />
              <span>Loading trailer…</span>
            </div>
          )}

          {restricted ? (
            <div className="trailer-modal-restricted">
              <p>This video has playback restrictions in-app.</p>
              <button type="button" className="trailer-modal-primary" onClick={watchOnYoutube}>
                <ExternalLink size={16} strokeWidth={2} />
                Watch on YouTube
              </button>
            </div>
          ) : (
            <iframe
              key={trailer.key}
              className="trailer-modal-frame"
              src={trailer.embedUrl}
              title={trailer.name}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
              onLoad={markLoaded}
              onError={() => {
                if (timeoutRef.current) window.clearTimeout(timeoutRef.current)
                setLoading(false)
                setRestricted(true)
              }}
            />
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
