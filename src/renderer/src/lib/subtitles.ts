export interface Cue {
  start: number
  end: number
  text: string
}

function parseTimestamp(ts: string): number {
  // 00:00:01,000 or 00:00:01.000
  const clean = ts.trim().replace(',', '.')
  const parts = clean.split(':')
  if (parts.length === 3) {
    const [h, m, s] = parts
    return Number(h) * 3600 + Number(m) * 60 + Number(s)
  }
  if (parts.length === 2) {
    const [m, s] = parts
    return Number(m) * 60 + Number(s)
  }
  return Number(clean) || 0
}

export function parseSrt(content: string): Cue[] {
  const blocks = content.replace(/\r/g, '').split(/\n\n+/)
  const cues: Cue[] = []
  for (const block of blocks) {
    const lines = block.split('\n').filter(Boolean)
    if (lines.length < 2) continue
    const timeLine = lines.find((l) => l.includes('-->'))
    if (!timeLine) continue
    const [startRaw, endRaw] = timeLine.split('-->')
    const text = lines.slice(lines.indexOf(timeLine) + 1).join('\n').replace(/<[^>]+>/g, '')
    cues.push({
      start: parseTimestamp(startRaw),
      end: parseTimestamp(endRaw),
      text
    })
  }
  return cues
}

/**
 * Time-based cue lookup (never sequential index).
 * Delay: positive ms = show later; negative = show earlier.
 * adjustedTime = currentTime - offsetMs/1000
 */
export function findActiveCue(
  cues: Cue[],
  currentTime: number,
  offsetMs = 0
): Cue | undefined {
  if (!cues.length) return undefined
  const adjustedTime = currentTime - offsetMs / 1000
  let lo = 0
  let hi = cues.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const c = cues[mid]
    if (adjustedTime < c.start) hi = mid - 1
    else if (adjustedTime > c.end) lo = mid + 1
    else return c
  }
  return cues.find((cue) => adjustedTime >= cue.start && adjustedTime <= cue.end)
}

/** @deprecated Prefer findActiveCue with offset in ms */
export function cueAt(cues: Cue[], t: number, offsetSeconds = 0): string {
  return findActiveCue(cues, t, offsetSeconds * 1000)?.text || ''
}

export function suggestOffset(_cues: Cue[], _duration: number): number {
  return 0
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00'
  const s = Math.floor(seconds % 60)
  const m = Math.floor((seconds / 60) % 60)
  const h = Math.floor(seconds / 3600)
  if (h > 0)
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function formatSubtitleDelayMs(ms: number): string {
  const rounded = Math.round(ms)
  const signed = rounded > 0 ? `+${rounded}` : String(rounded)
  return `Subtitle Delay: ${signed} ms`
}
