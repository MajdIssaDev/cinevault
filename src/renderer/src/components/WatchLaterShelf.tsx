import { useNavigate } from 'react-router-dom'
import { BookmarkPlus, Clock } from 'lucide-react'
import { useState } from 'react'
import { useWatchLater } from '../hooks/useWatchLater'
import {
  fromWatchLaterType,
  type WatchLaterItem,
  type WatchLaterMediaType
} from '../services/watchLaterService'
import { PosterRatingBadge } from './PosterRatingBadge'
import { resolveGenre } from '../lib/genres'
import { HoverScrollTitle } from './HoverScrollTitle'
import { HScrollRail } from './HScrollRail'
import { detailPathForItem } from '../lib/detailPath'

const PLACEHOLDER_SLOTS = 4

function WatchLaterCard({
  item,
  onRemove,
  onOpen
}: {
  item: WatchLaterItem
  onRemove: (id: string | number) => void
  onOpen: () => void
}): JSX.Element {
  const [isHovered, setIsHovered] = useState(false)
  const year = item.releaseYear || '—'
  const subLabel = resolveGenre({
    genre: item.genre,
    mediaType: item.mediaType
  })

  return (
    <article
      className="watch-later-card group"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
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
          <HoverScrollTitle
            title={item.title}
            className="watch-later-card-title"
            active={isHovered}
          />
          <div className="watch-later-card-sub">
            <span>{year}</span>
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
      </button>
      <PosterRatingBadge rating={item.voteAverage} onDismiss={() => onRemove(item.id)} />
    </article>
  )
}

function WatchLaterPlaceholder({ onActivate }: { onActivate: () => void }): JSX.Element {
  return (
    <button
      type="button"
      className="watch-later-placeholder"
      onClick={onActivate}
      aria-label="Browse catalog to add Watch Later"
    >
      <BookmarkPlus size={20} strokeWidth={1.5} className="watch-later-placeholder-icon" aria-hidden />
      <span className="watch-later-placeholder-label">Add to Watch Later</span>
    </button>
  )
}

function watchLaterDetailPath(item: WatchLaterItem): string {
  const appType = fromWatchLaterType(item.mediaType)
  const raw = String(item.id)
  const externalId = Number(raw.replace(/^(tmdb-)?(movie|series|anime)-/, ''))
  return detailPathForItem({
    mediaType: appType,
    externalId: Number.isFinite(externalId) ? externalId : 0,
    provider: item.provider === 'tmdb' ? 'tmdb' : undefined
  })
}

export function WatchLaterShelf({
  mediaType
}: {
  mediaType: WatchLaterMediaType
}): JSX.Element | null {
  const navigate = useNavigate()
  const { watchLaterItems, remove } = useWatchLater(mediaType)

  const focusCatalog = (): void => {
    document.querySelector<HTMLElement>('.catalog-toolbar .catalog-search')?.focus()
    document.querySelector('.catalog-toolbar')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const sparse = watchLaterItems.length > 0 && watchLaterItems.length < PLACEHOLDER_SLOTS
  const placeholderCount = sparse ? Math.max(0, PLACEHOLDER_SLOTS - watchLaterItems.length) : 0

  return watchLaterItems.length > 0 ? (
    <section className="watch-later-shelf catalog-shelf" aria-label="Watch Later">
      <div className="catalog-shelf-head">
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
      </div>

      <HScrollRail trackClassName="catalog-shelf-track watch-later-track">
        {watchLaterItems.map((item) => (
          <div key={String(item.id)} className="shelf-card-slot watch-later-card-motion">
            <WatchLaterCard
              item={item}
              onRemove={remove}
              onOpen={() => navigate(watchLaterDetailPath(item))}
            />
          </div>
        ))}
        {Array.from({ length: placeholderCount }).map((_, i) => (
          <div
            key={`placeholder-${i}`}
            className="shelf-card-slot watch-later-card-motion watch-later-placeholder-motion"
          >
            <WatchLaterPlaceholder onActivate={focusCatalog} />
          </div>
        ))}
      </HScrollRail>
    </section>
  ) : null
}
