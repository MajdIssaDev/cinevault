import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync, readdirSync } from 'fs'
import { join } from 'path'
import { ipcMain } from 'electron'
import { getDefaultCacheDir, loadSettings } from './settings'
import { destroyTorrentData, stopMatchingTorrents } from './torrent'

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
  try {
    if (record.folderPath && existsSync(record.folderPath)) {
      rmSync(record.folderPath, { recursive: true, force: true, maxRetries: 6, retryDelay: 120 })
    }
  } catch (err) {
    console.error(`[torrent-registry] Failed to delete cache for ${record.mediaId}:`, err)
  }
}

export async function deleteTorrentByMediaId(mediaId: string): Promise<boolean> {
  if (!mediaId) return false
  const record = registry.get(mediaId)
  await stopMatchingTorrents(
    (id) => id === mediaId || id.startsWith(`${mediaId}-`),
    { destroyStore: true }
  )
  if (record) {
    await deleteTorrentFiles(record)
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

  ipcMain.handle('torrent:delete-by-media', async (_e, mediaId: string) => {
    await deleteTorrentByMediaId(mediaId)
    return { success: true }
  })

  ipcMain.handle('torrent:enforce-cache-cap', async (_e, maxCacheGB?: number) => {
    const removed = await enforceCacheCap(maxCacheGB)
    return { success: true, removed }
  })
}
