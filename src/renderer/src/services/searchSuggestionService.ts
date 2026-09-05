/**
 * Catalog search typo correction via Google Suggest + Levenshtein guard.
 */
import { fetchJson } from '../lib/http'

export function levenshtein(a: string, b: string): number {
  const s = a.toLowerCase()
  const t = b.toLowerCase()
  if (s === t) return 0
  if (!s.length) return t.length
  if (!t.length) return s.length

  const prev = new Array<number>(t.length + 1)
  const cur = new Array<number>(t.length + 1)
  for (let j = 0; j <= t.length; j++) prev[j] = j

  for (let i = 1; i <= s.length; i++) {
    cur[0] = i
    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
    }
    for (let j = 0; j <= t.length; j++) prev[j] = cur[j]
  }
  return prev[t.length]
}

/** True when suggestion looks like a spelling fix, not an unrelated longer phrase. */
export function isPlausibleCorrection(query: string, suggestion: string): boolean {
  const q = query.trim().toLowerCase()
  const s = suggestion.trim().toLowerCase()
  if (!q || !s || q === s) return false

  const dist = levenshtein(q, s)
  if (dist === 0) return false

  const maxDist = Math.max(2, Math.floor(q.length * 0.4))
  if (dist > maxDist) return false

  // Reject long expansions that aren't near-typo fixes ("inceptn" → "inception cast and crew")
  const lengthSlack = Math.max(4, Math.floor(q.length * 0.5))
  if (s.length > q.length + lengthSlack && dist > 2) return false

  // Prefer similar token counts for multi-word titles
  const qTokens = q.split(/\s+/).length
  const sTokens = s.split(/\s+/).length
  if (sTokens > qTokens + 2 && dist > 1) return false

  return true
}

function cleanSuggestion(raw: string): string {
  return raw
    .replace(/<\/?b>/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Returns a spelling correction for `query`, or null if none / not a real edit.
 */
export async function getSpellingSuggestion(query: string): Promise<string | null> {
  const q = query.trim()
  if (q.length < 2) return null

  try {
    const url = `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(q)}`
    const data = await fetchJson<[string, string[]]>(url)
    const suggestions = Array.isArray(data?.[1]) ? data[1] : []
    const first = suggestions[0] ? cleanSuggestion(suggestions[0]) : ''
    if (!first) return null
    if (first.toLowerCase() === q.toLowerCase()) return null
    if (!isPlausibleCorrection(q, first)) return null
    return first
  } catch {
    return null
  }
}
