import { Star } from 'lucide-react'

/** Shared frosted rating pill — top-right of poster art only. */
export function PosterRatingBadge({ rating }: { rating: number | null | undefined }): JSX.Element | null {
  const value = Number(rating)
  if (!Number.isFinite(value) || value <= 0) return null
  return (
    <div className="poster-rating-badge" aria-label={`Rating ${value.toFixed(1)}`}>
      <Star className="poster-rating-badge-star" size={10} strokeWidth={0} aria-hidden />
      <span className="poster-rating-badge-value">{value.toFixed(1)}</span>
    </div>
  )
}

export { mediaTypeLabel } from '../lib/genres'
