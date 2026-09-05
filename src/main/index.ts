import { app, BrowserWindow, ipcMain, shell, screen, protocol, net } from 'electron'
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { join, normalize } from 'path'
import { pathToFileURL } from 'url'
import { electronApp, optimizer, is } from './utils'
import { registerCacheHandlers } from './cache'
import { registerSettingsHandlers } from './settings'
import { registerLibraryHandlers } from './library'
import { registerOpenSubtitlesHandlers } from './opensubtitles'
import { registerSubtitleEngineHandlers } from './subtitlesEngine'
import { registerDownloaderHandlers } from './downloader'
import { registerTorznabHandlers } from './torznab'
import { destroyAllTorrents, registerTorrentHandlers } from './torrent'
import { registerTorrentRegistryHandlers } from './torrentRegistry'
import { setupAutoUpdater } from './updater'
import { startStreamProxy, stopStreamProxy } from './streamProxy'

// Unlock platform HEVC decoding + GPU paths before Chromium boots.
app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport')
app.commandLine.appendSwitch('ignore-gpu-blocklist')
app.commandLine.appendSwitch('enable-gpu-rasterization')
app.commandLine.appendSwitch('enable-zero-copy')

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'cvmedia',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true,
      corsEnabled: true
    }
  }
])

let mainWindow: BrowserWindow | null = null
let pipWindow: BrowserWindow | null = null

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: '#090d16',
    frame: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  const emitMaximized = (): void => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    mainWindow.webContents.send('window:maximized-changed', mainWindow.isMaximized())
  }
  mainWindow.on('maximize', emitMaximized)
  mainWindow.on('unmaximize', emitMaximized)

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function createPipWindow(bounds?: { x: number; y: number; width: number; height: number }): BrowserWindow {
  const display = screen.getPrimaryDisplay().workArea
  const width = bounds?.width ?? 420
  const height = bounds?.height ?? 236
  const x = bounds?.x ?? display.x + display.width - width - 24
  const y = bounds?.y ?? display.y + 24

  pipWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
    frame: false,
    alwaysOnTop: true,
    resizable: true,
    skipTaskbar: false,
    backgroundColor: '#000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  pipWindow.setAlwaysOnTop(true, 'screen-saver')
  pipWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    pipWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}#/pip`)
  } else {
    pipWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: '/pip' })
  }

  pipWindow.on('closed', () => {
    pipWindow = null
    mainWindow?.webContents.send('pip:closed')
  })

  return pipWindow
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.cinevault.app')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  try {
    startStreamProxy()
  } catch (err) {
    console.error('[main] stream proxy failed to start:', err)
  }

  protocol.handle('cvmedia', (request) => {
    const url = new URL(request.url)
    // cvmedia://local/C:/path/to/file.mp4  OR cvmedia://local/E/Movies/file.mp4
    let filePath = decodeURIComponent(url.pathname)
    if (process.platform === 'win32') {
      // pathname like /C:/Users/... or /C/Users...
      filePath = filePath.replace(/^\//, '')
      if (/^[a-zA-Z]\//.test(filePath)) {
        filePath = `${filePath[0]}:${filePath.slice(1)}`
      }
      filePath = normalize(filePath)
    }
    return net.fetch(pathToFileURL(filePath).toString())
  })

  registerSettingsHandlers()
  registerCacheHandlers()
  registerLibraryHandlers()
  registerOpenSubtitlesHandlers()
  registerSubtitleEngineHandlers()
  registerDownloaderHandlers()
  registerTorznabHandlers()
  registerTorrentHandlers()
  registerTorrentRegistryHandlers()

  createMainWindow()
  setupAutoUpdater(() => mainWindow)

  ipcMain.handle('window:minimize', () => mainWindow?.minimize())
  ipcMain.handle('window:close', () => mainWindow?.close())
  ipcMain.handle('window:toggle-maximize', () => {
    if (!mainWindow) return false
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize()
      return false
    }
    mainWindow.maximize()
    return true
  })
  ipcMain.handle('window:is-maximized', () => Boolean(mainWindow?.isMaximized()))
  // Kept for compatibility; custom title bar no longer uses native overlay.
  ipcMain.handle('window:set-titlebar-overlay', () => false)

  // Manual window drag — CSS -webkit-app-region is unreliable over full-bleed player layers.
  let dragOffset: { x: number; y: number } | null = null
  ipcMain.handle('window:drag-start', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return false
    if (mainWindow.isMaximized()) {
      // Windows-like: restore then start drag from cursor
      const cursor = screen.getCursorScreenPoint()
      mainWindow.unmaximize()
      const restored = mainWindow.getBounds()
      const x = Math.round(cursor.x - restored.width / 2)
      const y = Math.max(0, cursor.y - Math.round(restored.height * 0.08))
      mainWindow.setPosition(x, y)
      dragOffset = { x: cursor.x - x, y: cursor.y - y }
      return true
    }
    const cursor = screen.getCursorScreenPoint()
    const [wx, wy] = mainWindow.getPosition()
    dragOffset = { x: cursor.x - wx, y: cursor.y - wy }
    return true
  })
  ipcMain.handle('window:drag-move', () => {
    if (!mainWindow || mainWindow.isDestroyed() || !dragOffset) return false
    if (mainWindow.isMaximized()) return false
    const cursor = screen.getCursorScreenPoint()
    mainWindow.setPosition(cursor.x - dragOffset.x, cursor.y - dragOffset.y)
    return true
  })
  ipcMain.handle('window:drag-end', () => {
    dragOffset = null
    return true
  })

  ipcMain.handle('pip:open', (_e, bounds?: { x: number; y: number; width: number; height: number }) => {
    if (pipWindow && !pipWindow.isDestroyed()) {
      pipWindow.focus()
      return true
    }
    createPipWindow(bounds)
    return true
  })

  ipcMain.handle('pip:close', () => {
    if (pipWindow && !pipWindow.isDestroyed()) pipWindow.close()
    return true
  })

  ipcMain.handle('pip:set-always-on-top', (_e, flag: boolean) => {
    pipWindow?.setAlwaysOnTop(flag, 'screen-saver')
    return flag
  })

  ipcMain.handle('shell:open-path', async (_e, path: string) => shell.openPath(path))
  ipcMain.handle('shell:open-external', async (_e, url: string) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return false
    await shell.openExternal(url)
    return true
  })
  ipcMain.handle('shell:show-item', (_e, path: string) => {
    shell.showItemInFolder(path)
    return true
  })
  ipcMain.handle(
    'shell:open-external-player',
    async (
      _e,
      streamUrl: unknown
    ): Promise<{ success: boolean; player?: string; error?: string }> => {
      if (typeof streamUrl !== 'string' || !streamUrl.trim()) {
        return { success: false, error: 'Invalid stream URL' }
      }
      const url = streamUrl.trim()
      if (!/^(https?:\/\/|magnet:)/i.test(url)) {
        return { success: false, error: 'Unsupported stream URL' }
      }

      const absolutePlayers: string[] =
        process.platform === 'win32'
          ? [
              'C:\\Program Files\\VideoLAN\\VLC\\vlc.exe',
              'C:\\Program Files (x86)\\VideoLAN\\VLC\\vlc.exe',
              'C:\\Program Files\\mpv\\mpv.exe',
              join(process.env.LOCALAPPDATA || '', 'Programs', 'VideoLAN', 'VLC', 'vlc.exe')
            ]
          : process.platform === 'darwin'
            ? [
                '/Applications/VLC.app/Contents/MacOS/VLC',
                '/Applications/mpv.app/Contents/MacOS/mpv',
                '/opt/homebrew/bin/mpv',
                '/usr/local/bin/mpv'
              ]
            : ['/usr/bin/vlc', '/usr/local/bin/vlc', '/usr/bin/mpv', '/usr/local/bin/mpv']

      for (const exe of absolutePlayers) {
        if (!exe || !existsSync(exe)) continue
        try {
          const child = spawn(exe, [url], {
            detached: true,
            stdio: 'ignore',
            windowsHide: true
          })
          child.unref()
          return { success: true, player: exe }
        } catch {
          /* try next */
        }
      }

      // PATH lookup (vlc / mpv on PATH)
      for (const bin of ['vlc', 'mpv']) {
        try {
          const child = spawn(bin, [url], {
            detached: true,
            stdio: 'ignore',
            shell: process.platform === 'win32',
            windowsHide: true
          })
          child.on('error', () => {
            /* binary missing from PATH */
          })
          child.unref()
          return { success: true, player: bin }
        } catch {
          /* try next */
        }
      }

      try {
        await shell.openExternal(url)
        return { success: true, player: 'system' }
      } catch (e) {
        return {
          success: false,
          error: e instanceof Error ? e.message : 'Could not open external player'
        }
      }
    }
  )

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  stopStreamProxy()
  void destroyAllTorrents()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  stopStreamProxy()
})
