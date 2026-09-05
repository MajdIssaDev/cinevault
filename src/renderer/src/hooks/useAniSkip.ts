import { useEffect, useState } from 'react'

export type AniSkipInterval = {
  startTime: number
  endTime: number
}

export type AniSkipTimes = {
  op: AniSkipInterval | null
  ed: AniSkipInterval | null
}

type AniSkipApiItem = {
  skipType: string
  interval: { startTime: number; endTime: number }
}

/**
 * Fetch AniSkip OP/ED windows for an anime episode (MAL id required).
 * https://api.aniskip.com/v2/skip-times/{malId}/{episodeNumber}?types[]=op&types[]=ed
 */
export async function fetchAniSkipTimes(
  malId: number,
  episodeNumber: number
): Promise<AniSkipTimes> {
  const empty: AniSkipTimes = { op: null, ed: null }
  if (!malId || !episodeNumber || episodeNumber < 1) return empty
  try {
    const url =
      `https://api.aniskip.com/v2/skip-times/${malId}/${episodeNumber}` +
      `?types[]=op&types[]=ed`
    const res = await fetch(url)
    if (!res.ok) return empty
    const json = (await res.json()) as {
      found?: boolean
      results?: AniSkipApiItem[]
    }
    if (!json.found || !json.results?.length) return empty
    let op: AniSkipInterval | null = null
    let ed: AniSkipInterval | null = null
    for (const row of json.results) {
      const interval = {
        startTime: Number(row.interval?.startTime) || 0,
        endTime: Number(row.interval?.endTime) || 0
      }
      if (interval.endTime <= interval.startTime) continue
      if (row.skipType === 'op') op = interval
      if (row.skipType === 'ed') ed = interval
    }
    return { op, ed }
  } catch {
    return empty
  }
}

export function useAniSkip(
  malId: number | null | undefined,
  episodeNumber: number | null | undefined
): AniSkipTimes {
  const [times, setTimes] = useState<AniSkipTimes>({ op: null, ed: null })

  useEffect(() => {
    let cancelled = false
    setTimes({ op: null, ed: null })
    if (!malId || !episodeNumber) return
    void fetchAniSkipTimes(malId, episodeNumber).then((next) => {
      if (!cancelled) setTimes(next)
    })
    return () => {
      cancelled = true
    }
  }, [malId, episodeNumber])

  return times
}

export function isInSkipWindow(
  currentTime: number,
  interval: AniSkipInterval | null | undefined
): boolean {
  if (!interval) return false
  return currentTime >= interval.startTime && currentTime < interval.endTime - 0.35
}
