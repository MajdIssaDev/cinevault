import { ipcMain } from 'electron'
import { createWriteStream, existsSync, mkdirSync, statSync } from 'fs'
import { join } from 'path'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'
import { loadSettings, getDefaultCacheDir } from './settings'

const downloads = new Map<
  string,
  { bytesReceived: number; bytesTotal: number; speed: number; done: boolean; error?: string; path?: string }
>()

export function registerDownloaderHandlers(): void {
  ipcMain.handle(
    'download:start',
    async (
      _e,
      opts: { id: string; url: string; fileName: string }
    ): Promise<{ path: string }> => {
      const dir = join(loadSettings().cacheDirectory || getDefaultCacheDir(), 'streams')
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      const dest = join(dir, opts.fileName.replace(/[^\w.\-]+/g, '_'))

      downloads.set(opts.id, { bytesReceived: 0, bytesTotal: 0, speed: 0, done: false, path: dest })

      const res = await fetch(opts.url)
      if (!res.ok || !res.body) {
        downloads.set(opts.id, {
          bytesReceived: 0,
          bytesTotal: 0,
          speed: 0,
          done: true,
          error: `HTTP ${res.status}`
        })
        throw new Error(`Download failed: ${res.status}`)
      }

      const total = Number(res.headers.get('content-length') || 0)
      let received = 0
      let lastReceived = 0
      let lastTs = Date.now()

      const webStream = res.body as unknown as import('stream/web').ReadableStream
      const nodeReadable = Readable.fromWeb(webStream)
      nodeReadable.on('data', (chunk: Buffer) => {
        received += chunk.length
        const now = Date.now()
        const dt = (now - lastTs) / 1000
        if (dt >= 0.5) {
          const speed = (received - lastReceived) / dt
          lastReceived = received
          lastTs = now
          downloads.set(opts.id, {
            bytesReceived: received,
            bytesTotal: total,
            speed,
            done: false,
            path: dest
          })
        }
      })

      await pipeline(nodeReadable, createWriteStream(dest))
      downloads.set(opts.id, {
        bytesReceived: received || (existsSync(dest) ? statSync(dest).size : 0),
        bytesTotal: total || received,
        speed: 0,
        done: true,
        path: dest
      })
      return { path: dest }
    }
  )

  ipcMain.handle('download:status', (_e, id: string) => downloads.get(id) || null)

  ipcMain.handle('download:path-for-file-url', (_e, filePath: string) => {
    const normalized = filePath.replace(/\\/g, '/')
    return `cvmedia://local/${encodeURI(normalized)}`
  })
}
