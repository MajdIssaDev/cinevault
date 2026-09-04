import { useEffect, useMemo, useState } from 'react'
import type { CatalogItem, MediaType } from '../types'
import { useAppStore } from '../store'
import { PosterCard } from '../components/PosterCard'
import {
  discoverByGenre,
  fetchPopularMovies,
  fetchPopularSeries,
  searchMovies,
  searchSeries
} from '../api/tmdb'
import { fetchAnimeByGenre, fetchPopularAnime, searchAnime } from '../api/anilist'
import { GENRE_MOVIE, GENRE_TV } from '../types'

const ANIME_GENRES = [
  'Action',
  'Adventure',
  'Comedy',
  'Drama',
  'Fantasy',
  'Horror',
  'Mecha',
  'Mystery',
  'Romance',
  'Sci-Fi',
  'Slice of Life',
  'Sports',
  'Supernatural'
]

export function CatalogPage({ mediaType }: { mediaType: MediaType }): JSX.Element {
  const settings = useAppStore((s) => s.settings)
  const searchQuery = useAppStore((s) => s.searchQuery)
  const setSearchQuery = useAppStore((s) => s.setSearchQuery)
  const genreFilter = useAppStore((s) => s.genreFilter)
  const setGenreFilter = useAppStore((s) => s.setGenreFilter)
  const sortBy = useAppStore((s) => s.sortBy)
  const setSortBy = useAppStore((s) => s.setSortBy)

  const [items, setItems] = useState<CatalogItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const genres = useMemo(() => {
    if (mediaType === 'movie') return Object.values(GENRE_MOVIE)
    if (mediaType === 'series') return Object.values(GENRE_TV)
    return ANIME_GENRES
  }, [mediaType])

  useEffect(() => {
    let cancelled = false
    const run = async (): Promise<void> => {
      setLoading(true)
      setError(null)
      try {
        const key = settings?.tmdbApiKey || ''
        let list: CatalogItem[] = []
        if (mediaType === 'anime') {
          if (searchQuery.trim()) list = await searchAnime(searchQuery.trim())
          else if (genreFilter !== 'all') list = await fetchAnimeByGenre(genreFilter)
          else list = await fetchPopularAnime()
        } else {
          if (!key) throw new Error('Add your TMDB API key in Settings to browse catalogs.')
          if (searchQuery.trim()) {
            list =
              mediaType === 'movie'
                ? await searchMovies(key, searchQuery.trim())
                : await searchSeries(key, searchQuery.trim())
          } else if (genreFilter !== 'all') {
            list = await discoverByGenre(key, mediaType === 'movie' ? 'movie' : 'tv', genreFilter)
          } else {
            list =
              mediaType === 'movie' ? await fetchPopularMovies(key) : await fetchPopularSeries(key)
          }
        }
        if (!cancelled) setItems(list)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load catalog')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    const t = setTimeout(() => void run(), 250)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [mediaType, searchQuery, genreFilter, settings?.tmdbApiKey])

  const sorted = useMemo(() => {
    const copy = [...items]
    switch (sortBy) {
      case 'rating':
        return copy.sort((a, b) => b.rating - a.rating)
      case 'date':
        return copy.sort((a, b) => (b.releaseDate || '').localeCompare(a.releaseDate || ''))
      case 'title':
        return copy.sort((a, b) => a.title.localeCompare(b.title))
      default:
        return copy
    }
  }, [items, sortBy])

  const title =
    mediaType === 'movie' ? 'Movies' : mediaType === 'series' ? 'Series' : 'Anime'

  return (
    <div>
      <h1 className="page-title">{title}</h1>
      <p className="page-sub">
        Official artwork & metadata · hover a poster for release date · star to favorite
      </p>
      <div className="toolbar">
        <input
          className="search"
          placeholder={`Search ${title.toLowerCase()}…`}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <select className="select" value={genreFilter} onChange={(e) => setGenreFilter(e.target.value)}>
          <option value="all">All genres</option>
          {genres.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
        <select
          className="select"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
        >
          <option value="popularity">Sort: Popularity</option>
          <option value="rating">Sort: Rating</option>
          <option value="date">Sort: Release date</option>
          <option value="title">Sort: Title</option>
        </select>
      </div>
      {loading && <div className="muted">Loading catalog…</div>}
      {error && <div className="card-block" style={{ color: 'var(--danger)' }}>{error}</div>}
      {!loading && !error && sorted.length === 0 && (
        <div className="empty">No titles found. Try another search or genre.</div>
      )}
      <div className="poster-grid">
        {sorted.map((item) => (
          <PosterCard key={item.id} item={item} />
        ))}
      </div>
    </div>
  )
}
