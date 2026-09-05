import { ipcMain } from 'electron'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import JSZip from 'jszip'
import { getDefaultCacheDir, loadSettings } from './settings'

export type SubtitleProvider = 'Subdl' | 'Public'

export type UnifiedSubtitle = {
  id: string
  label: string
  language: string
  /** Direct HTTP URL when available (Public / unpacked Subdl). */
  url: string | null
  provider: SubtitleProvider
  /** Subdl download identity */
  nId?: string
  downloadUrl?: string
  /** Raw release / file name for matching & UI */
  releaseName?: string
  matchScore?: number
}

export type ResolvedSubtitle = {
  path: string | null
  url: string | null
  content: string | null
  label: string
  language: string
  provider: SubtitleProvider
}

type SearchQuery = {
  imdbId?: string
  type?: 'movie' | 'series' | 'episode' | 'tv'
  lang?: string
  season?: number
  episode?: number
  title?: string
  /** Torrent / file name used to score Subdl release matches */
  releaseHint?: string
}

const RELEASE_TOKEN_RE =
  /\b(yts|yify|rarbg|psa|sparks|ctrlhd|ntb|eztv|killers|geckos|flux|amiable|etric|hdchina|chd|wi\.?ki|hdspace|hdsky|beyondhd|framestor|criterion|remux|bluray|blu-ray|bdrip|brrip|web-?dl|webrip|hdtv|dvdrip|x264|x265|h\.?264|h\.?265|hevc|avc|aac|dts|truehd|atmos|hdr10?\+?|dv|dovi|2160p|1080p|720p|480p|4k|uhd|multi|proper|repack)\b/gi

function extractReleaseTokens(name: string): Set<string> {
  const out = new Set<string>()
  const n = name.toLowerCase().replace(/[._]+/g, ' ')
  for (const m of n.matchAll(RELEASE_TOKEN_RE)) {
    out.add(m[1].replace(/\./g, '').replace(/-/g, ''))
  }
  // Group / scene tags in brackets or trailing
  for (const m of n.matchAll(/\[([a-z0-9.-]{2,24})\]|\b([a-z0-9]{2,12})\s*$/gi)) {
    const tag = (m[1] || m[2] || '').toLowerCase().replace(/[.-]/g, '')
    if (tag && tag.length >= 2 && !/^(the|and|of|a)$/.test(tag)) out.add(tag)
  }
  return out
}

export function scoreReleaseMatch(candidate: string, hint: string): number {
  if (!hint || !candidate) return 0
  const hintTokens = extractReleaseTokens(hint)
  if (!hintTokens.size) return 0
  const cand = candidate.toLowerCase().replace(/[._]+/g, ' ')
  let score = 0
  for (const token of hintTokens) {
    if (cand.includes(token)) score += token.length >= 5 ? 3 : 2
  }
  // Prefer near-identical resolution token presence
  for (const res of ['2160p', '1080p', '720p', '480p']) {
    if (hintTokens.has(res) && cand.includes(res)) score += 4
  }
  return score
}

function rankByRelease(items: UnifiedSubtitle[], hint?: string): UnifiedSubtitle[] {
  if (!hint?.trim()) return items
  return items
    .map((s) => ({
      ...s,
      matchScore: scoreReleaseMatch(s.releaseName || s.label, hint)
    }))
    .sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0))
}

function subDir(): string {
  const settings = loadSettings()
  const dir = join(settings.cacheDirectory || getDefaultCacheDir(), 'subtitles')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function normalizeImdb(id: string | undefined): string | null {
  if (!id) return null
  const t = id.trim()
  if (!t) return null
  return t.startsWith('tt') ? t : `tt${t}`
}

function normalizeLang(lang: string | undefined): string {
  return (lang || 'en').toLowerCase().slice(0, 3)
}

const LANG3: Record<string, string> = {
  en: 'eng',
  es: 'spa',
  fr: 'fre',
  de: 'ger',
  it: 'ita',
  pt: 'por',
  ar: 'ara',
  he: 'heb',
  ja: 'jpn',
  ko: 'kor',
  zh: 'chi',
  ru: 'rus',
  pl: 'pol'
}

function langMatches(candidate: string, want: string): boolean {
  const c = candidate.toLowerCase()
  const w = want.toLowerCase()
  if (c === w) return true
  if (c.startsWith(w) || w.startsWith(c)) return true
  const mapped = LANG3[w]
  if (mapped && (c === mapped || c.startsWith(mapped))) return true
  // reverse: eng -> en
  for (const [two, three] of Object.entries(LANG3)) {
    if (c === three && w === two) return true
  }
  return false
}

function looksLikeMojibake(text: string): boolean {
  if (!text) return true
  const replacement = (text.match(/\uFFFD/g) || []).length
  if (replacement > 3) return true
  // Common UTF-8 misread Arabic patterns
  if (/Ã.|Â.|Ù.|Ø./.test(text) && !/[\u0600-\u06FF]/.test(text)) return true
  return false
}

function decodeSubtitleBuffer(buf: Buffer, lang: string): string {
  const utf8 = buf.toString('utf8')
  if (lang.startsWith('ar')) {
    if (!looksLikeMojibake(utf8) && /[\u0600-\u06FF]/.test(utf8)) return utf8
    try {
      const decoded = new TextDecoder('windows-1256').decode(buf)
      if (/[\u0600-\u06FF]/.test(decoded)) return decoded
    } catch {
      /* keep utf8 */
    }
  }
  if (looksLikeMojibake(utf8)) {
    try {
      return new TextDecoder('windows-1256').decode(buf)
    } catch {
      return utf8
    }
  }
  return utf8
}

async function extractSubtitleFromZip(data: ArrayBuffer, lang: string): Promise<string> {
  const zip = await JSZip.loadAsync(data)
  const files = Object.values(zip.files).filter(
    (f) => !f.dir && /\.(srt|vtt|ass|ssa)$/i.test(f.name)
  )
  const preferred =
    files.find((f) => /\.srt$/i.test(f.name)) ||
    files.find((f) => /\.vtt$/i.test(f.name)) ||
    files[0]
  if (!preferred) throw new Error('No subtitle file found in archive')
  const buf = Buffer.from(await preferred.async('arraybuffer'))
  return decodeSubtitleBuffer(buf, lang)
}

async function searchSubdl(query: SearchQuery, apiKey: string): Promise<UnifiedSubtitle[]> {
  const imdb = normalizeImdb(query.imdbId)
  if (!imdb) return []
  const lang = normalizeLang(query.lang)
  const type =
    query.type === 'movie' ? 'movie' : query.type === 'tv' || query.type === 'series' ? 'tv' : 'movie'

  const url = new URL('https://api.subdl.com/api/v1/subtitles')
  url.searchParams.set('api_key', apiKey)
  url.searchParams.set('imdb_id', imdb)
  url.searchParams.set('languages', lang.toUpperCase())
  url.searchParams.set('type', type)
  if (query.season != null) url.searchParams.set('subs_season', String(query.season))
  if (query.episode != null) url.searchParams.set('subs_episode', String(query.episode))
  if (query.title) url.searchParams.set('film_name', query.title)

  const res = await fetch(url.toString(), {
    headers: { Accept: 'application/json', 'User-Agent': 'CineVault/1.0' }
  })
  if (!res.ok) throw new Error(`Subdl search failed (${res.status})`)
  const data = (await res.json()) as {
    status?: boolean
    subtitles?: Array<{
      name?: string
      release_name?: string
      lang?: string
      language?: string
      url?: string
      download_link?: string
      nId?: string | number
      season?: number
      episode?: number
    }>
  }
  if (data.status === false) return []
  const rows = data.subtitles || []
  const mapped = rows.slice(0, 40).map((s, i) => {
    const language = (s.lang || s.language || lang).toString()
    const release = s.release_name || s.name || 'Subtitle'
    const dl =
      s.download_link ||
      (s.url?.startsWith('http') ? s.url : s.url ? `https://dl.subdl.com${s.url}` : null)
    return {
      id: `subdl-${s.nId || i}-${release.slice(0, 24)}`,
      label: `${language} · ${release}`.slice(0, 120),
      language,
      url: null,
      provider: 'Subdl' as const,
      nId: s.nId != null ? String(s.nId) : undefined,
      downloadUrl: dl || undefined,
      releaseName: release
    }
  })
  return rankByRelease(mapped, query.releaseHint)
}

async function downloadSubdl(
  item: UnifiedSubtitle,
  apiKey: string,
  lang: string
): Promise<ResolvedSubtitle> {
  let bytes: ArrayBuffer | null = null

  if (item.downloadUrl) {
    const res = await fetch(item.downloadUrl)
    if (!res.ok) throw new Error(`Subdl download failed (${res.status})`)
    bytes = await res.arrayBuffer()
  } else if (item.nId) {
    const url = new URL(`https://api.subdl.com/api/v2/subtitles/${item.nId}/download`)
    url.searchParams.set('format', 'zip')
    url.searchParams.set('api_key', apiKey)
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: '*/*' }
    })
    if (!res.ok) throw new Error(`Subdl download failed (${res.status})`)
    bytes = await res.arrayBuffer()
  } else {
    throw new Error('Subdl item has no download link')
  }

  const content = await extractSubtitleFromZip(bytes, lang)
  const file = join(subDir(), `subdl-${Date.now()}.srt`)
  writeFileSync(file, content, 'utf8')
  return {
    path: file,
    url: null,
    content,
    label: item.label,
    language: item.language,
    provider: 'Subdl'
  }
}

async function searchPublicStremio(query: SearchQuery): Promise<UnifiedSubtitle[]> {
  const imdb = normalizeImdb(query.imdbId)
  if (!imdb) return []
  const lang = normalizeLang(query.lang)
  const isSeries =
    query.type === 'series' ||
    query.type === 'tv' ||
    query.type === 'episode' ||
    (query.season != null && query.episode != null)

  let pathId = imdb
  if (isSeries && query.season != null && query.episode != null) {
    pathId = `${imdb}:${query.season}:${query.episode}`
  }
  const kind = isSeries ? 'series' : 'movie'
  const url = `https://opensubtitles-v3.strem.io/subtitles/${kind}/${pathId}.json`

  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'CineVault/1.0' }
  })
  if (!res.ok) throw new Error(`Public subtitle search failed (${res.status})`)
  const data = (await res.json()) as {
    subtitles?: Array<{ id?: string; url?: string; lang?: string; language?: string }>
  }
  const rows = (data.subtitles || []).filter((s) => s.url)
  const filtered = rows.filter((s) => langMatches(s.lang || s.language || '', lang))
  const use = (filtered.length ? filtered : rows).slice(0, 40)
  return use.map((s, i) => {
    const language = s.lang || s.language || lang
    const release = `${language} · Public`
    return {
      id: `public-${s.id || i}`,
      label: release,
      language,
      url: s.url!,
      provider: 'Public' as const,
      releaseName: release
    }
  })
}

export async function getAvailableSubtitles(query: SearchQuery): Promise<UnifiedSubtitle[]> {
  const settings = loadSettings()
  const key = settings.subdlApiKey?.trim()
  if (key) {
    try {
      const subdl = await searchSubdl(query, key)
      if (subdl.length) return subdl
    } catch (err) {
      console.warn('[subs] Subdl search failed, falling back', err)
    }
  }
  try {
    const pub = await searchPublicStremio(query)
    return rankByRelease(pub, query.releaseHint)
  } catch (err) {
    console.warn('[subs] Public search failed', err)
    return []
  }
}

export async function resolveSubtitle(
  item: UnifiedSubtitle,
  lang?: string
): Promise<ResolvedSubtitle> {
  const settings = loadSettings()
  if (item.provider === 'Public' && item.url) {
    return {
      path: null,
      url: item.url,
      content: null,
      label: item.label,
      language: item.language,
      provider: 'Public'
    }
  }
  const key = settings.subdlApiKey?.trim()
  if (!key) throw new Error('Subdl API key required to download this subtitle')
  return downloadSubdl(item, key, normalizeLang(lang || item.language || settings.defaultSubtitleLanguage))
}

export async function testSubdlKey(apiKey?: string): Promise<{ ok: boolean; message: string }> {
  const key = (apiKey || loadSettings().subdlApiKey || '').trim()
  if (!key) return { ok: false, message: 'Enter a Subdl API key first' }
  try {
    const url = new URL('https://api.subdl.com/api/v1/subtitles')
    url.searchParams.set('api_key', key)
    url.searchParams.set('imdb_id', 'tt0111161')
    url.searchParams.set('languages', 'EN')
    url.searchParams.set('type', 'movie')
    const res = await fetch(url.toString(), {
      headers: { Accept: 'application/json', 'User-Agent': 'CineVault/1.0' }
    })
    if (!res.ok) return { ok: false, message: `Subdl rejected the key (${res.status})` }
    const data = (await res.json()) as { status?: boolean; message?: string }
    if (data.status === false) {
      return { ok: false, message: data.message || 'Invalid Subdl API key' }
    }
    return { ok: true, message: 'Subdl API key looks good' }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Subdl test failed' }
  }
}

export function registerSubtitleEngineHandlers(): void {
  ipcMain.handle('subs:available', async (_e, query: SearchQuery) => getAvailableSubtitles(query))
  ipcMain.handle('subs:resolve', async (_e, item: UnifiedSubtitle, lang?: string) =>
    resolveSubtitle(item, lang)
  )
  ipcMain.handle('subs:test-subdl', async (_e, apiKey?: string) => testSubdlKey(apiKey))
}
