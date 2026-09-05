import { ipcMain } from 'electron'
import { createWriteStream, existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'
import { loadSettings } from './settings'
import { getDefaultCacheDir } from './settings'

const API = 'https://api.opensubtitles.com/api/v1'

interface OsLogin {
  token: string
  user?: { allowed_downloads?: number }
}

let session: OsLogin | null = null

async function osFetch(path: string, init: RequestInit = {}, token?: string): Promise<Response> {
  const settings = loadSettings()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'Api-Key': settings.openSubtitlesApiKey,
    'User-Agent': 'CineVault v1.0'
  }
  if (token || session?.token) headers.Authorization = `Bearer ${token || session?.token}`
  return fetch(`${API}${path}`, { ...init, headers: { ...headers, ...(init.headers as object) } })
}

async function ensureLogin(): Promise<string> {
  if (session?.token) return session.token
  const settings = loadSettings()
  if (!settings.openSubtitlesApiKey || !settings.openSubtitlesUsername || !settings.openSubtitlesPassword) {
    throw new Error('OPENSUBTITLES_CREDENTIALS_MISSING')
  }
  const res = await osFetch('/login', {
    method: 'POST',
    body: JSON.stringify({
      username: settings.openSubtitlesUsername,
      password: settings.openSubtitlesPassword
    })
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`OpenSubtitles login failed: ${res.status} ${text}`)
  }
  session = (await res.json()) as OsLogin
  return session.token
}

export interface SubtitleResult {
  id: string
  language: string
  release: string
  downloadCount: number
  hearingImpaired: boolean
  fileId: number
  fps: number | null
}

export function registerOpenSubtitlesHandlers(): void {
  ipcMain.handle('subs:login-test', async () => {
    session = null
    await ensureLogin()
    return { ok: true }
  })

  ipcMain.handle(
    'subs:search',
    async (
      _e,
      query: {
        query?: string
        imdbId?: string
        tmdbId?: number
        season?: number
        episode?: number
        languages?: string
        type?: 'movie' | 'episode' | 'all'
      }
    ) => {
      await ensureLogin()
      const params = new URLSearchParams()
      if (query.query) params.set('query', query.query)
      if (query.imdbId) params.set('imdb_id', query.imdbId.replace('tt', ''))
      if (query.tmdbId) params.set('tmdb_id', String(query.tmdbId))
      if (query.season != null) params.set('season_number', String(query.season))
      if (query.episode != null) params.set('episode_number', String(query.episode))
      params.set('languages', query.languages || loadSettings().defaultSubtitleLanguage)
      if (query.type && query.type !== 'all') params.set('type', query.type)
      params.set('order_by', 'download_count')
      params.set('order_direction', 'desc')

      const res = await osFetch(`/subtitles?${params.toString()}`)
      if (!res.ok) throw new Error(`Subtitle search failed: ${res.status}`)
      const data = (await res.json()) as {
        data: Array<{
          id: string
          attributes: {
            language: string
            release: string
            download_count: number
            hearing_impaired: boolean
            fps: number | null
            files: Array<{ file_id: number }>
          }
        }>
      }

      return data.data
        .filter((d) => d.attributes.files?.[0])
        .map(
          (d): SubtitleResult => ({
            id: d.id,
            language: d.attributes.language,
            release: d.attributes.release,
            downloadCount: d.attributes.download_count,
            hearingImpaired: d.attributes.hearing_impaired,
            fileId: d.attributes.files[0].file_id,
            fps: d.attributes.fps
          })
        )
    }
  )

  ipcMain.handle('subs:download', async (_e, fileId: number, suggestedName?: string) => {
    await ensureLogin()
    const res = await osFetch('/download', {
      method: 'POST',
      body: JSON.stringify({ file_id: fileId })
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Subtitle download failed: ${res.status} ${text}`)
    }
    const payload = (await res.json()) as { link: string; file_name?: string }
    const fileRes = await fetch(payload.link)
    if (!fileRes.ok || !fileRes.body) throw new Error('Could not fetch subtitle file')

    const dir = join(loadSettings().cacheDirectory || getDefaultCacheDir(), 'subtitles')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const name = suggestedName || payload.file_name || `sub-${fileId}.srt`
    const safe = name.replace(/[^\w.\-]+/g, '_')
    const dest = join(dir, safe)

    // Node 18+ fetch body is a web stream
    const nodeStream = Readable.fromWeb(fileRes.body as import('stream/web').ReadableStream)
    await pipeline(nodeStream, createWriteStream(dest))
    return dest
  })

  ipcMain.handle('subs:save-vtt', async (_e, content: string, name: string) => {
    const dir = join(loadSettings().cacheDirectory || getDefaultCacheDir(), 'subtitles')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const dest = join(dir, name.replace(/[^\w.\-]+/g, '_'))
    writeFileSync(dest, content, 'utf-8')
    return dest
  })
}
