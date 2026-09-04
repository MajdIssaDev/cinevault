import { useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAppStore } from '../store'
import { formatFeedSize, TorznabClient, type FeedResult } from '../api/torznab'

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
  const settings = useAppStore((s) => s.settings)
  const client = useMemo(() => new TorznabClient(), [])
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<FeedResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searched, setSearched] = useState(false)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  const endpoint = settings?.torznabEndpoint || ''
  const apiKey = settings?.torznabApiKey || ''
  const configured = Boolean(endpoint.trim() && apiKey.trim())

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    const q = query.trim()
    if (!q || !configured) return
    setSearched(true)
    setLoading(true)
    setError(null)
    setCopiedKey(null)
    try {
      setResults(await client.search(endpoint, apiKey, q))
    } catch (err) {
      setResults([])
      setError(err instanceof Error ? err.message : 'Search failed')
    } finally {
      setLoading(false)
    }
  }

  const onCopy = async (item: FeedResult, key: string): Promise<void> => {
    if (!item.uri) return
    try {
      await copyText(item.uri)
      setCopiedKey(key)
      window.setTimeout(() => {
        setCopiedKey((current) => (current === key ? null : current))
      }, 1600)
    } catch {
      setError('Could not copy the URI to the clipboard')
    }
  }

  return (
    <div>
      <h1 className="page-title">Feeds</h1>
      <p className="page-sub">Search your configured Torznab / RSS 2.0 indexer and copy result URIs.</p>

      {!configured && (
        <div className="card-block" style={{ color: 'var(--danger)', marginBottom: 18 }}>
          Add a Torznab endpoint and API key in{' '}
          <Link to="/settings" style={{ textDecoration: 'underline' }}>
            Settings
          </Link>{' '}
          to search feeds.
        </div>
      )}

      <form className="toolbar" onSubmit={(e) => void onSubmit(e)}>
        <input
          className="search"
          placeholder="Search the feed…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={!configured || loading}
        />
        <button className="btn primary" type="submit" disabled={!configured || loading || !query.trim()}>
          Search
        </button>
      </form>

      {loading && <div className="muted">Searching…</div>}
      {error && (
        <div className="card-block" style={{ color: 'var(--danger)', marginBottom: 18 }}>
          {error}
        </div>
      )}
      {!loading && !error && !searched && (
        <div className="empty">Enter a search to query the feed.</div>
      )}
      {!loading && !error && searched && results.length === 0 && (
        <div className="empty">No items matched.</div>
      )}
      {!loading && results.length > 0 && (
        <div className="results-table-wrap">
          <table className="results-table">
            <thead>
              <tr>
                <th>Title</th>
                <th className="num">Size</th>
                <th className="num">Seeders</th>
                <th className="num">Leechers</th>
                <th className="actions" />
              </tr>
            </thead>
            <tbody>
              {results.map((item, index) => {
                const key = `${item.uri}|${item.title}|${index}`
                return (
                  <tr key={key}>
                    <td className="title-cell" title={item.title}>
                      {item.title}
                    </td>
                    <td className="num">{item.size > 0 ? formatFeedSize(item.size) : '—'}</td>
                    <td className="num">{item.seeders}</td>
                    <td className="num">{item.leechers}</td>
                    <td className="actions">
                      <button
                        className="btn ghost"
                        type="button"
                        disabled={!item.uri}
                        onClick={() => void onCopy(item, key)}
                      >
                        {copiedKey === key ? 'Copied' : 'Copy'}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
