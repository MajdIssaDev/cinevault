import { useEffect, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import {
  Captions,
  ExternalLink,
  FolderOpen,
  Info,
  MonitorPlay,
  Palette,
  RefreshCw,
  Save
} from 'lucide-react'
import { useAppStore } from '../store'
import type { AppSettings } from '../../../main/settings'
import { ThemedSelect } from '../components/ThemedSelect'
import { openExternal } from '../lib/openExternal'

type TabId = 'appearance' | 'subtitles' | 'playback' | 'storage' | 'about'

const TABS: { id: TabId; label: string; icon: typeof Palette }[] = [
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'subtitles', label: 'Subtitles', icon: Captions },
  { id: 'playback', label: 'Playback', icon: MonitorPlay },
  { id: 'storage', label: 'Storage & Library', icon: FolderOpen },
  { id: 'about', label: 'About', icon: Info }
]

type UpdateUiState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'latest' }
  | { kind: 'available'; version: string; notes: string | null }
  | { kind: 'downloading'; percent: number; bytesPerSecond: number }
  | { kind: 'ready'; version: string }
  | { kind: 'error'; message: string }

const SUB_LANGS = [
  'en',
  'es',
  'fr',
  'de',
  'ar',
  'pt',
  'ru',
  'zh',
  'ja',
  'ko',
  'hi',
  'it',
  'tr',
  'pl',
  'he',
  'nl',
  'uk',
  'id',
  'vi',
  'th',
  'sv',
  'ro',
  'cs',
  'hu',
  'el'
]

const SUB_LANG_LABELS: Record<string, string> = {
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  ar: 'Arabic',
  pt: 'Portuguese',
  ru: 'Russian',
  zh: 'Chinese',
  ja: 'Japanese',
  ko: 'Korean',
  hi: 'Hindi',
  it: 'Italian',
  tr: 'Turkish',
  pl: 'Polish',
  he: 'Hebrew',
  nl: 'Dutch',
  uk: 'Ukrainian',
  id: 'Indonesian',
  vi: 'Vietnamese',
  th: 'Thai',
  sv: 'Swedish',
  ro: 'Romanian',
  cs: 'Czech',
  hu: 'Hungarian',
  el: 'Greek'
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

function formatSpeed(bps: number): string {
  if (!bps || bps <= 0) return '—'
  return `${formatBytes(bps)}/s`
}

function Toggle({
  checked,
  onChange,
  label,
  description
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  description?: string
}): JSX.Element {
  return (
    <label className="settings-toggle-row">
      <span className="settings-toggle-copy">
        <span className="settings-toggle-label">{label}</span>
        {description && <span className="settings-toggle-desc">{description}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        className={`settings-switch${checked ? ' on' : ''}`}
        onClick={() => onChange(!checked)}
      >
        <span className="settings-switch-thumb" />
      </button>
    </label>
  )
}

function Field({
  label,
  children
}: {
  label: string
  children: ReactNode
}): JSX.Element {
  return (
    <div className="settings-field">
      <label>{label}</label>
      {children}
    </div>
  )
}

export function SettingsPage(): JSX.Element {
  const settings = useAppStore((s) => s.settings)
  const saveSettings = useAppStore((s) => s.saveSettings)
  const setUpdateBadge = useAppStore((s) => s.setUpdateBadge)
  const location = useLocation()
  const initialTab =
    (location.state as { settingsTab?: TabId } | null)?.settingsTab &&
    TABS.some((t) => t.id === (location.state as { settingsTab?: TabId }).settingsTab)
      ? ((location.state as { settingsTab: TabId }).settingsTab)
      : 'appearance'
  const [draft, setDraft] = useState<AppSettings | null>(settings)
  const [tab, setTab] = useState<TabId>(initialTab)
  const [cacheStats, setCacheStats] = useState<{ bytes: number; count: number; directory: string } | null>(
    null
  )
  const [msg, setMsg] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [appVersion, setAppVersion] = useState('…')
  const [updateUi, setUpdateUi] = useState<UpdateUiState>({ kind: 'idle' })

  useEffect(() => setDraft(settings), [settings])
  useEffect(() => {
    const next = (location.state as { settingsTab?: TabId } | null)?.settingsTab
    if (next && TABS.some((t) => t.id === next)) setTab(next)
  }, [location.state])
  useEffect(() => {
    void window.cinevault?.cache.stats().then(setCacheStats)
  }, [])
  useEffect(() => {
    void window.cinevault?.updater.getVersion().then(setAppVersion).catch(() => setAppVersion('1.0.0'))
  }, [])

  useEffect(() => {
    const updater = window.cinevault?.updater
    if (!updater) return
    return updater.onStatus((payload) => {
      switch (payload.status) {
        case 'checking':
          setUpdateUi({ kind: 'checking' })
          break
        case 'available':
          setUpdateUi({
            kind: 'available',
            version: payload.version || '?',
            notes: payload.releaseNotes ?? null
          })
          setUpdateBadge(true, payload.version ?? null)
          break
        case 'none':
          setUpdateUi({ kind: 'latest' })
          setUpdateBadge(false, null)
          break
        case 'downloading':
          setUpdateUi({
            kind: 'downloading',
            percent: payload.percent ?? 0,
            bytesPerSecond: payload.bytesPerSecond ?? 0
          })
          break
        case 'ready':
          setUpdateUi({ kind: 'ready', version: payload.version || '?' })
          setUpdateBadge(true, payload.version ?? null)
          break
        case 'error':
          if (payload.silent) {
            setUpdateUi({
              kind: 'error',
              message: 'Unable to reach update server. You can keep using this version.'
            })
          } else {
            setUpdateUi({
              kind: 'error',
              message: payload.message || 'Update check failed'
            })
          }
          break
        default:
          break
      }
    })
  }, [setUpdateBadge])

  useEffect(() => {
    if (!msg) return
    const t = window.setTimeout(() => setMsg(null), 3200)
    return () => window.clearTimeout(t)
  }, [msg])

  if (!draft) {
    return (
      <div className="settings-page">
        <p className="settings-loading">Loading settings…</p>
      </div>
    )
  }

  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]): void => {
    setDraft({ ...draft, [key]: value })
  }

  const onSave = async (): Promise<void> => {
    setSaving(true)
    try {
      await saveSettings(draft)
      setMsg('Settings saved')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const checkUpdates = async (): Promise<void> => {
    setUpdateUi({ kind: 'checking' })
    try {
      await window.cinevault.updater.check()
    } catch {
      setUpdateUi({
        kind: 'error',
        message: 'Unable to reach update server. You can keep using this version.'
      })
    }
  }

  const cachePath = cacheStats?.directory || draft.cacheDirectory
  const updateStatusText = ((): string => {
    switch (updateUi.kind) {
      case 'checking':
        return 'Checking for updates…'
      case 'latest':
        return "You're on the latest version"
      case 'available':
        return `Update v${updateUi.version} available`
      case 'downloading':
        return `Downloading update… ${Math.round(updateUi.percent)}%`
      case 'ready':
        return `Update v${updateUi.version} ready to install`
      case 'error':
        return updateUi.message
      default:
        return 'Check GitHub Releases for new builds'
    }
  })()

  return (
    <div className="settings-page">
      <div className="settings-container">
        <header className="settings-header">
          <div>
            <h1 className="settings-title">Settings</h1>
            <p className="settings-subtitle">
              Appearance, subtitles, playback, storage, and app updates.
            </p>
          </div>
          <button
            type="button"
            className="settings-save"
            disabled={saving}
            onClick={() => void onSave()}
          >
            <Save size={16} strokeWidth={2} />
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </header>

        <div className="settings-layout">
          <nav className="settings-rail" aria-label="Settings sections">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                className={`settings-rail-item${tab === id ? ' active' : ''}`}
                onClick={() => setTab(id)}
              >
                <Icon size={16} strokeWidth={1.75} aria-hidden />
                {label}
              </button>
            ))}
          </nav>

          <div className="settings-panel">
            {tab === 'appearance' && (
              <section className="settings-card">
                <h2 className="settings-card-title">Appearance</h2>
                <p className="settings-card-desc">Choose how CineVault looks across the app.</p>
                <Field label="Theme">
                  <ThemedSelect
                    variant="settings"
                    aria-label="Theme"
                    value={draft.theme}
                    onChange={(v) => set('theme', v as AppSettings['theme'])}
                    options={[
                      { value: 'dark', label: 'Dark' },
                      { value: 'light', label: 'Light' },
                      { value: 'system', label: 'System' }
                    ]}
                  />
                </Field>
                <p className="settings-hint">
                  Movies, series, and anime load automatically — no catalog API keys required.
                </p>
              </section>
            )}

            {tab === 'subtitles' && (
              <section className="settings-card">
                <h2 className="settings-card-title">Subtitles</h2>
                <p className="settings-card-desc">
                  Subtitles work automatically out of the box. Add a free Subdl key to unlock larger
                  catalogs and enhanced Arabic synchronization.
                </p>

                <div className="settings-account-hint">
                  <p>
                    No account required for basic public subtitles. Optional Subdl unlocks more
                    matches — create a free key on subdl.com if you want it.
                  </p>
                  <div className="settings-account-links">
                    <button
                      type="button"
                      className="settings-link-btn"
                      onClick={() => void openExternal('https://subdl.com')}
                    >
                      <ExternalLink size={14} strokeWidth={2} />
                      Open Subdl
                    </button>
                  </div>
                </div>

                <div className="settings-stack">
                  <Field label="Subdl API Key (Optional)">
                    <input
                      className="settings-input"
                      value={draft.subdlApiKey}
                      onChange={(e) => set('subdlApiKey', e.target.value)}
                      autoComplete="off"
                      placeholder="Paste your Subdl API key"
                    />
                  </Field>
                  <Field label="Default language">
                    <ThemedSelect
                      variant="settings"
                      aria-label="Default subtitle language"
                      value={draft.defaultSubtitleLanguage}
                      onChange={(v) => set('defaultSubtitleLanguage', v)}
                      options={SUB_LANGS.map((l) => ({
                        value: l,
                        label: `${SUB_LANG_LABELS[l] || l.toUpperCase()} (${l})`
                      }))}
                    />
                  </Field>
                </div>
                <button
                  type="button"
                  className="settings-btn-ghost"
                  onClick={async () => {
                    await saveSettings(draft)
                    try {
                      const { testSubdlKey } = await import('../services/subtitleService')
                      const result = await testSubdlKey(draft.subdlApiKey)
                      setMsg(result.message)
                    } catch (e) {
                      setMsg(e instanceof Error ? e.message : 'Key test failed')
                    }
                  }}
                >
                  Test Key
                </button>
              </section>
            )}

            {tab === 'playback' && (
              <section className="settings-card">
                <h2 className="settings-card-title">Playback</h2>
                <p className="settings-card-desc">Default stream quality and preferred source traits.</p>
                <Field label="Resolution">
                  <ThemedSelect
                    variant="settings"
                    aria-label="Default resolution"
                    value={draft.defaultQuality}
                    onChange={(v) => set('defaultQuality', v as AppSettings['defaultQuality'])}
                    options={[
                      { value: '2160p', label: '4K (2160p)' },
                      { value: '1440p', label: '2K (1440p)' },
                      { value: '1080p', label: '1080p' },
                      { value: '720p', label: '720p' }
                    ]}
                  />
                </Field>
                <div className="settings-toggles">
                  <Toggle
                    checked={draft.preferHdr}
                    onChange={(v) => set('preferHdr', v)}
                    label="Prefer HDR / Dolby Vision sources"
                    description="When torrent labels mention HDR, DV, or Dolby Vision"
                  />
                  <Toggle
                    checked={draft.preferSpatialAudio}
                    onChange={(v) => set('preferSpatialAudio', v)}
                    label="Prefer spatial / Atmos audio tracks"
                    description="When labels mention Atmos, TrueHD, or DTS:X"
                  />
                  <Toggle
                    checked={Boolean(draft.nightMode)}
                    onChange={(v) => set('nightMode', v)}
                    label="Night Mode (Dialogue Boost)"
                    description="Softens loud peaks and lifts quiet dialogue via Web Audio"
                  />
                </div>
                {draft.nightMode && (
                  <Field label={`Max volume boost (${Math.round((draft.volumeBoost || 1) * 100)}%)`}>
                    <input
                      className="settings-input"
                      type="range"
                      min={100}
                      max={200}
                      step={5}
                      value={Math.round((draft.volumeBoost || 1) * 100)}
                      onChange={(e) => set('volumeBoost', Number(e.target.value) / 100)}
                      aria-label="Max volume boost"
                    />
                  </Field>
                )}
              </section>
            )}

            {tab === 'storage' && (
              <>
                <section className="settings-card">
                  <h2 className="settings-card-title">Cache & storage</h2>
                  <p className="settings-card-desc">
                    {cacheStats
                      ? `${cacheStats.count} entries · ${formatBytes(cacheStats.bytes)}`
                      : 'Calculating cache size…'}
                  </p>

                  <div className="settings-path-row">
                    <code className="settings-path" title={cachePath}>
                      {cachePath}
                    </code>
                    <button
                      type="button"
                      className="settings-btn-ghost"
                      onClick={() => void window.cinevault.cache.openFolder()}
                    >
                      Open Folder
                    </button>
                  </div>

                  <Field label="Keep unfinished downloads (hours)">
                    <input
                      className="settings-input settings-input-narrow"
                      type="number"
                      min={1}
                      value={draft.cacheRetentionHours}
                      onChange={(e) => set('cacheRetentionHours', Number(e.target.value) || 48)}
                    />
                  </Field>

                  <Field label="Max torrent cache (GB)">
                    <input
                      className="settings-input settings-input-narrow"
                      type="number"
                      min={1}
                      max={500}
                      value={draft.maxCacheGB ?? 20}
                      onChange={(e) => {
                        const n = Number(e.target.value) || 20
                        set('maxCacheGB', n)
                        void window.cinevault?.torrent.enforceCacheCap?.(n)
                      }}
                    />
                  </Field>

                  <div className="settings-toggles">
                    <Toggle
                      checked={draft.autoDeleteOnComplete}
                      onChange={(v) => set('autoDeleteOnComplete', v)}
                      label="Delete cached media after finishing"
                      description="Removes downloaded files once playback completes"
                    />
                  </div>

                  <div className="settings-danger">
                    <div>
                      <strong>Danger zone</strong>
                      <p>Permanently delete all cached media from disk.</p>
                    </div>
                    <button
                      type="button"
                      className="settings-btn-danger"
                      onClick={async () => {
                        if (!confirm('Delete all cached media?')) return
                        try {
                          await window.cinevault.cache.clearAll()
                          useAppStore.setState({ lastSession: null, session: null })
                          setCacheStats(await window.cinevault.cache.stats())
                          setMsg('Cache cleared')
                        } catch (e) {
                          setMsg(e instanceof Error ? e.message : 'Cache clear failed')
                        }
                      }}
                    >
                      Clear Cache
                    </button>
                  </div>
                </section>

                <section className="settings-card">
                  <h2 className="settings-card-title">Library folders</h2>
                  <p className="settings-card-desc">
                    Local folders scanned for playable files on the Local & streams page.
                  </p>
                  {draft.libraryFolders.length === 0 ? (
                    <p className="settings-hint">No folders added yet.</p>
                  ) : (
                    <ul className="settings-folder-list">
                      {draft.libraryFolders.map((f) => (
                        <li key={f}>
                          <code className="settings-path">{f}</code>
                          <button
                            type="button"
                            className="settings-btn-ghost settings-btn-sm"
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
                  )}
                  <button
                    type="button"
                    className="settings-btn-ghost"
                    onClick={async () => {
                      await window.cinevault.library.pickFolder()
                      const next = await window.cinevault.settings.get()
                      setDraft(next)
                    }}
                  >
                    Add Folder
                  </button>
                </section>
              </>
            )}

            {tab === 'about' && (
              <section className="settings-card">
                <h2 className="settings-card-title">About</h2>
                <p className="settings-card-desc">
                  CineVault version and GitHub Releases updates.
                </p>

                <div className="settings-about-version">
                  <span className="settings-about-label">Current version</span>
                  <span className="settings-about-value">v{appVersion}</span>
                </div>

                <p className="settings-update-status" role="status">
                  {updateUi.kind === 'checking' && (
                    <span className="settings-update-spinner" aria-hidden />
                  )}
                  {updateStatusText}
                </p>

                {updateUi.kind === 'available' && updateUi.notes && (
                  <pre className="settings-release-notes">{updateUi.notes}</pre>
                )}

                {updateUi.kind === 'downloading' && (
                  <div className="settings-update-progress">
                    <div className="settings-update-bar" aria-hidden>
                      <span style={{ width: `${Math.min(100, Math.max(0, updateUi.percent))}%` }} />
                    </div>
                    <div className="settings-update-meta">
                      <span>{Math.round(updateUi.percent)}%</span>
                      <span>{formatSpeed(updateUi.bytesPerSecond)}</span>
                    </div>
                  </div>
                )}

                <div className="settings-update-actions">
                  {(updateUi.kind === 'idle' ||
                    updateUi.kind === 'checking' ||
                    updateUi.kind === 'latest' ||
                    updateUi.kind === 'error' ||
                    updateUi.kind === 'available') && (
                    <button
                      type="button"
                      className="settings-btn-ghost"
                      disabled={updateUi.kind === 'checking'}
                      onClick={() => void checkUpdates()}
                    >
                      <RefreshCw
                        size={15}
                        strokeWidth={2}
                        className={updateUi.kind === 'checking' ? 'spin' : undefined}
                      />
                      {updateUi.kind === 'checking' ? 'Checking…' : 'Check for Updates'}
                    </button>
                  )}

                  {updateUi.kind === 'available' && (
                    <button
                      type="button"
                      className="settings-save"
                      onClick={() => void window.cinevault.updater.download()}
                    >
                      Download now
                    </button>
                  )}

                  {updateUi.kind === 'downloading' && (
                    <span className="muted" style={{ fontSize: 12 }}>
                      Downloading update in the background…
                    </span>
                  )}

                  {updateUi.kind === 'ready' && (
                    <button
                      type="button"
                      className="settings-save"
                      onClick={() => void window.cinevault.updater.install()}
                    >
                      Restart to Update
                    </button>
                  )}
                </div>
              </section>
            )}
          </div>
        </div>

        {msg && <div className="settings-toast">{msg}</div>}
      </div>
    </div>
  )
}
