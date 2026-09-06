import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  readdirSync,
  rmSync
} from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

/** Keep ~20 pieces behind the playhead for short rewinds. */
export const RETAIN_BEHIND_PIECES = 20
/** Download / retain up to ~80 pieces ahead of the playhead. */
export const BUFFER_AHEAD_PIECES = 80

export type RollingStoreInstance = {
  chunkLength: number
  length: number
  root: string
  present: Set<number>
  put: (index: number, buf: Buffer, cb: (err?: Error | null) => void) => void
  get: (
    index: number,
    opts: unknown,
    cb?: (err: Error | null, buf?: Buffer) => void
  ) => void
  close: (cb: (err?: Error | null) => void) => void
  destroy: (cb: (err?: Error | null) => void) => void
  /** Delete piece files outside [center - behind, center + ahead]. Returns purged indices. */
  purgeOutsideWindow: (center: number, behind: number, ahead: number) => number[]
  hasPiece: (index: number) => boolean
}

function piecePath(root: string, index: number): string {
  return join(root, `piece_${index}.bin`)
}

function cacheRootForHash(infoHash: string): string {
  return join(tmpdir(), 'CineVault', 'cache', infoHash.toLowerCase())
}

/**
 * WebTorrent-compatible chunk store: one file per piece under
 * `%TEMP%/CineVault/cache/{infoHash}/piece_{index}.bin`
 */
export function createRollingPieceStoreConstructor(infoHash: string): new (
  chunkLength: number,
  opts?: { length?: number; torrent?: { infoHash?: string } }
) => RollingStoreInstance {
  const hash = (infoHash || 'unknown').toLowerCase()
  const root = cacheRootForHash(hash)

  return class RollingPieceStore implements RollingStoreInstance {
    chunkLength: number
    length: number
    root: string
    present: Set<number>
    closed = false

    constructor(chunkLength: number, opts: { length?: number } = {}) {
      this.chunkLength = Number(chunkLength) || 16384
      this.length = Number(opts.length) || 0
      this.root = root
      this.present = new Set()
      if (!existsSync(root)) mkdirSync(root, { recursive: true })
      try {
        for (const name of readdirSync(root)) {
          const m = /^piece_(\d+)\.bin$/i.exec(name)
          if (m) this.present.add(Number(m[1]))
        }
      } catch {
        /* ignore */
      }
    }

    put(index: number, buf: Buffer, cb: (err?: Error | null) => void): void {
      if (this.closed) return cb(new Error('Storage is closed'))
      try {
        if (!existsSync(this.root)) mkdirSync(this.root, { recursive: true })
        writeFileSync(piecePath(this.root, index), buf)
        this.present.add(index)
        queueMicrotask(() => cb(null))
      } catch (err) {
        queueMicrotask(() => cb(err instanceof Error ? err : new Error(String(err))))
      }
    }

    get(
      index: number,
      opts: unknown,
      cb?: (err: Error | null, buf?: Buffer) => void
    ): void {
      const callback =
        typeof opts === 'function'
          ? (opts as (err: Error | null, buf?: Buffer) => void)
          : cb
      if (!callback) return
      if (this.closed) {
        queueMicrotask(() => callback(new Error('Storage is closed')))
        return
      }
      try {
        const p = piecePath(this.root, index)
        if (!existsSync(p)) {
          queueMicrotask(() => callback(new Error('Chunk not found')))
          return
        }
        const buf = readFileSync(p)
        // Optional offset/length slice (fs-chunk-store compatible)
        const o = (typeof opts === 'object' && opts ? opts : {}) as {
          offset?: number
          length?: number
        }
        if (o.offset != null || o.length != null) {
          const start = o.offset || 0
          const end = o.length != null ? start + o.length : buf.length
          queueMicrotask(() => callback(null, buf.subarray(start, end)))
          return
        }
        queueMicrotask(() => callback(null, buf))
      } catch (err) {
        queueMicrotask(() =>
          callback(err instanceof Error ? err : new Error(String(err)))
        )
      }
    }

    close(cb: (err?: Error | null) => void): void {
      this.closed = true
      queueMicrotask(() => cb(null))
    }

    destroy(cb: (err?: Error | null) => void): void {
      this.closed = true
      this.present.clear()
      try {
        if (existsSync(this.root)) {
          rmSync(this.root, { recursive: true, force: true, maxRetries: 4, retryDelay: 50 })
        }
      } catch {
        /* ignore */
      }
      queueMicrotask(() => cb(null))
    }

    hasPiece(index: number): boolean {
      return this.present.has(index)
    }

    purgeOutsideWindow(center: number, behind: number, ahead: number): number[] {
      const lo = Math.max(0, center - behind)
      const hi = center + ahead
      const purged: number[] = []
      for (const index of [...this.present]) {
        if (index < lo || index > hi) {
          try {
            unlinkSync(piecePath(this.root, index))
          } catch {
            /* ignore */
          }
          this.present.delete(index)
          purged.push(index)
        }
      }
      return purged
    }
  }
}

export function removeRollingCache(infoHash: string): void {
  const root = cacheRootForHash(infoHash)
  for (let i = 0; i < 5; i++) {
    try {
      if (!existsSync(root)) return
      rmSync(root, { recursive: true, force: true, maxRetries: 6, retryDelay: 100 })
      if (!existsSync(root)) return
    } catch {
      /* Windows may still hold handles — caller retries after a delay */
    }
  }
}

function queueMicrotask(fn: () => void): void {
  if (typeof globalThis.queueMicrotask === 'function') globalThis.queueMicrotask(fn)
  else setTimeout(fn, 0)
}
