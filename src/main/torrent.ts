import { ipcMain } from 'electron'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import type { Server } from 'http'
import WebTorrent from 'webtorrent'
import { getDefaultCacheDir, loadSettings } from './settings'

const VIDEO_EXT = /\.(mp4|mkv|avi|webm|m4v|mov|wmv|flv|ts|m2ts)$/i

export interface TorrentStatus {
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
}

interface ActiveTorrent {
  torrent: WebTorrent.Torrent
  server: Server | null
  port: number
  fileIndex: number
  fileName: string
  total: number
  ready: boolean
  error?: string
  streamUrl?: string
}

let client: WebTorrent.Instance | null = null
const active = new Map<string, ActiveTorrent>()

function getClient(): WebTorrent.Instance {
  if (!client) client = new WebTorrent()
  return client
}

function torrentsDir(): string {
  const dir = join(loadSettings().cacheDirectory || getDefaultCacheDir(), 'torrents')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function pickVideoFile(
  torrent: WebTorrent.Torrent
): { file: WebTorrent.TorrentFile; index: number } | null {
  let best: { file: WebTorrent.TorrentFile; index: number } | null = null
  torrent.files.forEach((file, index) => {
    if (!VIDEO_EXT.test(file.name)) return
    if (!best || file.length > best.file.length) best = { file, index }
  })
  if (best) return best
  torrent.files.forEach((file, index) => {
    if (!best || file.length > best.file.length) best = { file, index }
  })
  return best
}

function listenServer(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error('Torrent stream server timed out'))
    }, 12_000)
    const onError = (err: Error): void => {
      cleanup()
      reject(err)
    }
    const cleanup = (): void => {
      clearTimeout(timeout)
      server.removeListener('error', onError)
    }
    server.once('error', onError)
    server.listen(0, '127.0.0.1', () => {
      cleanup()
      const addr = server.address()
      if (addr && typeof addr === 'object') resolve(addr.port)
      else reject(new Error('Failed to bind torrent stream server'))
    })
  })
}

function toStatus(entry: ActiveTorrent): TorrentStatus {
  const t = entry.torrent
  return {
    progress: t.progress,
    downloadSpeed: t.downloadSpeed,
    uploadSpeed: t.uploadSpeed,
    peers: t.numPeers,
    downloaded: t.downloaded,
    total: entry.total || t.length,
    ready: entry.ready,
    done: Boolean(t.done),
    error: entry.error,
    streamUrl: entry.streamUrl,
    fileName: entry.fileName
  }
}

function infoHashFromMagnet(magnet: string): string | null {
  const m = magnet.match(/xt=urn:btih:([a-fA-F0-9]{40}|[a-zA-Z2-7]{32})/i)
  return m ? m[1].toLowerCase() : null
}

function findActiveByInfoHash(hash: string): { id: string; entry: ActiveTorrent } | null {
  const needle = hash.toLowerCase()
  for (const [id, entry] of active) {
    const ih = entry.torrent.infoHash?.toLowerCase()
    if (ih && ih === needle) return { id, entry }
  }
  return null
}

async function ensureStream(opts: {
  id: string
  torrent: WebTorrent.Torrent
}): Promise<{ streamUrl: string; fileName: string; size: number }> {
  const existing = active.get(opts.id)
  if (existing?.streamUrl && existing.ready && existing.torrent === opts.torrent) {
    return {
      streamUrl: existing.streamUrl,
      fileName: existing.fileName,
      size: existing.total
    }
  }

  // Drop any other map entry that points at this torrent instance
  for (const [id, entry] of active) {
    if (entry.torrent === opts.torrent && id !== opts.id) {
      active.delete(id)
      if (entry.server && entry.streamUrl) {
        active.set(opts.id, { ...entry })
        return {
          streamUrl: entry.streamUrl,
          fileName: entry.fileName,
          size: entry.total
        }
      }
      try {
        entry.server?.close()
      } catch {
        /* ignore */
      }
    }
  }

  const picked = pickVideoFile(opts.torrent)
  if (!picked) {
    throw new Error('No video file found in torrent')
  }

  const { file, index } = picked
  opts.torrent.files.forEach((f, i) => {
    try {
      if (i === index) f.select()
      else f.deselect()
    } catch {
      /* ignore */
    }
  })

  try {
    const startPiece = (file as { _startPiece?: number })._startPiece ?? 0
    const endPiece = (file as { _endPiece?: number })._endPiece ?? startPiece
    const span = Math.max(1, endPiece - startPiece + 1)
    const warmEnd = Math.min(endPiece, startPiece + Math.max(24, Math.ceil(span * 0.05)))
    opts.torrent.critical(startPiece, warmEnd)
    opts.torrent.select(startPiece, warmEnd, 1)
  } catch {
    /* ignore */
  }

  const server = opts.torrent.createServer() as Server
  const port = await listenServer(server)
  const streamUrl = `http://127.0.0.1:${port}/${index}`

  active.set(opts.id, {
    torrent: opts.torrent,
    server,
    port,
    fileIndex: index,
    fileName: file.name,
    total: file.length,
    ready: true,
    streamUrl
  })

  return { streamUrl, fileName: file.name, size: file.length }
}

async function startTorrent(opts: {
  id: string
  magnetUri: string
}): Promise<{ streamUrl: string; fileName: string; size: number }> {
  const existing = active.get(opts.id)
  if (existing?.streamUrl && existing.ready) {
    return {
      streamUrl: existing.streamUrl,
      fileName: existing.fileName,
      size: existing.total
    }
  }
  if (existing) await stopTorrent(opts.id)

  const magnet = opts.magnetUri.trim()
  if (!magnet.toLowerCase().startsWith('magnet:')) {
    throw new Error('Invalid magnet URI')
  }

  const wt = getClient()
  const path = torrentsDir()
  const hash = infoHashFromMagnet(magnet)

  // Resume / re-open: same magnet under a new cache id must reuse the live torrent.
  if (hash) {
    const hit = findActiveByInfoHash(hash)
    if (hit) {
      if (hit.id !== opts.id) {
        active.delete(hit.id)
        active.set(opts.id, hit.entry)
      }
      if (hit.entry.streamUrl && hit.entry.ready) {
        return {
          streamUrl: hit.entry.streamUrl,
          fileName: hit.entry.fileName,
          size: hit.entry.total
        }
      }
      return ensureStream({ id: opts.id, torrent: hit.entry.torrent })
    }

    const known = typeof wt.get === 'function' ? wt.get(hash) : null
    if (known) {
      return ensureStream({ id: opts.id, torrent: known })
    }
  }

  const torrent = await new Promise<WebTorrent.Torrent>((resolve, reject) => {
    let t: WebTorrent.Torrent
    let settled = false
    try {
      t = wt.add(magnet, { path })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (/duplicate/i.test(msg) && hash) {
        const dup = typeof wt.get === 'function' ? wt.get(hash) : null
        if (dup) {
          resolve(dup)
          return
        }
      }
      reject(err instanceof Error ? err : new Error(msg))
      return
    }

    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      fn()
    }

    const timeout = setTimeout(() => {
      finish(() => {
        cleanup()
        try {
          t.destroy({ destroyStore: false })
        } catch {
          /* ignore */
        }
        reject(new Error('Torrent metadata timed out (no peers / slow network)'))
      })
    }, 25_000)
    const onReady = (): void => {
      finish(() => {
        clearTimeout(timeout)
        cleanup()
        resolve(t)
      })
    }
    const onError = (err: Error | string): void => {
      finish(() => {
        clearTimeout(timeout)
        cleanup()
        const message = err instanceof Error ? err.message : String(err)
        if (/duplicate/i.test(message) && hash) {
          const dup = typeof wt.get === 'function' ? wt.get(hash) : null
          if (dup) {
            resolve(dup)
            return
          }
        }
        reject(err instanceof Error ? err : new Error(message))
      })
    }
    const cleanup = (): void => {
      t.removeListener('ready', onReady)
      t.removeListener('error', onError)
    }
    if (t.ready) {
      finish(() => {
        clearTimeout(timeout)
        resolve(t)
      })
      return
    }
    t.once('ready', onReady)
    t.once('error', onError)
  })

  return ensureStream({ id: opts.id, torrent })
}

async function stopTorrent(id: string): Promise<boolean> {
  const entry = active.get(id)
  if (!entry) return false
  active.delete(id)

  await new Promise<void>((resolve) => {
    try {
      entry.server?.close(() => resolve())
    } catch {
      resolve()
    }
    setTimeout(resolve, 500)
  })

  await new Promise<void>((resolve) => {
    try {
      entry.torrent.destroy({ destroyStore: false }, () => resolve())
    } catch {
      resolve()
    }
    setTimeout(resolve, 1500)
  })

  return true
}

export function registerTorrentHandlers(): void {
  ipcMain.handle(
    'torrent:start',
    async (_e, opts: { id: string; magnetUri: string; fileName?: string }) => {
      if (!opts?.id || !opts?.magnetUri) throw new Error('Missing torrent id or magnet URI')
      return startTorrent({ id: opts.id, magnetUri: opts.magnetUri })
    }
  )

  ipcMain.handle('torrent:status', (_e, id: string): TorrentStatus | null => {
    const entry = active.get(id)
    if (!entry) return null
    return toStatus(entry)
  })

  ipcMain.handle('torrent:stop', async (_e, id: string) => stopTorrent(id))
}

export async function destroyAllTorrents(): Promise<void> {
  const ids = [...active.keys()]
  for (const id of ids) await stopTorrent(id)
  if (client) {
    await new Promise<void>((resolve) => {
      try {
        client!.destroy(() => resolve())
      } catch {
        resolve()
      }
      setTimeout(resolve, 2000)
    })
    client = null
  }
}
