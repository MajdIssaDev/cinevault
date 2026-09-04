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

export function cueAt(cues: Cue[], t: number, offset = 0): string {
  const x = t + offset
  const cue = cues.find((c) => x >= c.start && x <= c.end)
  return cue?.text || ''
}

/** Rough auto offset: align first cue near first spoken silence break is hard without ASR.
 *  Heuristic: if video duration known and cues end far from duration, nudge by median gap — optional stub. */
export function suggestOffset(_cues: Cue[], _duration: number): number {
  return 0
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00'
  const s = Math.floor(seconds % 60)
  const m = Math.floor((seconds / 60) % 60)
  const h = Math.floor(seconds / 3600)
  if (h > 0) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
