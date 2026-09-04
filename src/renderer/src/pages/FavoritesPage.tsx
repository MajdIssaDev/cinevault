import { useAppStore } from '../store'
import { PosterCard } from '../components/PosterCard'
import type { CatalogItem } from '../types'

export function FavoritesPage(): JSX.Element {
  const favorites = useAppStore((s) => s.favorites)
  const items: CatalogItem[] = favorites.map((f) => ({
    id: f.id,
    externalId: f.externalId,
    mediaType: f.mediaType,
    title: f.title,
    overview: '',
    posterUrl: f.posterUrl,
    backdropUrl: null,
    releaseDate: f.releaseDate,
    rating: 0,
    genres: []
  }))

  return (
    <div>
      <h1 className="page-title">Favorites</h1>
      <p className="page-sub">Titles you starred across movies, series, and anime.</p>
      {items.length === 0 ? (
        <div className="empty">No favorites yet. Hover a poster and tap ★.</div>
      ) : (
        <div className="poster-grid">
          {items.map((item) => (
            <PosterCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  )
}
