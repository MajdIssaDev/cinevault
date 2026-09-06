import { useEffect, useMemo, useRef, useState } from 'react'
import { Clapperboard, ChevronLeft, ChevronRight, Clock, Heart, Info, Play, Search, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { FocusEvent } from 'react'
import type { CatalogItem, Quality } from '../types'
import { useAppStore } from '../store'
import { resolveTmdbApiKey } from '../api/tmdb'
import {
  FEATURED_SLIDE_MS,
  buildFeaturedDeck,
  pickFeaturedCandidates,
  type FeaturedSlide
} from '../lib/featuredDeck'
import { resolveHeroBackdropUrl } from '../lib/heroImage'
import { detailPathForItem } from '../lib/detailPath'
import { openTrailerSearch, resolveTrailerForItem } from '../lib/trailer'
import { TrailerModal } from './TrailerModal'
import type { TrailerInfo } from '../api/tmdb'
import { useWatchLater } from '../hooks/useWatchLater'
import { catalogToWatchLaterItem } from '../services/watchLaterService'
import { Tooltip } from './ui/Tooltip'
import { HeroProgressBars } from './HeroProgressBars'

type LocalMatch = {
  id: string
  path: string
  name: string
  qualityGuess: string
}

function FeaturedSlideView({
  slide,
  active
}: {
  slide: FeaturedSlide
  active: boolean
}): JSX.Element {
  const navigate = useNavigate()
  const setSession = useAppStore((s) => s.setSession)
  const qualityPref = useAppStore((s) => s.qualityPref)
  const settings = useAppStore((s) => s.settings)
  const toggleFavorite = useAppStore((s) => s.toggleFavorite)
  const item = slide.item
  const fav = useAppStore((s) =>
    s.favorites.some((f) => f.mediaType === item.mediaType && f.externalId === item.externalId)
  )
  const { isSaved, toggle: toggleWatchLater } = useWatchLater()
  const inWatchLater = isSaved(item.id)
  const [localMatch, setLocalMatch] = useState<LocalMatch | null>(null)
  const [checkingLocal, setCheckingLocal] = useState(true)
  const [trailer, setTrailer] = useState<TrailerInfo | null>(null)
  const [trailerBusy, setTrailerBusy] = useState(false)
  const [playState, setPlayState] = useState<'idle' | 'connecting'>('idle')
  const playAbortRef = useRef(false)

  useEffect(() => {
    if (!active) return
    let cancelled = false
    setCheckingLocal(true)
    setLocalMatch(null)
    void window.cinevault?.library
      .matchTitle(item.title)
      .then((matches) => {
        if (cancelled) return
        const best = matches[0] || null
        setLocalMatch(
          best
            ? { id: best.id, path: best.path, name: best.name, qualityGuess: best.qualityGuess }
            : null
        )
      })
      .catch(() => {
        if (!cancelled) setLocalMatch(null)
      })
      .finally(() => {
        if (!cancelled) setCheckingLocal(false)
      })
    return () => {
      cancelled = true
    }
  }, [active, item.id, item.title])

  const detailPath = detailPathForItem(item)
  const rating = slide.rating > 0 ? slide.rating.toFixed(1) : null

  const playLocal = async (): Promise<void> => {
    if (!localMatch || !window.cinevault) return
    if (playState !== 'idle') {
      playAbortRef.current = true
      setPlayState('idle')
      return
    }
    playAbortRef.current = false
    setPlayState('connecting')
    try {
      const url = await window.cinevault.download.toFileUrl(localMatch.path)
      if (playAbortRef.current) return
      const q = (
        ['720p', '1080p', '1440p', '2160p'].includes(localMatch.qualityGuess)
          ? localMatch.qualityGuess
          : qualityPref
      ) as Quality
      setSession({
        cacheId: `lib-${localMatch.id}`,
        title: item.title,
        mediaType: item.mediaType,
        externalId: item.externalId,
        source: {
          id: localMatch.id,
          label: localMatch.name,
          quality: q,
          url,
          kind: 'local',
          hdr: /hdr|dv|dolby.?vision/i.test(localMatch.name),
          spatialAudio: /atmos|truehd|dts.?x/i.test(localMatch.name)
        },
        resolution: q === 'unknown' ? qualityPref : q
      })
    } catch {
      /* keep idle */
    } finally {
      if (!playAbortRef.current) setPlayState('idle')
    }
  }

  const openTrailer = async (): Promise<void> => {
    setTrailerBusy(true)
    try {
      const { trailer: resolved } = await resolveTrailerForItem(item, {
        tmdbApiKey: resolveTmdbApiKey(settings?.tmdbApiKey)
      })
      if (resolved) setTrailer(resolved)
      else await openTrailerSearch(item.title)
    } catch {
      await openTrailerSearch(item.title)
    } finally {
      setTrailerBusy(false)
    }
  }

  return (
    <div
      className={`catalog-hero-slide${active ? ' is-active' : ''}`}
      aria-hidden={!active}
    >
      <div className="catalog-hero-media" aria-hidden>
        <img
          className="catalog-hero-bg"
          src={slide.backdropUrl}
          alt=""
          decoding="async"
          loading={active ? 'eager' : 'lazy'}
          fetchPriority={active ? 'high' : 'low'}
          draggable={false}
        />
      </div>
      <div className="catalog-hero-scrim catalog-hero-scrim-x" aria-hidden />
      <div className="catalog-hero-fade-bottom" aria-hidden />
      <div className="catalog-hero-fade-top" aria-hidden />

      <div className="catalog-hero-content">
        <p className="catalog-hero-kicker">FEATURED</p>
        <div className="catalog-hero-title-slot">
          {slide.logoUrl ? (
            <img
              className="catalog-hero-logo is-ready"
              src={slide.logoUrl}
              alt={slide.title}
              decoding="async"
              loading="eager"
              draggable={false}
            />
          ) : (
            <h1 className="catalog-hero-title">{slide.title}</h1>
          )}
        </div>
        <div className="catalog-hero-meta">
          {slide.year ? <span className="catalog-hero-year">{slide.year}</span> : null}
          {rating ? (
            <span className="catalog-hero-score">
              <span className="catalog-hero-star" aria-hidden>
                ★
              </span>
              {rating}
            </span>
          ) : null}
          {slide.genres.map((g) => (
            <span key={g} className="catalog-hero-tag">
              {g}
            </span>
          ))}
        </div>
        {slide.overview ? <p className="catalog-hero-overview">{slide.overview}</p> : null}
        <div className="catalog-hero-actions">
          {localMatch ? (
            <Tooltip
              content={playState === 'connecting' ? 'Press to abort' : 'Play from library'}
              side="top"
            >
              <button
                className={`catalog-btn primary${playState === 'connecting' ? ' busy' : ''}`}
                type="button"
                tabIndex={active ? 0 : -1}
                aria-busy={playState === 'connecting'}
                onClick={() => void playLocal()}
              >
                {playState === 'connecting' ? (
                  <>
                    <span className="catalog-btn-spinner" aria-hidden />
                    Connecting…
                    <X size={14} strokeWidth={2.5} />
                  </>
                ) : (
                  <>
                    <Play size={14} fill="currentColor" strokeWidth={0} />
                    Play
                  </>
                )}
              </button>
            </Tooltip>
          ) : (
            <Tooltip content="Find & Stream" side="top">
              <button
                className="catalog-btn primary"
                type="button"
                tabIndex={active ? 0 : -1}
                disabled={checkingLocal}
                onClick={() => navigate(detailPath)}
              >
                <Search size={14} strokeWidth={2} />
                {checkingLocal ? 'Checking…' : 'Find Streams'}
              </button>
            </Tooltip>
          )}
          <Tooltip content="Play Trailer" side="top">
            <button
              className="catalog-btn glass"
              type="button"
              tabIndex={active ? 0 : -1}
              disabled={trailerBusy}
              onClick={() => void openTrailer()}
            >
              <Clapperboard size={14} strokeWidth={1.75} />
              {trailerBusy ? 'Loading…' : 'Watch Trailer'}
            </button>
          </Tooltip>
          <Tooltip
            content={inWatchLater ? 'Remove from Watch Later' : 'Bookmark for Later'}
            side="top"
          >
            <button
              className={`catalog-btn glass catalog-btn-watch-later${inWatchLater ? ' watch-later-on' : ''}`}
              type="button"
              tabIndex={active ? 0 : -1}
              aria-pressed={inWatchLater}
              onClick={() => toggleWatchLater(catalogToWatchLaterItem(item))}
            >
              <Clock size={14} strokeWidth={1.75} />
              {inWatchLater ? 'In Watch Later' : 'Watch Later'}
            </button>
          </Tooltip>
          <Tooltip content={fav ? 'Remove from favorites' : 'Add to Favorites'} side="top">
            <button
              className={`catalog-btn icon-squircle catalog-btn-fav${fav ? ' on' : ''}`}
              type="button"
              tabIndex={active ? 0 : -1}
              aria-label={fav ? 'Remove from favorites' : 'Add to Favorites'}
              aria-pressed={fav}
              onClick={() =>
                toggleFavorite({
                  id: item.id,
                  mediaType: item.mediaType,
                  externalId: item.externalId,
                  title: item.title,
                  posterUrl: item.posterUrl,
                  releaseDate: item.releaseDate
                })
              }
            >
              {fav ? (
                <Heart size={16} fill="currentColor" strokeWidth={0} />
              ) : (
                <Heart size={16} strokeWidth={1.75} />
              )}
            </button>
          </Tooltip>
          <Tooltip content="View Details & Cast" side="top">
            <button
              className="catalog-btn icon-squircle"
              type="button"
              tabIndex={active ? 0 : -1}
              aria-label="View Details"
              onClick={() => navigate(detailPath)}
            >
              <Info size={16} strokeWidth={1.75} />
            </button>
          </Tooltip>
        </div>
      </div>

      {active && trailer ? <TrailerModal trailer={trailer} onClose={() => setTrailer(null)} /> : null}
    </div>
  )
}

function draftSlides(items: CatalogItem[]): FeaturedSlide[] {
  return pickFeaturedCandidates(items).map((item) => ({
    id: item.id,
    item,
    title: item.title,
    overview: item.overview?.replace(/\.{2,}$/, '').trim() || '',
    year: item.releaseDate?.slice(0, 4) || '',
    rating: item.rating > 0 ? item.rating : 0,
    genres: item.genres.slice(0, 3),
    backdropUrl: resolveHeroBackdropUrl(item.backdropUrl) || item.backdropUrl || '',
    logoUrl: item.titleLogoUrl || null
  }))
}

export function FeaturedHero({ items }: { items: CatalogItem[] }): JSX.Element | null {
  const settings = useAppStore((s) => s.settings)
  const deckKey = useMemo(() => items.map((i) => i.id).join('|'), [items])
  const [slides, setSlides] = useState<FeaturedSlide[]>(() => draftSlides(items))
  const [activeIndex, setActiveIndex] = useState(0)
  const [cycleKey, setCycleKey] = useState(0)
  const [paused, setPaused] = useState(false)
  const rootRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    let cancelled = false
    setSlides(draftSlides(items))
    setActiveIndex(0)
    setCycleKey((k) => k + 1)
    void buildFeaturedDeck(items, settings?.tmdbApiKey).then((deck) => {
      if (!cancelled && deck.length) setSlides(deck)
    })
    return () => {
      cancelled = true
    }
    // items identity tracked via deckKey
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckKey, settings?.tmdbApiKey])

  const selectSlide = (index: number): void => {
    setActiveIndex(index)
    setCycleKey((k) => k + 1)
  }

  const advance = (): void => {
    if (slides.length < 2) return
    setActiveIndex((i) => (i + 1) % slides.length)
    setCycleKey((k) => k + 1)
  }

  const goPrev = (): void => {
    if (slides.length < 2) return
    setActiveIndex((i) => (i - 1 + slides.length) % slides.length)
    setCycleKey((k) => k + 1)
  }

  const goNext = (): void => {
    advance()
  }

  const onFocusCapture = (): void => setPaused(true)
  const onBlurCapture = (e: FocusEvent<HTMLElement>): void => {
    const next = e.relatedTarget as Node | null
    if (next && rootRef.current?.contains(next)) return
    setPaused(false)
  }

  if (!slides.length) return null

  const active = slides[activeIndex] || slides[0]
  const canNavigate = slides.length > 1

  return (
    <section
      ref={rootRef}
      className={`catalog-hero catalog-hero-rotator${paused ? ' is-paused' : ''}`}
      aria-roledescription="carousel"
      aria-label={`Featured: ${active.title}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={onFocusCapture}
      onBlurCapture={onBlurCapture}
    >
      {slides.map((slide, index) => (
        <FeaturedSlideView key={slide.id} slide={slide} active={index === activeIndex} />
      ))}
      {canNavigate ? (
        <>
          <button
            type="button"
            className="catalog-hero-nav catalog-hero-nav-prev"
            aria-label="Previous featured"
            onClick={goPrev}
          >
            <ChevronLeft size={22} strokeWidth={2} />
          </button>
          <button
            type="button"
            className="catalog-hero-nav catalog-hero-nav-next"
            aria-label="Next featured"
            onClick={goNext}
          >
            <ChevronRight size={22} strokeWidth={2} />
          </button>
        </>
      ) : null}
      <HeroProgressBars
        count={slides.length}
        activeIndex={activeIndex}
        paused={paused}
        cycleKey={cycleKey}
        durationMs={FEATURED_SLIDE_MS}
        onSelect={selectSlide}
        onActiveComplete={advance}
      />
    </section>
  )
}

/** @deprecated Prefer FeaturedHero with a deck — kept for single-item call sites. */
export function CatalogHero({ item }: { item: CatalogItem }): JSX.Element | null {
  return <FeaturedHero items={[item]} />
}
