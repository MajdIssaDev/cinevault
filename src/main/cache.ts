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

export interface CacheEntry {
  id: string
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
      try {
        if (existsSync(entry.filePath)) rmSync(entry.filePath, { force: true })
      } catch {
        /* ignore */
      }
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
    const entries = readIndex().filter((e) => e.id !== entry.id)
    entries.push(entry)
    writeIndex(entries)
    return entry
  })

  ipcMain.handle('cache:mark-complete', (_e, id: string) => {
    const settings = loadSettings()
    let entries = readIndex()
    const entry = entries.find((e) => e.id === id)
    if (!entry) return null
    entry.completed = true
    entry.lastWatchedAt = Date.now()
    if (settings.autoDeleteOnComplete) {
      try {
        if (existsSync(entry.filePath)) rmSync(entry.filePath, { force: true })
      } catch {
        /* ignore */
      }
      entries = entries.filter((e) => e.id !== id)
    }
    writeIndex(entries)
    return entry
  })

  ipcMain.handle('cache:remove', (_e, id: string) => {
    const entries = readIndex()
    const entry = entries.find((e) => e.id === id)
    if (entry && existsSync(entry.filePath)) rmSync(entry.filePath, { force: true })
    const next = entries.filter((e) => e.id !== id)
    writeIndex(next)
    return true
  })

  ipcMain.handle('cache:clear-all', () => {
    const dir = ensureCacheDir()
    for (const name of readdirSync(dir)) {
      if (name === 'cache-index.json') continue
      rmSync(join(dir, name), { recursive: true, force: true })
    }
    writeIndex([])
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
        bytes += statSync(full).size
      } catch {
        /* ignore */
      }
    }
    return { bytes, count: entries.length, directory: dir }
  })

  ipcMain.handle('cache:get-dir', () => ensureCacheDir())
}
