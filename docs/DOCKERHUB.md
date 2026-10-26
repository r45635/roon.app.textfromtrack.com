# TextFromTrack Roon Companion

**Synced lyrics for everything Roon plays — line by line, in time with the music, on any screen in the house.**

<img src="https://raw.githubusercontent.com/r45635/roon.app.textfromtrack.com/main/docs/media/clips/karaoke.gif" width="640" alt="Lyrics highlighted line by line, in time with the music">

A small Node service and web UI that pairs with your Roon Core and shows synced lyrics for
whatever a zone plays — Qobuz, TIDAL, radio or local files. Click a line and Roon jumps there,
nudge the timing, go full screen, or turn a phone, tablet or TV browser into a lyrics display
(each screen follows its own zone). Lyrics come from [LRCLIB](https://lrclib.net); no music
folder and no account needed.

Images: `r45635/roon-companion` (Docker Hub) and `ghcr.io/r45635/roon-companion` — **amd64 and arm64**.

## Run it

```bash
docker run -d --name roon-companion --network host --restart unless-stopped \
  -v "$PWD/data:/app/src/storage" r45635/roon-companion
```

Then in Roon: **Settings → Extensions → TextFromTrack Roon Companion → Enable**, and open
`http://<host>:3888`. The phone icon in the top bar shows QR codes for your phone and for a
full-screen lyrics display.

With Compose, use the [docker-compose.yml](https://github.com/r45635/roon.app.textfromtrack.com/blob/main/docker-compose.yml).

- **Linux / NAS:** keep `--network host` — Roon's discovery needs it.
- **Docker Desktop (Mac / Windows):** use `-p 3888:3888` and set `ROON_CORE_HOST` to your Core's IP.

## Options

| Variable | What it does |
|---|---|
| `ROON_CORE_HOST` | Connect to this Core directly instead of discovering it (needed without host networking) |
| `ACCESS_TOKEN` | Require a token from other devices: open `http://<host>:3888/?access_token=…` once on each |
| `UPDATE_CHECK=false` | Never ask GitHub whether a newer release exists |
| `ALLOWED_HOSTS` | Your domain, when behind a reverse proxy |
| `MUSIC_ROOTS` + a music volume | Only if you want it to write lyrics into your files (mount `:rw`) |
| `TFT_TOKEN` | Optional AI lyrics with [TextFromTrack](https://app.textfromtrack.com) (paid credits) |

Every variable: [development guide](https://github.com/r45635/roon.app.textfromtrack.com/blob/main/docs/DEVELOPMENT.md#environment-variables).

## Your library, if you want

Mount your music folder and the companion can also write `.lrc` files or embed lyrics in MP3 / FLAC
tags (other tags and artwork kept), fill your whole library from LRCLIB in one batch, and let you
sync lyrics yourself.

## Links

[GitHub](https://github.com/r45635/roon.app.textfromtrack.com) ·
[Quick start](https://github.com/r45635/roon.app.textfromtrack.com/blob/main/docs/quickstart.md) ·
[Player guide](https://github.com/r45635/roon.app.textfromtrack.com/blob/main/docs/guide/player.md) ·
[Desktop apps](https://github.com/r45635/roon.app.textfromtrack.com/releases/latest) ·
[Issues](https://github.com/r45635/roon.app.textfromtrack.com/issues)

MIT licensed. Not affiliated with Roon Labs.
<sub>Clip music: "The Nest" by Josh Woodward, CC BY 4.0 — joshwoodward.com.</sub>
