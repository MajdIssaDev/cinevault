import { fetchJson } from '../lib/http'
import { withParsedAudio, type AudioCodec } from '../lib/torrentParser'

export interface PublicSearchResult {
  id: string
  name: string
  sizeBytes: number
  seeders: number
  leechers: number
  magnetUri: string
  source: string
  audioCodec: AudioCodec
  isAudioSupported: boolean
  audioLabel: string | null
}

const APIBAY_URL = 'https://apibay.org/q.php'
const YTS_HOSTS = ['https://yts.mx', 'https://yts.lt', 'https://yts.ag']

const PUBLIC_TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.tracker.eu.org:6969/announce',
  'udp://tracker.torrent.eu.org:451/announce'
]

interface ApibayItem {
  id?: string
  name?: string
  info_hash?: string
  seeders?: string
  leechers?: string
  size?: string
}

interface YtsTorrent {
  hash: string
  quality: string
  type: string
  seeds: number
  peers: number
  size_bytes: number
}

interface YtsMovie {
  id: number
  title: string
  torrents?: YtsTorrent[]
}

interface YtsResponse {
  status: string
  data?: {
    movie_count?: number
    movies?: YtsMovie[]
  }
}

function parseCount(value: string | number | undefined): number {
  const n = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

export function buildMagnetUri(infoHash: string, displayName: string): string {
  const hash = infoHash.trim().toLowerCase()
  if (!hash || !/^[a-f0-9]{40}$|^[a-z2-7]{32}$/i.test(hash)) return ''

  // Do not use URLSearchParams for xt — it encodes ":" to %3A and parse-torrent
  // then fails with "Invalid torrent identifier".
  const parts = [`xt=urn:btih:${hash}`]
  if (displayName.trim()) parts.push(`dn=${encodeURIComponent(displayName.trim())}`)
  for (const tracker of PUBLIC_TRACKERS) {
    parts.push(`tr=${encodeURIComponent(tracker)}`)
  }
  return `magnet:?${parts.join('&')}`
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

function mapApibayItem(item: ApibayItem): PublicSearchResult | null {
  const id = (item.id ?? '').trim()
  const name = (item.name ?? '').trim()
  const hash = (item.info_hash ?? '').trim()
  if (!id || id === '0' || !name || !hash || /no results/i.test(name)) return null

  return withParsedAudio({
    id: `apibay-${id}`,
    name,
    sizeBytes: parseCount(item.size),
    seeders: parseCount(item.seeders),
    leechers: parseCount(item.leechers),
    magnetUri: buildMagnetUri(hash, name),
    source: 'Apibay'
  })
}

async function searchApibay(query: string): Promise<PublicSearchResult[]> {
  const url = `${APIBAY_URL}?q=${encodeURIComponent(query)}&cat=200`
  const data = await fetchJson<ApibayItem[] | ApibayItem>(url)
  const items = Array.isArray(data) ? data : [data]
  return items.map(mapApibayItem).filter((item): item is PublicSearchResult => item !== null)
}

function mapYtsTorrent(movie: YtsMovie, torrent: YtsTorrent): PublicSearchResult {
  const quality = torrent.quality?.trim()
  const type = torrent.type?.trim()
  const suffix = [quality, type].filter(Boolean).join(' ')
  const name = suffix ? `${movie.title} (${suffix})` : movie.title
  const seeders = parseCount(torrent.seeds)
  const peers = parseCount(torrent.peers)
  const leechers = peers >= seeders ? Math.max(0, peers - seeders) : peers

  return withParsedAudio({
    id: `yts-${movie.id}-${torrent.hash}`,
    name,
    sizeBytes: parseCount(torrent.size_bytes),
    seeders,
    leechers,
    magnetUri: buildMagnetUri(torrent.hash, name),
    source: 'YTS'
  })
}

async function searchYts(query: string): Promise<PublicSearchResult[]> {
  const path = `/api/v2/list_movies.json?query_term=${encodeURIComponent(query)}`
  let data: YtsResponse | null = null
  for (const host of YTS_HOSTS) {
    try {
      data = await fetchJson<YtsResponse>(`${host}${path}`)
      break
    } catch {
      // DNS / unreachable hosts are expected; try the next mirror quietly.
      continue
    }
  }
  if (!data) return []
  if (data.status !== 'ok' || !data.data?.movies?.length) return []

  const results: PublicSearchResult[] = []
  for (const movie of data.data.movies) {
    for (const torrent of movie.torrents ?? []) {
      if (!torrent.hash?.trim()) continue
      results.push(mapYtsTorrent(movie, torrent))
    }
  }
  return results
}

export async function searchPublicIndexers(query: string): Promise<PublicSearchResult[]> {
  const q = query.trim()
  if (!q) return []

  const [apibay, yts] = await Promise.allSettled([
    searchApibay(q).catch(() => [] as PublicSearchResult[]),
    searchYts(q)
  ])
  const combined: PublicSearchResult[] = []

  if (apibay.status === 'fulfilled') combined.push(...apibay.value)
  if (yts.status === 'fulfilled') combined.push(...yts.value)

  return combined.sort((a, b) => b.seeders - a.seeders)
}
