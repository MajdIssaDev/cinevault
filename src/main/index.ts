import { app, BrowserWindow, ipcMain, shell, screen, nativeTheme, protocol, net } from 'electron'
import { join, normalize } from 'path'
import { pathToFileURL } from 'url'
import { electronApp, optimizer, is } from './utils'
import { registerCacheHandlers } from './cache'
import { registerSettingsHandlers } from './settings'
import { registerLibraryHandlers } from './library'
import { registerOpenSubtitlesHandlers } from './opensubtitles'
import { registerDownloaderHandlers } from './downloader'
import { registerTorznabHandlers } from './torznab'
import { setupAutoUpdater } from './updater'

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
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0b0d10' : '#f4f6f8',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: nativeTheme.shouldUseDarkColors ? '#0b0d10' : '#f4f6f8',
      symbolColor: nativeTheme.shouldUseDarkColors ? '#e8ecf1' : '#1a1f26',
      height: 36
    },
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
  registerDownloaderHandlers()
  registerTorznabHandlers()

  createMainWindow()
  setupAutoUpdater(mainWindow)

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
  ipcMain.handle('shell:show-item', (_e, path: string) => {
    shell.showItemInFolder(path)
    return true
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
