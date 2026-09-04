export interface FeedResult {
  title: string
  size: number
  pubDate: string | null
  seeders: number
  peers: number
  leechers: number
  uri: string
}

export interface TorznabHttpResponse {
  status: number
  body: string
}

export type TorznabGet = (url: string) => Promise<TorznabHttpResponse>

const MALFORMED = 'Feed response was not valid Torznab/RSS XML'
const INVALID_KEY = 'Invalid API key'
const MISSING_SETTINGS = 'Add your Torznab endpoint and API key in Settings.'

const AUTH_ERROR_CODES = new Set(['100', '101', '401', '403'])

function defaultGet(url: string): Promise<TorznabHttpResponse> {
  if (typeof window !== 'undefined' && window.cinevault?.torznab?.get) {
    return window.cinevault.torznab.get(url)
  }
  return fetch(url).then(async (res) => ({ status: res.status, body: await res.text() }))
}

export function formatFeedSize(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—'
  if (n < 1024) return `${Math.round(n)} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

function looksLikeHtml(body: string): boolean {
  const t = body.trim()
  return /^<!doctype html/i.test(t) || /^<html[\s>]/i.test(t)
}

function parseCount(value: string | undefined): number {
  if (!value) return 0
  const n = Number.parseInt(value, 10)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

function parseSize(value: string | undefined): number {
  if (!value) return 0
  const n = Number.parseFloat(value)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

function childText(item: Element, localName: string): string {
  const kids = item.children
  for (let i = 0; i < kids.length; i++) {
    if (kids[i].localName === localName) return (kids[i].textContent || '').trim()
  }
  return ''
}

function childElement(item: Element, localName: string): Element | null {
  const kids = item.children
  for (let i = 0; i < kids.length; i++) {
    if (kids[i].localName === localName) return kids[i]
  }
  return null
}

function collectAttrs(item: Element): Record<string, string> {
  const out: Record<string, string> = {}
  const nodes = item.getElementsByTagName('*')
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i]
    if (el.localName !== 'attr') continue
    const name = el.getAttribute('name')
    if (!name) continue
    out[name.toLowerCase()] = el.getAttribute('value') ?? el.textContent ?? ''
  }
  return out
}

function isAuthFailure(code: string, description: string, status: number): boolean {
  const desc = description.toLowerCase()
  return (
    AUTH_ERROR_CODES.has(code) ||
    status === 401 ||
    status === 403 ||
    desc.includes('api key') ||
    desc.includes('apikey') ||
    desc.includes('unauthorized') ||
    desc.includes('incorrect user') ||
    desc.includes('credentials')
  )
}

function invalidKeyError(description?: string): Error {
  const detail = description?.trim()
  return new Error(detail && detail.toLowerCase() !== INVALID_KEY.toLowerCase() ? `${INVALID_KEY}: ${detail}` : INVALID_KEY)
}

function findErrorElement(doc: Document): Element | null {
  const root = doc.documentElement
  if (root && root.localName === 'error') return root
  const nested = doc.getElementsByTagName('error')
  return nested.length ? nested[0] : null
}

function hasParserError(doc: Document): boolean {
  if (!doc.documentElement) return true
  if (doc.documentElement.localName === 'parsererror') return true
  return doc.getElementsByTagName('parsererror').length > 0
}

function resolveLeechers(attrs: Record<string, string>, seeders: number, peers: number): number {
  if (attrs.leechers !== undefined && attrs.leechers !== '') return parseCount(attrs.leechers)
  if (peers >= seeders) return Math.max(0, peers - seeders)
  return peers
}

function mapItem(item: Element): FeedResult {
  const attrs = collectAttrs(item)
  const enclosure = childElement(item, 'enclosure')
  const title = childText(item, 'title') || 'Untitled'
  const pubDate = childText(item, 'pubDate') || null
  const size =
    parseSize(attrs.size) || parseSize(childText(item, 'size')) || parseSize(enclosure?.getAttribute('length') ?? undefined)
  const seeders = parseCount(attrs.seeders)
  const peers = parseCount(attrs.peers)
  const magnet = (attrs.magneturl || '').trim()
  const enclosureUrl = (enclosure?.getAttribute('url') || '').trim()
  const link = childText(item, 'link')
  const uri = magnet || enclosureUrl || link

  return {
    title,
    size,
    pubDate,
    seeders,
    peers,
    leechers: resolveLeechers(attrs, seeders, peers),
    uri
  }
}

export function parseTorznabXml(body: string, status: number): FeedResult[] {
  const trimmed = body.trim()
  if (!trimmed || looksLikeHtml(trimmed)) {
    if (status === 401 || status === 403) throw invalidKeyError()
    throw new Error(MALFORMED)
  }

  const doc = new DOMParser().parseFromString(trimmed, 'text/xml')
  if (hasParserError(doc)) {
    if (status === 401 || status === 403) throw invalidKeyError()
    throw new Error(MALFORMED)
  }

  const errorEl = findErrorElement(doc)
  if (errorEl) {
    const code = errorEl.getAttribute('code') || String(status || '')
    const description = (errorEl.getAttribute('description') || errorEl.textContent || '').trim()
    if (isAuthFailure(code, description, status)) throw invalidKeyError(description)
    throw new Error(description || `Indexer error ${code}`.trim())
  }

  if (status === 401 || status === 403) throw invalidKeyError()
  if (status >= 400) throw new Error(`Feed request failed (${status})`)

  const items = doc.getElementsByTagName('item')
  const rootName = doc.documentElement?.localName || ''
  if (
    items.length === 0 &&
    !['rss', 'rdf', 'feed', 'channel'].includes(rootName)
  ) {
    throw new Error(MALFORMED)
  }

  const results: FeedResult[] = []
  for (let i = 0; i < items.length; i++) {
    results.push(mapItem(items[i]))
  }
  return results.sort((a, b) => b.seeders - a.seeders)
}

function buildSearchUrl(endpoint: string, apiKey: string, query: string): string {
  let url: URL
  try {
    url = new URL(endpoint.trim())
  } catch {
    throw new Error('Torznab endpoint must be a valid http or https URL.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Torznab endpoint must use http or https.')
  }
  url.searchParams.set('t', 'search')
  url.searchParams.set('q', query)
  url.searchParams.set('apikey', apiKey)
  return url.toString()
}

export class TorznabClient {
  constructor(private readonly http: TorznabGet = defaultGet) {}

  async search(endpoint: string, apiKey: string, query: string): Promise<FeedResult[]> {
    if (!endpoint.trim() || !apiKey.trim()) throw new Error(MISSING_SETTINGS)
    const url = buildSearchUrl(endpoint, apiKey, query)
    const { status, body } = await this.http(url)
    return parseTorznabXml(body, status)
  }
}
