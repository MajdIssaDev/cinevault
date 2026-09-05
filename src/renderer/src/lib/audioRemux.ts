import { hasExplicitUnsupportedAudio, parseTorrentAudio } from './torrentParser'

/** Local FFmpeg remux proxy started by the Electron main process. */
export const AUDIO_REMUX_PROXY_BASE = 'http://127.0.0.1:8888/'

/** True when release name indicates cinema audio Chromium cannot decode. */
export function needsAudioRemux(label: string): boolean {
  if (!label) return false
  if (hasExplicitUnsupportedAudio(label)) return true
  const audio = parseTorrentAudio(label)
  return !audio.isAudioSupported && audio.audioCodec !== 'UNKNOWN'
}

/**
 * Wrap a local torrent/http stream URL so FFmpeg copies video and
 * re-encodes audio to stereo AAC. `startSeconds` is applied via ffmpeg `-ss`.
 */
export function buildAudioRemuxUrl(sourceUrl: string, startSeconds = 0): string {
  const u = new URL(AUDIO_REMUX_PROXY_BASE)
  u.searchParams.set('source', sourceUrl)
  const start = Math.max(0, Number(startSeconds) || 0)
  if (start > 0) u.searchParams.set('start', String(start))
  return u.toString()
}

export function isAudioRemuxUrl(url: string): boolean {
  return url.startsWith(AUDIO_REMUX_PROXY_BASE) || url.startsWith('http://127.0.0.1:8888/')
}
