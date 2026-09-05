import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ChevronDown, Clapperboard, Clock, Heart, Play, RotateCcw, Star } from 'lucide-react'
import { useAppStore } from '../store'
import type { CatalogItem, EpisodeInfo, MediaExtras, Quality, SeasonInfo, StreamSource } from '../types'
import { fetchMovieDetails } from '../api/ytsCatalog'
import { episodesForSeason, fetchSeriesDetails } from '../api/tvmaze'
import { fetchAnimeDetails } from '../api/anilist'
import { enrichFromImdb, mergeExtras } from '../api/tmdb'
import {
  formatFileSize,
  searchPublicIndexers,
  type PublicSearchResult
} from '../services/publicSearchService'
import {
  buildCatalogSearchQuery,
  guessQualityFromName,
  qualityLabel,
  sortTorrentResults,
  startTorrentPlayback
} from '../lib/torrentPlayback'
import {
  defaultTargetFromQuality,
  getBestStream,
  type TargetRes
} from '../lib/streamScorer'
import {
  formatRemaining,
  getLatestProgressForTitle,
  getProgress,
  subscribePlaybackHistory,
  type PlaybackProgress
} from '../services/playbackHistoryService'
import { formatTime } from '../lib/subtitles'
import { pickSharpHeroUrl, upgradeImageUrl } from '../lib/heroImage'
import { useWatchLater } from '../hooks/useWatchLater'
import { catalogToWatchLaterItem } from '../services/watchLaterService'
import { openTrailerSearch, resolveTrailerForItem } from '../lib/trailer'
import { buildTrailerInfo, type TrailerInfo } from '../api/tmdb'
import {
  formatSubtitleMenuLabel,
  getAvailableSubtitles,
  rankSubtitlesByRelease,
  resolveSubtitleTrack,
  type UnifiedSubtitle
} from '../services/subtitleService'
import { HScrollRail } from '../components/HScrollRail'
import { ThemedSelect } from '../components/ThemedSelect'
import { TrailerModal } from '../components/TrailerModal'

type UiError = {
  message: string
  action?: { to: string; label: string }
}

function cleanIpcMessage(raw: string): string {
  return raw
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim()
}

function toUiError(e: unknown, fallback: string): UiError {
  const raw = e instanceof Error ? e.message : String(e)
  const cleaned = cleanIpcMessage(raw)
  if (/OPENSUBTITLES_CREDENTIALS_MISSING|credentials missing/i.test(cleaned)) {
    return {
      message: 'OpenSubtitles isn’t set up yet. Add your API key and account to search for subtitles.',
      action: { to: '/settings', label: 'Open Settings' }
    }
  }
  if (/OpenSubtitles login failed/i.test(cleaned)) {
    return {
      message: 'Couldn’t sign in to OpenSubtitles. Check your API key, username, and password.',
      action: { to: '/settings', label: 'Open Settings' }
    }
  }
  return { message: cleaned || fallback }
}

function releaseYear(date: string | null | undefined): string {
  if (!date) return '—'
  return date.split('-')[0] || date
}

function formatRuntime(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h <= 0) return `${m}m`
  return m ? `${h}h ${m}m` : `${h}h`
}

function epCode(n: number): string {
  return `E${String(n).padStart(2, '0')}`
}

function qualityTone(q: Quality | 'unknown'): string {
  if (q === '2160p' || q === '1440p') return 'uhd'
  if (q === '1080p') return 'hi'
  if (q === '720p') return 'mid'
  return 'lo'
}

export function DetailPage(): JSX.Element {
  const { mediaType = 'movie', id = '0' } = useParams()
  const externalId = Number(id)
  const navigate = useNavigate()
  const settings = useAppStore((s) => s.settings)
  const qualityPref = useAppStore((s) => s.qualityPref)
  const setSession = useAppStore((s) => s.setSession)
  const toggleFavorite = useAppStore((s) => s.toggleFavorite)
  const { isSaved: isWatchLaterSaved, toggle: toggleWatchLaterItem } = useWatchLater()

  const [item, setItem] = useState<CatalogItem | null>(null)
  const [extras, setExtras] = useState<MediaExtras>({})
  const [lightbox, setLightbox] = useState<string | null>(null)
  const [trailer, setTrailer] = useState<TrailerInfo | null>(null)
  const [trailerBusy, setTrailerBusy] = useState(false)
  const fav = useAppStore((s) => {
    const media = item?.mediaType || (mediaType as 'movie' | 'series' | 'anime')
    const ext = item?.externalId ?? externalId
    return s.favorites.some((f) => f.mediaType === media && f.externalId === ext)
  })
  const [seasons, setSeasons] = useState<SeasonInfo[]>([])
  const [episodes, setEpisodes] = useState<EpisodeInfo[]>([])
  const [season, setSeason] = useState(1)
  const [episode, setEpisode] = useState<EpisodeInfo | null>(null)
  const [imdbId, setImdbId] = useState<string | null>(null)
  const [localSources, setLocalSources] = useState<StreamSource[]>([])
  const [selectedLocal, setSelectedLocal] = useState('')
  const [streamUrl, setStreamUrl] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [subLang, setSubLang] = useState(settings?.defaultSubtitleLanguage || 'en')
  const [subs, setSubs] = useState<UnifiedSubtitle[]>([])
  const [error, setError] = useState<UiError | null>(null)
  const [busy, setBusy] = useState(false)

  const [torrentResults, setTorrentResults] = useState<PublicSearchResult[]>([])
  const [torrentLoading, setTorrentLoading] = useState(false)
  const [torrentError, setTorrentError] = useState<string | null>(null)
  const [startingId, setStartingId] = useState<string | null>(null)
  const [qualityFilter, setQualityFilter] = useState<'all' | Quality | 'unknown'>('all')
  const [selectedRes, setSelectedRes] = useState<TargetRes>(() =>
    defaultTargetFromQuality(qualityPref)
  )
  const [resAdjustedNote, setResAdjustedNote] = useState<string | null>(null)
  const autoDowngrade = true
  const [savedProgress, setSavedProgress] = useState<PlaybackProgress | null>(null)
  const [forceFromStart, setForceFromStart] = useState(false)

  useEffect(() => {
    setSelectedRes(defaultTargetFromQuality(qualityPref))
    setResAdjustedNote(null)
  }, [qualityPref, item?.id])

  useEffect(() => {
    if (!lightbox) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setLightbox(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightbox])

  useEffect(() => {
    let cancelled = false
    const run = async (): Promise<void> => {
      setError(null)
      setExtras({})
      setLightbox(null)
      setTrailer(null)
      try {
        if (mediaType === 'anime') {
          const data = await fetchAnimeDetails(externalId)
          if (cancelled) return
          setItem(data.item)
          setSeasons(data.seasons)
          setEpisodes(data.episodes)
          setEpisode(data.episodes[0] || null)
        } else if (mediaType === 'series') {
          const data = await fetchSeriesDetails(externalId)
          if (cancelled) return
          let nextItem = data.item
          let nextExtras: MediaExtras = {}
          const key = settings?.tmdbApiKey
          if (key && data.imdbId) {
            try {
              const enrich = await enrichFromImdb(key, data.imdbId, 'tv')
              if (enrich) {
                if (enrich.backdropUrl) nextItem = { ...nextItem, backdropUrl: enrich.backdropUrl }
                if (enrich.overview) nextItem = { ...nextItem, overview: enrich.overview }
                nextExtras = enrich.extras
              }
            } catch {
              /* YTS/TVMaze base is enough */
            }
          }
          if (cancelled) return
          setItem(nextItem)
          setExtras(nextExtras)
          setSeasons(data.seasons)
          setImdbId(data.imdbId)
          setEpisodes(data.episodes)
          const s = data.seasons[0]?.seasonNumber || 1
          setSeason(s)
          const seasonEps = episodesForSeason(data.episodes, s)
          setEpisode(seasonEps[0] || null)
        } else {
          const data = await fetchMovieDetails(externalId)
          if (cancelled) return
          let nextItem = data.item
          let nextExtras = data.extras
          const key = settings?.tmdbApiKey
          if (key && nextItem.imdbId) {
            try {
              const enrich = await enrichFromImdb(key, nextItem.imdbId, 'movie')
              if (enrich) {
                if (enrich.backdropUrl) nextItem = { ...nextItem, backdropUrl: enrich.backdropUrl }
                if (enrich.overview && enrich.overview.length > (nextItem.overview?.length || 0)) {
                  nextItem = { ...nextItem, overview: enrich.overview }
                }
                nextExtras = mergeExtras(nextExtras, enrich.extras)
              }
            } catch {
              /* keep YTS extras */
            }
          }
          if (cancelled) return
          setItem(nextItem)
          setExtras(nextExtras)
          setImdbId(nextItem.imdbId)
        }
      } catch (e) {
        if (!cancelled) setError(toUiError(e, 'Failed to load'))
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [mediaType, externalId, settings?.tmdbApiKey])

  useEffect(() => {
    if (mediaType !== 'series' || !episodes.length) return
    const seasonEps = episodesForSeason(episodes, season)
    setEpisode((current) => {
      if (current && seasonEps.some((e) => e.id === current.id)) return current
      return seasonEps[0] || null
    })
  }, [mediaType, season, episodes])

  useEffect(() => {
    if (!item) {
      setSavedProgress(null)
      return
    }
    const refresh = (): void => {
      if (mediaType === 'movie') {
        setSavedProgress(getProgress(item.id))
        return
      }
      if (episode == null) {
        setSavedProgress(getLatestProgressForTitle(item.id))
        return
      }
      setSavedProgress(getProgress(item.id, season, episode.episodeNumber))
    }
    refresh()
    return subscribePlaybackHistory(refresh)
  }, [item, mediaType, season, episode?.episodeNumber])

  // Jump to the episode that has saved progress when details load
  useEffect(() => {
    if (!item || mediaType === 'movie' || !episodes.length) return
    const latest = getLatestProgressForTitle(item.id)
    if (!latest?.season || !latest.episode) return
    setSeason(latest.season)
    const match = episodes.find(
      (e) => e.seasonNumber === latest.season && e.episodeNumber === latest.episode
    )
    if (match) setEpisode(match)
    // only on item identity change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, episodes.length])

  useEffect(() => {
    setSubLang(settings?.defaultSubtitleLanguage || 'en')
  }, [settings?.defaultSubtitleLanguage])

  // Prefetch subtitles using Settings default language (player can change later)
  useEffect(() => {
    const id = imdbId || item?.imdbId
    if (!id || !item) return
    let cancelled = false
    void getAvailableSubtitles({
      imdbId: id,
      type: mediaType === 'movie' ? 'movie' : 'series',
      lang: subLang,
      season: mediaType !== 'movie' ? season : undefined,
      episode: mediaType !== 'movie' ? episode?.episodeNumber : undefined,
      title: item.title
    })
      .then((results) => {
        if (!cancelled) setSubs(results)
      })
      .catch(() => {
        /* player can still search */
      })
    return () => {
      cancelled = true
    }
  }, [imdbId, item?.imdbId, item?.title, mediaType, subLang, season, episode?.episodeNumber])

  useEffect(() => {
    if (!item) return
    let cancelled = false
    void window.cinevault?.library.matchTitle(item.title).then(async (matches) => {
      if (cancelled) return
      const mapped: StreamSource[] = []
      for (const m of matches) {
        const url = await window.cinevault.download.toFileUrl(m.path)
        const q = (['720p', '1080p', '1440p', '2160p'].includes(m.qualityGuess)
          ? m.qualityGuess
          : 'unknown') as StreamSource['quality']
        mapped.push({
          id: m.id,
          label: `${m.name} (${m.qualityGuess})`,
          quality: q,
          url,
          kind: 'local',
          hdr: /hdr|dv|dolby.?vision/i.test(m.name),
          spatialAudio: /atmos|truehd|dts.?x/i.test(m.name)
        })
      }
      try {
        const raw = localStorage.getItem(`streams:${item.id}`)
        if (raw) mapped.push(...(JSON.parse(raw) as StreamSource[]))
      } catch {
        /* ignore */
      }
      setLocalSources(mapped)
      setSelectedLocal(mapped[0]?.id || '')
    })
    return () => {
      cancelled = true
    }
  }, [item])

  const searchQuery = useMemo(() => {
    if (!item) return ''
    return buildCatalogSearchQuery({
      title: item.title,
      mediaType: item.mediaType,
      releaseDate: item.releaseDate,
      season: mediaType !== 'movie' ? season : undefined,
      episode: mediaType !== 'movie' ? episode?.episodeNumber : undefined
    })
  }, [item, mediaType, season, episode?.episodeNumber])

  useEffect(() => {
    if (!searchQuery) return
    let cancelled = false
    const run = async (): Promise<void> => {
      setTorrentLoading(true)
      setTorrentError(null)
      setQualityFilter('all')
      try {
        const raw = await searchPublicIndexers(searchQuery)
        if (cancelled) return
        setTorrentResults(sortTorrentResults(raw, qualityPref))
      } catch (e) {
        if (!cancelled) {
          setTorrentResults([])
          setTorrentError(e instanceof Error ? e.message : 'Torrent search failed')
        }
      } finally {
        if (!cancelled) setTorrentLoading(false)
      }
    }
    const t = window.setTimeout(() => void run(), 200)
    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [searchQuery, qualityPref])

  const filteredTorrents = useMemo(() => {
    if (qualityFilter === 'all') return torrentResults
    return torrentResults.filter((r) => guessQualityFromName(r.name) === qualityFilter)
  }, [torrentResults, qualityFilter])

  const streamPick = useMemo(
    () =>
      getBestStream(torrentResults, selectedRes, {
        isMovieLike: mediaType === 'movie'
      }),
    [torrentResults, selectedRes, mediaType]
  )

  const {
    bestStream,
    highestAvailableRes,
    isTargetAvailable,
    hasUnsupportedAudio
  } = streamPick

  useEffect(() => {
    if (torrentLoading || torrentResults.length === 0) return
    if (selectedRes === 'Auto') {
      setResAdjustedNote(null)
      return
    }
    const pick = getBestStream(torrentResults, selectedRes, {
      isMovieLike: mediaType === 'movie'
    })
    if (pick.isTargetAvailable) {
      return
    }
    if (autoDowngrade && pick.highestAvailableRes) {
      const from = selectedRes
      const to = pick.highestAvailableRes
      if (from !== to) {
        setSelectedRes(to)
        setResAdjustedNote(`${from} unavailable · Adjusted to ${to}`)
      }
      return
    }
    setResAdjustedNote(null)
  }, [torrentLoading, torrentResults, mediaType, autoDowngrade])

  useEffect(() => {
    if (!resAdjustedNote) return
    const t = window.setTimeout(() => setResAdjustedNote(null), 4500)
    return () => window.clearTimeout(t)
  }, [resAdjustedNote])

  const qualityOptions = useMemo(() => {
    const present = new Set(torrentResults.map((r) => guessQualityFromName(r.name)))
    const order: Array<Quality | 'unknown'> = ['2160p', '1440p', '1080p', '720p', 'unknown']
    return order.filter((q) => present.has(q))
  }, [torrentResults])

  const activeLocal = useMemo(
    () => localSources.find((s) => s.id === selectedLocal) || null,
    [localSources, selectedLocal]
  )

  const addStream = (): void => {
    if (!item || !streamUrl.trim()) return
    const isHls = /\.m3u8($|\?)/i.test(streamUrl)
    const src: StreamSource = {
      id: `custom-${Date.now()}`,
      label: `Custom ${qualityPref}${isHls ? ' · HLS' : ''}`,
      quality: qualityPref,
      url: streamUrl.trim(),
      kind: isHls ? 'hls' : 'http'
    }
    const merged = [...localSources.filter((s) => s.id !== src.id), src]
    setLocalSources(merged)
    setSelectedLocal(src.id)
    const customs = merged.filter((s) => s.kind !== 'local')
    localStorage.setItem(`streams:${item.id}`, JSON.stringify(customs))
    setStreamUrl('')
  }

  const resolveSubtitles = async (
    preferred?: UnifiedSubtitle | null
  ): Promise<{
    path: string | null
    url: string | null
    label?: string
  }> => {
    if (!item) return { path: null, url: null }
    const track = preferred || subs[0]
    if (!track) return { path: null, url: null }
    const resolved = await resolveSubtitleTrack(track, subLang)
    return {
      path: resolved.path,
      url: resolved.url || resolved.blobUrl,
      label: formatSubtitleMenuLabel(track)
    }
  }

  const playTorrent = async (
    result: PublicSearchResult,
    opts?: { fromStart?: boolean }
  ): Promise<void> => {
    if (!item || !result.magnetUri || startingId) return
    const { warnIfCellular } = await import('../lib/mobileNetwork')
    if (!(await warnIfCellular('torrent playback'))) return
    setStartingId(result.id)
    setError(null)
    const fromStart = opts?.fromStart || forceFromStart
    const resumeAt =
      !fromStart && savedProgress && savedProgress.currentTime > 3
        ? savedProgress.currentTime
        : undefined
    try {
      const cacheId = `${item.id}-${season || 0}-${episode?.episodeNumber || 0}-${Date.now()}`
      const source = await startTorrentPlayback({
        cacheId,
        magnetUri: result.magnetUri,
        label: result.name,
        preferredQuality: qualityPref
      })

      // Prefer prefetched tracks; never block playback on a slow subtitle API.
      let bestTrack: UnifiedSubtitle | null =
        rankSubtitlesByRelease(subs, result.name)[0] || null
      const id = imdbId || item.imdbId
      if (id) {
        try {
          const ranked = await Promise.race([
            getAvailableSubtitles({
              imdbId: id,
              type: mediaType === 'movie' ? 'movie' : 'series',
              lang: subLang,
              season: mediaType !== 'movie' ? season : undefined,
              episode: mediaType !== 'movie' ? episode?.episodeNumber : undefined,
              title: item.title,
              releaseHint: result.name
            }),
            new Promise<UnifiedSubtitle[]>((resolve) => {
              window.setTimeout(() => resolve([]), 2500)
            })
          ])
          if (ranked.length) {
            setSubs(ranked)
            bestTrack = ranked[0]
          }
        } catch {
          /* keep prefetched bestTrack */
        }
      }

      let subtitlePath: string | null = null
      let subtitleUrl: string | null = null
      let subtitleLabel: string | undefined
      try {
        const resolved = await Promise.race([
          resolveSubtitles(bestTrack),
          new Promise<{ path: string | null; url: string | null; label?: string }>((resolve) => {
            window.setTimeout(() => resolve({ path: null, url: null }), 3000)
          })
        ])
        subtitlePath = resolved.path
        subtitleUrl = resolved.url
        subtitleLabel = resolved.label
      } catch {
        /* player can load subtitles later */
      }

      if (window.cinevault) {
        void window.cinevault.cache.upsert({
          id: cacheId,
          title: item.title,
          mediaType: item.mediaType,
          filePath: '',
          createdAt: Date.now(),
          lastWatchedAt: Date.now(),
          completed: false,
          progressSeconds: resumeAt || 0,
          durationSeconds: 0,
          sourceUrl: result.magnetUri
        })
      }

      setSession({
        cacheId,
        title:
          mediaType === 'movie'
            ? item.title
            : `${item.title} · S${season}E${episode?.episodeNumber ?? 1}`,
        mediaType: item.mediaType,
        externalId: item.externalId,
        season: mediaType !== 'movie' ? season : undefined,
        episode: mediaType !== 'movie' ? episode?.episodeNumber : undefined,
        episodeTitle: mediaType !== 'movie' ? episode?.title : undefined,
        showTitle: item.title,
        posterUrl: item.posterUrl,
        backdropUrl: item.backdropUrl,
        imdbId: imdbId || item.imdbId || null,
        source,
        subtitlePath,
        subtitleUrl,
        subtitleLabel,
        subtitleLang: subLang,
        resolution: (source.quality !== 'unknown' ? source.quality : qualityPref) as Quality,
        resumeSeconds: fromStart ? 0 : resumeAt
      })
      setForceFromStart(false)
    } catch (e) {
      setError(toUiError(e, 'Could not start torrent playback'))
    } finally {
      setStartingId(null)
    }
  }

  const startLocalWatch = async (): Promise<void> => {
    if (!item || !activeLocal) {
      setError({ message: 'Select a local or custom stream first.' })
      return
    }
    setBusy(true)
    setError(null)
    try {
      const { path: subtitlePath, url: subtitleUrl, label: subtitleLabel } =
        await resolveSubtitles()
      const cacheId = `${item.id}-${season || 0}-${episode?.episodeNumber || 0}-${Date.now()}`
      const playUrl = activeLocal.url
      const playKind = activeLocal.kind

      if (activeLocal.kind === 'http' && window.cinevault) {
        const ext = playUrl.split('?')[0].split('.').pop() || 'mp4'
        void window.cinevault.download.start({
          id: cacheId,
          url: playUrl,
          fileName: `${cacheId}.${ext}`
        })
      }

      if (window.cinevault) {
        await window.cinevault.cache.upsert({
          id: cacheId,
          title: item.title,
          mediaType: item.mediaType,
          filePath: playKind === 'local' ? activeLocal.url : '',
          createdAt: Date.now(),
          lastWatchedAt: Date.now(),
          completed: false,
          progressSeconds: 0,
          durationSeconds: 0,
          sourceUrl: activeLocal.kind !== 'local' ? activeLocal.url : undefined
        })
      }

      setSession({
        cacheId,
        title:
          mediaType === 'movie'
            ? item.title
            : `${item.title} · S${season}E${episode?.episodeNumber ?? 1}`,
        mediaType: item.mediaType,
        externalId: item.externalId,
        season: mediaType !== 'movie' ? season : undefined,
        episode: mediaType !== 'movie' ? episode?.episodeNumber : undefined,
        episodeTitle: mediaType !== 'movie' ? episode?.title : undefined,
        showTitle: item.title,
        posterUrl: item.posterUrl,
        backdropUrl: item.backdropUrl,
        imdbId: imdbId || item.imdbId || null,
        source: { ...activeLocal, url: playUrl, kind: playKind },
        subtitlePath,
        subtitleUrl,
        subtitleLabel,
        subtitleLang: subLang,
        resolution: (activeLocal.quality !== 'unknown' ? activeLocal.quality : qualityPref) as Quality,
        resumeSeconds: forceFromStart
          ? 0
          : savedProgress && savedProgress.currentTime > 3
            ? savedProgress.currentTime
            : undefined
      })
      setForceFromStart(false)
    } catch (e) {
      setError(toUiError(e, 'Could not start playback'))
    } finally {
      setBusy(false)
    }
  }

  if (error && !item) {
    return (
      <div className="detail-page">
        <button className="detail-back" type="button" onClick={() => navigate(-1)}>
          <ArrowLeft size={18} strokeWidth={1.75} />
          Back
        </button>
        <div className="detail-inline-error" style={{ marginTop: 16 }}>
          <span>{error.message}</span>
          {error.action && (
            <Link
              to={error.action.to}
              state={{ settingsTab: 'subtitles' }}
              className="detail-error-link"
            >
              {error.action.label}
            </Link>
          )}
        </div>
      </div>
    )
  }

  if (!item) {
    return (
      <div className="detail-page detail-loading">
        <span className="feed-spinner" aria-hidden />
        <span className="muted">Loading…</span>
      </div>
    )
  }

  const showEpisodes = mediaType === 'series' || mediaType === 'anime'
  const visibleEpisodes =
    mediaType === 'series' ? episodesForSeason(episodes, season) : episodes
  const year = releaseYear(item.releaseDate)
  const synopsis = episode && showEpisodes ? episode.overview || item.overview : item.overview
  const cast = extras.cast || []
  const stills = extras.stills || []
  const backdrop = pickSharpHeroUrl(item.backdropUrl, stills)

  const openTrailer = async (): Promise<void> => {
    if (!item) return
    setTrailerBusy(true)
    try {
      const { trailer: resolved, searchUrl } = await resolveTrailerForItem(
        {
          title: item.title,
          mediaType: item.mediaType,
          externalId: item.externalId,
          imdbId: item.imdbId || imdbId
        },
        {
          youtubeId: extras.trailerYoutubeId,
          tmdbApiKey: settings?.tmdbApiKey
        }
      )
      if (resolved) {
        setTrailer(resolved)
      } else {
        await openTrailerSearch(item.title)
        // Also try opening searchUrl if openTrailerSearch failed silently
        void searchUrl
      }
    } catch {
      if (extras.trailerYoutubeId) {
        setTrailer(buildTrailerInfo(extras.trailerYoutubeId, `${item.title} Trailer`))
      } else {
        await openTrailerSearch(item.title)
      }
    } finally {
      setTrailerBusy(false)
    }
  }

  return (
    <div className="detail-page">
      <section className="detail-hero-immersive" aria-label={item.title}>
        <div className="detail-hero-media" aria-hidden={!backdrop}>
          {backdrop && (
            <img
              className="detail-hero-bg"
              src={backdrop}
              alt=""
              decoding="async"
              fetchPriority="high"
            />
          )}
          <div className="detail-hero-scrim detail-hero-scrim-x" />
          <div className="detail-hero-scrim detail-hero-scrim-y" />
        </div>
        <button className="detail-back" type="button" onClick={() => navigate(-1)}>
          <ArrowLeft size={18} strokeWidth={1.75} />
        </button>
        <div className="detail-hero-content">
          <h1 className="detail-hero-title">{item.title}</h1>
          {extras.tagline && <p className="detail-tagline">{extras.tagline}</p>}
          <div className="detail-hero-meta">
            <span className="detail-hero-year">{year}</span>
            {item.rating > 0 && (
              <>
                <span className="detail-meta-sep" aria-hidden>
                  |
                </span>
                <span className="detail-score">
                  <span className="detail-score-star" aria-hidden>
                    ★
                  </span>{' '}
                  {item.rating.toFixed(1)}
                </span>
              </>
            )}
            {extras.ageRating && <span className="detail-cert">{extras.ageRating}</span>}
            {extras.runtimeMinutes != null && extras.runtimeMinutes > 0 && (
              <span>{formatRuntime(extras.runtimeMinutes)}</span>
            )}
            {item.genres.slice(0, 4).map((g) => (
              <span key={g} className="detail-tag">
                {g}
              </span>
            ))}
          </div>

          <div className="detail-actions">
            <div className="detail-actions-row">
              <button
                type="button"
                className={`detail-watch-btn${
                  !torrentLoading && isTargetAvailable && bestStream ? ' ready' : ''
                }`}
                disabled={
                  torrentLoading || !isTargetAvailable || !bestStream || Boolean(startingId)
                }
                title={
                  !torrentLoading && !isTargetAvailable
                    ? `No ${selectedRes} torrents found. Highest available: ${highestAvailableRes || '—'}`
                    : bestStream
                      ? `Play ${bestStream.name}`
                      : undefined
                }
                onClick={() => {
                  if (bestStream) void playTorrent(bestStream)
                }}
              >
                {torrentLoading ? (
                  <span className="detail-watch-spinner" aria-hidden />
                ) : (
                  <Play size={16} className="detail-watch-play-icon" fill="currentColor" />
                )}
                <span>
                  {torrentLoading
                    ? 'Finding…'
                    : savedProgress && !forceFromStart
                      ? `Resume (${formatTime(savedProgress.currentTime)})`
                      : 'Watch Now'}
                </span>
              </button>

              <div className="detail-res-select-wrap">
                <select
                  className="detail-res-select"
                  value={selectedRes}
                  aria-label="Preferred resolution"
                  onChange={(e) => {
                    setSelectedRes(e.target.value as TargetRes)
                    setResAdjustedNote(null)
                  }}
                >
                  <option value="4K">4K</option>
                  <option value="1080p">1080p</option>
                  <option value="720p">720p</option>
                  <option value="Auto">Auto</option>
                </select>
                <ChevronDown size={14} className="detail-res-chevron" aria-hidden />
              </div>

              {savedProgress && (
                <button
                  type="button"
                  className="detail-restart-btn"
                  title="Start from beginning"
                  aria-label="Start from beginning"
                  disabled={
                    torrentLoading || !isTargetAvailable || !bestStream || Boolean(startingId)
                  }
                  onClick={() => {
                    setForceFromStart(true)
                    if (bestStream) void playTorrent(bestStream, { fromStart: true })
                  }}
                >
                  <RotateCcw size={16} strokeWidth={1.75} />
                </button>
              )}

              <span className="detail-actions-sep" aria-hidden />

              <button
                className="detail-btn trailer"
                type="button"
                disabled={trailerBusy}
                title={
                  extras.trailerYoutubeId
                    ? 'Watch trailer'
                    : 'Watch trailer (opens in-app or YouTube search)'
                }
                onClick={() => void openTrailer()}
              >
                <Clapperboard size={18} strokeWidth={1.75} />
                {trailerBusy ? 'Loading…' : 'Watch Trailer'}
              </button>

              <div className="detail-actions-icons">
                <button
                  className={`detail-icon-btn detail-watch-later-btn${
                    item && isWatchLaterSaved(item.id) ? ' on' : ''
                  }`}
                  type="button"
                  title="Watch Later"
                  aria-label="Watch Later"
                  aria-pressed={Boolean(item && isWatchLaterSaved(item.id))}
                  onClick={() => {
                    if (!item) return
                    toggleWatchLaterItem(catalogToWatchLaterItem(item))
                  }}
                >
                  <Clock size={18} strokeWidth={1.75} />
                </button>

                <button
                  className={`detail-icon-btn${fav ? ' on' : ''}`}
                  type="button"
                  title={fav ? 'Remove from favorites' : 'Favorite'}
                  aria-label={fav ? 'Remove from favorites' : 'Favorite'}
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
              </div>

              {!torrentLoading &&
                !isTargetAvailable &&
                highestAvailableRes &&
                selectedRes !== 'Auto' && (
                  <button
                    type="button"
                    className="detail-res-fallback"
                    onClick={() => {
                      setSelectedRes(highestAvailableRes)
                      setResAdjustedNote(null)
                    }}
                  >
                    No {selectedRes} available · Switch to {highestAvailableRes}
                  </button>
                )}

              {resAdjustedNote && (
                <span className="detail-res-toast" role="status">
                  {resAdjustedNote}
                </span>
              )}

              {hasUnsupportedAudio && bestStream && (
                <span
                  className="detail-audio-warn"
                  role="status"
                  title="May require external player or audio transcoding"
                >
                  Best match uses{' '}
                  {bestStream.audioLabel || bestStream.audioCodec || 'cinema audio'} — audio may
                  be silent in-app
                </span>
              )}
            </div>

            {savedProgress && !forceFromStart && savedProgress.duration > 0 && (
              <p className="detail-remaining">
                {formatRemaining(savedProgress).replace(/\s*left$/i, '')} remaining
              </p>
            )}
          </div>
        </div>
      </section>

      <div className="detail-body">
        {(synopsis || item.overview) && (
          <section className="detail-section detail-synopsis-block">
            <p className="detail-synopsis">{synopsis || item.overview}</p>
          </section>
        )}

        {cast.length > 0 && (
          <section className="detail-section">
            <div className="detail-section-head">
              <h2>Cast & Crew</h2>
            </div>
            <div className="cast-row">
              {cast.map((c) => (
                <div
                  key={`${c.role}-${c.name}`}
                  className="cast-chip"
                  title={c.character || c.role}
                >
                  <div className="cast-avatar-wrap">
                    {c.photoUrl ? (
                      <img
                        src={c.photoUrl}
                        alt={c.name}
                        className="cast-avatar"
                        loading="lazy"
                      />
                    ) : (
                      <span className="cast-avatar-fallback" aria-hidden>
                        {c.name ? c.name.charAt(0).toUpperCase() : '?'}
                      </span>
                    )}
                  </div>
                  <div className="cast-copy">
                    <strong className="cast-name">{c.name}</strong>
                    <span className="cast-role">
                      {c.role === 'director' ? 'Director' : c.character || 'Cast'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {stills.length > 0 && (
          <section className="detail-section">
            <div className="detail-section-head">
              <h2>Stills & Gallery</h2>
            </div>
            <HScrollRail className="gallery-rail" aria-label="Stills gallery" role="list">
              {stills.map((url) => (
                <button
                  key={url}
                  type="button"
                  className="gallery-thumb"
                  onClick={() => setLightbox(upgradeImageUrl(url))}
                >
                  <img src={url} alt="" loading="lazy" decoding="async" />
                </button>
              ))}
            </HScrollRail>
          </section>
        )}

        {lightbox &&
          createPortal(
            <div
              className="gallery-lightbox"
              role="dialog"
              aria-modal="true"
              onClick={() => setLightbox(null)}
            >
              <img src={lightbox} alt="" onClick={(e) => e.stopPropagation()} />
              <button type="button" className="gallery-close" onClick={() => setLightbox(null)}>
                Close
              </button>
            </div>,
            document.body
          )}

        {showEpisodes && (
          <section className="detail-section">
            <div className="detail-section-head">
              <h2>Episodes</h2>
            </div>

            {seasons.length > 0 && (
              <div className="season-tabs" role="tablist" aria-label="Seasons">
                {seasons.map((s) => (
                  <button
                    key={s.seasonNumber}
                    type="button"
                    role="tab"
                    aria-selected={season === s.seasonNumber}
                    className={`season-tab${season === s.seasonNumber ? ' active' : ''}`}
                    onClick={() => setSeason(s.seasonNumber)}
                  >
                    {s.name || `Season ${s.seasonNumber}`}
                  </button>
                ))}
              </div>
            )}

            <div className="episode-cards">
              {visibleEpisodes.map((ep) => {
                const active = episode?.id === ep.id
                return (
                  <button
                    key={ep.id}
                    type="button"
                    className={`episode-card${active ? ' active' : ''}`}
                    onClick={() => setEpisode(ep)}
                  >
                    <div className="episode-thumb">
                      {ep.stillUrl ? (
                        <img src={ep.stillUrl} alt="" loading="lazy" decoding="async" />
                      ) : (
                        <div className="episode-thumb-empty">{epCode(ep.episodeNumber)}</div>
                      )}
                    </div>
                    <div className="episode-card-body">
                      <div className="episode-card-top">
                        <span className="episode-index">{epCode(ep.episodeNumber)}</span>
                        {ep.airDate && <span className="episode-date">{ep.airDate}</span>}
                      </div>
                      <strong className="episode-title">{ep.title}</strong>
                    </div>
                  </button>
                )
              })}
            </div>

            {episode && (
              <div className="episode-synopsis">
                <strong>
                  {epCode(episode.episodeNumber)} · {episode.title}
                </strong>
                <p>{episode.overview || 'No episode synopsis.'}</p>
              </div>
            )}
          </section>
        )}

        <section className="detail-section">
          <div className="detail-section-head">
            <h2>Streams</h2>
            {!torrentLoading && torrentResults.length > 0 && (
              <span className="muted">
                {filteredTorrents.length} of {torrentResults.length}
              </span>
            )}
          </div>

          {!torrentLoading && torrentResults.length > 0 && (
            <div className="stream-filters">
              <button
                type="button"
                className={`stream-filter${qualityFilter === 'all' ? ' active' : ''}`}
                onClick={() => setQualityFilter('all')}
              >
                All
              </button>
              {qualityOptions.map((q) => (
                <button
                  key={q}
                  type="button"
                  className={`stream-filter${qualityFilter === q ? ' active' : ''}`}
                  onClick={() => setQualityFilter(q)}
                >
                  {q === 'unknown' ? 'Other' : qualityLabel(q)}
                </button>
              ))}
            </div>
          )}

          {torrentLoading && (
            <div className="stream-status" role="status">
              <span className="feed-spinner" aria-hidden />
              Finding streams…
            </div>
          )}

          {torrentError && <div className="stream-error">{torrentError}</div>}

          {!torrentLoading && !torrentError && torrentResults.length === 0 && (
            <div className="stream-empty">
              <Star size={22} strokeWidth={1.5} />
              <p>No streams found for this title.</p>
              <Link to="/feeds" className="detail-link">
                Try Feeds
              </Link>
            </div>
          )}

          {!torrentLoading && filteredTorrents.length === 0 && torrentResults.length > 0 && (
            <div className="stream-empty">
              <p>No streams match this resolution.</p>
            </div>
          )}

          <div className="stream-list">
            {filteredTorrents.map((row) => {
              const q = guessQualityFromName(row.name)
              const starting = startingId === row.id
              return (
                <article
                  key={row.id}
                  className="stream-card"
                  onClick={() => void playTorrent(row)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      void playTorrent(row)
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <div className="stream-card-main">
                    <div className="stream-badges">
                      <span className={`stream-res ${qualityTone(q)}`}>{qualityLabel(q)}</span>
                      {(() => {
                        const label =
                          row.audioLabel ||
                          (row.audioCodec && row.audioCodec !== 'UNKNOWN' ? row.audioCodec : null)
                        if (!label) return null
                        const warn = row.isAudioSupported === false
                        return (
                          <span
                            className={`stream-audio${warn ? ' warn' : ''}`}
                            title={
                              warn
                                ? 'May require external player or audio transcoding'
                                : undefined
                            }
                          >
                            {label}
                          </span>
                        )
                      })()}
                    </div>
                    <div className="stream-card-copy">
                      <div className="stream-title" title={row.name}>
                        {row.name}
                      </div>
                      <span className="stream-source">{row.source}</span>
                    </div>
                  </div>
                  <div className="stream-card-meta">
                    <span className="stream-size">{formatFileSize(row.sizeBytes)}</span>
                    <span
                      className="stream-health"
                      title={`${row.seeders} seeders · ${row.leechers} leechers`}
                    >
                      <span className="stream-health-dot" />
                      {row.seeders}
                    </span>
                    <button
                      className="stream-play"
                      type="button"
                      disabled={!!startingId || !row.magnetUri}
                      onClick={(e) => {
                        e.stopPropagation()
                        void playTorrent(row)
                      }}
                    >
                      <Play size={14} fill="currentColor" strokeWidth={0} />
                      {starting ? '…' : 'Play'}
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
        </section>

        <section className="detail-section advanced">
          <button
            className="detail-advanced-toggle"
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
          >
            {showAdvanced ? 'Hide' : 'Show'} advanced sources
          </button>
          {showAdvanced && (
            <div className="detail-advanced">
              {localSources.length > 0 && (
                <div className="play-row">
                  <ThemedSelect
                    variant="default"
                    aria-label="Local or custom source"
                    value={selectedLocal}
                    onChange={setSelectedLocal}
                    menuMinWidth={260}
                    options={[
                      { value: '', label: 'Local / custom source…' },
                      ...localSources.map((s) => ({
                        value: s.id,
                        label: `${s.label}${s.hdr ? ' · HDR' : ''}${s.spatialAudio ? ' · Spatial' : ''}`
                      }))
                    ]}
                  />
                  <button
                    className="btn primary"
                    type="button"
                    onClick={() => void startLocalWatch()}
                    disabled={busy || !activeLocal}
                  >
                    Play selected
                  </button>
                </div>
              )}
              <div className="play-row">
                <input
                  className="search"
                  placeholder="https://…/video.mp4 or .m3u8"
                  value={streamUrl}
                  onChange={(e) => setStreamUrl(e.target.value)}
                />
                <button className="btn" type="button" onClick={addStream}>
                  Attach
                </button>
              </div>
            </div>
          )}
        </section>

        {error && (
          <div className="detail-inline-error" role="alert">
            <span>{error.message}</span>
            {error.action && (
              <Link
                to={error.action.to}
                state={{ settingsTab: 'subtitles' }}
                className="detail-error-link"
              >
                {error.action.label}
              </Link>
            )}
          </div>
        )}
      </div>

      {trailer && <TrailerModal trailer={trailer} onClose={() => setTrailer(null)} />}
    </div>
  )
}
