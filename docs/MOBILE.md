# CineVault Mobile (Capacitor)

Cross-platform iOS / Android shell around the same React UI, with Capgo OTA updates from GitHub Releases.

## Prerequisites

- Node 20+
- Android Studio (Android) / Xcode 15+ on macOS (iOS)
- For OTA: publish a GitHub Release that includes a `dist.zip` web bundle (optional `sha256` in release notes)

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run mobile:build` | Build web → `dist/` and `npx cap sync` |
| `npm run mobile:android` | Sync + open Android Studio |
| `npm run mobile:ios` | Sync + open Xcode |
| `npm run mobile:ota:zip` | Build and zip `dist.zip` for a release |

## OTA

Configured in `src/renderer/src/lib/mobileOta.ts` against `MajdIssaDev/cinevault`.

1. Bump `version` in `package.json`
2. `npm run mobile:ota:zip`
3. Attach `dist.zip` to a GitHub Release tagged with that version (e.g. `v1.0.1`)
4. Optionally add to the release body: `dist.zip sha256: <hex>`

On launch (and when returning to foreground), the app downloads a newer `dist.zip`, verifies checksum when present, applies via `CapacitorUpdater.set()`, and must call `notifyAppReady()` within 10s or Capgo rolls back.

## Notes

- Electron desktop builds are unchanged (`npm run dev` / `npm run dist`).
- Native torrent IPC is Electron-only; mobile focuses on HTTP/HLS playback, catalog, trailers, and OTA until a native torrent bridge is added.
