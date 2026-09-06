import http from 'http'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { getExecutableFfmpegPath } from './ffmpegResolver'

export const STREAM_PROXY_PORT = 8888
export const STREAM_PROXY_HOST = '127.0.0.1'

let proxyServer: http.Server | null = null
let resolvedFfmpeg: string | null = null

/** Track live remux children so a new scrub can force-kill stragglers. */
const activeProcs = new Map<ChildProcessWithoutNullStreams, string>()

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
  if (proc.exitCode != null || proc.signalCode != null) {
    activeProcs.delete(proc)
    return
  }
  activeProcs.delete(proc)
  try {
    if (process.platform === 'win32' && proc.pid) {
      // Force-kill the whole tree — SIGKILL is unreliable on Windows.
      spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore'
      })
    } else {
      proc.kill('SIGKILL')
    }
  } catch {
    try {
      proc.kill()
    } catch {
      /* ignore */
    }
  }
}

/** Kill remux children whose `-i` source matches (full URL, host:port, or substring). */
export function killStreamProxyForSource(sourceNeedle: string): number {
  const needle = (sourceNeedle || '').trim().toLowerCase()
  if (!needle) return 0
  let killed = 0
  for (const [proc, url] of [...activeProcs.entries()]) {
    const src = (url || '').toLowerCase()
    if (!src) continue
    if (src === needle || src.includes(needle) || needle.includes(src)) {
      killProc(proc)
      killed += 1
    }
  }
  return killed
}

export function killAllStreamProxyProcs(): number {
  const n = activeProcs.size
  for (const proc of [...activeProcs.keys()]) killProc(proc)
  activeProcs.clear()
  return n
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

      // Timestamp & stream normalization (spatial E-AC-3 / Atmos / DDP)
      '-fflags',
      '+genpts+discardcorrupt',
      '-analyzeduration',
      '10000000',
      '-probesize',
      '32000000',
      '-avoid_negative_ts',
      'make_zero',

      // Fast input seek
      ...(start > 0 ? ['-ss', String(start)] : []),
      '-i',
      sourceUrl,

      // Prefer first video + first audio (skip secondary commentary / atmos truehd pairs)
      '-map',
      '0:v:0?',
      '-map',
      '0:a:0?',

      // Video: untouched bitstream passthrough
      '-c:v',
      'copy',

      // Audio: continuous sample-clock alignment → stereo AAC
      '-c:a',
      'aac',
      '-b:a',
      '256k',
      '-ac',
      '2',
      // async=1000 stretches/trims up to 1000 samples/sec to fix drift;
      // first_pts=0 forces audio to begin at t=0 with the container timeline
      '-af',
      'aresample=async=1000:first_pts=0',

      // Output container
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

    activeProcs.set(proc, sourceUrl)
    proc.stdout.pipe(res)

    let stderrBuf = ''
    proc.stderr.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString('utf8')
      if (stderrBuf.length > 4000) stderrBuf = stderrBuf.slice(-2000)
    })

    proc.on('error', (err) => {
      console.error('[stream-proxy] ffmpeg process error:', err)
      activeProcs.delete(proc)
      if (!res.writableEnded) res.end()
    })

    proc.on('close', (code) => {
      activeProcs.delete(proc)
      if (code && code !== 0 && stderrBuf.trim()) {
        console.error('[stream-proxy] ffmpeg exit', code, stderrBuf.trim())
      }
      if (!res.writableEnded) res.end()
    })

    let tornDown = false
    const teardown = (): void => {
      if (tornDown) return
      tornDown = true
      try {
        proc.stdout.unpipe(res)
        proc.stdout.destroy()
      } catch {
        /* ignore */
      }
      // SIGKILL / taskkill immediately so a scrubbed `&start=` cannot keep
      // multiplexing stale audio into another response buffer.
      killProc(proc)
      if (!res.writableEnded) {
        try {
          res.end()
        } catch {
          /* ignore */
        }
      }
    }

    req.on('close', teardown)
    req.on('aborted', teardown)
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
  killAllStreamProxyProcs()
  if (!proxyServer) return
  const server = proxyServer
  proxyServer = null
  server.close()
}
