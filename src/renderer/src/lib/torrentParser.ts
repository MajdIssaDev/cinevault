/**
 * Parse audio / video codec hints from torrent / release names.
 * Chromium can decode AAC / MP3 / Opus / FLAC natively; AC3/DTS/Atmos usually cannot.
 * Prefer x264/H.264 over HEVC/x265 for in-app playback.
 */

export type AudioCodec = 'AAC' | 'AC3' | 'EAC3' | 'DTS' | 'UNKNOWN'

export type ParsedTorrentAudio = {
  audioCodec: AudioCodec
  /** True for browser-native codecs (AAC, MP3, Opus, FLAC). */
  isAudioSupported: boolean
  /** Short badge label, e.g. "AAC 2.0" / "DTS-HD" / null if unknown. */
  audioLabel: string | null
}

export type ParsedTorrentVideo = {
  /** HEVC / x265 / 10-bit — often fails in Chromium without HW decode. */
  isHevc: boolean
  /** x264 / H.264 / AVC — preferred for in-app playback. */
  isX264: boolean
  /** Short badge, e.g. "x264" / "HEVC" / null if unknown. */
  videoLabel: string | null
}

const HEVC_RE = /(hevc|x265|h265|10bit|10-bit)/i
const X264_RE = /(x264|h264|avc)/i

export function parseTorrentVideo(name: string): ParsedTorrentVideo {
  const n = name || ''
  const isHevc = HEVC_RE.test(n)
  const isX264 = X264_RE.test(n)
  let videoLabel: string | null = null
  if (isHevc && isX264) videoLabel = 'x264/HEVC'
  else if (isHevc) videoLabel = 'HEVC'
  else if (isX264) videoLabel = 'x264'
  return { isHevc, isX264, videoLabel }
}

/** True when the release is clearly browser-friendly H.264 (not HEVC/10-bit tagged). */
export function isBrowserPreferredVideo(name: string): boolean {
  const v = parseTorrentVideo(name)
  return v.isX264 && !v.isHevc
}

const NATIVE_RE =
  /\b(?:aac(?:[.\s_-]?2\.0)?|mp3|opus|flac)\b/i

const AAC_LABEL_RE = /\baac(?:[.\s_-]?(2\.0|5\.1))?\b/i
const MP3_RE = /\bmp3\b/i
const OPUS_RE = /\bopus\b/i
const FLAC_RE = /\bflac\b/i

const ATMOS_RE = /\b(?:atmos|truehd|true[\s._-]?hd)\b/i
const DTS_RE = /\b(?:dts(?:[\s._-]?(?:hd(?:[\s._-]?ma)?|x))?|dtshd)\b/i
const EAC3_RE = /\b(?:e[\s._-]?ac[\s._-]?3|eac3|ddp(?:[\s._-]?(?:5\.1|7\.1))?|dd\+|ddplus)\b/i
const AC3_RE = /\b(?:ac[\s._-]?3|dd(?:[\s._-]?(?:5\.1|2\.0))|dolby[\s._-]?digital)\b/i

export function parseTorrentAudio(name: string): ParsedTorrentAudio {
  const n = name || ''

  if (ATMOS_RE.test(n)) {
    const atmos = /\batmos\b/i.test(n)
    return {
      audioCodec: 'DTS',
      isAudioSupported: false,
      audioLabel: atmos ? 'Atmos' : 'TrueHD'
    }
  }

  if (DTS_RE.test(n)) {
    const hd = /\bdts[\s._-]?hd|dtshd/i.test(n)
    return {
      audioCodec: 'DTS',
      isAudioSupported: false,
      audioLabel: hd ? 'DTS-HD' : 'DTS'
    }
  }

  if (EAC3_RE.test(n)) {
    const ch = /\b(?:5\.1|7\.1)\b/.exec(n)
    return {
      audioCodec: 'EAC3',
      isAudioSupported: false,
      audioLabel: ch ? `EAC3 ${ch[0]}` : 'EAC3'
    }
  }

  if (AC3_RE.test(n) && !NATIVE_RE.test(n)) {
    const ch = /\b(?:5\.1|2\.0)\b/.exec(n)
    return {
      audioCodec: 'AC3',
      isAudioSupported: false,
      audioLabel: ch ? `AC3 ${ch[0]}` : 'AC3'
    }
  }

  if (AAC_LABEL_RE.test(n)) {
    const m = AAC_LABEL_RE.exec(n)
    const ch = m?.[1]
    return {
      audioCodec: 'AAC',
      isAudioSupported: true,
      audioLabel: ch ? `AAC ${ch}` : 'AAC'
    }
  }

  if (MP3_RE.test(n)) {
    return { audioCodec: 'AAC', isAudioSupported: true, audioLabel: 'MP3' }
  }
  if (OPUS_RE.test(n)) {
    return { audioCodec: 'AAC', isAudioSupported: true, audioLabel: 'Opus' }
  }
  if (FLAC_RE.test(n)) {
    return { audioCodec: 'AAC', isAudioSupported: true, audioLabel: 'FLAC' }
  }

  return {
    audioCodec: 'UNKNOWN',
    isAudioSupported: true, // unknown ≠ known-bad; don't hard-block
    audioLabel: null
  }
}

/** Explicit passthrough / cinema codecs that Chromium typically cannot play. */
export function hasExplicitUnsupportedAudio(name: string): boolean {
  const parsed = parseTorrentAudio(name)
  return !parsed.isAudioSupported && parsed.audioCodec !== 'UNKNOWN'
}

export function withParsedAudio<T extends { name: string }>(
  item: T
): T & ParsedTorrentAudio & ParsedTorrentVideo {
  return { ...item, ...parseTorrentAudio(item.name), ...parseTorrentVideo(item.name) }
}
