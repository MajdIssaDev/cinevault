import { dialog, ipcMain } from 'electron'
import { existsSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import http, { type IncomingMessage, type Server, type ServerResponse } from 'http'
import type { Readable } from 'stream'
import WebTorrent from 'webtorrent'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Piece = require('torrent-piece') as new (length: number) => {
  length: number
  missing: number
}
import { getDefaultCacheDir, loadSettings } from './settings'
import {
  BUFFER_AHEAD_PIECES,
  RETAIN_BEHIND_PIECES,
  createRollingPieceStoreConstructor,
  removeRollingCache,
  type RollingStoreInstance
} from './rollingPieceStore'
import { killStreamProxyForSource } from './streamProxy'

const VIDEO_EXT = /\.(mp4|mkv|avi|webm|m4v|mov|wmv|flv|ts|m2ts)$/i
/** Contiguous bytes ahead of playhead that unlock playback (matches renderer). */
export const PREBUFFER_BYTES = 35 * 1024 * 1024

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
  /** Contiguous verified bytes from the active playhead forward. */
  contiguousForwardBytes?: number
  currentPiece?: number
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
  rollingStore?: RollingStoreInstance | null
}

let client: WebTorrent.Instance | null = null
const active = new Map<string, ActiveTorrent>()
let webtorrentGuardsInstalled = false

function isWebtorrentPieceRace(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const msg = err.message || ''
  const stack = err.stack || ''
  return (
    (/reading ['"]missing['"]/i.test(msg) || /Cannot read propert(?:y|ies) of null/i.test(msg)) &&
    (/webtorrent/i.test(stack) ||
      /trySelectWire/i.test(stack) ||
      /speedRanker/i.test(stack) ||
      /_updateWire/i.test(stack))
  )
}

/**
 * WebTorrent can throw TypeError on pieces[i].missing when a piece slot is already
 * null (verified / mid-destroy) while peer wires still update. Patch hot paths and
 * swallow the known race so Electron doesn't show a fatal main-process dialog.
 */
function installWebtorrentGuards(): void {
  if (webtorrentGuardsInstalled) return
  webtorrentGuardsInstalled = true

  try {
    // CJS path used by Electron main (webtorrent's package entry).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Torrent = require('webtorrent/lib/torrent.js') as {
      prototype: Record<string, unknown>
    }
    const proto = Torrent.prototype
    for (const method of ['_update', '_updateWireWrapper', '_updateWire']) {
      const orig = proto[method]
      if (typeof orig !== 'function') continue
      proto[method] = function patchedWebtorrentUpdate(
        this: unknown,
        ...args: unknown[]
      ): unknown {
        try {
          return (orig as (...a: unknown[]) => unknown).apply(this, args)
        } catch (err) {
          if (isWebtorrentPieceRace(err)) {
            console.warn('[torrent] ignored webtorrent piece race in', method)
            return undefined
          }
          throw err
        }
      }
    }
  } catch (err) {
    console.warn('[torrent] could not patch webtorrent update paths:', err)
  }

  process.on('uncaughtException', (err) => {
    if (isWebtorrentPieceRace(err)) {
      console.warn('[torrent] ignored uncaught webtorrent piece race:', err.message)
      return
    }
    console.error('[main] uncaughtException:', err)
    try {
      dialog.showErrorBox(
        'A JavaScript error occurred in the main process',
        err.stack || err.message || String(err)
      )
    } catch {
      /* ignore */
    }
  })

  process.on('unhandledRejection', (reason) => {
    if (isWebtorrentPieceRace(reason)) {
      console.warn('[torrent] ignored webtorrent piece race rejection')
      return
    }
    console.error('[main] unhandledRejection:', reason)
  })
}

function getClient(): WebTorrent.Instance {
  installWebtorrentGuards()
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
  const file = t.files?.[entry.fileIndex] as TorrentFilePieces | undefined
  const duration = entry.lastDurationSec || 0
  const currentTime = entry.lastPlayheadSec || 0
  const fileLength = file?.length || entry.total || 0
  const bytePos =
    duration > 1 && fileLength > 0
      ? Math.min(fileLength - 1, Math.floor((currentTime / duration) * fileLength))
      : 0
  const contig = file ? contiguousForwardBytes(t, file, bytePos) : 0
  const pieceLength = Math.max(1, t.pieceLength || 16_384)
  const startPiece = file?._startPiece ?? 0
  const currentPiece = startPiece + Math.floor(bytePos / pieceLength)
  try {
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
      fileName: entry.fileName,
      contiguousForwardBytes: contig,
      currentPiece
    }
  } catch {
    return {
      progress: 0,
      downloadSpeed: 0,
      uploadSpeed: 0,
      peers: 0,
      downloaded: 0,
      total: entry.total || 0,
      ready: entry.ready,
      done: false,
      error: entry.error,
      streamUrl: entry.streamUrl,
      fileName: entry.fileName,
      contiguousForwardBytes: contig,
      currentPiece
    }
  }
}

type TorrentFilePieces = WebTorrent.TorrentFile & {
  _startPiece?: number
  _endPiece?: number
}

type BitfieldLike = { get: (i: number) => boolean; set?: (i: number, v: boolean) => void }

function contiguousForwardBytes(
  torrent: WebTorrent.Torrent,
  file: TorrentFilePieces,
  byteOffset: number
): number {
  const startPiece = file._startPiece ?? 0
  const endPiece = file._endPiece ?? startPiece
  const pieceLength = Math.max(1, torrent.pieceLength || 16_384)
  const fileLength = file.length || 0
  if (fileLength <= 0) return 0
  const rel = Math.max(0, Math.min(byteOffset, fileLength - 1))
  let piece = Math.min(endPiece, Math.max(startPiece, startPiece + Math.floor(rel / pieceLength)))
  const bitfield = (torrent as unknown as { bitfield?: BitfieldLike }).bitfield
  if (!bitfield?.get) return 0

  let bytes = 0
  const first = piece
  while (piece <= endPiece && bitfield.get(piece)) {
    if (piece === first) {
      const offsetInPiece = rel % pieceLength
      bytes += pieceLength - offsetInPiece
    } else {
      bytes += pieceLength
    }
    piece += 1
  }
  return Math.min(bytes, Math.max(0, fileLength - rel))
}

function resolveRollingStore(torrent: WebTorrent.Torrent): RollingStoreInstance | null {
  const store = (torrent as unknown as { store?: { store?: RollingStoreInstance } }).store
  // ImmediateChunkStore wraps CacheChunkStore wraps our store — dig for purgeOutsideWindow
  const candidates = [
    store,
    (store as unknown as { store?: RollingStoreInstance })?.store,
    (store as unknown as { store?: { store?: RollingStoreInstance } })?.store?.store
  ]
  for (const c of candidates) {
    if (c && typeof (c as RollingStoreInstance).purgeOutsideWindow === 'function') {
      return c as RollingStoreInstance
    }
  }
  return null
}

function clearBitfieldPieces(torrent: WebTorrent.Torrent, indices: number[]): void {
  const bitfield = (torrent as unknown as { bitfield?: BitfieldLike }).bitfield
  const pieces = (torrent as unknown as { pieces?: Array<unknown> }).pieces
  const pieceLength = Math.max(1, torrent.pieceLength || 16_384)
  const lastPieceLength = Math.max(1, torrent.lastPieceLength || pieceLength)
  for (const index of indices) {
    try {
      bitfield?.set?.(index, false)
    } catch {
      /* ignore */
    }
    try {
      // WebTorrent's downloaded/progress getters crash if bitfield is false and
      // pieces[i] is null. Recreate an empty Piece stub so status polling stays safe
      // while rolling cache marks the slot as missing for re-download.
      if (pieces && index >= 0 && index < pieces.length) {
        const len = index === pieces.length - 1 ? lastPieceLength : pieceLength
        pieces[index] = new Piece(len)
      }
    } catch {
      /* ignore */
    }
  }
}

function purgeRollingWindow(
  entry: ActiveTorrent,
  centerPiece: number
): void {
  const store = entry.rollingStore || resolveRollingStore(entry.torrent)
  if (!store) return
  entry.rollingStore = store
  const purged = store.purgeOutsideWindow(
    centerPiece,
    RETAIN_BEHIND_PIECES,
    BUFFER_AHEAD_PIECES
  )
  if (purged.length) clearBitfieldPieces(entry.torrent, purged)
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
    const warmEnd = Math.min(endPiece, startPiece + BUFFER_AHEAD_PIECES)
    opts.torrent.critical(startPiece, Math.min(endPiece, startPiece + 24))
    opts.torrent.select(startPiece, warmEnd, 1)
  } catch {
    /* ignore */
  }

  const server = createTorrentFileServer(opts.torrent, index)
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
    streamUrl,
    rollingStore: resolveRollingStore(opts.torrent)
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
      const Store = hash ? createRollingPieceStoreConstructor(hash) : undefined
      t = Store
        ? (wt.add as (uri: string, opts: Record<string, unknown>) => WebTorrent.Torrent)(magnet, {
            store: Store,
            storeOpts: { infoHash: hash },
            storeCacheSlots: 0
          })
        : wt.add(magnet, { path })
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Retry recursive deletes — Windows often returns EBUSY until handles flush. */
async function rmDirWithRetry(dir: string, attempts = 8): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    try {
      if (!existsSync(dir)) return true
      rmSync(dir, { recursive: true, force: true, maxRetries: 6, retryDelay: 120 })
      if (!existsSync(dir)) return true
    } catch (err) {
      if (i === attempts - 1) {
        console.error(`[torrent] Failed to delete ${dir}:`, err)
      }
    }
    await sleep(120 + i * 80)
  }
  return !existsSync(dir)
}

async function wipeTorrentDisk(hash: string): Promise<boolean> {
  const h = hash.toLowerCase()
  let removed = false
  for (const p of [join(torrentsDir(), h), join(torrentsDir(), h.toUpperCase())]) {
    if (await rmDirWithRetry(p)) {
      if (!existsSync(p)) removed = true
    }
  }
  removeRollingCache(h)
  // Second pass after rolling-store destroy may still be flushing on Windows
  await sleep(150)
  removeRollingCache(h)
  return removed
}

/** Snapshot active torrents matching an id predicate (before stop/destroy). */
export function collectActiveTorrents(match: (id: string) => boolean): {
  ids: string[]
  hashes: string[]
  streamUrls: string[]
} {
  const ids: string[] = []
  const hashes: string[] = []
  const streamUrls: string[] = []
  for (const [id, entry] of active) {
    if (!match(id)) continue
    ids.push(id)
    const ih = entry.torrent.infoHash?.toLowerCase()
    if (ih) hashes.push(ih)
    if (entry.streamUrl) streamUrls.push(entry.streamUrl)
  }
  return { ids, hashes, streamUrls }
}

async function destroyTorrentInstance(
  torrent: WebTorrent.Torrent,
  destroyStore: boolean
): Promise<void> {
  // Quiesce peer update loops before destroy to reduce pieces[i].missing races.
  try {
    const t = torrent as WebTorrent.Torrent & {
      pause?: () => void
      _selections?: unknown[]
      wires?: Array<{ destroy?: () => void }>
    }
    t.pause?.()
    if (Array.isArray(t._selections)) t._selections.length = 0
    const wires = [...(t.wires || [])]
    for (const wire of wires) {
      try {
        wire.destroy?.()
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }

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

  // Release FFmpeg remux pipes that still hold the HTTP stream open (Windows file locks).
  if (entry.streamUrl) {
    killStreamProxyForSource(entry.streamUrl)
    try {
      const port = String(entry.port || '')
      if (port) killStreamProxyForSource(`:${port}/`)
    } catch {
      /* ignore */
    }
  }

  await new Promise<void>((resolve) => {
    try {
      entry.server?.close(() => resolve())
    } catch {
      resolve()
    }
    setTimeout(resolve, 500)
  })

  // Brief pause so Windows drops TCP/file handles before engine destroy.
  await sleep(150)

  const hash = entry.torrent.infoHash?.toLowerCase()
  await destroyTorrentInstance(entry.torrent, destroyStore)
  if (destroyStore && hash) {
    await sleep(150)
    await wipeTorrentDisk(hash)
  }
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
      await sleep(150)
      removed = (await wipeTorrentDisk(hash)) || removed
    }
  }

  return removed
}

/** Jump torrent priority to the HTTP Range / seek byte offset. */
function prioritizePiecesAtByte(
  torrent: WebTorrent.Torrent,
  file: TorrentFilePieces,
  byteOffset: number,
  opts?: { invalidate?: boolean; soft?: boolean; endByte?: number }
): void {
  const startPiece = file._startPiece ?? 0
  const endPiece = file._endPiece ?? startPiece
  const pieceLength = Math.max(1, torrent.pieceLength || 16_384)
  const rel = Math.max(0, byteOffset)
  const pieceIndex = Math.min(
    endPiece,
    Math.max(startPiece, startPiece + Math.floor(rel / pieceLength))
  )
  // Instant decode head: 4 critical pieces; keep a forward buffer behind them.
  const critSpan = opts?.soft ? Math.min(24, BUFFER_AHEAD_PIECES) : 3
  const critEnd = Math.min(endPiece, pieceIndex + critSpan)
  const aheadFromEnd =
    opts?.endByte != null
      ? startPiece + Math.floor(Math.max(0, opts.endByte) / pieceLength)
      : pieceIndex
  const aheadEnd = Math.min(
    endPiece,
    Math.max(critEnd, Math.min(Math.max(pieceIndex + 15, aheadFromEnd), pieceIndex + BUFFER_AHEAD_PIECES))
  )
  const behindStart = startPiece
  const behindEnd = Math.max(startPiece - 1, pieceIndex - RETAIN_BEHIND_PIECES - 1)
  try {
    if (opts?.soft) {
      // Advisory only (e.g. moov probes) — never starve the playhead window.
      torrent.critical(pieceIndex, critEnd)
      torrent.select(pieceIndex, aheadEnd, 1)
      return
    }
    if (opts?.invalidate) {
      // Hard seek: drop interest outside the new zero-point window.
      if (pieceIndex - 1 >= startPiece) {
        torrent.deselect(startPiece, pieceIndex - 1, 0)
      }
      if (aheadEnd + 1 <= endPiece) {
        torrent.deselect(aheadEnd + 1, endPiece, 0)
      }
    } else if (behindEnd >= behindStart) {
      torrent.deselect(behindStart, behindEnd, 0)
    }
    torrent.critical(pieceIndex, critEnd)
    torrent.select(pieceIndex, aheadEnd, 2)
  } catch {
    /* ignore */
  }
}

function guessVideoMime(fileName: string): string {
  const n = (fileName || '').toLowerCase()
  if (n.endsWith('.mp4') || n.endsWith('.m4v') || n.endsWith('.mov')) return 'video/mp4'
  if (n.endsWith('.webm')) return 'video/webm'
  if (n.endsWith('.mkv')) return 'video/x-matroska'
  if (n.endsWith('.avi')) return 'video/x-msvideo'
  if (n.endsWith('.ts') || n.endsWith('.m2ts')) return 'video/mp2t'
  return 'application/octet-stream'
}

/**
 * Local HTTP range server for a single torrent file.
 * Destroys abandoned createReadStream pipes on seek/abort so WebTorrent's
 * piece pipeline is not blocked by stale range consumers.
 */
function createTorrentFileServer(torrent: WebTorrent.Torrent, fileIndex: number): Server {
  const openStreams = new Set<Readable>()
  let lastRangeStart = -1
  let lastRangeEnd = -1

  const destroyStream = (stream: Readable | null): void => {
    if (!stream) return
    openStreams.delete(stream)
    try {
      stream.destroy()
    } catch {
      /* ignore */
    }
  }

  const destroyAllStreams = (): void => {
    for (const s of [...openStreams]) destroyStream(s)
  }

  const server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
    try {
      const urlPath = (req.url || '/').split('?')[0]
      const index = Number(urlPath.replace(/^\//, '').split('/')[0])
      if (!Number.isFinite(index) || index !== fileIndex) {
        res.statusCode = 404
        res.end('Not Found')
        return
      }

      const file = torrent.files[fileIndex] as TorrentFilePieces | undefined
      if (!file) {
        res.statusCode = 404
        res.end('Not Found')
        return
      }

      res.setHeader('Accept-Ranges', 'bytes')
      res.setHeader('Content-Type', guessVideoMime(file.name))
      res.setHeader('Connection', 'keep-alive')
      res.setHeader('Cache-Control', 'no-store')

      const total = file.length || 0
      const rangeHeader = req.headers.range
      let start = 0
      let end = Math.max(0, total - 1)

      if (typeof rangeHeader === 'string' && rangeHeader) {
        const m = /bytes=(\d*)-(\d*)/i.exec(rangeHeader)
        if (!m) {
          res.statusCode = 416
          res.setHeader('Content-Range', `bytes */${total}`)
          res.end()
          return
        }
        if (m[1]) start = Number.parseInt(m[1], 10)
        if (m[2]) end = Number.parseInt(m[2], 10)
        if (!Number.isFinite(start) || start < 0) start = 0
        if (!Number.isFinite(end) || end >= total) end = total - 1
        if (start > end || start >= total) {
          res.statusCode = 416
          res.setHeader('Content-Range', `bytes */${total}`)
          res.end()
          return
        }
        res.statusCode = 206
        res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`)
        res.setHeader('Content-Length', end - start + 1)
      } else {
        res.statusCode = 200
        res.setHeader('Content-Length', total)
      }

      const pieceLength = Math.max(1, torrent.pieceLength || 16_384)
      // Contiguous follow-on ranges stay soft; real seeks jump the zero-point window.
      const contiguous =
        lastRangeEnd >= 0 &&
        start >= lastRangeStart - pieceLength &&
        start <= lastRangeEnd + pieceLength * 2
      const jump = lastRangeStart < 0 || !contiguous
      prioritizePiecesAtByte(torrent, file, start, {
        invalidate: jump,
        soft: !jump,
        endByte: end
      })
      lastRangeStart = start
      lastRangeEnd = end

      if (req.method === 'HEAD') {
        res.end()
        return
      }

      const stream = file.createReadStream({ start, end }) as unknown as Readable
      openStreams.add(stream)

      // CRUCIAL: free the WebTorrent pipe when the client aborts (seek / drop).
      let cleaned = false
      const onAbort = (): void => {
        if (cleaned) return
        cleaned = true
        destroyStream(stream)
      }
      req.on('close', onAbort)
      res.on('close', onAbort)
      stream.on('error', () => {
        try {
          if (!res.writableEnded) res.destroy()
        } catch {
          /* ignore */
        }
        onAbort()
      })
      stream.on('end', () => {
        openStreams.delete(stream)
      })
      stream.pipe(res)
    } catch {
      try {
        res.statusCode = 500
        res.end('Stream error')
      } catch {
        /* ignore */
      }
    }
  })

  server.on('close', () => {
    destroyAllStreams()
  })

  return server
}

/** Sliding download window around the playhead (critical + high priority). */
function prioritizePlaybackWindow(opts: {
  id: string
  currentTime: number
  duration: number
  invalidate?: boolean
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

  // Prefer verified media duration over inflated catalog runtimes for byte mapping.
  if (opts.duration > 1) {
    const prev = entry.lastDurationSec || 0
    // Accept first value, any shorter duration (real container), or small bumps.
    // Reject sudden jumps to a much longer catalog runtime (e.g. TMDB 173m vs file 86m).
    if (!prev || opts.duration <= prev * 1.15 || opts.duration < prev) {
      entry.lastDurationSec = opts.duration
    }
  }
  const duration = entry.lastDurationSec || (opts.duration > 1 ? opts.duration : 0)
  let currentTime = Math.max(0, opts.currentTime || 0)
  if (duration > 1) currentTime = Math.min(currentTime, duration)

  // Soft metadata probes sometimes report EOF while playhead is still 0 — ignore those only.
  const prevTime = entry.lastPlayheadSec || 0
  if (
    !opts.invalidate &&
    prevTime < 1 &&
    duration > 1 &&
    currentTime >= duration - 1
  ) {
    currentTime = prevTime
  }

  entry.lastPlayheadSec = currentTime

  const bytePos =
    duration > 1 ? Math.min(fileLength - 1, Math.floor((currentTime / duration) * fileLength)) : 0
  prioritizePiecesAtByte(entry.torrent, file, bytePos, { invalidate: opts.invalidate })

  const pieceAt = Math.min(
    endPiece,
    Math.max(startPiece, startPiece + Math.floor(bytePos / pieceLength))
  )
  // Only purge disk on explicit seeks — soft playhead sync must not wipe the start buffer.
  if (opts.invalidate) {
    purgeRollingWindow(entry, pieceAt)
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
  installWebtorrentGuards()
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
      opts: { id: string; currentTime: number; duration: number; invalidate?: boolean }
    ): boolean => {
      if (!opts?.id) return false
      return prioritizePlaybackWindow({
        id: opts.id,
        currentTime: opts.currentTime || 0,
        duration: opts.duration || 0,
        invalidate: Boolean(opts.invalidate)
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
