import { ipcMain, net } from 'electron'

const TIMEOUT_MS = 20_000
const MAX_BODY_BYTES = 8 * 1024 * 1024
/** Skip hosts that recently failed DNS / connect for a short window. */
const HOST_COOLDOWN_MS = 60_000

const DEFAULT_HEADERS: Record<string, string> = {
  Accept: 'application/json, application/rss+xml, application/xml, text/xml, text/plain, */*',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 CineVault/1.0'
}

export interface TorznabGetResult {
  status: number
  body: string
  /** Soft network failure — not thrown, so Electron won't spam "Error occurred in handler". */
  error?: string
}

const hostCooldownUntil = new Map<string, number>()

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const name = 'name' in error ? String((error as { name?: string }).name) : ''
  return name === 'AbortError' || name === 'TimeoutError'
}

function isTransientNetworkError(message: string): boolean {
  return /ERR_NAME_NOT_RESOLVED|ERR_CONNECTION|ERR_TIMED_OUT|ERR_NETWORK|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|getaddrinfo|timed out|Network error/i.test(
    message
  )
}

function softFail(message: string): TorznabGetResult {
  return { status: 0, body: '', error: message }
}

async function fetchText(url: string): Promise<TorznabGetResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await net.fetch(url, {
      signal: controller.signal,
      headers: DEFAULT_HEADERS
    })
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.byteLength > MAX_BODY_BYTES) {
      throw new Error('Feed response was too large')
    }
    return { status: res.status, body: buf.toString('utf-8') }
  } finally {
    clearTimeout(timer)
  }
}

export function registerTorznabHandlers(): void {
  ipcMain.handle('torznab:get', async (_e, url: unknown): Promise<TorznabGetResult> => {
    if (typeof url !== 'string' || !url.trim()) {
      return softFail('Invalid feed URL')
    }

    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return softFail('Invalid feed URL')
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return softFail('Feed URL must use http or https')
    }

    const hostKey = parsed.host.toLowerCase()
    const cooledUntil = hostCooldownUntil.get(hostKey) || 0
    if (Date.now() < cooledUntil) {
      return softFail(`Host temporarily unavailable (${parsed.host})`)
    }

    try {
      const result = await fetchText(parsed.toString())
      if (result.status > 0) hostCooldownUntil.delete(hostKey)
      return result
    } catch (error) {
      if (error instanceof Error && error.message === 'Feed response was too large') {
        return softFail(error.message)
      }
      const message = isAbortError(error)
        ? 'Request timed out'
        : `Network error: ${error instanceof Error ? error.message : 'request failed'}`

      if (isTransientNetworkError(message)) {
        hostCooldownUntil.set(hostKey, Date.now() + HOST_COOLDOWN_MS)
      }
      // Soft-fail: do not throw — Electron logs every thrown ipcMain handler as an error.
      return softFail(message)
    }
  })
}
