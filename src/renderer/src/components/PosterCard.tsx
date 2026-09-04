import type { CatalogItem } from '../types'
import { useAppStore } from '../store'
import { useNavigate } from 'react-router-dom'

export function PosterCard({ item }: { item: CatalogItem }): JSX.Element {
  const navigate = useNavigate()
  const isFavorite = useAppStore((s) => s.isFavorite)
  const toggleFavorite = useAppStore((s) => s.toggleFavorite)
  const fav = isFavorite(item.mediaType, item.externalId)
  const year = item.releaseDate?.slice(0, 4) || '—'

  return (
    <article
      className="poster-card"
      onClick={() => navigate(`/detail/${item.mediaType}/${item.externalId}`)}
    >
      {item.posterUrl ? (
        <img src={item.posterUrl} alt={item.title} loading="lazy" />
      ) : (
        <div className="empty" style={{ height: '100%', display: 'grid', placeItems: 'center' }}>
          {item.title}
        </div>
      )}
      <button
        type="button"
        className={`fav${fav ? ' on' : ''}`}
        title={fav ? 'Unfavorite' : 'Favorite'}
        onClick={(e) => {
          e.stopPropagation()
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
        ★
      </button>
      <div className="overlay">
        <strong style={{ color: '#fff' }}>{item.title}</strong>
        <div className="meta">
          Released {year} · ★ {item.rating?.toFixed?.(1) ?? '—'}
        </div>
      </div>
    </article>
  )
}
