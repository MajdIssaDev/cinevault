import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
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
import { HoverScrollTitle } from './HoverScrollTitle'
import { Tooltip } from './ui/Tooltip'
import { detailPathForItem } from '../lib/detailPath'

function ContinueCard({
  entry,
  onRemove,
  onOpen
}: {
  entry: PlaybackProgress
  onRemove: () => void
  onOpen: () => void
}): JSX.Element {
  const [isHovered, setIsHovered] = useState(false)
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
    <article
      className="continue-card group"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
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
          <HoverScrollTitle
            title={entry.title}
            className="continue-card-title"
            active={isHovered}
          />
          {subtitle ? (
            <div className="continue-card-sub">{subtitle}</div>
          ) : null}
        </div>
      </button>
      <Tooltip content="Remove from list" className="continue-card-remove-tip">
        <button
          type="button"
          className="continue-card-remove"
          aria-label="Remove item"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onRemove()
          }}
        >
          <X size={14} strokeWidth={2.5} />
        </button>
      </Tooltip>
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

  return filtered.length > 0 ? (
    <section className="continue-watching catalog-shelf" aria-label="Continue watching">
      <div className="catalog-shelf-head">
        <h2 className="catalog-shelf-title">Continue Watching</h2>
      </div>
      <HScrollRail trackClassName="catalog-shelf-track">
        {filtered.map((entry) => (
          <div
            key={`${entry.mediaId}:${entry.season || 0}:${entry.episode || 0}`}
            className="continue-card-motion"
          >
            <ContinueCard
              entry={entry}
              onRemove={() => {
                clearProgressForMedia(entry.mediaId)
                void (async () => {
                  try {
                    await window.cinevault?.cache.removeByMedia(entry.mediaId)
                    await window.cinevault?.torrent.deleteByMedia?.(entry.mediaId)
                  } catch (err) {
                    console.error('Failed to cleanup torrent storage:', err)
                  }
                })()
              }}
              onOpen={() => {
                navigate(
                  detailPathForItem({
                    mediaType: entry.mediaType,
                    externalId: entry.externalId,
                    provider: entry.provider
                  })
                )
              }}
            />
          </div>
        ))}
      </HScrollRail>
    </section>
  ) : null
}
