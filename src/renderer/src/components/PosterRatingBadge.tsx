import { Star, X } from 'lucide-react'

/** Shared frosted rating pill — morphs to dismiss on card hover when `onDismiss` is set. */
export function PosterRatingBadge({
  rating,
  onDismiss
}: {
  rating: number | null | undefined
  onDismiss?: () => void
}): JSX.Element | null {
  const value = Number(rating)
  const hasRating = Number.isFinite(value) && value > 0
  if (!hasRating && !onDismiss) return null

  return (
    <div
      className={`poster-corner-anchor${onDismiss ? ' has-dismiss' : ''}${hasRating ? '' : ' dismiss-only'}`}
    >
      {hasRating ? (
        <div
          className={`poster-rating-badge${onDismiss ? ' morphs' : ''}`}
          aria-label={`Rating ${value.toFixed(1)}`}
          aria-hidden={onDismiss ? true : undefined}
        >
          <Star className="poster-rating-badge-star" size={10} strokeWidth={0} aria-hidden />
          <span className="poster-rating-badge-value">{value.toFixed(1)}</span>
        </div>
      ) : null}

      {onDismiss ? (
        <button
          type="button"
          className="poster-dismiss-btn"
          aria-label="Remove from list"
          onMouseDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onDismiss()
          }}
        >
          <X size={14} strokeWidth={2.5} aria-hidden />
        </button>
      ) : null}
    </div>
  )
}

export { mediaTypeLabel } from '../lib/genres'
