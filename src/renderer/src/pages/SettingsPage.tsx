import { useEffect, useState } from 'react'
import { useAppStore } from '../store'
import type { AppSettings } from '../../../main/settings'

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

export function SettingsPage(): JSX.Element {
  const settings = useAppStore((s) => s.settings)
  const saveSettings = useAppStore((s) => s.saveSettings)
  const [draft, setDraft] = useState<AppSettings | null>(settings)
  const [cacheStats, setCacheStats] = useState<{ bytes: number; count: number; directory: string } | null>(
    null
  )
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => setDraft(settings), [settings])
  useEffect(() => {
    void window.cinevault?.cache.stats().then(setCacheStats)
  }, [])

  if (!draft) return <div className="muted">Loading settings…</div>

  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]): void => {
    setDraft({ ...draft, [key]: value })
  }

  return (
    <div>
      <h1 className="page-title">Settings</h1>
      <p className="page-sub">Appearance, APIs, library folders, cache, and playback preferences.</p>

      <div className="settings-grid">
        <section className="card-block">
          <h3 style={{ marginTop: 0 }}>Appearance</h3>
          <div className="field">
            <label>Theme</label>
            <select value={draft.theme} onChange={(e) => set('theme', e.target.value as AppSettings['theme'])}>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
              <option value="system">System</option>
            </select>
          </div>
        </section>

        <section className="card-block">
          <h3 style={{ marginTop: 0 }}>Catalog APIs</h3>
          <div className="field">
            <label>TMDB API key</label>
            <input
              value={draft.tmdbApiKey}
              onChange={(e) => set('tmdbApiKey', e.target.value)}
              placeholder="Required for movies & series"
            />
          </div>
          <p className="muted">Anime uses AniList (no key). Get a TMDB key at themoviedb.org.</p>
        </section>

        <section className="card-block">
          <h3 style={{ marginTop: 0 }}>Torznab / RSS</h3>
          <div className="field">
            <label>Endpoint URL</label>
            <input
              value={draft.torznabEndpoint ?? ''}
              onChange={(e) => set('torznabEndpoint', e.target.value)}
              placeholder="http://127.0.0.1:9696/1/api"
            />
          </div>
          <div className="field">
            <label>API key</label>
            <input
              type="password"
              value={draft.torznabApiKey ?? ''}
              onChange={(e) => set('torznabApiKey', e.target.value)}
              placeholder="Indexer API key"
              autoComplete="off"
            />
          </div>
          <p className="muted">
            User-operated indexer URL (Prowlarr or Jackett Torznab). CineVault does not ship a built-in catalog.
          </p>
        </section>

        <section className="card-block">
          <h3 style={{ marginTop: 0 }}>OpenSubtitles</h3>
          <div className="field">
            <label>API key</label>
            <input
              value={draft.openSubtitlesApiKey}
              onChange={(e) => set('openSubtitlesApiKey', e.target.value)}
            />
          </div>
          <div className="field">
            <label>Username</label>
            <input
              value={draft.openSubtitlesUsername}
              onChange={(e) => set('openSubtitlesUsername', e.target.value)}
            />
          </div>
          <div className="field">
            <label>Password</label>
            <input
              type="password"
              value={draft.openSubtitlesPassword}
              onChange={(e) => set('openSubtitlesPassword', e.target.value)}
            />
          </div>
          <div className="field">
            <label>Default subtitle language</label>
            <select
              value={draft.defaultSubtitleLanguage}
              onChange={(e) => set('defaultSubtitleLanguage', e.target.value)}
            >
              {['en', 'es', 'fr', 'de', 'it', 'pt', 'ar', 'he', 'ja', 'ko', 'zh', 'ru'].map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <button
            className="btn"
            type="button"
            style={{ marginTop: 10 }}
            onClick={async () => {
              await saveSettings(draft)
              try {
                await window.cinevault.subs.loginTest()
                setMsg('OpenSubtitles login OK')
              } catch (e) {
                setMsg(e instanceof Error ? e.message : 'Login failed')
              }
            }}
          >
            Test login
          </button>
        </section>

        <section className="card-block">
          <h3 style={{ marginTop: 0 }}>Playback</h3>
          <div className="field">
            <label>Default quality</label>
            <select
              value={draft.defaultQuality}
              onChange={(e) => set('defaultQuality', e.target.value as AppSettings['defaultQuality'])}
            >
              <option value="720p">720p (minimum)</option>
              <option value="1080p">1080p (default)</option>
              <option value="1440p">2K (1440p)</option>
              <option value="2160p">4K (2160p)</option>
            </select>
          </div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
            <input
              type="checkbox"
              checked={draft.preferHdr}
              onChange={(e) => set('preferHdr', e.target.checked)}
            />
            Prefer HDR / Dolby Vision sources when labeled
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
            <input
              type="checkbox"
              checked={draft.preferSpatialAudio}
              onChange={(e) => set('preferSpatialAudio', e.target.checked)}
            />
            Prefer spatial / Atmos audio tracks when labeled
          </label>
        </section>

        <section className="card-block">
          <h3 style={{ marginTop: 0 }}>Library folders</h3>
          <ul>
            {draft.libraryFolders.map((f) => (
              <li key={f} style={{ marginBottom: 8 }}>
                <code>{f}</code>{' '}
                <button
                  className="btn ghost"
                  type="button"
                  onClick={async () => {
                    await window.cinevault.library.removeFolder(f)
                    const next = await window.cinevault.settings.get()
                    setDraft(next)
                  }}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <button
            className="btn"
            type="button"
            onClick={async () => {
              await window.cinevault.library.pickFolder()
              const next = await window.cinevault.settings.get()
              setDraft(next)
            }}
          >
            Add folder
          </button>
        </section>

        <section className="card-block">
          <h3 style={{ marginTop: 0 }}>Cache & storage</h3>
          <p className="muted">
            Directory: <code>{cacheStats?.directory || draft.cacheDirectory}</code>
          </p>
          <p className="muted">
            {cacheStats
              ? `${cacheStats.count} entries · ${formatBytes(cacheStats.bytes)}`
              : 'Calculating…'}
          </p>
          <div className="field">
            <label>Keep unfinished downloads (hours)</label>
            <input
              type="number"
              min={1}
              value={draft.cacheRetentionHours}
              onChange={(e) => set('cacheRetentionHours', Number(e.target.value) || 48)}
            />
          </div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
            <input
              type="checkbox"
              checked={draft.autoDeleteOnComplete}
              onChange={(e) => set('autoDeleteOnComplete', e.target.checked)}
            />
            Delete cached media after finishing a title
          </label>
          <div className="play-row">
            <button
              className="btn"
              type="button"
              onClick={async () => {
                await window.cinevault.cache.openFolder()
              }}
            >
              Open cache folder
            </button>
            <button
              className="btn"
              type="button"
              onClick={async () => {
                if (!confirm('Delete all cached media?')) return
                await window.cinevault.cache.clearAll()
                setCacheStats(await window.cinevault.cache.stats())
                setMsg('Cache cleared')
              }}
            >
              Clear cache
            </button>
          </div>
        </section>

        <button
          className="btn primary"
          type="button"
          onClick={async () => {
            await saveSettings(draft)
            setMsg('Settings saved')
          }}
        >
          Save settings
        </button>
        {msg && <div className="toast">{msg}</div>}
      </div>
    </div>
  )
}
