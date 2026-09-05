/**
 * Capacitor OTA updates from GitHub Releases (`dist.zip`).
 * Uses @capgo/capacitor-updater with manual download + 10s notifyAppReady rollback.
 */
import { App } from '@capacitor/app'
import { CapacitorUpdater } from '@capgo/capacitor-updater'
import { isMobileShell } from './platform'

/** Replace if the GitHub repo moves; matches electron-builder publish config. */
export const OTA_GITHUB_OWNER = 'MajdIssaDev'
export const OTA_GITHUB_REPO = 'cinevault'

type GhAsset = {
  name: string
  browser_download_url: string
  size?: number
}

type GhRelease = {
  tag_name: string
  name?: string
  body?: string | null
  assets: GhAsset[]
}

function normalizeVersion(v: string): string {
  return v.trim().replace(/^v/i, '')
}

/** Simple semver-ish compare: returns true if `a` is older than `b`. */
export function isVersionOlder(a: string, b: string): boolean {
  const pa = normalizeVersion(a).split(/[.+-]/).map((x) => parseInt(x, 10) || 0)
  const pb = normalizeVersion(b).split(/[.+-]/).map((x) => parseInt(x, 10) || 0)
  const n = Math.max(pa.length, pb.length)
  for (let i = 0; i < n; i++) {
    const x = pa[i] || 0
    const y = pb[i] || 0
    if (x < y) return true
    if (x > y) return false
  }
  return false
}

function extractChecksum(release: GhRelease, zipName: string): string | undefined {
  const shaAsset = release.assets.find(
    (a) =>
      a.name.toLowerCase() === `${zipName.toLowerCase()}.sha256` ||
      a.name.toLowerCase() === 'dist.sha256' ||
      /\.sha256$/i.test(a.name)
  )
  // Prefer checksum embedded in release notes: `dist.zip sha256: <hex>`
  const body = release.body || ''
  const m =
    body.match(/dist\.zip[^\n]*sha256[:\s]+([a-f0-9]{64})/i) ||
    body.match(/sha256[:\s]+([a-f0-9]{64})/i)
  if (m?.[1]) return m[1].toLowerCase()
  if (shaAsset) return shaAsset.browser_download_url // downloaded later if needed
  return undefined
}

async function fetchLatestRelease(): Promise<GhRelease | null> {
  const url = `https://api.github.com/repos/${OTA_GITHUB_OWNER}/${OTA_GITHUB_REPO}/releases/latest`
  const res = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'CineVault-Mobile-OTA'
    }
  })
  if (!res.ok) {
    console.warn('[ota] GitHub releases lookup failed', res.status)
    return null
  }
  return (await res.json()) as GhRelease
}

async function downloadChecksumFile(url: string): Promise<string | undefined> {
  try {
    const res = await fetch(url)
    if (!res.ok) return undefined
    const text = await res.text()
    const m = text.match(/([a-f0-9]{64})/i)
    return m?.[1]?.toLowerCase()
  } catch {
    return undefined
  }
}

let checking = false

export async function checkAndApplyOtaUpdate(): Promise<void> {
  if (!isMobileShell() || checking) return
  checking = true
  try {
    const current = await CapacitorUpdater.current()
    const currentVersion = normalizeVersion(current.bundle.version || '0.0.0')

    const release = await fetchLatestRelease()
    if (!release) return

    const zip =
      release.assets.find((a) => a.name.toLowerCase() === 'dist.zip') ||
      release.assets.find((a) => /dist.*\.zip$/i.test(a.name))
    if (!zip) {
      console.info('[ota] No dist.zip asset on latest release')
      return
    }

    const remoteVersion = normalizeVersion(release.tag_name || release.name || '')
    if (!remoteVersion || !isVersionOlder(currentVersion, remoteVersion)) {
      console.info('[ota] Up to date', currentVersion)
      return
    }

    let checksum = extractChecksum(release, zip.name)
    if (checksum && checksum.startsWith('http')) {
      checksum = await downloadChecksumFile(checksum)
    }

    console.info('[ota] Downloading', remoteVersion, zip.browser_download_url)
    const bundle = await CapacitorUpdater.download({
      url: zip.browser_download_url,
      version: remoteVersion,
      ...(checksum ? { checksum } : {})
    })

    console.info('[ota] Applying bundle', bundle.version)
    await CapacitorUpdater.set(bundle)
  } catch (err) {
    console.warn('[ota] Update failed', err)
  } finally {
    checking = false
  }
}

/**
 * Call once at app boot on native mobile.
 * notifyAppReady within 10s prevents Capgo automatic rollback.
 */
export async function initMobileOta(): Promise<void> {
  if (!isMobileShell()) return

  try {
    await CapacitorUpdater.notifyAppReady()
  } catch (err) {
    console.warn('[ota] notifyAppReady failed', err)
  }

  // Initial check
  void checkAndApplyOtaUpdate()

  App.addListener('appStateChange', (state) => {
    if (state.isActive) void checkAndApplyOtaUpdate()
  })
}
