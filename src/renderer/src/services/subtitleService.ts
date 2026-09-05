/**
 * Dual-tier subtitle engine (renderer façade).
 * Tier 1: Subdl (authenticated) · Tier 2: public Stremio OpenSubtitles proxy.
 */

export type SubtitleProvider = 'Subdl' | 'Public'

export type UnifiedSubtitle = {
  id: string
  label: string
  language: string
  url: string | null
  provider: SubtitleProvider
  nId?: string
  downloadUrl?: string
  releaseName?: string
  matchScore?: number
}

export type ResolvedSubtitle = {
  path: string | null
  url: string | null
  /** Blob URL created in renderer when content was returned */
  blobUrl: string | null
  content: string | null
  label: string
  language: string
  provider: SubtitleProvider
}

export type SubtitleQuery = {
  imdbId?: string | null
  type?: 'movie' | 'series' | 'episode' | 'tv'
  lang?: string
  season?: number
  episode?: number
  title?: string
  /** Torrent / file name for Subdl release matching */
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
  for (const res of ['2160p', '1080p', '720p', '480p']) {
    if (hintTokens.has(res) && cand.includes(res)) score += 4
  }
  return score
}

/** Re-rank an existing list against a torrent/file name (best first). */
export function rankSubtitlesByRelease(
  items: UnifiedSubtitle[],
  releaseHint?: string | null
): UnifiedSubtitle[] {
  if (!releaseHint?.trim()) return items
  return items
    .map((s) => ({
      ...s,
      matchScore: scoreReleaseMatch(s.releaseName || s.label, releaseHint)
    }))
    .sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0))
}

export function formatSubtitleMenuLabel(s: UnifiedSubtitle): string {
  const badge = s.provider === 'Subdl' ? 'Subdl' : 'Default'
  const lang = (s.language || '').toUpperCase() || 'SUB'
  const release = (s.releaseName || s.label.replace(/^[^\s·]+[·\s]+/, '').trim()).trim()
  const star = s.matchScore && s.matchScore > 0 ? ' ★' : ''
  return release ? `${lang} [${badge}]${star} · ${release}` : `${lang} [${badge}]${star}`
}

export async function getAvailableSubtitles(query: SubtitleQuery): Promise<UnifiedSubtitle[]> {
  if (!window.cinevault?.subs?.available) return []
  if (!query.imdbId) return []
  const list = await window.cinevault.subs.available({
    imdbId: query.imdbId,
    type: query.type || 'movie',
    lang: query.lang || 'en',
    season: query.season,
    episode: query.episode,
    title: query.title,
    releaseHint: query.releaseHint
  })
  return query.releaseHint ? rankSubtitlesByRelease(list, query.releaseHint) : list
}

export async function resolveSubtitleTrack(
  item: UnifiedSubtitle,
  lang?: string
): Promise<ResolvedSubtitle> {
  if (!window.cinevault?.subs?.resolve) {
    throw new Error('Subtitle engine unavailable')
  }
  const resolved = await window.cinevault.subs.resolve(item, lang)
  let blobUrl: string | null = null
  if (resolved.content && !resolved.url && !resolved.path) {
    const blob = new Blob([resolved.content], { type: 'text/plain;charset=utf-8' })
    blobUrl = URL.createObjectURL(blob)
  } else if (resolved.content && resolved.path) {
    const blob = new Blob([resolved.content], { type: 'text/plain;charset=utf-8' })
    blobUrl = URL.createObjectURL(blob)
  }
  return { ...resolved, blobUrl }
}

export async function testSubdlKey(apiKey?: string): Promise<{ ok: boolean; message: string }> {
  if (!window.cinevault?.subs?.testSubdl) {
    return { ok: false, message: 'Subtitle engine unavailable' }
  }
  return window.cinevault.subs.testSubdl(apiKey)
}
