import { startTransition, useCallback, useEffect, useMemo, useRef, useState, memo } from 'react'
import { Search, X } from 'lucide-react'
import type { CatalogItem, MediaType } from '../types'
import { useAppStore } from '../store'
import { PosterCard } from '../components/PosterCard'
import { FeaturedHero } from '../components/FeaturedHero'
import { ContinueWatchingRow } from '../components/ContinueWatchingRow'
import { ForYouShelf } from '../components/ForYouShelf'
import { WatchLaterShelf } from '../components/WatchLaterShelf'
import { GenreChips } from '../components/GenreChips'
import { ThemedSelect } from '../components/ThemedSelect'
import { Tooltip } from '../components/ui/Tooltip'
import {
  SearchCorrectionNotice,
  type SearchCorrection
} from '../components/SearchCorrectionNotice'
import { getSpellingSuggestion } from '../services/searchSuggestionService'
import { buildSearchQuery, searchCatalog } from '../services/searchService'
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
import { resolveTmdbApiKey } from '../api/tmdb'
import { catalogCacheKey, getCatalogCache, setCatalogCache } from '../lib/catalogCache'
import { pickFeaturedCandidates } from '../lib/featuredDeck'
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

function genresFor(mediaType: MediaType): string[] {
  if (mediaType === 'movie') return YTS_GENRES
  if (mediaType === 'series') return TVMAZE_GENRES
  return ANIME_GENRES
}

async function loadCatalogPage(
  mediaType: MediaType,
  searchQuery: string,
  genreFilter: string,
  page: number,
  tmdbApiKey?: string | null
): Promise<CatalogItem[]> {
  const q = buildSearchQuery(searchQuery)
  if (q) {
    // Text search: TMDB multi relevance order — never year-param hijack or client re-sort.
    try {
      const tmdbHits = await searchCatalog(tmdbApiKey, q, mediaType, page)
      if (tmdbHits.length) return tmdbHits
    } catch {
      /* fall through to provider search */
    }
    if (mediaType === 'anime') return searchAnime(q, page)
    if (mediaType === 'movie') return searchMovies(q, page)
    return searchSeries(q, page)
  }
  if (mediaType === 'anime') {
    if (genreFilter !== 'all') return fetchAnimeByGenre(genreFilter, page)
    return fetchPopularAnime(page)
  }
  if (mediaType === 'movie') {
    if (genreFilter !== 'all') return fetchMoviesByGenre(genreFilter, page)
    return fetchNewAndPopularMovies(page)
  }
  if (genreFilter !== 'all') return fetchSeriesByGenre(genreFilter, page)
  return fetchNewAndPopularSeries(page)
}

function presentCatalogItems(
  list: CatalogItem[],
  sortBy: CatalogSort,
  isSearch: boolean
): CatalogItem[] {
  // Preserve TMDB / provider search relevance — do not bury matches under rating/date sorts.
  if (isSearch) return list
  return sortCatalogItems(list, sortBy)
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

type CatalogSort = 'popularity' | 'rating' | 'date' | 'title'

function sortCatalogItems(list: CatalogItem[], mode: CatalogSort): CatalogItem[] {
  if (mode === 'popularity' || list.length <= 1) return list
  const copy = [...list]
  switch (mode) {
    case 'rating':
      return copy.sort((a, b) => b.rating - a.rating)
    case 'date':
      return copy.sort((a, b) => (b.releaseDate || '').localeCompare(a.releaseDate || ''))
    case 'title':
      return copy.sort((a, b) => a.title.localeCompare(b.title))
    default:
      return copy
  }
}

/** Append only — never reorders existing rows (avoids grid reshuffle on infinite scroll). */
function appendDisplayItems(prev: CatalogItem[], merged: CatalogItem[]): CatalogItem[] {
  const seen = new Set(prev.map((i) => i.id))
  const added = merged.filter((i) => !seen.has(i.id))
  return added.length ? [...prev, ...added] : prev
}

function prefetchPosters(items: CatalogItem[]): void {
  // Small, idle-friendly warm — avoid decoding a full page that is also mounting in the DOM
  const warm = items.slice(0, 8)
  const run = (): void => {
    for (const item of warm) {
      if (!item.posterUrl) continue
      const img = new Image()
      img.decoding = 'async'
      img.src = item.posterUrl
    }
  }
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(() => run(), { timeout: 1200 })
  } else {
    window.setTimeout(run, 120)
  }
}

const SIBLING_TYPES: MediaType[] = ['movie', 'series', 'anime']

/** Warm page-1 of other tabs into the in-memory catalog cache (no React mount). */
function warmSiblingCatalogCaches(
  current: MediaType,
  searchQuery: string,
  genreFilter: string,
  tmdbApiKey?: string | null
): void {
  const run = (): void => {
    for (const type of SIBLING_TYPES) {
      if (type === current) continue
      const key = catalogCacheKey(type, searchQuery, genreFilter)
      if (getCatalogCache(key)?.items.length) continue
      void loadCatalogPage(type, searchQuery, genreFilter, 1, tmdbApiKey)
        .then((list) => {
          if (list.length) setCatalogCache(key, list, 1)
        })
        .catch(() => {})
    }
  }
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(() => run(), { timeout: 2500 })
  } else {
    window.setTimeout(run, 600)
  }
}

function sentinelNeedsMore(
  root: Element | null,
  target: Element | null,
  rootMarginPx = 600
): boolean {
  if (!root || !target) return false
  const rootRect = root.getBoundingClientRect()
  const targetRect = target.getBoundingClientRect()
  return targetRect.top <= rootRect.bottom + rootMarginPx
}

/** Isolated so loadingMore / correction updates do not re-render every poster. */
const CatalogPosterGrid = memo(function CatalogPosterGrid({
  items
}: {
  items: CatalogItem[]
}): JSX.Element {
  return (
    <div className="poster-grid">
      {items.map((item) => (
        <div key={item.id} className="poster-grid-item">
          <PosterCard item={item} />
        </div>
      ))}
    </div>
  )
})

export function CatalogPage({
  mediaType,
  active = true
}: {
  mediaType: MediaType
  /** False while another catalog tab is showing — pause IO / background growth. */
  active?: boolean
}): JSX.Element {
  const searchQuery = useAppStore((s) => s.searchQuery)
  const setSearchQuery = useAppStore((s) => s.setSearchQuery)
  const genreFilter = useAppStore((s) => s.genreFilter)
  const setGenreFilter = useAppStore((s) => s.setGenreFilter)
  const sortBy = useAppStore((s) => s.sortBy)
  const setSortBy = useAppStore((s) => s.setSortBy)
  const tmdbApiKey = useAppStore((s) => s.settings?.tmdbApiKey)

  const cacheKey = catalogCacheKey(mediaType, searchQuery, genreFilter)
  const cached = getCatalogCache(cacheKey)
  const isSearchQuery = buildSearchQuery(searchQuery).length > 0

  const [items, setItems] = useState<CatalogItem[]>(cached?.items ?? [])
  const [displayItems, setDisplayItems] = useState<CatalogItem[]>(() => {
    const mode = (useAppStore.getState().sortBy || 'popularity') as CatalogSort
    const q = buildSearchQuery(useAppStore.getState().searchQuery || '')
    return presentCatalogItems(cached?.items ?? [], mode, q.length > 0)
  })
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

  const activeRef = useRef(active)
  useEffect(() => {
    activeRef.current = active
  }, [active])

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
  }, [genreFilter])

  const scrollTopByTabRef = useRef(0)
  useEffect(() => {
    const pane = (paneRef.current || document.querySelector('.main-pane')) as HTMLElement | null
    if (!pane) return
    if (!active) {
      scrollTopByTabRef.current = pane.scrollTop
      return
    }
    pane.scrollTop = scrollTopByTabRef.current
  }, [active])

  const loadMore = useCallback(async (): Promise<void> => {
    if (!activeRef.current) return
    if (loadingMoreRef.current || !hasMoreRef.current || loadingRef.current) return
    loadingMoreRef.current = true
    // Only show spinner if the fetch is slow — avoids a full catalog paint on fast pages
    const spinnerTimer = window.setTimeout(() => setLoadingMore(true), 220)
    const key = catalogCacheKey(mediaType, searchQuery, genreFilter)
    const apiKey = resolveTmdbApiKey(useAppStore.getState().settings?.tmdbApiKey)

    try {
      // One page per trigger — keeps scroll smooth; chain once after paint if still short
      let nextPage = pageRef.current + 1
      let appended = false

      for (let attempt = 0; attempt < 8; attempt++) {
        let list: CatalogItem[] = []
        try {
          list = await loadCatalogPage(mediaType, searchQuery, genreFilter, nextPage, apiKey)
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

        const prev = itemsRef.current
        const merged = mergeUnique(prev, list)
        if (merged.length > prev.length) {
          itemsRef.current = merged
          pageRef.current = nextPage
          setCatalogCache(key, merged, nextPage)
          // Low-priority append; append-only display order (no re-sort on fetch).
          startTransition(() => {
            setItems(merged)
            setDisplayItems((prevDisplay) => appendDisplayItems(prevDisplay, merged))
            setPage(nextPage)
          })
          appended = true
          if (!hasMoreRef.current) {
            hasMoreRef.current = true
            setHasMore(true)
          } else {
            hasMoreRef.current = true
          }
          // Prefetch next page quietly — do not decode the page we just mounted (DOM will)
          void loadCatalogPage(mediaType, searchQuery, genreFilter, nextPage + 1, apiKey).then((warm) => {
            if (warm.length) prefetchPosters(warm.slice(0, 8))
          })
          break
        }
        nextPage += 1
      }

      if (appended) {
        // Cooldown so scroll + decode can settle before another page mounts
        window.setTimeout(() => {
          if (
            activeRef.current &&
            hasMoreRef.current &&
            !loadingMoreRef.current &&
            sentinelNeedsMore(paneRef.current, sentinelRef.current, 280)
          ) {
            void loadMore()
          }
        }, 700)
      }
    } finally {
      window.clearTimeout(spinnerTimer)
      loadingMoreRef.current = false
      setLoadingMore(false)
    }
  }, [mediaType, searchQuery, genreFilter])

  useEffect(() => {
    let cancelled = false
    const key = catalogCacheKey(mediaType, searchQuery, genreFilter)
    const rawQuery = buildSearchQuery(searchQuery)
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
      setDisplayItems(presentCatalogItems(hit.items, sortBy as CatalogSort, Boolean(rawQuery)))
      setPage(hit.lastPage)
      pageRef.current = hit.lastPage
      itemsRef.current = hit.items
      setHasMore(true)
      hasMoreRef.current = true
      setError(null)
      setLoading(false)
      loadingRef.current = false
      void applySuggestionLogic(hit.items)
      warmSiblingCatalogCaches(mediaType, searchQuery, genreFilter, tmdbApiKey)
      queueMicrotask(() => {
        if (!cancelled && activeRef.current) void loadMore()
      })
      return () => {
        cancelled = true
      }
    }

    setItems([])
    setDisplayItems([])
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
        const list = await loadCatalogPage(mediaType, searchQuery, genreFilter, 1, tmdbApiKey)
        if (cancelled) return
        setCatalogCache(key, list, 1)
        setItems(list)
        setDisplayItems(presentCatalogItems(list, sortBy as CatalogSort, Boolean(rawQuery)))
        itemsRef.current = list
        setPage(1)
        pageRef.current = 1
        setHasMore(list.length > 0)
        hasMoreRef.current = list.length > 0
        prefetchPosters(list)
        warmSiblingCatalogCaches(mediaType, searchQuery, genreFilter, tmdbApiKey)
        await applySuggestionLogic(list)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load catalog')
      } finally {
        if (!cancelled) {
          setLoading(false)
          loadingRef.current = false
          if (activeRef.current) void loadMore()
        }
      }
    }

    const delay = rawQuery ? 280 : 0
    const t = setTimeout(() => void run(), delay)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [mediaType, searchQuery, genreFilter, loadMore, setSearchQuery, tmdbApiKey])

  // Browse-only: apply catalog sort when the user changes it. Search keeps relevance order.
  useEffect(() => {
    if (buildSearchQuery(searchQuery)) return
    setDisplayItems(sortCatalogItems(itemsRef.current, sortBy as CatalogSort))
  }, [sortBy, searchQuery])

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
    if (!active) return
    const root = document.querySelector('.main-pane')
    const target = sentinelRef.current
    if (!root || !target) return
    paneRef.current = root

    const io = new IntersectionObserver(
      (entries) => {
        if (!activeRef.current) return
        if (entries.some((e) => e.isIntersecting)) void loadMore()
      },
      // Smaller margin: fetch nearer the end so the mount hitch isn't mid-scroll
      { root, rootMargin: '280px 0px', threshold: 0 }
    )
    io.observe(target)
    return () => io.disconnect()
  }, [loadMore, active])

  const onSortChange = (value: string): void => {
    const mode = value as CatalogSort
    setSortBy(mode)
    // Never reshuffle active text-search results (TMDB relevance order).
    if (buildSearchQuery(searchQuery)) return
    setDisplayItems(sortCatalogItems(itemsRef.current, mode))
  }

  const browseFeaturedRef = useRef<CatalogItem[]>([])

  const featuredDeck = useMemo(() => {
    if (searchQuery.trim()) return browseFeaturedRef.current
    const next = pickFeaturedCandidates(displayItems)
    if (next.length) browseFeaturedRef.current = next
    return next
  }, [displayItems, searchQuery])

  const genres = genresFor(mediaType)
  const title = mediaType === 'movie' ? 'Movies' : mediaType === 'series' ? 'Series' : 'Anime'
  const isSearching = isSearchQuery

  const clearSearch = (): void => {
    onSearchInputChange('')
  }

  return (
    <div className={`catalog-page${isSearching ? ' is-searching' : ''}`}>
      {!isSearching && featuredDeck.length > 0 ? (
        <div className="catalog-browse-hero">
          <FeaturedHero items={featuredDeck} />
        </div>
      ) : null}

      <div className="catalog-body">
        {!isSearching ? (
          <div className="catalog-browse-shelves">
            <ContinueWatchingRow mediaType={mediaType} />
            <ForYouShelf mediaType={mediaType} />
            <WatchLaterShelf mediaType={mediaType === 'series' ? 'tv' : mediaType} />
          </div>
        ) : null}

        <div className="catalog-toolbar">
          <div className="catalog-heading">
            <h1 className="catalog-section-title">{isSearching ? `Search · ${title}` : title}</h1>
          </div>
          <div className="catalog-tools">
            <label
              className={`catalog-search-wrap${isSearching ? ' is-searching' : ''}`}
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
              {isSearching ? (
                <Tooltip content="Clear search">
                  <button
                    type="button"
                    className="catalog-search-clear"
                    aria-label="Clear search"
                    onClick={clearSearch}
                  >
                    <X size={14} strokeWidth={2.5} />
                  </button>
                </Tooltip>
              ) : null}
            </label>
            <ThemedSelect
              variant="catalog"
              className="catalog-sort-select"
              aria-label="Sort catalog"
              value={sortBy}
              onChange={onSortChange}
              menuMinWidth={152}
              options={[
                { value: 'popularity', label: 'Popularity' },
                { value: 'rating', label: 'Rating' },
                { value: 'date', label: 'Release date' },
                { value: 'title', label: 'Title' }
              ]}
            />
          </div>
        </div>

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
        {!loading && !error && displayItems.length === 0 && (
          <div className="empty">No titles found. Try another search or genre.</div>
        )}

        <CatalogPosterGrid items={displayItems} />
        <div ref={sentinelRef} data-catalog-sentinel className="catalog-load-sentinel">
          {loadingMore ? <div className="catalog-load-spinner" aria-label="Loading more" /> : null}
        </div>
      </div>
    </div>
  )
}
