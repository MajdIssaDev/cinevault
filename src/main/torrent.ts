import { ipcMain } from 'electron'
import { existsSync, mkdirSync, rmSync } from 'fs'
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
  lastPlayheadSec?: number
  lastDurationSec?: number
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
  attachRangePrioritizer(server, opts.torrent, index)
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

async function destroyTorrentInstance(
  torrent: WebTorrent.Torrent,
  destroyStore: boolean
): Promise<void> {
  await new Promise<void>((resolve) => {
    try {
      torrent.destroy({ destroyStore }, () => resolve())
    } catch {
      resolve()
    }
    setTimeout(resolve, destroyStore ? 2500 : 1500)
  })
}

async function stopTorrent(
  id: string,
  opts?: { destroyStore?: boolean }
): Promise<boolean> {
  const destroyStore = Boolean(opts?.destroyStore)
  const entry = active.get(id)
  if (!entry) {
    return false
  }
  active.delete(id)

  await new Promise<void>((resolve) => {
    try {
      entry.server?.close(() => resolve())
    } catch {
      resolve()
    }
    setTimeout(resolve, 500)
  })

  await destroyTorrentInstance(entry.torrent, destroyStore)
  return true
}

/** Stop + optionally wipe downloaded files for any active id matching a predicate. */
export async function stopMatchingTorrents(
  match: (id: string) => boolean,
  opts?: { destroyStore?: boolean }
): Promise<string[]> {
  const ids = [...active.keys()].filter(match)
  for (const id of ids) await stopTorrent(id, opts)
  return ids
}

/**
 * Fully remove torrent data for a cache id and/or magnet (active or residual on disk).
 */
export async function destroyTorrentData(opts: {
  id?: string
  magnetUri?: string
  destroyStore?: boolean
}): Promise<boolean> {
  const destroyStore = opts.destroyStore !== false
  let removed = false

  if (opts.id && active.has(opts.id)) {
    removed = (await stopTorrent(opts.id, { destroyStore })) || removed
  }

  const hash = opts.magnetUri ? infoHashFromMagnet(opts.magnetUri) : null
  if (hash) {
    const hit = findActiveByInfoHash(hash)
    if (hit) {
      removed = (await stopTorrent(hit.id, { destroyStore })) || removed
    }

    const wt = client
    const known = wt && typeof wt.get === 'function' ? wt.get(hash) : null
    if (known) {
      // May already have been destroyed above; ignore duplicate destroy errors.
      const stillListed = [...active.values()].some((e) => e.torrent === known)
      if (!stillListed) {
        await destroyTorrentInstance(known, destroyStore)
        removed = true
      }
    }

    if (destroyStore) {
      const dir = join(torrentsDir(), hash)
      const dirUpper = join(torrentsDir(), hash.toUpperCase())
      for (const p of [dir, dirUpper]) {
        try {
          if (existsSync(p)) {
            rmSync(p, { recursive: true, force: true, maxRetries: 6, retryDelay: 120 })
            removed = true
          }
        } catch {
          /* ignore */
        }
      }
    }
  }

  return removed
}

type TorrentFilePieces = WebTorrent.TorrentFile & {
  _startPiece?: number
  _endPiece?: number
}

/** Jump torrent priority to the HTTP Range byte offset (seek). */
function prioritizePiecesAtByte(
  torrent: WebTorrent.Torrent,
  file: TorrentFilePieces,
  byteOffset: number
): void {
  const startPiece = file._startPiece ?? 0
  const endPiece = file._endPiece ?? startPiece
  const pieceLength = Math.max(1, torrent.pieceLength || 16_384)
  const rel = Math.max(0, byteOffset)
  const pieceIndex = Math.min(
    endPiece,
    Math.max(startPiece, startPiece + Math.floor(rel / pieceLength))
  )
  const critEnd = Math.min(endPiece, pieceIndex + 20)
  const behindEnd = Math.max(startPiece - 1, pieceIndex - 5 - 1)
  try {
    if (behindEnd >= startPiece) {
      torrent.deselect(startPiece, behindEnd, 0)
    }
    torrent.critical(pieceIndex, critEnd)
    torrent.select(pieceIndex, critEnd, 2)
  } catch {
    /* ignore */
  }
}

function attachRangePrioritizer(
  server: Server,
  torrent: WebTorrent.Torrent,
  fileIndex: number
): void {
  server.on('request', (req) => {
    try {
      const range = req.headers.range
      if (!range || typeof range !== 'string') return
      const m = /bytes=(\d+)/i.exec(range)
      if (!m) return
      const byteOffset = Number.parseInt(m[1], 10)
      if (!Number.isFinite(byteOffset) || byteOffset < 0) return
      const file = torrent.files[fileIndex] as TorrentFilePieces | undefined
      if (!file) return
      prioritizePiecesAtByte(torrent, file, byteOffset)
    } catch {
      /* ignore */
    }
  })
}

/** Sliding download window around the playhead (critical + high priority). */
function prioritizePlaybackWindow(opts: {
  id: string
  currentTime: number
  duration: number
}): boolean {
  const entry = active.get(opts.id)
  if (!entry?.ready) return false
  const file = entry.torrent.files[entry.fileIndex] as TorrentFilePieces | undefined
  if (!file) return false

  const startPiece = file._startPiece ?? 0
  const endPiece = file._endPiece ?? startPiece
  const pieceLength = Math.max(1, entry.torrent.pieceLength || 16_384)
  const fileLength = file.length || entry.total || 0
  if (fileLength <= 0 || endPiece < startPiece) return false

  const duration = opts.duration > 1 ? opts.duration : entry.lastDurationSec || 0
  const currentTime = Math.max(0, opts.currentTime || 0)
  entry.lastPlayheadSec = currentTime
  if (duration > 1) entry.lastDurationSec = duration

  const bytePos =
    duration > 1 ? Math.min(fileLength - 1, Math.floor((currentTime / duration) * fileLength)) : 0
  prioritizePiecesAtByte(entry.torrent, file, bytePos)

  // Also warm the next ~100MB as high priority beyond the critical window
  try {
    const pieceAt = Math.min(
      endPiece,
      Math.max(startPiece, startPiece + Math.floor(bytePos / pieceLength))
    )
    const criticalPieces = 20
    const highPieces = Math.max(16, Math.ceil((100 * 1024 * 1024) / pieceLength))
    const critEnd = Math.min(endPiece, pieceAt + criticalPieces)
    const highStart = Math.min(endPiece, critEnd + 1)
    const highEnd = Math.min(endPiece, critEnd + highPieces)
    if (highStart <= highEnd) {
      entry.torrent.select(highStart, highEnd, 1)
    }
  } catch {
    /* ignore */
  }
  return true
}

function announceTorrent(torrent: WebTorrent.Torrent): void {
  try {
    const discovery = (torrent as unknown as { discovery?: { tracker?: { update?: () => void } } })
      .discovery
    discovery?.tracker?.update?.()
  } catch {
    /* ignore */
  }
  try {
    const anyT = torrent as unknown as { announce?: () => void }
    anyT.announce?.()
  } catch {
    /* ignore */
  }
}

/** Force re-request of the playhead window + tracker announce (stall recovery). */
function nudgeTorrent(id: string): boolean {
  const entry = active.get(id)
  if (!entry?.ready) return false
  const ok = prioritizePlaybackWindow({
    id,
    currentTime: entry.lastPlayheadSec || 0,
    duration: entry.lastDurationSec || 0
  })
  announceTorrent(entry.torrent)
  try {
    // Brief pause/resume of selection can unstick some wires.
    const file = entry.torrent.files[entry.fileIndex] as TorrentFilePieces | undefined
    if (file) {
      const startPiece = file._startPiece ?? 0
      const endPiece = Math.min(
        file._endPiece ?? startPiece,
        startPiece + Math.max(8, Math.ceil((20 * 1024 * 1024) / Math.max(1, entry.torrent.pieceLength || 16384)))
      )
      entry.torrent.critical(startPiece, endPiece)
    }
  } catch {
    /* ignore */
  }
  return ok
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

  ipcMain.handle(
    'torrent:stop',
    async (_e, id: string, opts?: { destroyStore?: boolean }) =>
      stopTorrent(id, opts)
  )

  ipcMain.handle(
    'torrent:destroy-data',
    async (_e, opts: { id?: string; magnetUri?: string; destroyStore?: boolean }) =>
      destroyTorrentData(opts || {})
  )

  ipcMain.handle(
    'torrent:prioritize',
    (
      _e,
      opts: { id: string; currentTime: number; duration: number }
    ): boolean => {
      if (!opts?.id) return false
      return prioritizePlaybackWindow({
        id: opts.id,
        currentTime: opts.currentTime || 0,
        duration: opts.duration || 0
      })
    }
  )

  ipcMain.handle('torrent:nudge', (_e, id: string): boolean => {
    if (!id) return false
    return nudgeTorrent(id)
  })
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
