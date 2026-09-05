import http from 'http'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { getExecutableFfmpegPath } from './ffmpegResolver'

export const STREAM_PROXY_PORT = 8888
export const STREAM_PROXY_HOST = '127.0.0.1'

let proxyServer: http.Server | null = null
let resolvedFfmpeg: string | null = null

function isAllowedSource(sourceUrl: string): boolean {
  try {
    const u = new URL(sourceUrl)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    const host = u.hostname.toLowerCase()
    return host === '127.0.0.1' || host === 'localhost' || host === '::1'
  } catch {
    return false
  }
}

function killProc(proc: ChildProcessWithoutNullStreams): void {
  if (proc.killed) return
  try {
    if (process.platform === 'win32') {
      proc.kill()
    } else {
      proc.kill('SIGKILL')
    }
  } catch {
    /* ignore */
  }
}

/**
 * Local remux proxy: copy video bitstream, re-encode cinema audio → stereo AAC
 * so Chromium can play DDP/AC3/DTS/Atmos torrents in-app.
 */
export function startStreamProxy(): http.Server {
  if (proxyServer) return proxyServer

  try {
    resolvedFfmpeg = getExecutableFfmpegPath()
  } catch (err) {
    console.error('[stream-proxy] ffmpeg unavailable:', err)
    // Still bind so the renderer gets a clear 503 instead of connection refused.
    resolvedFfmpeg = null
  }

  proxyServer = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': '*'
      })
      res.end()
      return
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain' })
      res.end('Method not allowed')
      return
    }

    let pageUrl: URL
    try {
      pageUrl = new URL(req.url || '/', `http://${STREAM_PROXY_HOST}:${STREAM_PROXY_PORT}`)
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain' })
      res.end('Bad request URL')
      return
    }

    const sourceParam = pageUrl.searchParams.get('source')
    const startTime = Number.parseFloat(pageUrl.searchParams.get('start') || '0')
    const start = Number.isFinite(startTime) && startTime > 0 ? startTime : 0

    if (!sourceParam) {
      res.writeHead(400, { 'Content-Type': 'text/plain' })
      res.end('Missing "source" parameter.')
      return
    }

    let sourceUrl: string
    try {
      sourceUrl = decodeURIComponent(sourceParam)
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain' })
      res.end('Invalid "source" parameter.')
      return
    }

    if (!isAllowedSource(sourceUrl)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' })
      res.end('Source must be a local http(s) stream.')
      return
    }

    if (!resolvedFfmpeg) {
      res.writeHead(503, { 'Content-Type': 'text/plain' })
      res.end('ffmpeg binary not available')
      return
    }

    if (req.method === 'HEAD') {
      res.writeHead(200, {
        'Content-Type': 'video/mp4',
        'Access-Control-Allow-Origin': '*',
        'Accept-Ranges': 'none'
      })
      res.end()
      return
    }

    res.writeHead(200, {
      'Content-Type': 'video/mp4',
      'Transfer-Encoding': 'chunked',
      Connection: 'keep-alive',
      'Accept-Ranges': 'none',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store'
    })

    const ffmpegArgs = [
      '-hide_banner',
      '-loglevel',
      'error',
      ...(start > 0 ? ['-ss', String(start)] : []),
      '-i',
      sourceUrl,
      '-map',
      '0:v:0?',
      '-map',
      '0:a:0?',
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-ac',
      '2',
      '-ar',
      '48000',
      '-movflags',
      'frag_keyframe+empty_moov+default_base_moof',
      '-f',
      'mp4',
      'pipe:1'
    ]

    let proc: ChildProcessWithoutNullStreams
    try {
      proc = spawn(resolvedFfmpeg, ffmpegArgs, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch (err) {
      console.error('[stream-proxy] spawn failed:', err)
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' })
      }
      res.end('Failed to start ffmpeg')
      return
    }

    proc.stdout.pipe(res)

    let stderrBuf = ''
    proc.stderr.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString('utf8')
      if (stderrBuf.length > 4000) stderrBuf = stderrBuf.slice(-2000)
    })

    proc.on('error', (err) => {
      console.error('[stream-proxy] ffmpeg process error:', err)
      if (!res.writableEnded) res.end()
    })

    proc.on('close', (code) => {
      if (code && code !== 0 && stderrBuf.trim()) {
        console.error('[stream-proxy] ffmpeg exit', code, stderrBuf.trim())
      }
      if (!res.writableEnded) res.end()
    })

    const teardown = (): void => {
      killProc(proc)
      try {
        proc.stdout.unpipe(res)
      } catch {
        /* ignore */
      }
    }

    req.on('close', teardown)
    res.on('close', teardown)
  })

  proxyServer.on('error', (err) => {
    console.error('[stream-proxy] server error:', err)
  })

  proxyServer.listen(STREAM_PROXY_PORT, STREAM_PROXY_HOST, () => {
    console.log(
      `[stream-proxy] remux proxy on http://${STREAM_PROXY_HOST}:${STREAM_PROXY_PORT}` +
        (resolvedFfmpeg ? '' : ' (ffmpeg missing)')
    )
  })

  return proxyServer
}

export function stopStreamProxy(): void {
  if (!proxyServer) return
  const server = proxyServer
  proxyServer = null
  server.close()
}
