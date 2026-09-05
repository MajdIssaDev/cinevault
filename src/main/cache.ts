import { ipcMain, shell } from 'electron'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  readFileSync
} from 'fs'
import { join } from 'path'
import { loadSettings } from './settings'
import { destroyAllTorrents, destroyTorrentData, stopMatchingTorrents } from './torrent'
import { deleteTorrentByMediaId, enforceCacheCap } from './torrentRegistry'

export interface CacheEntry {
  id: string
  /** Catalog key e.g. movie-123 / series-456 — one stored torrent per mediaId */
  mediaId?: string
  title: string
  mediaType: 'movie' | 'series' | 'anime'
  filePath: string
  createdAt: number
  lastWatchedAt: number
  completed: boolean
  progressSeconds: number
  durationSeconds: number
  sourceUrl?: string
}

const COMPLETE_DELETE_MS = 5 * 60 * 1000
const pendingDeletes = new Map<string, ReturnType<typeof setTimeout>>()

function metaPath(cacheDir: string): string {
  return join(cacheDir, 'cache-index.json')
}

function ensureCacheDir(): string {
  const { cacheDirectory } = loadSettings()
  if (!existsSync(cacheDirectory)) mkdirSync(cacheDirectory, { recursive: true })
  return cacheDirectory
}

function readIndex(): CacheEntry[] {
  const dir = ensureCacheDir()
  const p = metaPath(dir)
  if (!existsSync(p)) return []
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as CacheEntry[]
  } catch {
    return []
  }
}

function writeIndex(entries: CacheEntry[]): void {
  const dir = ensureCacheDir()
  writeFileSync(metaPath(dir), JSON.stringify(entries, null, 2), 'utf-8')
}

function cancelScheduledDelete(id: string): void {
  const t = pendingDeletes.get(id)
  if (t) clearTimeout(t)
  pendingDeletes.delete(id)
}

function entryMatchesMedia(entry: CacheEntry, mediaId: string): boolean {
  if (!mediaId) return false
  if (entry.mediaId === mediaId) return true
  return entry.id === mediaId || entry.id.startsWith(`${mediaId}-`)
}

async function wipeEntryFiles(entry: CacheEntry): Promise<void> {
  await destroyTorrentData({
    id: entry.id,
    magnetUri: entry.sourceUrl?.startsWith('magnet:') ? entry.sourceUrl : undefined,
    destroyStore: true
  })
  if (entry.filePath) {
    try {
      if (existsSync(entry.filePath)) {
        rmSync(entry.filePath, { force: true, maxRetries: 6, retryDelay: 120 })
      }
    } catch {
      /* ignore */
    }
  }
}

async function removeEntryById(id: string): Promise<boolean> {
  cancelScheduledDelete(id)
  const entries = readIndex()
  const entry = entries.find((e) => e.id === id)
  if (entry) await wipeEntryFiles(entry)
  else {
    await destroyTorrentData({ id, destroyStore: true })
  }
  writeIndex(entries.filter((e) => e.id !== id))
  return true
}

async function removeByMediaId(
  mediaId: string,
  opts?: { keepId?: string }
): Promise<number> {
  if (!mediaId) return 0
  const keepId = opts?.keepId
  const entries = readIndex()
  const doomed = entries.filter(
    (e) => entryMatchesMedia(e, mediaId) && (!keepId || e.id !== keepId)
  )

  await stopMatchingTorrents(
    (id) =>
      (id === mediaId || id.startsWith(`${mediaId}-`)) && (!keepId || id !== keepId),
    { destroyStore: true }
  )

  for (const entry of doomed) {
    cancelScheduledDelete(entry.id)
    await wipeEntryFiles(entry)
  }

  const kept = entries.filter((e) => !doomed.some((d) => d.id === e.id))
  writeIndex(kept)
  return doomed.length
}

function scheduleDelete(id: string, delayMs = COMPLETE_DELETE_MS): void {
  if (pendingDeletes.has(id)) return
  const timer = setTimeout(() => {
    pendingDeletes.delete(id)
    void removeEntryById(id)
  }, delayMs)
  pendingDeletes.set(id, timer)
}

export function pruneExpiredCache(): CacheEntry[] {
  const settings = loadSettings()
  const retentionMs = (settings.cacheRetentionHours || 48) * 60 * 60 * 1000
  const now = Date.now()
  let entries = readIndex()
  const kept: CacheEntry[] = []

  for (const entry of entries) {
    const expired = !entry.completed && now - entry.lastWatchedAt > retentionMs
    const doneAndDelete = entry.completed && settings.autoDeleteOnComplete
    if (expired || doneAndDelete) {
      cancelScheduledDelete(entry.id)
      void wipeEntryFiles(entry)
    } else {
      kept.push(entry)
    }
  }

  writeIndex(kept)
  return kept
}

export function registerCacheHandlers(): void {
  ipcMain.handle('cache:list', () => {
    pruneExpiredCache()
    return readIndex()
  })

  ipcMain.handle('cache:upsert', (_e, entry: CacheEntry) => {
    // Don't cancel a pending post-complete wipe when progress keeps updating.
    if (!entry.completed) cancelScheduledDelete(entry.id)
    const entries = readIndex().filter((e) => e.id !== entry.id)
    entries.push(entry)
    writeIndex(entries)
    void enforceCacheCap()
    return entry
  })

  ipcMain.handle('cache:mark-complete', async (_e, id: string) => {
    let entries = readIndex()
    const entry = entries.find((e) => e.id === id)
    if (!entry) {
      // Still schedule wipe for active torrent without index row
      scheduleDelete(id)
      return null
    }
    entry.completed = true
    entry.lastWatchedAt = Date.now()
    writeIndex(entries)
    // Always wipe finished titles from disk after 5 minutes
    scheduleDelete(id, COMPLETE_DELETE_MS)
    return entry
  })

  ipcMain.handle('cache:remove', async (_e, id: string) => removeEntryById(id))

  ipcMain.handle(
    'cache:remove-by-media',
    async (_e, mediaId: string, opts?: { keepId?: string }) => {
      const n = await removeByMediaId(mediaId, opts)
      if (mediaId && !opts?.keepId) {
        await deleteTorrentByMediaId(mediaId)
      }
      return n
    }
  )

  ipcMain.handle('cache:clear-all', async () => {
    for (const id of [...pendingDeletes.keys()]) cancelScheduledDelete(id)

    // Release file locks held by WebTorrent before deleting
    await destroyAllTorrents()

    const dir = ensureCacheDir()
    const failures: string[] = []
    for (const name of readdirSync(dir)) {
      if (name === 'cache-index.json') continue
      const full = join(dir, name)
      try {
        rmSync(full, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 })
      } catch (err) {
        failures.push(`${name}:${err instanceof Error ? err.message : String(err)}`)
      }
    }
    writeIndex([])

    if (failures.length) {
      throw new Error(`Some cache files could not be deleted (in use): ${failures[0]}`)
    }
    return true
  })

  ipcMain.handle('cache:open-folder', async () => {
    const dir = ensureCacheDir()
    await shell.openPath(dir)
    return dir
  })

  ipcMain.handle('cache:stats', () => {
    const dir = ensureCacheDir()
    const entries = readIndex()
    let bytes = 0
    const seen = new Set<string>()
    for (const e of entries) {
      try {
        if (existsSync(e.filePath)) {
          bytes += statSync(e.filePath).size
          seen.add(e.filePath)
        }
      } catch {
        /* ignore */
      }
    }
    for (const name of readdirSync(dir)) {
      if (name === 'cache-index.json') continue
      const full = join(dir, name)
      if (seen.has(full)) continue
      try {
        const st = statSync(full)
        if (st.isDirectory()) {
          // Approximate: sum nested sizes would be expensive; count top-level dir size via walk
          bytes += walkBytes(full)
        } else {
          bytes += st.size
        }
      } catch {
        /* ignore */
      }
    }
    return { bytes, count: entries.length, directory: dir }
  })

  ipcMain.handle('cache:get-dir', () => ensureCacheDir())
}

function walkBytes(root: string): number {
  let total = 0
  try {
    for (const name of readdirSync(root)) {
      const full = join(root, name)
      try {
        const st = statSync(full)
        if (st.isDirectory()) total += walkBytes(full)
        else total += st.size
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
  return total
}
