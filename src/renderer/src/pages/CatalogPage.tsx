import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Search, X } from 'lucide-react'
import type { CatalogItem, MediaType } from '../types'
import { useAppStore } from '../store'
import { PosterCard } from '../components/PosterCard'
import { CatalogHero } from '../components/CatalogHero'
import { ContinueWatchingRow } from '../components/ContinueWatchingRow'
import { WatchLaterShelf } from '../components/WatchLaterShelf'
import { GenreChips } from '../components/GenreChips'
import { ThemedSelect } from '../components/ThemedSelect'
import {
  SearchCorrectionNotice,
  type SearchCorrection
} from '../components/SearchCorrectionNotice'
import { getSpellingSuggestion } from '../services/searchSuggestionService'
import {
  YTS_GENRES,
  fetchMoviesByGenre,
  fetchNewAndPopularMovies,
  searchMovies
} from '../api/ytsCatalog'
import {
  TVMAZE_GENRES,
  fetchNewAndPopularSeries,
  fetchSeriesByGenre,
  searchSeries
} from '../api/tvmaze'
import { fetchAnimeByGenre, fetchPopularAnime, searchAnime } from '../api/anilist'
import { catalogCacheKey, getCatalogCache, setCatalogCache } from '../lib/catalogCache'

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

const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1]

const gridVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.04, delayChildren: 0.05 }
  }
}

const cardVariants = {
  hidden: { opacity: 0, scale: 0.94, y: 12 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { duration: 0.25, ease: 'easeOut' as const }
  }
}

function genresFor(mediaType: MediaType): string[] {
  if (mediaType === 'movie') return YTS_GENRES
  if (mediaType === 'series') return TVMAZE_GENRES
  return ANIME_GENRES
}

async function loadCatalogPage(
  mediaType: MediaType,
  searchQuery: string,
  genreFilter: string,
  page: number
): Promise<CatalogItem[]> {
  const q = searchQuery.trim()
  if (mediaType === 'anime') {
    if (q) return searchAnime(q, page)
    if (genreFilter !== 'all') return fetchAnimeByGenre(genreFilter, page)
    return fetchPopularAnime(page)
  }
  if (mediaType === 'movie') {
    if (q) return searchMovies(q, page)
    if (genreFilter !== 'all') return fetchMoviesByGenre(genreFilter, page)
    return fetchNewAndPopularMovies(page)
  }
  if (q) return searchSeries(q, page)
  if (genreFilter !== 'all') return fetchSeriesByGenre(genreFilter, page)
  return fetchNewAndPopularSeries(page)
}

function mergeUnique(existing: CatalogItem[], next: CatalogItem[]): CatalogItem[] {
  const seen = new Set(existing.map((i) => i.id))
  const out = [...existing]
  for (const item of next) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    out.push(item)
  }
  return out
}

function prefetchPosters(items: CatalogItem[]): void {
  for (const item of items.slice(0, 24)) {
    if (!item.posterUrl) continue
    const img = new Image()
    img.decoding = 'async'
    img.src = item.posterUrl
  }
}

function sentinelNeedsMore(
  root: Element | null,
  target: Element | null,
  rootMarginPx = 1400
): boolean {
  if (!root || !target) return false
  const rootRect = root.getBoundingClientRect()
  const targetRect = target.getBoundingClientRect()
  return targetRect.top <= rootRect.bottom + rootMarginPx
}

export function CatalogPage({ mediaType }: { mediaType: MediaType }): JSX.Element {
  const searchQuery = useAppStore((s) => s.searchQuery)
  const setSearchQuery = useAppStore((s) => s.setSearchQuery)
  const genreFilter = useAppStore((s) => s.genreFilter)
  const setGenreFilter = useAppStore((s) => s.setGenreFilter)
  const sortBy = useAppStore((s) => s.sortBy)
  const setSortBy = useAppStore((s) => s.setSortBy)

  const cacheKey = catalogCacheKey(mediaType, searchQuery, genreFilter)
  const cached = getCatalogCache(cacheKey)

  const [items, setItems] = useState<CatalogItem[]>(cached?.items ?? [])
  const [page, setPage] = useState(cached?.lastPage ?? 1)
  const [hasMore, setHasMore] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(!cached)
  const [loadingMore, setLoadingMore] = useState(false)
  const [correction, setCorrection] = useState<SearchCorrection>(null)

  const sentinelRef = useRef<HTMLDivElement>(null)
  const paneRef = useRef<Element | null>(null)
  const loadingMoreRef = useRef(false)
  const hasMoreRef = useRef(true)
  const pageRef = useRef(cached?.lastPage ?? 1)
  const itemsRef = useRef<CatalogItem[]>(cached?.items ?? [])
  const loadingRef = useRef(!cached)
  const skipAutocorrectRef = useRef(false)
  const pendingOriginalRef = useRef<string | null>(null)
  const autoCorrectingRef = useRef(false)

  useEffect(() => {
    hasMoreRef.current = hasMore
  }, [hasMore])
  useEffect(() => {
    pageRef.current = page
  }, [page])
  useEffect(() => {
    itemsRef.current = items
  }, [items])
  useEffect(() => {
    loadingRef.current = loading
  }, [loading])

  useEffect(() => {
    paneRef.current = document.querySelector('.main-pane')
  }, [])

  useEffect(() => {
    const pane = paneRef.current || document.querySelector('.main-pane')
    if (pane) pane.scrollTop = 0
  }, [mediaType, genreFilter])

  const loadMore = useCallback(async (): Promise<void> => {
    if (loadingMoreRef.current || !hasMoreRef.current || loadingRef.current) return
    loadingMoreRef.current = true
    setLoadingMore(true)
    const key = catalogCacheKey(mediaType, searchQuery, genreFilter)

    try {
      // One page per trigger — keeps scroll smooth; chain once after paint if still short
      let nextPage = pageRef.current + 1
      let appended = false

      for (let attempt = 0; attempt < 8; attempt++) {
        let list: CatalogItem[] = []
        try {
          list = await loadCatalogPage(mediaType, searchQuery, genreFilter, nextPage)
        } catch {
          break
        }

        if (!list.length) {
          if (attempt >= 2) {
            hasMoreRef.current = false
            setHasMore(false)
          } else {
            nextPage += 1
            continue
          }
          break
        }

        prefetchPosters(list)
        const prev = itemsRef.current
        const merged = mergeUnique(prev, list)
        if (merged.length > prev.length) {
          itemsRef.current = merged
          pageRef.current = nextPage
          setCatalogCache(key, merged, nextPage)
          startTransition(() => {
            setItems(merged)
            setPage(nextPage)
          })
          appended = true
          hasMoreRef.current = true
          setHasMore(true)
          void loadCatalogPage(mediaType, searchQuery, genreFilter, nextPage + 1).then((warm) => {
            if (warm.length) prefetchPosters(warm)
          })
          break
        }
        nextPage += 1
      }

      if (appended) {
        requestAnimationFrame(() => {
          if (
            hasMoreRef.current &&
            !loadingMoreRef.current &&
            sentinelNeedsMore(paneRef.current, sentinelRef.current)
          ) {
            void loadMore()
          }
        })
      }
    } finally {
      loadingMoreRef.current = false
      setLoadingMore(false)
    }
  }, [mediaType, searchQuery, genreFilter])

  useEffect(() => {
    let cancelled = false
    const key = catalogCacheKey(mediaType, searchQuery, genreFilter)
    const rawQuery = searchQuery.trim()
    const hit = getCatalogCache(key)

    const applySuggestionLogic = async (list: CatalogItem[]): Promise<void> => {
      if (!rawQuery) {
        pendingOriginalRef.current = null
        setCorrection(null)
        return
      }

      if (list.length > 0) {
        const original = pendingOriginalRef.current
        if (original && original.toLowerCase() !== rawQuery.toLowerCase()) {
          setCorrection({
            isAutoCorrected: true,
            displayedQuery: rawQuery,
            originalQuery: original
          })
          return
        }
        pendingOriginalRef.current = null
        // Soft "Did you mean" while showing current hits
        const suggestion = await getSpellingSuggestion(rawQuery)
        if (cancelled) return
        if (suggestion && suggestion.toLowerCase() !== rawQuery.toLowerCase()) {
          setCorrection({ isAutoCorrected: false, suggestion })
        } else {
          setCorrection(null)
        }
        return
      }

      // Zero results — try auto-correct unless user forced the raw query
      // or we already redirected once for this attempt.
      if (skipAutocorrectRef.current) {
        skipAutocorrectRef.current = false
        pendingOriginalRef.current = null
        setCorrection(null)
        return
      }

      if (pendingOriginalRef.current) {
        // Corrected term also empty — keep a way back to the original spelling
        setCorrection({
          isAutoCorrected: true,
          displayedQuery: rawQuery,
          originalQuery: pendingOriginalRef.current
        })
        return
      }

      const suggestion = await getSpellingSuggestion(rawQuery)
      if (cancelled) return
      if (suggestion && suggestion.toLowerCase() !== rawQuery.toLowerCase()) {
        pendingOriginalRef.current = rawQuery
        autoCorrectingRef.current = true
        setSearchQuery(suggestion)
        return
      }
      pendingOriginalRef.current = null
      setCorrection(null)
    }

    if (hit?.items.length) {
      setItems(hit.items)
      setPage(hit.lastPage)
      pageRef.current = hit.lastPage
      itemsRef.current = hit.items
      setHasMore(true)
      hasMoreRef.current = true
      setError(null)
      setLoading(false)
      loadingRef.current = false
      void applySuggestionLogic(hit.items)
      queueMicrotask(() => {
        if (!cancelled) void loadMore()
      })
      return () => {
        cancelled = true
      }
    }

    setItems([])
    setPage(1)
    pageRef.current = 1
    itemsRef.current = []
    setHasMore(true)
    hasMoreRef.current = true
    setError(null)
    setLoading(true)
    loadingRef.current = true
    if (!autoCorrectingRef.current && !pendingOriginalRef.current) {
      setCorrection(null)
    }
    autoCorrectingRef.current = false

    const run = async (): Promise<void> => {
      try {
        const list = await loadCatalogPage(mediaType, searchQuery, genreFilter, 1)
        if (cancelled) return
        setCatalogCache(key, list, 1)
        setItems(list)
        itemsRef.current = list
        setPage(1)
        pageRef.current = 1
        setHasMore(list.length > 0)
        hasMoreRef.current = list.length > 0
        prefetchPosters(list)
        await applySuggestionLogic(list)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load catalog')
      } finally {
        if (!cancelled) {
          setLoading(false)
          loadingRef.current = false
          void loadMore()
        }
      }
    }

    const delay = rawQuery ? 280 : 0
    const t = setTimeout(() => void run(), delay)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [mediaType, searchQuery, genreFilter, loadMore, setSearchQuery])

  const onSearchInputChange = (value: string): void => {
    pendingOriginalRef.current = null
    skipAutocorrectRef.current = false
    autoCorrectingRef.current = false
    setCorrection(null)
    setSearchQuery(value)
  }

  const onApplySuggestion = (suggestion: string): void => {
    pendingOriginalRef.current = null
    skipAutocorrectRef.current = false
    setCorrection(null)
    setSearchQuery(suggestion)
  }

  const onSearchOriginal = (original: string): void => {
    skipAutocorrectRef.current = true
    pendingOriginalRef.current = null
    autoCorrectingRef.current = false
    setCorrection(null)
    setSearchQuery(original)
  }

  useEffect(() => {
    const root = document.querySelector('.main-pane')
    const target = sentinelRef.current
    if (!root || !target) return
    paneRef.current = root

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore()
      },
      { root, rootMargin: '1200px 0px', threshold: 0 }
    )
    io.observe(target)
    return () => io.disconnect()
  }, [loadMore])

  const sorted = useMemo(() => {
    // Keep API order for popularity so newly fetched pages stay at the bottom
    if (sortBy === 'popularity') return items
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

  const browseFeaturedRef = useRef<CatalogItem | null>(null)

  const featured = useMemo(() => {
    if (searchQuery.trim()) return browseFeaturedRef.current
    // Prefer titles that actually have a landscape backdrop
    const next = sorted.find((i) => i.backdropUrl) || null
    browseFeaturedRef.current = next
    return next
  }, [sorted, searchQuery])

  const genres = genresFor(mediaType)
  const title = mediaType === 'movie' ? 'Movies' : mediaType === 'series' ? 'Series' : 'Anime'
  const isSearching = searchQuery.trim().length > 0

  const clearSearch = (): void => {
    onSearchInputChange('')
  }

  return (
    <div className={`catalog-page${isSearching ? ' is-searching' : ''}`}>
      <AnimatePresence initial={false}>
        {!isSearching && featured && (
          <motion.div
            key="catalog-hero"
            className="catalog-browse-hero"
            initial={{ opacity: 0, height: 0 }}
            animate={{
              opacity: 1,
              height: 'auto',
              transition: { duration: 0.35, ease: 'easeInOut' }
            }}
            exit={{
              opacity: 0,
              height: 0,
              marginBottom: 0,
              transition: { duration: 0.3, ease: 'easeInOut' }
            }}
            style={{ overflow: 'hidden' }}
          >
            <CatalogHero item={featured} />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="catalog-body">
        <AnimatePresence initial={false}>
          {!isSearching && (
            <motion.div
              key="catalog-shelves"
              className="catalog-browse-shelves"
              initial={{ opacity: 0, height: 0 }}
              animate={{
                opacity: 1,
                height: 'auto',
                transition: { duration: 0.35, ease: 'easeInOut' }
              }}
              exit={{
                opacity: 0,
                height: 0,
                marginBottom: 0,
                transition: { duration: 0.3, ease: 'easeInOut' }
              }}
              style={{ overflow: 'hidden' }}
            >
              <ContinueWatchingRow mediaType={mediaType} />
              <WatchLaterShelf mediaType={mediaType === 'series' ? 'tv' : mediaType} />
            </motion.div>
          )}
        </AnimatePresence>

        <motion.div
          layout
          className="catalog-toolbar"
          transition={{ duration: 0.3, ease: 'easeOut' }}
        >
          <div className="catalog-heading">
            <h1 className="catalog-section-title">{isSearching ? `Search · ${title}` : title}</h1>
          </div>
          <div className="catalog-tools">
            <motion.label
              layout
              className={`catalog-search-wrap${isSearching ? ' is-searching' : ''}`}
              transition={{ duration: 0.3, ease: 'easeOut' }}
            >
              <span className="catalog-search-icon" aria-hidden>
                <Search size={16} strokeWidth={2} />
              </span>
              <input
                className="catalog-search"
                placeholder={`Search ${title.toLowerCase()}…`}
                value={searchQuery}
                onChange={(e) => onSearchInputChange(e.target.value)}
                aria-label={`Search ${title.toLowerCase()}`}
              />
              <AnimatePresence initial={false}>
                {isSearching && (
                  <motion.button
                    key="search-clear"
                    type="button"
                    className="catalog-search-clear"
                    title="Clear search"
                    aria-label="Clear search"
                    initial={{ opacity: 0, scale: 0.85 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.85 }}
                    transition={{ duration: 0.18 }}
                    onClick={clearSearch}
                  >
                    <X size={14} strokeWidth={2.5} />
                  </motion.button>
                )}
              </AnimatePresence>
            </motion.label>
            <ThemedSelect
              variant="catalog"
              className="catalog-sort-select"
              aria-label="Sort catalog"
              value={sortBy}
              onChange={(v) => setSortBy(v as typeof sortBy)}
              menuMinWidth={152}
              options={[
                { value: 'popularity', label: 'Popularity' },
                { value: 'rating', label: 'Rating' },
                { value: 'date', label: 'Release date' },
                { value: 'title', label: 'Title' }
              ]}
            />
          </div>
        </motion.div>

        <GenreChips aria-label="Genres">
          <button
            type="button"
            role="tab"
            aria-selected={genreFilter === 'all'}
            className={`genre-chip${genreFilter === 'all' ? ' active' : ''}`}
            onClick={() => setGenreFilter('all')}
          >
            All
          </button>
          {genres.map((g) => (
            <button
              key={g}
              type="button"
              role="tab"
              aria-selected={genreFilter === g}
              className={`genre-chip${genreFilter === g ? ' active' : ''}`}
              onClick={() => setGenreFilter(g)}
            >
              {g}
            </button>
          ))}
        </GenreChips>

        <SearchCorrectionNotice
          correction={correction}
          onApplySuggestion={onApplySuggestion}
          onSearchOriginal={onSearchOriginal}
        />

        {loading && <div className="muted">Loading catalog…</div>}
        {error && (
          <div className="card-block" style={{ color: 'var(--danger)' }}>
            {error}
          </div>
        )}
        {!loading && !error && sorted.length === 0 && (
          <div className="empty">No titles found. Try another search or genre.</div>
        )}

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={isSearching ? 'search-results' : 'catalog-browse-grid'}
            className="poster-grid"
            variants={gridVariants}
            initial="hidden"
            animate="visible"
            exit={{
              opacity: 0,
              y: 10,
              transition: { duration: 0.22, ease: EASE_OUT_EXPO }
            }}
            transition={{ duration: 0.3, ease: EASE_OUT_EXPO }}
          >
            {sorted.map((item) => (
              <motion.div key={item.id} className="poster-grid-item" variants={cardVariants}>
                <PosterCard item={item} />
              </motion.div>
            ))}
          </motion.div>
        </AnimatePresence>
        <div ref={sentinelRef} data-catalog-sentinel style={{ height: 1 }} aria-hidden />
        {loadingMore && (
          <div className="muted" style={{ padding: '16px 0' }}>
            Loading more…
          </div>
        )}
      </div>
    </div>
  )
}
