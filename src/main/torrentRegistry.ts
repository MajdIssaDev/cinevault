import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync, readdirSync } from 'fs'
import { join } from 'path'
import { ipcMain } from 'electron'
import { getDefaultCacheDir, loadSettings } from './settings'
import {
  collectActiveTorrents,
  destroyTorrentData,
  stopMatchingTorrents
} from './torrent'
import { killStreamProxyForSource } from './streamProxy'

export interface TorrentRecord {
  mediaId: string
  infoHash: string
  folderPath: string
  lastAccessed: number
  sizeBytes: number
  cacheId?: string
}

const registry = new Map<string, TorrentRecord>()

function registryPath(): string {
  const dir = loadSettings().cacheDirectory || getDefaultCacheDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'torrent-registry.json')
}

function dirSizeBytes(root: string): number {
  let total = 0
  try {
    if (!existsSync(root)) return 0
    const st = statSync(root)
    if (st.isFile()) return st.size
    for (const name of readdirSync(root)) {
      total += dirSizeBytes(join(root, name))
    }
  } catch {
    /* ignore */
  }
  return total
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function rmDirWithRetry(dir: string, attempts = 8): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      if (!existsSync(dir)) return
      rmSync(dir, { recursive: true, force: true, maxRetries: 6, retryDelay: 120 })
      if (!existsSync(dir)) return
    } catch (err) {
      if (i === attempts - 1) {
        console.error(`[torrent-registry] Failed to delete ${dir}:`, err)
      }
    }
    await sleep(150 + i * 100)
  }
}

export function loadTorrentRegistry(): void {
  registry.clear()
  try {
    const p = registryPath()
    if (!existsSync(p)) return
    const rows = JSON.parse(readFileSync(p, 'utf-8')) as TorrentRecord[]
    for (const row of rows) {
      if (row?.mediaId) registry.set(row.mediaId, row)
    }
  } catch {
    /* ignore */
  }
}

function persistRegistry(): void {
  try {
    writeFileSync(registryPath(), JSON.stringify([...registry.values()], null, 2), 'utf-8')
  } catch {
    /* ignore */
  }
}

async function deleteTorrentFiles(record: TorrentRecord): Promise<void> {
  if (record.cacheId) {
    await destroyTorrentData({
      id: record.cacheId,
      magnetUri: record.infoHash ? `magnet:?xt=urn:btih:${record.infoHash}` : undefined,
      destroyStore: true
    })
  } else if (record.infoHash) {
    await destroyTorrentData({
      magnetUri: `magnet:?xt=urn:btih:${record.infoHash}`,
      destroyStore: true
    })
  }
  await sleep(150)
  try {
    if (record.folderPath) {
      await rmDirWithRetry(record.folderPath)
    }
  } catch (err) {
    console.error(`[torrent-registry] Failed to delete cache for ${record.mediaId}:`, err)
  }
}

export async function deleteTorrentByMediaId(
  mediaId: string,
  infoHash?: string
): Promise<boolean> {
  if (!mediaId && !infoHash) return false

  const match = (id: string): boolean => {
    if (!mediaId) return false
    return id === mediaId || id.startsWith(`${mediaId}-`)
  }

  const record = mediaId ? registry.get(mediaId) : undefined
  const hashes = new Set<string>()
  if (infoHash) hashes.add(infoHash.toLowerCase())
  if (record?.infoHash) hashes.add(record.infoHash.toLowerCase())

  // 1. Kill FFmpeg remux pipes that still read the live HTTP stream (releases locks).
  const live = mediaId ? collectActiveTorrents(match) : { ids: [], hashes: [], streamUrls: [] }
  for (const url of live.streamUrls) {
    killStreamProxyForSource(url)
  }
  for (const h of live.hashes) hashes.add(h)

  // 2. Destroy torrent engine instances (closes piece-store file handles).
  if (mediaId) {
    await stopMatchingTorrents(match, { destroyStore: true })
  }

  // 3. Allow Windows to flush locks, then wipe residual dirs + rolling chunk cache.
  await sleep(200)

  for (const hash of hashes) {
    await destroyTorrentData({
      magnetUri: `magnet:?xt=urn:btih:${hash}`,
      destroyStore: true
    })
  }

  if (record) {
    await deleteTorrentFiles(record)
    registry.delete(mediaId)
    persistRegistry()
  } else if (mediaId) {
    registry.delete(mediaId)
    persistRegistry()
  }

  return true
}

export async function prepareTorrentForMedia(opts: {
  mediaId: string
  infoHash: string
  folderPath: string
  cacheId?: string
  sizeBytes?: number
}): Promise<{ success: boolean }> {
  const mediaId = opts.mediaId
  if (!mediaId) return { success: false }
  const existing = registry.get(mediaId)
  if (existing && existing.infoHash && opts.infoHash && existing.infoHash !== opts.infoHash) {
    await deleteTorrentFiles(existing)
    await stopMatchingTorrents(
      (id) =>
        (id === mediaId || id.startsWith(`${mediaId}-`)) &&
        (!opts.cacheId || id !== opts.cacheId),
      { destroyStore: true }
    )
  }
  const folderPath =
    opts.folderPath ||
    join(loadSettings().cacheDirectory || getDefaultCacheDir(), 'torrents', opts.infoHash)
  const sizeBytes = opts.sizeBytes ?? dirSizeBytes(folderPath)
  registry.set(mediaId, {
    mediaId,
    infoHash: opts.infoHash,
    folderPath,
    lastAccessed: Date.now(),
    sizeBytes,
    cacheId: opts.cacheId
  })
  persistRegistry()
  void enforceCacheCap()
  return { success: true }
}

export async function touchTorrentMedia(mediaId: string): Promise<void> {
  const row = registry.get(mediaId)
  if (!row) return
  row.lastAccessed = Date.now()
  if (row.folderPath) row.sizeBytes = dirSizeBytes(row.folderPath)
  persistRegistry()
}

export async function enforceCacheCap(maxCacheGB?: number): Promise<number> {
  const settings = loadSettings()
  const cap = maxCacheGB ?? settings.maxCacheGB ?? 20
  if (!cap || cap <= 0) return 0
  const maxBytes = cap * 1024 * 1024 * 1024
  const sorted = [...registry.values()].sort((a, b) => a.lastAccessed - b.lastAccessed)
  let totalBytes = sorted.reduce((acc, curr) => acc + (curr.sizeBytes || 0), 0)
  let removed = 0
  for (const record of sorted) {
    if (totalBytes <= maxBytes) break
    await deleteTorrentFiles(record)
    registry.delete(record.mediaId)
    totalBytes -= record.sizeBytes || 0
    removed += 1
  }
  if (removed) persistRegistry()
  return removed
}

export function registerTorrentRegistryHandlers(): void {
  loadTorrentRegistry()

  ipcMain.handle(
    'torrent:prepare-stream',
    async (
      _e,
      opts: { mediaId: string; infoHash: string; folderPath?: string; cacheId?: string; sizeBytes?: number }
    ) =>
      prepareTorrentForMedia({
        mediaId: opts.mediaId,
        infoHash: (opts.infoHash || '').toLowerCase(),
        folderPath: opts.folderPath || '',
        cacheId: opts.cacheId,
        sizeBytes: opts.sizeBytes
      })
  )

  ipcMain.handle(
    'torrent:delete-by-media',
    async (
      _e,
      arg: string | { mediaId: string; infoHash?: string }
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        const mediaId = typeof arg === 'string' ? arg : arg?.mediaId
        const infoHash = typeof arg === 'string' ? undefined : arg?.infoHash
        if (!mediaId) return { success: false, error: 'Missing mediaId' }
        await deleteTorrentByMediaId(mediaId, infoHash)
        return { success: true }
      } catch (error) {
        console.error('[torrent-registry] delete-by-media failed:', error)
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error)
        }
      }
    }
  )

  ipcMain.handle('torrent:enforce-cache-cap', async (_e, maxCacheGB?: number) => {
    const removed = await enforceCacheCap(maxCacheGB)
    return { success: true, removed }
  })
}
