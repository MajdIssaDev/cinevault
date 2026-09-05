import { app } from 'electron'
import { existsSync } from 'fs'
import ffmpegPath from 'ffmpeg-static'

/**
 * Resolve the ffmpeg binary for both `electron-vite` dev and packaged builds.
 * Packaged apps unpack native binaries under `app.asar.unpacked`.
 */
export function getExecutableFfmpegPath(): string {
  if (!ffmpegPath) {
    throw new Error('ffmpeg-static binary path could not be resolved')
  }

  let resolved = ffmpegPath
  if (app.isPackaged) {
    resolved = ffmpegPath.replace('app.asar', 'app.asar.unpacked')
  }

  if (!existsSync(resolved)) {
    throw new Error(`ffmpeg binary not found at ${resolved}`)
  }

  return resolved
}
