import { useMemo, useState, type FormEvent } from 'react'
import {
  formatFileSize,
  searchPublicIndexers,
  type PublicSearchResult
} from '../services/publicSearchService'
import {
  guessQualityFromName,
  qualityLabel,
  sortTorrentResults,
  startTorrentPlayback
} from '../lib/torrentPlayback'
import { useAppStore } from '../store'
import type { Quality } from '../types'
import { ThemedSelect } from '../components/ThemedSelect'

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      /* fall through to execCommand */
    }
  }
  const el = document.createElement('textarea')
  el.value = text
  el.style.position = 'fixed'
  el.style.left = '-9999px'
  document.body.appendChild(el)
  el.select()
  const ok = document.execCommand('copy')
  document.body.removeChild(el)
  if (!ok) throw new Error('copy failed')
}

export function FeedPage(): JSX.Element {
  const setSession = useAppStore((s) => s.setSession)
  const qualityPref = useAppStore((s) => s.qualityPref)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PublicSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searched, setSearched] = useState(false)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [startingId, setStartingId] = useState<string | null>(null)
  const [qualityFilter, setQualityFilter] = useState<'all' | Quality | 'unknown'>('all')

  const filtered = useMemo(() => {
    if (qualityFilter === 'all') return results
    return results.filter((r) => guessQualityFromName(r.name) === qualityFilter)
  }, [results, qualityFilter])

  const qualityOptions = useMemo(() => {
    const present = new Set(results.map((r) => guessQualityFromName(r.name)))
    const order: Array<Quality | 'unknown'> = ['2160p', '1440p', '1080p', '720p', 'unknown']
    return order.filter((q) => present.has(q))
  }, [results])

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    const q = query.trim()
    if (!q) return
    setSearched(true)
    setLoading(true)
    setError(null)
    setCopiedKey(null)
    setQualityFilter('all')
    try {
      setResults(sortTorrentResults(await searchPublicIndexers(q), qualityPref))
    } catch (err) {
      setResults([])
      setError(err instanceof Error ? err.message : 'Search failed')
    } finally {
      setLoading(false)
    }
  }

  const onCopy = async (item: PublicSearchResult): Promise<void> => {
    if (!item.magnetUri) return
    try {
      await copyText(item.magnetUri)
      setCopiedKey(item.id)
      window.setTimeout(() => {
        setCopiedKey((current) => (current === item.id ? null : current))
      }, 1600)
    } catch {
      setError('Could not copy the magnet link to the clipboard')
    }
  }

  const onPlay = async (item: PublicSearchResult): Promise<void> => {
    if (!item.magnetUri) return
    const { warnIfCellular } = await import('../lib/mobileNetwork')
    if (!(await warnIfCellular('torrent playback'))) return
    setStartingId(item.id)
    setError(null)
    try {
      const cacheId = `feed-${item.id}-${Date.now()}`
      const source = await startTorrentPlayback({
        cacheId,
        magnetUri: item.magnetUri,
        label: item.name,
        preferredQuality: qualityPref
      })

      if (window.cinevault) {
        await window.cinevault.cache.upsert({
          id: cacheId,
          title: item.name,
          mediaType: 'movie',
          filePath: '',
          createdAt: Date.now(),
          lastWatchedAt: Date.now(),
          completed: false,
          progressSeconds: 0,
          durationSeconds: 0,
          sourceUrl: item.magnetUri
        })
      }

      setSession({
        cacheId,
        title: item.name,
        mediaType: 'movie',
        externalId: 0,
        source,
        resolution: (source.quality !== 'unknown' ? source.quality : qualityPref) as Quality
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start playback')
    } finally {
      setStartingId(null)
    }
  }

  return (
    <div>
      <h1 className="page-title">Feeds</h1>
      <p className="page-sub">
        Free-text search across public indexes · Play downloads in-app and watch while it fills
      </p>

      <form className="toolbar" onSubmit={(e) => void onSubmit(e)}>
        <input
          className="search"
          placeholder="Search movies…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={loading}
        />
        <button className="btn primary" type="submit" disabled={loading || !query.trim()}>
          Search
        </button>
      </form>

      {loading && (
        <div className="feed-loading" role="status" aria-live="polite">
          <span className="feed-spinner" aria-hidden="true" />
          Searching public indexes…
        </div>
      )}
      {error && (
        <div className="card-block" style={{ color: 'var(--danger)', marginBottom: 18 }}>
          {error}
        </div>
      )}
      {!loading && !error && !searched && (
        <div className="empty">Enter a title and press Enter to search.</div>
      )}
      {!loading && !error && searched && results.length === 0 && (
        <div className="empty">No items matched.</div>
      )}
      {!loading && results.length > 0 && (
        <>
          <div className="results-toolbar">
            <ThemedSelect
              variant="default"
              aria-label="Filter by resolution"
              value={qualityFilter}
              onChange={(v) => setQualityFilter(v as 'all' | Quality | 'unknown')}
              options={[
                { value: 'all', label: 'Resolution: All' },
                ...qualityOptions.map((q) => ({
                  value: q,
                  label: q === 'unknown' ? 'Unknown' : qualityLabel(q)
                }))
              ]}
            />
            <span className="muted" style={{ fontSize: 13 }}>
              {filtered.length} of {results.length} results
            </span>
          </div>
          {filtered.length === 0 ? (
            <div className="muted">No torrents match this resolution.</div>
          ) : (
            <div className="results-table-wrap">
              <table className="results-table">
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Res</th>
                    <th className="num">File Size</th>
                    <th className="num">Peers</th>
                    <th className="source-cell">Source</th>
                    <th className="actions">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((item) => {
                    const q = guessQualityFromName(item.name)
                    return (
                      <tr key={item.id}>
                        <td className="title-cell" title={item.name}>
                          {item.name}
                        </td>
                        <td className="quality-cell">
                          <span
                            className={`quality-badge${
                              q === 'unknown'
                                ? ' unknown'
                                : q === '2160p' || q === '1440p'
                                  ? ' uhd'
                                  : ''
                            }`}
                          >
                            {qualityLabel(q)}
                          </span>
                        </td>
                        <td className="num">{formatFileSize(item.sizeBytes)}</td>
                        <td className="num">
                          <span
                            className="peer-badge"
                            title={`${item.seeders} seeders · ${item.leechers} leechers`}
                          >
                            <span className="seed">{item.seeders}</span>
                            <span className="sep">/</span>
                            <span className="leech">{item.leechers}</span>
                          </span>
                        </td>
                        <td className="source-cell">
                          <span className="source-badge">{item.source}</span>
                        </td>
                        <td className="actions">
                          <button
                            className="btn ghost"
                            type="button"
                            disabled={!item.magnetUri}
                            onClick={() => void onCopy(item)}
                          >
                            {copiedKey === item.id ? 'Copied' : 'Copy'}
                          </button>
                          <button
                            className="btn primary"
                            type="button"
                            disabled={!item.magnetUri || !!startingId}
                            onClick={() => void onPlay(item)}
                          >
                            {startingId === item.id ? 'Starting…' : 'Play'}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
