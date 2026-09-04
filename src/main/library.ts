import { ipcMain, dialog } from 'electron'
import { existsSync, readdirSync, statSync } from 'fs'
import { extname, join, basename } from 'path'
import { loadSettings, saveSettings } from './settings'

const VIDEO_EXTS = new Set([
  '.mp4',
  '.mkv',
  '.webm',
  '.avi',
  '.mov',
  '.m4v',
  '.ts',
  '.m2ts'
])

export interface LibraryItem {
  id: string
  path: string
  name: string
  size: number
  modifiedAt: number
  qualityGuess: string
}

function guessQuality(name: string): string {
  const n = name.toLowerCase()
  if (/2160p|4k|uhd/.test(n)) return '2160p'
  if (/1440p|2k|qhd/.test(n)) return '1440p'
  if (/1080p|fhd/.test(n)) return '1080p'
  if (/720p/.test(n)) return '720p'
  return 'unknown'
}

function walk(dir: string, out: LibraryItem[], depth = 0): void {
  if (depth > 6 || !existsSync(dir)) return
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(full, out, depth + 1)
    } else if (VIDEO_EXTS.has(extname(entry.name).toLowerCase())) {
      try {
        const st = statSync(full)
        out.push({
          id: Buffer.from(full).toString('base64url'),
          path: full,
          name: basename(entry.name, extname(entry.name)),
          size: st.size,
          modifiedAt: st.mtimeMs,
          qualityGuess: guessQuality(entry.name)
        })
      } catch {
        /* ignore */
      }
    }
  }
}

export function registerLibraryHandlers(): void {
  ipcMain.handle('library:pick-folder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory']
    })
    if (result.canceled || !result.filePaths[0]) return null
    const folder = result.filePaths[0]
    const settings = loadSettings()
    if (!settings.libraryFolders.includes(folder)) {
      saveSettings({ libraryFolders: [...settings.libraryFolders, folder] })
    }
    return folder
  })

  ipcMain.handle('library:scan', () => {
    const { libraryFolders } = loadSettings()
    const items: LibraryItem[] = []
    for (const folder of libraryFolders) walk(folder, items)
    return items.sort((a, b) => b.modifiedAt - a.modifiedAt)
  })

  ipcMain.handle('library:remove-folder', (_e, folder: string) => {
    const settings = loadSettings()
    saveSettings({
      libraryFolders: settings.libraryFolders.filter((f) => f !== folder)
    })
    return true
  })

  ipcMain.handle('library:match-title', (_e, query: string) => {
    const { libraryFolders } = loadSettings()
    const items: LibraryItem[] = []
    for (const folder of libraryFolders) walk(folder, items)
    const q = query.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    return items
      .map((item) => {
        const name = item.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ')
        const score = name.includes(q) ? 2 : q.split(' ').filter((w) => name.includes(w)).length
        return { item, score }
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .map((x) => x.item)
  })
}
