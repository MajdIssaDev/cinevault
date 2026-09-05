import { contextBridge, ipcRenderer } from 'electron'
import type { AppSettings } from '../main/settings'
import type { CacheEntry } from '../main/cache'
import type { LibraryItem } from '../main/library'

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
    search: (query: Record<string, unknown>): Promise<
      { id: string; language: string; release: string; downloadCount: number; hearingImpaired: boolean; fileId: number; fps: number | null }[]
    > => ipcRenderer.invoke('subs:search', query),
    download: (fileId: number, name?: string): Promise<string> =>
      ipcRenderer.invoke('subs:download', fileId, name),
    saveVtt: (content: string, name: string): Promise<string> =>
      ipcRenderer.invoke('subs:save-vtt', content, name),
    available: (query: {
      imdbId?: string
      type?: 'movie' | 'series' | 'episode' | 'tv'
      lang?: string
      season?: number
      episode?: number
      title?: string
      releaseHint?: string
    }): Promise<
      {
        id: string
        label: string
        language: string
        url: string | null
        provider: 'Subdl' | 'Public'
        nId?: string
        downloadUrl?: string
        releaseName?: string
        matchScore?: number
      }[]
    > => ipcRenderer.invoke('subs:available', query),
    resolve: (
      item: {
        id: string
        label: string
        language: string
        url: string | null
        provider: 'Subdl' | 'Public'
        nId?: string
        downloadUrl?: string
        releaseName?: string
        matchScore?: number
      },
      lang?: string
    ): Promise<{
      path: string | null
      url: string | null
      content: string | null
      label: string
      language: string
      provider: 'Subdl' | 'Public'
    }> => ipcRenderer.invoke('subs:resolve', item, lang),
    testSubdl: (apiKey?: string): Promise<{ ok: boolean; message: string }> =>
      ipcRenderer.invoke('subs:test-subdl', apiKey)
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
    toggleMaximize: (): Promise<boolean> => ipcRenderer.invoke('window:toggle-maximize'),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:is-maximized'),
    onMaximizedChanged: (cb: (maximized: boolean) => void): (() => void) => {
      const handler = (_event: unknown, maximized: boolean): void => cb(Boolean(maximized))
      ipcRenderer.on('window:maximized-changed', handler)
      return () => ipcRenderer.removeListener('window:maximized-changed', handler)
    },
    setTitleBarOverlay: (_opts: {
      color: string
      symbolColor: string
      height?: number
    }): Promise<boolean> => ipcRenderer.invoke('window:set-titlebar-overlay')
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
    openExternal: (url: string): Promise<boolean> => ipcRenderer.invoke('shell:open-external', url),
    showItem: (path: string): Promise<boolean> => ipcRenderer.invoke('shell:show-item', path),
    openExternalPlayer: (
      streamUrl: string
    ): Promise<{ success: boolean; player?: string; error?: string }> =>
      ipcRenderer.invoke('shell:open-external-player', streamUrl)
  },
  torznab: {
    get: (url: string): Promise<{ status: number; body: string; error?: string }> =>
      ipcRenderer.invoke('torznab:get', url)
  },
  torrent: {
    start: (opts: {
      id: string
      magnetUri: string
      fileName?: string
    }): Promise<{ streamUrl: string; fileName: string; size: number }> =>
      ipcRenderer.invoke('torrent:start', opts),
    status: (
      id: string
    ): Promise<{
      progress: number
      downloadSpeed: number
      uploadSpeed: number
      peers: number
      downloaded: number
      total: number
      ready: boolean
      done: boolean
      error?: string
      streamUrl?: string
      fileName?: string
    } | null> => ipcRenderer.invoke('torrent:status', id),
    stop: (id: string): Promise<boolean> => ipcRenderer.invoke('torrent:stop', id),
    prioritize: (opts: {
      id: string
      currentTime: number
      duration: number
    }): Promise<boolean> => ipcRenderer.invoke('torrent:prioritize', opts),
    nudge: (id: string): Promise<boolean> => ipcRenderer.invoke('torrent:nudge', id)
  },
  updater: {
    getVersion: (): Promise<string> => ipcRenderer.invoke('updater:get-version'),
    check: (): Promise<{ ok: boolean; reason?: string; updateInfo?: string | null }> =>
      ipcRenderer.invoke('updater:check'),
    download: (): Promise<{ ok: boolean; reason?: string }> => ipcRenderer.invoke('updater:download'),
    install: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('updater:install'),
    onStatus: (cb: (payload: {
        status: string
        version?: string
        releaseNotes?: string | null
        percent?: number
        bytesPerSecond?: number
        transferred?: number
        total?: number
        message?: string
        silent?: boolean
      }) => void): (() => void) => {
      const handler = (_event: unknown, payload: unknown): void =>
        cb(payload as Parameters<typeof cb>[0])
      ipcRenderer.on('updater:status', handler)
      return () => ipcRenderer.removeListener('updater:status', handler)
    }
  }
}

contextBridge.exposeInMainWorld('cinevault', api)

export type CineVaultApi = typeof api
