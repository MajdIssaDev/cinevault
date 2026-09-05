import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Play, X } from 'lucide-react'
import type { MediaType } from '../types'
import {
  clearProgress,
  formatRemaining,
  getContinueWatchingList,
  subscribePlaybackHistory,
  type PlaybackProgress
} from '../services/playbackHistoryService'
import { HScrollRail } from './HScrollRail'

export function ContinueWatchingRow({
  mediaType
}: {
  mediaType?: MediaType
}): JSX.Element | null {
  const navigate = useNavigate()
  const [items, setItems] = useState<PlaybackProgress[]>(() => getContinueWatchingList())

  useEffect(() => {
    const refresh = (): void => setItems(getContinueWatchingList())
    refresh()
    return subscribePlaybackHistory(refresh)
  }, [])

  const filtered = mediaType ? items.filter((i) => i.mediaType === mediaType) : items
  if (!filtered.length) return null

  const removeEntry = (entry: PlaybackProgress): void => {
    clearProgress(entry.mediaId, entry.season, entry.episode)
  }

  return (
    <section className="continue-watching catalog-shelf" aria-label="Continue watching">
      <div className="catalog-shelf-head">
        <h2 className="catalog-shelf-title">Continue Watching</h2>
      </div>
      <HScrollRail trackClassName="catalog-shelf-track">
        {filtered.map((entry) => {
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
              key={`${entry.mediaId}:${entry.season || 0}:${entry.episode || 0}`}
              className="continue-card"
            >
              <button
                type="button"
                className="continue-card-main"
                onClick={() =>
                  navigate(`/detail/${entry.mediaType}/${entry.externalId}`)
                }
              >
                <div className="continue-card-art">
                  {entry.backdropPath || entry.posterPath ? (
                    <img
                      src={entry.backdropPath || entry.posterPath}
                      alt=""
                      loading="lazy"
                    />
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
                title="Remove from Continue Watching"
                aria-label={`Remove ${entry.title}`}
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  removeEntry(entry)
                }}
              >
                <X size={14} strokeWidth={2} />
              </button>
            </article>
          )
        })}
      </HScrollRail>
    </section>
  )
}
