import type { AniSkipInterval } from '../hooks/useAniSkip'

/** Fraction of runtime that counts as finished (credits). */
export const COMPLETION_RATIO = 0.92
/** Treat last N seconds as credits even below the ratio. */
export const CREDITS_REMAINING_SECONDS = 120

/**
 * True when playback has reached credits / end:
 * ≥92% runtime, ≤2 minutes remaining, or AniSkip outro window.
 */
export function checkIsFinished(
  currentTime: number,
  duration: number,
  ed?: AniSkipInterval | null
): boolean {
  if (ed && currentTime >= ed.startTime) return true
  if (!duration || duration <= 0) return false
  const remaining = duration - currentTime
  const ratio = currentTime / duration
  return ratio >= COMPLETION_RATIO || remaining <= CREDITS_REMAINING_SECONDS
}

/** Drop the media element source so OS file locks release before disk wipe. */
export function releaseVideoElement(video: HTMLVideoElement | null | undefined): void {
  if (!video) return
  try {
    video.pause()
    video.removeAttribute('src')
    while (video.firstChild) video.removeChild(video.firstChild)
    video.load()
  } catch {
    /* ignore */
  }
}
