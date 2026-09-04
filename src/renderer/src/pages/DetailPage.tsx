import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAppStore } from '../store'
import type { CatalogItem, EpisodeInfo, Quality, SeasonInfo, StreamSource } from '../types'
import { fetchMovieDetails, fetchSeasonEpisodes, fetchSeriesDetails } from '../api/tmdb'
import { fetchAnimeDetails } from '../api/anilist'

const QUALITIES: Quality[] = ['720p', '1080p', '1440p', '2160p']

export function DetailPage(): JSX.Element {
  const { mediaType = 'movie', id = '0' } = useParams()
  const externalId = Number(id)
  const navigate = useNavigate()
  const settings = useAppStore((s) => s.settings)
  const qualityPref = useAppStore((s) => s.qualityPref)
  const setQualityPref = useAppStore((s) => s.setQualityPref)
  const setSession = useAppStore((s) => s.setSession)
  const isFavorite = useAppStore((s) => s.isFavorite)
  const toggleFavorite = useAppStore((s) => s.toggleFavorite)

  const [item, setItem] = useState<CatalogItem | null>(null)
  const [seasons, setSeasons] = useState<SeasonInfo[]>([])
  const [episodes, setEpisodes] = useState<EpisodeInfo[]>([])
  const [season, setSeason] = useState(1)
  const [episode, setEpisode] = useState<EpisodeInfo | null>(null)
  const [imdbId, setImdbId] = useState<string | null>(null)
  const [sources, setSources] = useState<StreamSource[]>([])
  const [selectedSource, setSelectedSource] = useState<string>('')
  const [streamUrl, setStreamUrl] = useState('')
  const [subLang, setSubLang] = useState(settings?.defaultSubtitleLanguage || 'en')
  const [subs, setSubs] = useState<{ id: string; language: string; release: string; fileId: number }[]>(
    []
  )
  const [selectedSub, setSelectedSub] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    const run = async (): Promise<void> => {
      setError(null)
      try {
        if (mediaType === 'anime') {
          const data = await fetchAnimeDetails(externalId)
          if (cancelled) return
          setItem(data.item)
          setSeasons(data.seasons)
          setEpisodes(data.episodes)
          setEpisode(data.episodes[0] || null)
        } else if (mediaType === 'series') {
          const key = settings?.tmdbApiKey || ''
          const data = await fetchSeriesDetails(key, externalId)
          if (cancelled) return
          setItem(data.item)
          setSeasons(data.seasons)
          setImdbId(data.imdbId)
          const s = data.seasons[0]?.seasonNumber || 1
          setSeason(s)
        } else {
          const key = settings?.tmdbApiKey || ''
          const data = await fetchMovieDetails(key, externalId)
          if (cancelled) return
          setItem(data)
          setImdbId(data.imdbId)
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load')
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [mediaType, externalId, settings?.tmdbApiKey])

  useEffect(() => {
    if (mediaType !== 'series' || !settings?.tmdbApiKey) return
    let cancelled = false
    void fetchSeasonEpisodes(settings.tmdbApiKey, externalId, season).then((eps) => {
      if (cancelled) return
      setEpisodes(eps)
      setEpisode(eps[0] || null)
    })
    return () => {
      cancelled = true
    }
  }, [mediaType, externalId, season, settings?.tmdbApiKey])

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
      // restore custom streams from localStorage
      try {
        const raw = localStorage.getItem(`streams:${item.id}`)
        if (raw) mapped.push(...(JSON.parse(raw) as StreamSource[]))
      } catch {
        /* ignore */
      }
      setSources(mapped)
      setSelectedSource(mapped[0]?.id || '')
    })
    return () => {
      cancelled = true
    }
  }, [item])

  const activeSource = useMemo(
    () => sources.find((s) => s.id === selectedSource) || null,
    [sources, selectedSource]
  )

  const loadSubs = async (): Promise<void> => {
    if (!item || !window.cinevault) return
    setBusy(true)
    setError(null)
    try {
      const results = await window.cinevault.subs.search({
        query: item.title,
        imdbId: imdbId || undefined,
        tmdbId: mediaType !== 'anime' ? externalId : undefined,
        season: mediaType !== 'movie' ? season : undefined,
        episode: mediaType !== 'movie' ? episode?.episodeNumber : undefined,
        languages: subLang,
        type: mediaType === 'movie' ? 'movie' : 'episode'
      })
      setSubs(results)
      setSelectedSub(results[0]?.fileId ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Subtitle search failed')
    } finally {
      setBusy(false)
    }
  }

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
    const next = [...sources.filter((s) => s.kind !== 'local' || true), src]
    // keep locals + customs
    const merged = [...sources.filter((s) => s.id !== src.id), src]
    setSources(merged)
    setSelectedSource(src.id)
    const customs = merged.filter((s) => s.kind !== 'local')
    localStorage.setItem(`streams:${item.id}`, JSON.stringify(customs))
    setStreamUrl('')
  }

  const startWatch = async (): Promise<void> => {
    if (!item || !activeSource) {
      setError('Add a local library match or paste an HTTP/HLS stream URL first.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      let subtitlePath: string | null = null
      let subtitleLabel: string | undefined
      if (selectedSub != null && window.cinevault) {
        subtitlePath = await window.cinevault.subs.download(selectedSub, `${item.title}.srt`)
        subtitleLabel = subs.find((s) => s.fileId === selectedSub)?.language
      }

      const cacheId = `${item.id}-${season || 0}-${episode?.episodeNumber || 0}-${Date.now()}`
      let playUrl = activeSource.url
      let playKind = activeSource.kind

      // Progressive cache for remote HTTP (not HLS)
      if (activeSource.kind === 'http' && window.cinevault) {
        const ext = playUrl.split('?')[0].split('.').pop() || 'mp4'
        // Start download in background; play network URL immediately (watch while caching)
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
          filePath: playKind === 'local' ? activeSource.url : '',
          createdAt: Date.now(),
          lastWatchedAt: Date.now(),
          completed: false,
          progressSeconds: 0,
          durationSeconds: 0,
          sourceUrl: activeSource.kind !== 'local' ? activeSource.url : undefined
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
        source: { ...activeSource, url: playUrl, kind: playKind },
        subtitlePath,
        subtitleLabel,
        resolution: (activeSource.quality !== 'unknown' ? activeSource.quality : qualityPref) as Quality
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start playback')
    } finally {
      setBusy(false)
    }
  }

  if (error && !item) {
    return (
      <div>
        <button className="btn ghost" type="button" onClick={() => navigate(-1)}>
          ← Back
        </button>
        <div className="card-block" style={{ marginTop: 16, color: 'var(--danger)' }}>
          {error}
        </div>
      </div>
    )
  }

  if (!item) return <div className="muted">Loading…</div>

  const fav = isFavorite(item.mediaType, item.externalId)
  const showEpisodes = mediaType === 'series' || mediaType === 'anime'

  return (
    <div>
      <button className="btn ghost" type="button" onClick={() => navigate(-1)}>
        ← Back
      </button>
      <div className="detail" style={{ marginTop: 12 }}>
        <div>
          <div className="detail-hero">
            {item.backdropUrl || item.posterUrl ? (
              <img className="backdrop" src={item.backdropUrl || item.posterUrl || ''} alt="" />
            ) : null}
            <div className="shade" />
          </div>
          <div className="detail-copy">
            <h1 className="page-title">{item.title}</h1>
            <p className="page-sub">
              {item.releaseDate || 'Unknown date'} · ★ {item.rating.toFixed(1)} ·{' '}
              {item.genres.join(' · ') || 'Uncategorized'}
            </p>
            <p style={{ maxWidth: 680, lineHeight: 1.55 }}>{item.overview || 'No overview.'}</p>
            {episode && showEpisodes && (
              <div className="card-block" style={{ marginTop: 16 }}>
                <strong>
                  S{episode.seasonNumber}E{episode.episodeNumber} · {episode.title}
                </strong>
                <p className="muted" style={{ marginBottom: 0 }}>
                  {episode.overview || 'No episode synopsis.'}
                </p>
              </div>
            )}

            <div className="play-row">
              <select
                className="select"
                value={qualityPref}
                onChange={(e) => setQualityPref(e.target.value as Quality)}
              >
                {QUALITIES.map((q) => (
                  <option key={q} value={q}>
                    {q === '1440p' ? '2K (1440p)' : q === '2160p' ? '4K (2160p)' : q}
                  </option>
                ))}
              </select>
              <select
                className="select"
                value={selectedSource}
                onChange={(e) => setSelectedSource(e.target.value)}
                style={{ minWidth: 220 }}
              >
                <option value="">Select source…</option>
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                    {s.hdr ? ' · HDR' : ''}
                    {s.spatialAudio ? ' · Spatial' : ''}
                  </option>
                ))}
              </select>
              <select className="select" value={subLang} onChange={(e) => setSubLang(e.target.value)}>
                {['en', 'es', 'fr', 'de', 'it', 'pt', 'ar', 'he', 'ja', 'ko', 'zh', 'ru'].map((l) => (
                  <option key={l} value={l}>
                    Subs: {l}
                  </option>
                ))}
              </select>
              <button className="btn" type="button" onClick={() => void loadSubs()} disabled={busy}>
                Find subtitles
              </button>
              <select
                className="select"
                value={selectedSub ?? ''}
                onChange={(e) => setSelectedSub(e.target.value ? Number(e.target.value) : null)}
                style={{ minWidth: 180 }}
              >
                <option value="">No subtitles</option>
                {subs.map((s) => (
                  <option key={s.id} value={s.fileId}>
                    {s.language} · {s.release.slice(0, 40)}
                  </option>
                ))}
              </select>
              <button className="btn primary" type="button" onClick={() => void startWatch()} disabled={busy}>
                Start watching
              </button>
              <button
                className="btn"
                type="button"
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
                {fav ? '★ Favorited' : '☆ Favorite'}
              </button>
            </div>

            <div className="card-block" style={{ marginTop: 18 }}>
              <strong>Add stream URL</strong>
              <p className="muted">
                Paste an HTTP progressive or HLS (.m3u8) URL you are authorized to play. Local library
                matches appear automatically when filenames resemble this title.
              </p>
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
            {error && (
              <div className="card-block" style={{ marginTop: 12, color: 'var(--danger)' }}>
                {error}
              </div>
            )}
          </div>
        </div>

        {showEpisodes && (
          <aside className="detail-side">
            <div className="nav-label" style={{ marginTop: 0 }}>
              Seasons
            </div>
            <div className="season-list" style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 14 }}>
              {seasons.map((s) => (
                <button
                  key={s.seasonNumber}
                  type="button"
                  className={`chip${season === s.seasonNumber ? ' active' : ''}`}
                  onClick={() => setSeason(s.seasonNumber)}
                >
                  {s.name}
                </button>
              ))}
            </div>
            <div className="nav-label">Episodes</div>
            <div className="episode-list">
              {episodes.map((ep) => (
                <button
                  key={ep.id}
                  type="button"
                  className={`episode-row${episode?.id === ep.id ? ' active' : ''}`}
                  onClick={() => setEpisode(ep)}
                >
                  <strong>
                    E{ep.episodeNumber} · {ep.title}
                  </strong>
                  <p>{ep.overview || ep.airDate || '—'}</p>
                </button>
              ))}
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}
