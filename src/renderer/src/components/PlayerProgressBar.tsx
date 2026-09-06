import type { CSSProperties, ReactElement } from 'react'

/** Timeline clock: metadata runtime first, else finite HTML5 duration. */
export function resolveTrueDuration(
  runtimeSeconds: number | null | undefined,
  videoDuration: number | null | undefined
): number {
  if (typeof runtimeSeconds === 'number' && Number.isFinite(runtimeSeconds) && runtimeSeconds > 0) {
    return runtimeSeconds
  }
  if (
    typeof videoDuration === 'number' &&
    Number.isFinite(videoDuration) &&
    videoDuration > 0 &&
    videoDuration !== Number.POSITIVE_INFINITY
  ) {
    return videoDuration
  }
  return 0
}

/** YouTube-style timestamps (`1:05:03` / `05:03`). */
export function formatTimestamp(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '00:00'
  const hrs = Math.floor(seconds / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
}

export type BufferRange = { start: number; end: number }

/**
 * Buffered fill as a left→right % of the true runtime (YouTube loaded bar).
 * Uses the HTML5 range covering the playhead, else max buffered end,
 * else optional torrent download fraction.
 */
export function computeBufferedPercent(
  trueDuration: number,
  currentTime: number,
  ranges: BufferRange[],
  torrentProgress?: number | null
): number {
  if (trueDuration <= 0) return 0

  if (ranges.length > 0) {
    for (const r of ranges) {
      if (r.start <= currentTime && currentTime <= r.end) {
        return Math.min(100, (r.end / trueDuration) * 100)
      }
    }
    const maxBuffered = ranges[ranges.length - 1]?.end ?? 0
    return Math.min(100, (maxBuffered / trueDuration) * 100)
  }

  if (typeof torrentProgress === 'number' && Number.isFinite(torrentProgress) && torrentProgress > 0) {
    return Math.min(100, torrentProgress * 100)
  }

  return 0
}

type Props = {
  trueDuration: number
  currentTime: number
  bufferedPercent: number
  style?: CSSProperties
}

/**
 * 3-tier YouTube-style scrubber track:
 * 1) full-runtime background · 2) buffered · 3) played + knob
 */
export function PlayerProgressBar({
  trueDuration,
  currentTime,
  bufferedPercent,
  style
}: Props): ReactElement {
  const progressPct =
    trueDuration > 0 ? Math.min(100, Math.max(0, (currentTime / trueDuration) * 100)) : 0
  const bufferPct = Math.min(100, Math.max(0, bufferedPercent))

  return (
    <div className="timeline-track" style={style}>
      {/* Layer 2 — downloaded / buffered (background track is .timeline-track itself) */}
      <div className="timeline-download timeline-download--youtube" style={{ width: `${bufferPct}%` }} />
      {/* Layer 3 — played */}
      <div className="timeline-progress" style={{ width: `${progressPct}%` }} />
      {/* Knob */}
      <div className="timeline-thumb" style={{ left: `${progressPct}%` }} />
    </div>
  )
}
