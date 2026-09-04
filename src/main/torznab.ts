import { ipcMain } from 'electron'

const TIMEOUT_MS = 15_000
const MAX_BODY_BYTES = 8 * 1024 * 1024

export interface TorznabGetResult {
  status: number
  body: string
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const name = 'name' in error ? String((error as { name?: string }).name) : ''
  return name === 'AbortError' || name === 'TimeoutError'
}

export function registerTorznabHandlers(): void {
  ipcMain.handle('torznab:get', async (_e, url: unknown): Promise<TorznabGetResult> => {
    if (typeof url !== 'string' || !url.trim()) {
      throw new Error('Invalid feed URL')
    }

    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      throw new Error('Invalid feed URL')
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('Feed URL must use http or https')
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
      const res = await fetch(parsed.toString(), {
        signal: controller.signal,
        headers: {
          Accept: 'application/rss+xml, application/xml, text/xml, */*'
        }
      })
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.byteLength > MAX_BODY_BYTES) {
        throw new Error('Feed response was too large')
      }
      return { status: res.status, body: buf.toString('utf-8') }
    } catch (error) {
      if (error instanceof Error && error.message === 'Feed response was too large') throw error
      if (isAbortError(error) || controller.signal.aborted) {
        throw new Error('Request timed out')
      }
      throw new Error(`Network error: ${error instanceof Error ? error.message : 'request failed'}`)
    } finally {
      clearTimeout(timer)
    }
  })
}
