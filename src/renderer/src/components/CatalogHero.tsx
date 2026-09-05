import { useEffect, useState } from 'react'
import { Clapperboard, Clock, Heart, Info, Play, Search } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { CatalogItem, Quality } from '../types'
import { useAppStore } from '../store'
import { fetchMovieDetails } from '../api/ytsCatalog'
import { fetchTitleLogoUrl } from '../api/tmdb'
import { pickSharpHeroUrl, resolveHeroBackdropUrl } from '../lib/heroImage'
import { openTrailerSearch, resolveTrailerForItem } from '../lib/trailer'
import type { TrailerInfo } from '../api/tmdb'
import { TrailerModal } from './TrailerModal'
import { useWatchLater } from '../hooks/useWatchLater'
import { catalogToWatchLaterItem } from '../services/watchLaterService'

type LocalMatch = {
  id: string
  path: string
  name: string
  qualityGuess: string
}

export function CatalogHero({ item }: { item: CatalogItem }): JSX.Element {
  const navigate = useNavigate()
  const setSession = useAppStore((s) => s.setSession)
  const qualityPref = useAppStore((s) => s.qualityPref)
  const settings = useAppStore((s) => s.settings)
  const toggleFavorite = useAppStore((s) => s.toggleFavorite)
  const fav = useAppStore((s) =>
    s.favorites.some((f) => f.mediaType === item.mediaType && f.externalId === item.externalId)
  )
  const { isSaved, toggle: toggleWatchLater } = useWatchLater()
  const inWatchLater = isSaved(item.id)
  const [localMatch, setLocalMatch] = useState<LocalMatch | null>(null)
  const [checkingLocal, setCheckingLocal] = useState(true)
  const [backdrop, setBackdrop] = useState<string | null>(() =>
    resolveHeroBackdropUrl(item.backdropUrl)
  )
  const [youtubeId, setYoutubeId] = useState<string | null>(null)
  const [titleLogo, setTitleLogo] = useState<string | null>(null)
  const [trailer, setTrailer] = useState<TrailerInfo | null>(null)
  const [trailerBusy, setTrailerBusy] = useState(false)
  const [imdbId, setImdbId] = useState<string | null>(item.imdbId || null)

  useEffect(() => {
    setBackdrop(resolveHeroBackdropUrl(item.backdropUrl))
    setYoutubeId(null)
    setTitleLogo(null)
    setImdbId(item.imdbId || null)
    if (item.mediaType !== 'movie') return
    let cancelled = false
    void fetchMovieDetails(item.externalId)
      .then(({ item: full, extras }) => {
        if (cancelled) return
        setBackdrop(pickSharpHeroUrl(full.backdropUrl || item.backdropUrl, extras.stills))
        if (extras.trailerYoutubeId) setYoutubeId(extras.trailerYoutubeId)
        if (full.imdbId) setImdbId(full.imdbId)
      })
      .catch(() => {
        /* keep list backdrop */
      })
    return () => {
      cancelled = true
    }
  }, [item.id, item.mediaType, item.externalId, item.backdropUrl, item.imdbId])

  useEffect(() => {
    const key = settings?.tmdbApiKey?.trim()
    if (!key) {
      setTitleLogo(null)
      return
    }
    let cancelled = false
    void fetchTitleLogoUrl(key, {
      imdbId,
      mediaType: item.mediaType
    }).then((url) => {
      if (!cancelled) setTitleLogo(url)
    })
    return () => {
      cancelled = true
    }
  }, [settings?.tmdbApiKey, imdbId, item.mediaType, item.id])

  useEffect(() => {
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
  }, [item.id, item.title])

  const year = item.releaseDate?.slice(0, 4)
  const rating = item.rating > 0 ? item.rating.toFixed(1) : null
  const detailPath = `/detail/${item.mediaType}/${item.externalId}`

  const playLocal = async (): Promise<void> => {
    if (!localMatch || !window.cinevault) return
    const url = await window.cinevault.download.toFileUrl(localMatch.path)
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
  }

  const openTrailer = async (): Promise<void> => {
    setTrailerBusy(true)
    try {
      const { trailer: resolved } = await resolveTrailerForItem(item, {
        youtubeId,
        tmdbApiKey: settings?.tmdbApiKey
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
    <section className="catalog-hero" aria-label={`Featured: ${item.title}`}>
      <div className="catalog-hero-media" aria-hidden={!backdrop}>
        {backdrop && (
          <img
            className="catalog-hero-bg"
            src={backdrop}
            alt=""
            decoding="async"
            fetchPriority="high"
          />
        )}
        <div className="catalog-hero-scrim catalog-hero-scrim-x" />
        <div className="catalog-hero-scrim catalog-hero-scrim-y" />
      </div>
      <div className="catalog-hero-content">
        <p className="catalog-hero-kicker">Featured</p>
        {titleLogo ? (
          <img
            className="catalog-hero-logo"
            src={titleLogo}
            alt={item.title}
            decoding="async"
          />
        ) : (
          <h1 className="catalog-hero-title">{item.title}</h1>
        )}
        <div className="catalog-hero-meta">
          {year && <span className="catalog-hero-year">{year}</span>}
          {rating && (
            <>
              <span className="catalog-hero-bullet" aria-hidden>
                ·
              </span>
              <span className="catalog-hero-score">
                <span className="catalog-hero-star" aria-hidden>
                  ★
                </span>
                {rating}
              </span>
            </>
          )}
          {item.genres.slice(0, 3).map((g) => (
            <span key={g} className="catalog-hero-genre-wrap">
              <span className="catalog-hero-bullet" aria-hidden>
                ·
              </span>
              <span className="catalog-hero-tag">{g}</span>
            </span>
          ))}
        </div>
        {item.overview && <p className="catalog-hero-overview">{item.overview}</p>}
        <div className="catalog-hero-actions">
          {localMatch ? (
            <button className="catalog-btn primary" type="button" onClick={() => void playLocal()}>
              <Play size={18} fill="currentColor" strokeWidth={0} />
              Play
            </button>
          ) : (
            <button
              className="catalog-btn primary"
              type="button"
              disabled={checkingLocal}
              onClick={() => navigate(detailPath)}
            >
              <Search size={18} strokeWidth={2} />
              {checkingLocal ? 'Checking…' : 'Find Streams'}
            </button>
          )}
          <button
            className="catalog-btn glass"
            type="button"
            disabled={trailerBusy}
            title="Watch trailer"
            onClick={() => void openTrailer()}
          >
            <Clapperboard size={18} strokeWidth={1.75} />
            {trailerBusy ? 'Loading…' : 'Watch Trailer'}
          </button>
          <button
            className={`catalog-btn glass catalog-btn-watch-later${inWatchLater ? ' watch-later-on' : ''}`}
            type="button"
            title="Watch Later"
            aria-pressed={inWatchLater}
            onClick={() => toggleWatchLater(catalogToWatchLaterItem(item))}
          >
            <Clock size={18} strokeWidth={1.75} />
            {inWatchLater ? 'In Watch Later' : 'Watch Later'}
          </button>
          <button
            className={`catalog-btn icon-round catalog-btn-fav${fav ? ' on' : ''}`}
            type="button"
            title={fav ? 'Remove from favorites' : 'Add to favorites'}
            aria-label={fav ? 'Remove from favorites' : 'Add to favorites'}
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
              <Heart size={18} fill="currentColor" strokeWidth={0} />
            ) : (
              <Heart size={18} strokeWidth={1.75} />
            )}
          </button>
          <button
            className="catalog-btn icon-round"
            type="button"
            title="More info"
            aria-label="More info"
            onClick={() => navigate(detailPath)}
          >
            <Info size={18} strokeWidth={1.75} />
          </button>
        </div>
      </div>

      {trailer && <TrailerModal trailer={trailer} onClose={() => setTrailer(null)} />}
    </section>
  )
}
