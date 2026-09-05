import { Capacitor } from '@capacitor/core'

export type RuntimePlatform = 'electron' | 'ios' | 'android' | 'web'

export function isNativeMobile(): boolean {
  try {
    return Capacitor.isNativePlatform()
  } catch {
    return false
  }
}

export function getRuntimePlatform(): RuntimePlatform {
  if (typeof window !== 'undefined' && window.cinevault) return 'electron'
  try {
    const p = Capacitor.getPlatform()
    if (p === 'ios' || p === 'android') return p
  } catch {
    /* Capacitor not available */
  }
  return 'web'
}

export function isMobileShell(): boolean {
  const p = getRuntimePlatform()
  return p === 'ios' || p === 'android'
}
