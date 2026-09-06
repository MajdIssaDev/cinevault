import { memo, useEffect, useState } from 'react'
import { Clock, Heart, Play } from 'lucide-react'
import type { CatalogItem } from '../types'
import { useAppStore } from '../store'
import { useNavigate } from 'react-router-dom'
import {
  formatRemaining,
  getLatestProgressForTitle,
  subscribePlaybackHistory,
  type PlaybackProgress
} from '../services/playbackHistoryService'
import { useWatchLaterFlag } from '../hooks/useWatchLaterFlag'
import { catalogToWatchLaterItem } from '../services/watchLaterService'
import { detailPathForItem } from '../lib/detailPath'
import { PosterRatingBadge } from './PosterRatingBadge'
import { resolveGenre } from '../lib/genres'
import { HoverScrollTitle } from './HoverScrollTitle'
import { Tooltip } from './ui/Tooltip'

function looksLikeLandscapeArt(url: string | null): boolean {
  if (!url) return false
  return /background_image|backdrop|w1280|w1920|screenshot|still/i.test(url)
}

function PosterCardInner({ item }: { item: CatalogItem }): JSX.Element {
  const navigate = useNavigate()
  const toggleFavorite = useAppStore((s) => s.toggleFavorite)
  const fav = useAppStore((s) =>
    s.favorites.some((f) => f.mediaType === item.mediaType && f.externalId === item.externalId)
  )
  const { saved: inWatchLater, toggle: toggleWatchLater } = useWatchLaterFlag(item.id)
  const [bump, setBump] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  const [usePlaceholder, setUsePlaceholder] = useState(
    !item.posterUrl || looksLikeLandscapeArt(item.posterUrl)
  )
  const [progress, setProgress] = useState<PlaybackProgress | null>(() =>
    getLatestProgressForTitle(item.id)
  )

  useEffect(() => {
    setUsePlaceholder(!item.posterUrl || looksLikeLandscapeArt(item.posterUrl))
  }, [item.id, item.posterUrl])

  useEffect(() => {
    const refresh = (): void => {
      const next = getLatestProgressForTitle(item.id)
      setProgress((prev) => {
        if (
          prev?.percentage === next?.percentage &&
          prev?.updatedAt === next?.updatedAt &&
          prev?.currentTime === next?.currentTime
        ) {
          return prev
        }
        return next
      })
    }
    refresh()
    return subscribePlaybackHistory(refresh)
  }, [item.id])

  const year = item.releaseDate?.slice(0, 4) || '—'
  const subLabel = resolveGenre(item)
  const pct = progress ? Math.min(100, Math.max(0, progress.percentage)) : 0

  const goDetail = (): void => {
    const path = detailPathForItem(item)
    navigate(path)
  }

  return (
    <article
      className="poster-card group"
      onClick={goDetail}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="poster-card-media">
        {!usePlaceholder && item.posterUrl ? (
          <img
            src={item.posterUrl}
            alt=""
            loading="lazy"
            decoding="async"
            onLoad={(e) => {
              const img = e.currentTarget
              if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                if (img.naturalWidth / img.naturalHeight > 1.15) setUsePlaceholder(true)
              }
            }}
            onError={() => setUsePlaceholder(true)}
          />
        ) : (
          <div className="poster-card-empty" aria-hidden>
            <span className="poster-card-empty-title">{item.title}</span>
          </div>
        )}
        <PosterRatingBadge rating={item.rating} />
        <div className="poster-play" aria-hidden>
          <span className="poster-play-disc">
            <Play size={22} fill="currentColor" strokeWidth={0} />
          </span>
        </div>
        {progress && (
          <>
            <div className="poster-progress" aria-hidden>
              <div className="poster-progress-fill" style={{ width: `${pct}%` }} />
            </div>
            <button
              type="button"
              className="poster-resume-btn"
              onMouseDown={(e) => {
                e.preventDefault()
                e.stopPropagation()
              }}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                goDetail()
              }}
            >
              <Play size={12} fill="currentColor" strokeWidth={0} />
              {progress.season != null && progress.episode != null
                ? `Resume S${progress.season}:E${progress.episode} (${formatRemaining(progress)})`
                : `Resume (${formatRemaining(progress)})`}
            </button>
          </>
        )}
        <Tooltip content={inWatchLater ? 'In Watch Later' : 'Watch Later'} className="poster-action-tip poster-action-tip-wl">
          <button
            type="button"
            className={`poster-watch-later${inWatchLater ? ' on' : ''}`}
            aria-pressed={inWatchLater}
            onMouseDown={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              toggleWatchLater(catalogToWatchLaterItem(item))
            }}
          >
            <Clock size={15} strokeWidth={1.75} />
          </button>
        </Tooltip>
        <Tooltip content={fav ? 'Unfavorite' : 'Favorite'} className="poster-action-tip poster-action-tip-fav">
          <button
            type="button"
            className={`fav${fav ? ' on' : ''}${bump ? ' bump' : ''}`}
            aria-pressed={fav}
            onMouseDown={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setBump(true)
              window.setTimeout(() => setBump(false), 280)
              toggleFavorite({
                id: item.id,
                mediaType: item.mediaType,
                externalId: item.externalId,
                title: item.title,
                posterUrl: item.posterUrl,
                releaseDate: item.releaseDate
              })
            }}
          >
            {fav ? (
              <Heart size={16} fill="currentColor" strokeWidth={0} />
            ) : (
              <Heart size={16} strokeWidth={1.75} />
            )}
          </button>
        </Tooltip>
      </div>
      <div className="poster-card-meta">
        <HoverScrollTitle
          title={item.title}
          className="poster-card-title"
          active={isHovered}
        />
        <div className="poster-card-sub">
          <span className="poster-card-year">{year}</span>
          {subLabel ? (
            <>
              <span className="poster-card-dot" aria-hidden>
                •
              </span>
              <span className="poster-card-genre">{subLabel}</span>
            </>
          ) : null}
        </div>
      </div>
    </article>
  )
}

export const PosterCard = memo(PosterCardInner)
