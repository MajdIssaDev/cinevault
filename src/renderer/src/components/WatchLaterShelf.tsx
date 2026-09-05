import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Clock, X } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useWatchLater } from '../hooks/useWatchLater'
import {
  fromWatchLaterType,
  type WatchLaterItem,
  type WatchLaterMediaType
} from '../services/watchLaterService'

const SCROLL_STEP = 160

function WatchLaterCard({
  item,
  onRemove,
  onOpen
}: {
  item: WatchLaterItem
  onRemove: (id: string | number) => void
  onOpen: () => void
}): JSX.Element {
  return (
    <article className="watch-later-card">
      <button type="button" className="watch-later-card-main" onClick={onOpen}>
        <div className="watch-later-card-media">
          {item.posterPath ? (
            <img src={item.posterPath} alt="" loading="lazy" decoding="async" />
          ) : (
            <div className="watch-later-card-empty">{item.title}</div>
          )}
          <div className="watch-later-card-scrim" />
        </div>
        <div className="watch-later-card-meta">
          <div className="watch-later-card-title">{item.title}</div>
          <div className="watch-later-card-sub">
            {item.releaseYear || '—'}
            {item.voteAverage != null && item.voteAverage > 0
              ? ` · ★ ${item.voteAverage.toFixed(1)}`
              : ''}
          </div>
        </div>
      </button>
      <button
        type="button"
        className="watch-later-remove"
        title="Remove from Watch Later"
        aria-label={`Remove ${item.title}`}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onRemove(item.id)
        }}
      >
        <X size={14} strokeWidth={2} />
      </button>
    </article>
  )
}

export function WatchLaterShelf({
  mediaType
}: {
  mediaType: WatchLaterMediaType
}): JSX.Element {
  const navigate = useNavigate()
  const { watchLaterItems, remove } = useWatchLater(mediaType)
  const trackRef = useRef<HTMLDivElement>(null)
  const [canLeft, setCanLeft] = useState(false)
  const [canRight, setCanRight] = useState(false)

  const updateEdges = useCallback((): void => {
    const el = trackRef.current
    if (!el) {
      setCanLeft(false)
      setCanRight(false)
      return
    }
    const { scrollLeft, clientWidth, scrollWidth } = el
    setCanLeft(scrollLeft > 8)
    setCanRight(scrollLeft < scrollWidth - clientWidth - 8)
  }, [])

  useEffect(() => {
    const el = trackRef.current
    if (!el) return
    updateEdges()
    el.addEventListener('scroll', updateEdges, { passive: true })
    const ro = new ResizeObserver(updateEdges)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', updateEdges)
      ro.disconnect()
    }
  }, [updateEdges, watchLaterItems.length])

  const scrollBy = (dir: -1 | 1): void => {
    trackRef.current?.scrollBy({ left: dir * SCROLL_STEP, behavior: 'smooth' })
  }

  return (
    <AnimatePresence initial={false}>
      {watchLaterItems.length > 0 && (
        <motion.section
          key="watch-later-shelf"
          className="watch-later-shelf catalog-shelf watch-later-shelf-anim"
          aria-label="Watch Later"
          initial={{ opacity: 0, height: 0, marginBottom: 0 }}
          animate={{ opacity: 1, height: 'auto', marginBottom: 20 }}
          exit={{
            opacity: 0,
            height: 0,
            marginBottom: 0,
            transition: { duration: 0.3, ease: 'easeInOut' }
          }}
          style={{ overflow: 'hidden' }}
        >
          <div className="catalog-shelf-head watch-later-head">
            <div className="catalog-shelf-title-row">
              <Clock
                size={14}
                strokeWidth={1.75}
                className="watch-later-title-icon"
                aria-hidden
              />
              <h2 className="catalog-shelf-title">Watch Later</h2>
              <span className="watch-later-count">{watchLaterItems.length}</span>
            </div>
            <div className="watch-later-chevrons">
              <button
                type="button"
                className="watch-later-chevron"
                aria-label="Scroll left"
                disabled={!canLeft}
                onClick={() => scrollBy(-1)}
              >
                <ChevronLeft size={16} strokeWidth={1.75} />
              </button>
              <button
                type="button"
                className="watch-later-chevron"
                aria-label="Scroll right"
                disabled={!canRight}
                onClick={() => scrollBy(1)}
              >
                <ChevronRight size={16} strokeWidth={1.75} />
              </button>
            </div>
          </div>

          <div className="watch-later-track-wrap">
            <div ref={trackRef} className="watch-later-track catalog-shelf-track">
              <AnimatePresence mode="popLayout" initial={false}>
                {watchLaterItems.map((item) => {
                  const appType = fromWatchLaterType(item.mediaType)
                  const externalId = String(item.id).replace(/^(movie|series|anime)-/, '')
                  return (
                    <motion.div
                      key={String(item.id)}
                      layout
                      initial={{ opacity: 0, width: 0, scale: 0.9 }}
                      animate={{
                        opacity: 1,
                        width: 'auto',
                        scale: 1,
                        transition: {
                          width: { duration: 0.25, ease: 'easeOut' },
                          opacity: { duration: 0.2, delay: 0.1 },
                          scale: { duration: 0.25 }
                        }
                      }}
                      exit={{
                        opacity: 0,
                        width: 0,
                        scale: 0.85,
                        transition: {
                          opacity: { duration: 0.15 },
                          width: { duration: 0.25, delay: 0.1, ease: 'easeInOut' },
                          scale: { duration: 0.2 }
                        }
                      }}
                      className="watch-later-card-motion"
                    >
                      <WatchLaterCard
                        item={item}
                        onRemove={remove}
                        onOpen={() => navigate(`/detail/${appType}/${externalId}`)}
                      />
                    </motion.div>
                  )
                })}
              </AnimatePresence>
            </div>
          </div>
        </motion.section>
      )}
    </AnimatePresence>
  )
}
