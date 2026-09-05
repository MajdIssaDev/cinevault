import { BrowserWindow, app, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import { is } from './utils'

export type UpdaterPayload =
  | { status: 'checking' }
  | { status: 'available'; version: string; releaseNotes: string | null }
  | { status: 'none' }
  | {
      status: 'downloading'
      percent: number
      bytesPerSecond: number
      transferred: number
      total: number
    }
  | { status: 'ready'; version: string }
  | { status: 'error'; message: string; silent: boolean }

function releaseNotesText(notes: unknown): string | null {
  if (!notes) return null
  if (typeof notes === 'string') return notes
  if (Array.isArray(notes)) {
    return notes
      .map((n) => (typeof n === 'string' ? n : (n as { note?: string })?.note || ''))
      .filter(Boolean)
      .join('\n')
  }
  return null
}

function isBenignUpdaterError(message: string): boolean {
  const m = message.toLowerCase()
  return (
    m.includes('404') ||
    m.includes('not found') ||
    m.includes('enoent') ||
    m.includes('enotfound') ||
    m.includes('econnrefused') ||
    m.includes('econnreset') ||
    m.includes('etimedout') ||
    m.includes('network') ||
    m.includes('offline') ||
    m.includes('private') ||
    m.includes('unauthorized') ||
    m.includes('403') ||
    m.includes('no published versions') ||
    m.includes('cannot find latest') ||
    m.includes('http 4') ||
    m.includes('http 5')
  )
}

/**
 * GitHub Releases auto-update. Safe when offline, unlinked, or unpublished.
 * Downloads updates in the background when available; install on restart.
 */
export function setupAutoUpdater(getWindow: () => BrowserWindow | null): void {
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowDowngrade = false

  // Avoid electron-updater dialogs; we surface state in Settings.
  autoUpdater.logger = null

  const send = (payload: UpdaterPayload): void => {
    const win = getWindow() || BrowserWindow.getAllWindows()[0] || null
    if (!win || win.isDestroyed()) return
    try {
      win.webContents.send('updater:status', payload)
    } catch (err) {
      console.warn('[updater] failed to send status', err)
    }
  }

  autoUpdater.on('checking-for-update', () => {
    send({ status: 'checking' })
  })

  autoUpdater.on('update-available', (info) => {
    send({
      status: 'available',
      version: info.version,
      releaseNotes: releaseNotesText(info.releaseNotes)
    })
    // autoDownload=true starts the download; surface progress next.
  })

  autoUpdater.on('update-not-available', () => {
    send({ status: 'none' })
  })

  autoUpdater.on('download-progress', (p) => {
    send({
      status: 'downloading',
      percent: p.percent,
      bytesPerSecond: p.bytesPerSecond,
      transferred: p.transferred,
      total: p.total
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    send({ status: 'ready', version: info.version })
  })

  autoUpdater.on('error', (err) => {
    const message = err?.message || String(err)
    const silent = isBenignUpdaterError(message)
    console.warn('[updater]', silent ? 'benign error' : 'error', message)
    send({ status: 'error', message, silent })
  })

  ipcMain.handle('updater:get-version', () => app.getVersion())

  ipcMain.handle('updater:check', async () => {
    if (is.dev || !app.isPackaged) {
      send({
        status: 'error',
        message: 'Updates are available in packaged builds only.',
        silent: true
      })
      return { ok: false, reason: 'dev' as const }
    }
    try {
      const result = await autoUpdater.checkForUpdates()
      return { ok: true, updateInfo: result?.updateInfo?.version ?? null }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const silent = isBenignUpdaterError(message)
      console.warn('[updater] check failed', message)
      send({ status: 'error', message, silent })
      return { ok: false, reason: 'error' as const }
    }
  })

  ipcMain.handle('updater:download', async () => {
    if (is.dev || !app.isPackaged) {
      return { ok: false, reason: 'dev' as const }
    }
    try {
      await autoUpdater.downloadUpdate()
      return { ok: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn('[updater] download failed', message)
      send({ status: 'error', message, silent: isBenignUpdaterError(message) })
      return { ok: false, reason: 'error' as const }
    }
  })

  ipcMain.handle('updater:install', () => {
    if (is.dev || !app.isPackaged) return { ok: false }
    try {
      // isSilent=false, isForceRunAfter=true
      autoUpdater.quitAndInstall(false, true)
      return { ok: true }
    } catch (err) {
      console.warn('[updater] quitAndInstall failed', err)
      return { ok: false }
    }
  })

  // Quiet background probe — never throws to the user.
  if (!is.dev && app.isPackaged) {
    setTimeout(() => {
      void autoUpdater.checkForUpdates().catch((err) => {
        console.warn('[updater] background check skipped', err instanceof Error ? err.message : err)
      })
    }, 8000)

    // Recheck daily while the app stays open
    setInterval(
      () => {
        void autoUpdater.checkForUpdates().catch(() => undefined)
      },
      24 * 60 * 60 * 1000
    )
  }
}
