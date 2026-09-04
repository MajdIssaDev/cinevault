import { useEffect, useState } from 'react'
import { useAppStore } from '../store'
import type { Quality } from '../types'

interface LibItem {
  id: string
  path: string
  name: string
  size: number
  qualityGuess: string
}

function formatBytes(n: number): string {
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

export function LibraryPage(): JSX.Element {
  const setSession = useAppStore((s) => s.setSession)
  const qualityPref = useAppStore((s) => s.qualityPref)
  const [items, setItems] = useState<LibItem[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)

  const scan = async (): Promise<void> => {
    setLoading(true)
    try {
      const list = await window.cinevault.library.scan()
      setItems(list)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void scan()
  }, [])

  const filtered = items.filter((i) => i.name.toLowerCase().includes(query.toLowerCase()))

  return (
    <div>
      <h1 className="page-title">Local library</h1>
      <p className="page-sub">
        Files from folders you added in Settings. Play directly, or open a catalog title to auto-match.
      </p>
      <div className="toolbar">
        <input
          className="search"
          placeholder="Filter library…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="btn" type="button" onClick={() => void scan()} disabled={loading}>
          {loading ? 'Scanning…' : 'Rescan'}
        </button>
        <button
          className="btn"
          type="button"
          onClick={async () => {
            await window.cinevault.library.pickFolder()
            await scan()
          }}
        >
          Add folder
        </button>
      </div>
      {filtered.length === 0 ? (
        <div className="empty">No video files found. Add a library folder in Settings.</div>
      ) : (
        <div className="settings-grid">
          {filtered.map((item) => (
            <div key={item.id} className="card-block" style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong>{item.name}</strong>
                <div className="muted" style={{ fontSize: 12, wordBreak: 'break-all' }}>
                  {item.path}
                </div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {formatBytes(item.size)} · {item.qualityGuess}
                </div>
              </div>
              <button
                className="btn primary"
                type="button"
                onClick={async () => {
                  const url = await window.cinevault.download.toFileUrl(item.path)
                  const q = (
                    ['720p', '1080p', '1440p', '2160p'].includes(item.qualityGuess)
                      ? item.qualityGuess
                      : qualityPref
                  ) as Quality
                  setSession({
                    cacheId: `lib-${item.id}`,
                    title: item.name,
                    mediaType: 'movie',
                    externalId: 0,
                    source: {
                      id: item.id,
                      label: item.name,
                      quality: q,
                      url,
                      kind: 'local',
                      hdr: /hdr|dv|dolby.?vision/i.test(item.name),
                      spatialAudio: /atmos|truehd|dts.?x/i.test(item.name)
                    },
                    resolution: q
                  })
                }}
              >
                Play
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
