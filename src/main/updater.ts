import { BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import { is } from './utils'

export function setupAutoUpdater(getMain?: BrowserWindow | null): void {
  if (is.dev) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  const send = (channel: string, payload?: unknown): void => {
    const win = BrowserWindow.getAllWindows()[0] || getMain
    win?.webContents.send(channel, payload)
  }

  autoUpdater.on('checking-for-update', () => send('updater:status', { status: 'checking' }))
  autoUpdater.on('update-available', (info) => send('updater:status', { status: 'available', info }))
  autoUpdater.on('update-not-available', () => send('updater:status', { status: 'none' }))
  autoUpdater.on('error', (err) => send('updater:status', { status: 'error', message: err.message }))
  autoUpdater.on('download-progress', (p) =>
    send('updater:status', { status: 'downloading', percent: p.percent })
  )
  autoUpdater.on('update-downloaded', (info) =>
    send('updater:status', { status: 'ready', info })
  )

  setTimeout(() => {
    autoUpdater.checkForUpdatesAndNotify().catch(() => undefined)
  }, 4000)
}
