import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Native shell for the CineVault web UI (iOS / Android).
 * Web assets are produced by `npm run mobile:build` → `dist/`.
 */
const config: CapacitorConfig = {
  appId: 'com.cinevault.app',
  appName: 'CineVault',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    iosScheme: 'capacitor'
  },
  plugins: {
    CapacitorUpdater: {
      // Manual OTA via GitHub Releases (see src/renderer/src/lib/mobileOta.ts)
      autoUpdate: false,
      appReadyTimeout: 10000,
      responseTimeout: 60
    },
    CapacitorHttp: {
      enabled: true
    }
  },
  android: {
    allowMixedContent: true,
    backgroundColor: '#090d16'
  },
  ios: {
    backgroundColor: '#090d16',
    contentInset: 'automatic',
    preferredContentMode: 'mobile'
  }
}

export default config
