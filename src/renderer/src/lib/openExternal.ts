/**
 * Cross-platform external URL / magnet opener.
 * Electron → shell.openExternal · Capacitor → Browser / OS intent · web → window.open
 */
import { Browser } from '@capacitor/browser'
import { isMobileShell, getRuntimePlatform } from './platform'

export async function openExternal(url: string): Promise<void> {
  if (!url) return

  if (typeof window !== 'undefined' && window.cinevault?.shell?.openExternal) {
    await window.cinevault.shell.openExternal(url)
    return
  }

  if (isMobileShell()) {
    // Magnet links: hand off to a registered torrent client via OS intent
    if (/^magnet:/i.test(url)) {
      try {
        const a = document.createElement('a')
        a.href = url
        a.rel = 'noopener'
        a.style.display = 'none'
        document.body.appendChild(a)
        a.click()
        a.remove()
        return
      } catch {
        window.location.href = url
        return
      }
    }
    try {
      await Browser.open({ url, presentationStyle: 'popover' })
      return
    } catch (err) {
      console.warn('[openExternal] Browser.open failed', err)
    }
  }

  window.open(url, '_blank', 'noopener,noreferrer')
}

export async function openMagnet(magnetUri: string): Promise<void> {
  await openExternal(magnetUri)
}

export function platformLabel(): string {
  return getRuntimePlatform()
}
