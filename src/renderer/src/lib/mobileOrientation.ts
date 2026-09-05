/**
 * Screen orientation helpers for Capacitor.
 * Catalog → portrait · Player → landscape
 */
import { ScreenOrientation } from '@capacitor/screen-orientation'
import { isMobileShell } from './platform'

export async function lockCatalogOrientation(): Promise<void> {
  if (!isMobileShell()) return
  try {
    await ScreenOrientation.lock({ orientation: 'portrait' })
  } catch {
    try {
      await ScreenOrientation.lock({ orientation: 'portrait-primary' })
    } catch (err) {
      console.warn('[orientation] portrait lock failed', err)
    }
  }
}

export async function lockPlayerOrientation(): Promise<void> {
  if (!isMobileShell()) return
  try {
    await ScreenOrientation.lock({ orientation: 'landscape' })
  } catch {
    try {
      await ScreenOrientation.unlock()
    } catch (err) {
      console.warn('[orientation] landscape unlock failed', err)
    }
  }
}

export async function unlockOrientation(): Promise<void> {
  if (!isMobileShell()) return
  try {
    await ScreenOrientation.unlock()
  } catch {
    /* ignore */
  }
}
