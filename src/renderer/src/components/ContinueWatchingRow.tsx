import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Play, X } from 'lucide-react'
import type { MediaType } from '../types'
import {
  clearProgressForMedia,
  formatRemaining,
  getContinueWatchingList,
  subscribePlaybackHistory,
  type PlaybackProgress
} from '../services/playbackHistoryService'
import { HScrollRail } from './HScrollRail'

function ContinueCard({
  entry,
  onRemove,
  onOpen
}: {
  entry: PlaybackProgress
  onRemove: () => void
  onOpen: () => void
}): JSX.Element {
  const pct = Math.min(100, Math.max(0, entry.percentage))
  const episodeLabel =
    entry.season != null && entry.episode != null
      ? `S${entry.season}:E${entry.episode}${
          entry.episodeTitle ? ` · ${entry.episodeTitle}` : ''
        }`
      : null
  const remaining = entry.duration > 0 ? formatRemaining(entry) : null
  const subtitle = [episodeLabel, remaining].filter(Boolean).join(' · ')

  return (
    <article className="continue-card">
      <button type="button" className="continue-card-main" onClick={onOpen}>
        <div className="continue-card-art">
          {entry.backdropPath || entry.posterPath ? (
            <img src={entry.backdropPath || entry.posterPath} alt="" loading="lazy" />
          ) : (
            <div className="continue-card-empty">{entry.title}</div>
          )}
          <div className="continue-card-scrim" />
          <span className="continue-card-play">
            <Play size={18} fill="currentColor" strokeWidth={0} />
          </span>
          <div className="poster-progress continue-card-progress" aria-hidden>
            <div className="poster-progress-fill" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="continue-card-meta">
          <div className="continue-card-title">{entry.title}</div>
          {subtitle ? <div className="continue-card-sub">{subtitle}</div> : null}
        </div>
      </button>
      <button
        type="button"
        className="continue-card-remove"
        title="Remove from list"
        aria-label="Remove item"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onRemove()
        }}
      >
        <X size={14} strokeWidth={2.5} />
      </button>
    </article>
  )
}

export function ContinueWatchingRow({
  mediaType
}: {
  mediaType?: MediaType
}): JSX.Element {
  const navigate = useNavigate()
  const [items, setItems] = useState<PlaybackProgress[]>(() => getContinueWatchingList())

  useEffect(() => {
    const refresh = (): void => setItems(getContinueWatchingList())
    refresh()
    return subscribePlaybackHistory(refresh)
  }, [])

  const filtered = mediaType ? items.filter((i) => i.mediaType === mediaType) : items

  return (
    <AnimatePresence initial={false}>
      {filtered.length > 0 && (
        <motion.section
          key="continue-watching-shelf"
          className="continue-watching catalog-shelf continue-watching-anim"
          aria-label="Continue watching"
          initial={{ opacity: 0, height: 0, marginBottom: 0 }}
          animate={{ opacity: 1, height: 'auto', marginBottom: 0 }}
          exit={{
            opacity: 0,
            height: 0,
            marginBottom: 0,
            transition: { duration: 0.3, ease: 'easeInOut' }
          }}
          style={{ overflow: 'hidden' }}
        >
          <div className="catalog-shelf-head">
            <h2 className="catalog-shelf-title">Continue Watching</h2>
          </div>
          <HScrollRail trackClassName="catalog-shelf-track">
            <AnimatePresence mode="popLayout" initial={false}>
              {filtered.map((entry) => (
                <motion.div
                  key={`${entry.mediaId}:${entry.season || 0}:${entry.episode || 0}`}
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
                  className="continue-card-motion"
                >
                  <ContinueCard
                    entry={entry}
                    onRemove={() => {
                      clearProgressForMedia(entry.mediaId)
                      void window.cinevault?.cache.removeByMedia(entry.mediaId)
                    }}
                    onOpen={() =>
                      navigate(`/detail/${entry.mediaType}/${entry.externalId}`)
                    }
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          </HScrollRail>
        </motion.section>
      )}
    </AnimatePresence>
  )
}
