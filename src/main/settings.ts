import { app, ipcMain } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

export type ThemeMode = 'dark' | 'light' | 'system'

export interface AppSettings {
  theme: ThemeMode
  tmdbApiKey: string
  subdlApiKey: string
  openSubtitlesApiKey: string
  openSubtitlesUsername: string
  openSubtitlesPassword: string
  defaultSubtitleLanguage: string
  defaultQuality: '720p' | '1080p' | '1440p' | '2160p'
  libraryFolders: string[]
  cacheDirectory: string
  cacheRetentionHours: number
  autoDeleteOnComplete: boolean
  preferHdr: boolean
  preferSpatialAudio: boolean
  updateChannel: 'latest'
}

const DEFAULTS: AppSettings = {
  theme: 'dark',
  tmdbApiKey: '',
  subdlApiKey: '',
  openSubtitlesApiKey: '',
  openSubtitlesUsername: '',
  openSubtitlesPassword: '',
  defaultSubtitleLanguage: 'en',
  defaultQuality: '1080p',
  libraryFolders: [],
  cacheDirectory: '',
  cacheRetentionHours: 48,
  autoDeleteOnComplete: true,
  preferHdr: true,
  preferSpatialAudio: true,
  updateChannel: 'latest'
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export function getDefaultCacheDir(): string {
  return join(app.getPath('userData'), 'media-cache')
}

export function loadSettings(): AppSettings {
  try {
    if (!existsSync(settingsPath())) return { ...DEFAULTS, cacheDirectory: getDefaultCacheDir() }
    const raw = JSON.parse(readFileSync(settingsPath(), 'utf-8')) as Partial<AppSettings>
    return {
      ...DEFAULTS,
      ...raw,
      cacheDirectory: raw.cacheDirectory || getDefaultCacheDir()
    }
  } catch {
    return { ...DEFAULTS, cacheDirectory: getDefaultCacheDir() }
  }
}

export function saveSettings( partial: Partial<AppSettings>): AppSettings {
  const next = { ...loadSettings(), ...partial }
  if (!next.cacheDirectory) next.cacheDirectory = getDefaultCacheDir()
  if (!existsSync(next.cacheDirectory)) mkdirSync(next.cacheDirectory, { recursive: true })
  writeFileSync(settingsPath(), JSON.stringify(next, null, 2), 'utf-8')
  return next
}

export function registerSettingsHandlers(): void {
  ipcMain.handle('settings:get', () => loadSettings())
  ipcMain.handle('settings:set', (_e, partial: Partial<AppSettings>) => saveSettings(partial))
  ipcMain.handle('settings:get-user-data', () => app.getPath('userData'))
}
