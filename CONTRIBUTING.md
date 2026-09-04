# CineVault — contributor notes

## Stack

- Electron 33 + electron-vite
- React 18 + TypeScript
- Zustand (UI persistence)
- hls.js (HLS playback)
- electron-builder (NSIS installer + portable + auto-update metadata)
- electron-updater (GitHub Releases)

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Development with hot reload |
| `npm run build` | Compile main/preload/renderer to `out/` |
| `npm run dist` | Build + package Windows installer & portable exe into `release/` |
| `npm run dist:dir` | Unpackaged `release/win-unpacked/CineVault.exe` for quick smoke test |

## First-run keys

Users paste TMDB + OpenSubtitles credentials in **Settings**. Never commit `.env` secrets.

## Release checklist

1. Bump `version` in `package.json`
2. Set `build.publish.owner` / `repo`
3. `npm run dist`
4. Create a GitHub Release tagged `vX.Y.Z` and upload `release/*` artifacts (`Setup.exe`, `.blockmap`, `latest.yml`, portable optional)
5. Do **not** commit `release/` or `out/`

## Uninstaller

NSIS target registers a standard Windows uninstaller (Add/Remove Programs → CineVault).
