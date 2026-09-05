# CineVault

Modern desktop media catalog and player for **movies**, **series**, and **anime**.

Browse poster catalogs with **no API keys required** (YTS movies, TVMaze series, AniList anime), pick a title, choose a torrent result, and **watch while it downloads in-app**. Also play from your **local library** or attach **HTTP/HLS** streams, with optional OpenSubtitles, picture-in-picture, and scrub previews.

> Use CineVault only with content you are authorized to access. Catalog artwork comes from public metadata APIs; torrent results are fetched from public indexes and streamed locally via WebTorrent.

## Features

- **Catalog tabs**: Movies · Series · Anime · Favorites — popular / newly released posters on screen
- **Filters & sorts**: genre, rating, popularity, title
- **Detail → torrents**: opening a title auto-searches indexes; click a result to download and watch in-app
- **Feeds**: free-text torrent search with the same in-app Play path
- **Player**: timeline with remaining time, hover frame preview, pause/resume/stop, volume, fullscreen, subtitle size & ±0.1s offset, always-on-top mini window, “stats for nerds”, back-to-library with one-tap resume
- **OpenSubtitles**: store username/password + API key; auto-match by title/IMDB; default language in Settings
- **Quality presets**: 720p minimum · default 1080p · 2K · 4K (biases torrent ranking when labeled)
- **Cache**: torrent files under the media cache; unfinished kept 48h; open folder / clear-all in Settings
- **Themes**: dark & light corporate UI
- **Installer**: NSIS with uninstaller · portable exe · GitHub auto-updates

## Prerequisites

- Node.js 20+
- Windows 10/11 (x64) for packaged builds
- Free API keys (optional):
  - [OpenSubtitles](https://www.opensubtitles.com/en/consumers) — subtitle API key (+ account login in-app)
  - Movies use [YTS](https://yts.mx/api), series use [TVMaze](https://www.tvmaze.com/api), anime uses [AniList](https://anilist.co/graphiql) — no keys

## Develop

```bash
npm install
npm run dev
```

Enter optional OpenSubtitles credentials under **Settings** if you want subtitle search.

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

Packaged installs check [GitHub Releases](https://github.com/MajdIssaDev/cinevault/releases) on launch and download updates in the background. When ready, use **Settings → Restart to Update** (or quit the app — updates install on quit).

Publish a new version:

```bash
# bump version in package.json, then:
git tag v1.1.0
git push origin v1.1.0
# or build locally:
npm run dist
npx electron-builder --win --publish always
```

NSIS setup (`CineVault-Setup-*-x64.exe`) registers an uninstaller in **Windows Settings → Apps**.

## Media library & cache

Default cache directory (configurable in Settings):

```
%APPDATA%/cinevault/media-cache
```

- Add local folders under **Settings → Library**.
- Torrents download under `media-cache/torrents/` and stream via a local HTTP server while downloading.
- Attach stream URLs on a title’s detail page (Advanced section: HTTP progressive or HLS `.m3u8`).
- After a complete watch, cached media for that session may be pruned.
- Incomplete sessions are retained **48 hours**, then pruned on launch.
- **Settings → Open cache folder** / **Clear cache**.

## HDR / Dolby / spatial audio

Electron uses Chromium’s media stack. When Windows codecs and the source file/stream include HDR, Dolby Vision, or spatial/Atmos tracks, CineVault requests hardware decoding and reports detected tracks in **Stats for nerds**. Full Atmos/DV pass-through depends on the GPU, drivers, and display — not every title will light up every feature.

## Project layout

```
src/main/          Electron main, IPC, torrent engine, cache, updater
src/preload/       Safe bridge
src/renderer/      React UI + player
build/             Icons & installer assets
```

## License

MIT
