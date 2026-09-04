import { contextBridge, ipcRenderer } from 'electron'
import type { AppSettings } from '../main/settings'
import type { CacheEntry } from '../main/cache'
import type { LibraryItem } from '../main/library'
import type { SubtitleResult } from '../main/opensubtitles'

const api = {
  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
    set: (partial: Partial<AppSettings>): Promise<AppSettings> =>
      ipcRenderer.invoke('settings:set', partial),
    userData: (): Promise<string> => ipcRenderer.invoke('settings:get-user-data')
  },
  cache: {
    list: (): Promise<CacheEntry[]> => ipcRenderer.invoke('cache:list'),
    upsert: (entry: CacheEntry): Promise<CacheEntry> => ipcRenderer.invoke('cache:upsert', entry),
    markComplete: (id: string): Promise<CacheEntry | null> =>
      ipcRenderer.invoke('cache:mark-complete', id),
    remove: (id: string): Promise<boolean> => ipcRenderer.invoke('cache:remove', id),
    clearAll: (): Promise<boolean> => ipcRenderer.invoke('cache:clear-all'),
    openFolder: (): Promise<string> => ipcRenderer.invoke('cache:open-folder'),
    stats: (): Promise<{ bytes: number; count: number; directory: string }> =>
      ipcRenderer.invoke('cache:stats'),
    getDir: (): Promise<string> => ipcRenderer.invoke('cache:get-dir')
  },
  library: {
    pickFolder: (): Promise<string | null> => ipcRenderer.invoke('library:pick-folder'),
    scan: (): Promise<LibraryItem[]> => ipcRenderer.invoke('library:scan'),
    removeFolder: (folder: string): Promise<boolean> =>
      ipcRenderer.invoke('library:remove-folder', folder),
    matchTitle: (query: string): Promise<LibraryItem[]> =>
      ipcRenderer.invoke('library:match-title', query)
  },
  subs: {
    loginTest: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('subs:login-test'),
    search: (query: Record<string, unknown>): Promise<SubtitleResult[]> =>
      ipcRenderer.invoke('subs:search', query),
    download: (fileId: number, name?: string): Promise<string> =>
      ipcRenderer.invoke('subs:download', fileId, name),
    saveVtt: (content: string, name: string): Promise<string> =>
      ipcRenderer.invoke('subs:save-vtt', content, name)
  },
  download: {
    start: (opts: { id: string; url: string; fileName: string }): Promise<{ path: string }> =>
      ipcRenderer.invoke('download:start', opts),
    status: (
      id: string
    ): Promise<{
      bytesReceived: number
      bytesTotal: number
      speed: number
      done: boolean
      error?: string
      path?: string
    } | null> => ipcRenderer.invoke('download:status', id),
    toFileUrl: (filePath: string): Promise<string> =>
      ipcRenderer.invoke('download:path-for-file-url', filePath)
  },
  window: {
    minimize: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
    close: (): Promise<void> => ipcRenderer.invoke('window:close'),
    toggleMaximize: (): Promise<boolean> => ipcRenderer.invoke('window:toggle-maximize')
  },
  pip: {
    open: (bounds?: { x: number; y: number; width: number; height: number }): Promise<boolean> =>
      ipcRenderer.invoke('pip:open', bounds),
    close: (): Promise<boolean> => ipcRenderer.invoke('pip:close'),
    setAlwaysOnTop: (flag: boolean): Promise<boolean> =>
      ipcRenderer.invoke('pip:set-always-on-top', flag),
    onClosed: (cb: () => void): (() => void) => {
      const handler = (): void => cb()
      ipcRenderer.on('pip:closed', handler)
      return () => ipcRenderer.removeListener('pip:closed', handler)
    }
  },
  shell: {
    openPath: (path: string): Promise<string> => ipcRenderer.invoke('shell:open-path', path),
    showItem: (path: string): Promise<boolean> => ipcRenderer.invoke('shell:show-item', path)
  },
  torznab: {
    get: (url: string): Promise<{ status: number; body: string }> =>
      ipcRenderer.invoke('torznab:get', url)
  },
  updater: {
    onStatus: (cb: (payload: unknown) => void): (() => void) => {
      const handler = (_: unknown, payload: unknown): void => cb(payload)
      ipcRenderer.on('updater:status', handler)
      return () => ipcRenderer.removeListener('updater:status', handler)
    }
  }
}

contextBridge.exposeInMainWorld('cinevault', api)

export type CineVaultApi = typeof api
