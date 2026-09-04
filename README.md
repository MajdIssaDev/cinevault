# CineVault

Modern desktop media catalog and player for **movies**, **series**, and **anime**.

Browse official catalogs, play from your **local library** or **HTTP/HLS streams you own or have rights to**, auto-fetch subtitles via OpenSubtitles, and enjoy a polished player with picture-in-picture, scrub previews, and HDR-aware playback when the OS/codec stack supports it.

> CineVault does **not** include torrent downloading or pirate stream indexes. Use it with content you are authorized to watch.

## Features

- **Catalog tabs**: Movies · Series · Anime · Favorites
- **Filters & sorts**: genre, year, rating, popularity, title
- **Detail views**: overview, seasons/episodes (series & anime), resolution & subtitle picks before play
- **Player**: timeline with remaining time, hover frame preview, pause/resume/stop, volume, fullscreen, subtitle size & ±0.1s offset, always-on-top mini window, “stats for nerds”, back-to-library with one-tap resume
- **OpenSubtitles**: store username/password + API key; auto-match by title/IMDB; default language in Settings
- **Quality presets**: 720p minimum · default 1080p · 2K · 4K (applied when sources expose them)
- **Cache**: finished titles removed after watch; unfinished kept 48h; open folder / clear-all in Settings
- **Themes**: dark & light corporate UI
- **Installer**: NSIS with uninstaller · portable exe · GitHub auto-updates

## Prerequisites

- Node.js 20+
- Windows 10/11 (x64) for packaged builds
- Free API keys:
  - [TMDB](https://www.themoviedb.org/settings/api) — movies & series metadata
  - [OpenSubtitles](https://www.opensubtitles.com/en/consumers) — subtitle API key (+ account login in-app)
  - Anime metadata uses the public [AniList GraphQL](https://anilist.co/graphiql) API (no key)

## Develop

```bash
npm install
npm run dev
```

Enter your TMDB and OpenSubtitles credentials under **Settings** on first launch.

## Build installer & portable exe

```bash
npm run dist
```

Outputs land in `release/`:

| Artifact | Purpose |
|----------|---------|
| `CineVault-Setup-*-x64.exe` | NSIS installer (includes uninstaller via Apps & Features) |
| `CineVault-Portable-*-x64.exe` | Run without install |
| `release/win-unpacked/CineVault.exe` | Unpacked app for local testing |
| `*.blockmap` / `latest.yml` | Auto-updater metadata (produced on GitHub publish) |

`release/` and `out/` are gitignored — push source only.

## Auto-updater

1. Edit `package.json` → `build.publish` with your GitHub `owner` / `repo`.
2. Tag a release and upload the `release/` artifacts from `npm run dist`.
3. Installed clients check GitHub Releases on startup.

## Media library & cache

Default cache directory (configurable in Settings):

```
%APPDATA%/cinevault/media-cache
```

- Add local folders under **Settings → Library**.
- Attach stream URLs on a title’s detail page (HTTP progressive or HLS `.m3u8`).
- After a complete watch, cached media for that session is deleted.
- Incomplete sessions are retained **48 hours**, then pruned on launch.
- **Settings → Open cache folder** / **Clear cache**.

## HDR / Dolby / spatial audio

Electron uses Chromium’s media stack. When Windows codecs and the source file/stream include HDR, Dolby Vision, or spatial/Atmos tracks, CineVault requests hardware decoding and reports detected tracks in **Stats for nerds**. Full Atmos/DV pass-through depends on the GPU, drivers, and display — not every title will light up every feature.

## Project layout

```
src/main/          Electron main, IPC, cache, updater
src/preload/       Safe bridge
src/renderer/      React UI + player
build/             Icons & installer assets
```

## License

MIT
