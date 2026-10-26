# Development guide — TextFromTrack Roon Companion

How the companion is built, how to run it from source, every setting and API route. Using the app? Start with the [README](../README.md) and the [quick start](quickstart.md).

- [Architecture](#architecture-overview) · [Development setup](#development-setup) · [Environment variables](#environment-variables) · [API reference](#api-reference) · [Known limitations](#known-limitations) · [Roadmap](#roadmap)

---

## Architecture overview

```
roon.app.textfromtrack.com/
├── src/                        Node.js / Express backend
│   ├── server.js               Express entry point
│   ├── config.js               Environment variable loader
│   ├── roon/
│   │   ├── roonClient.js       Roon API extension (discovery, pairing, zone subscription)
│   │   └── nowPlayingStore.js  In-memory now-playing state
│   ├── lyrics/
│   │   ├── lyricsResolver.js   Lyrics for a track: local file → cache → LRCLIB (works without files)
│   │   ├── nowPlayingLyrics.js Local match + prefetch on every track change
│   │   └── lrclibClient.js     LRCLIB HTTP client (busy/5xx raise, 404 = not found)
│   ├── music/
│   │   ├── musicRoots.js       Configured music roots + path containment check
│   │   ├── scanner.js          Recursive library scan → music-index.json
│   │   ├── matcher.js          Score-based metadata matching
│   │   ├── lyricsDetector.js   LRC sidecar + embedded lyrics detection
│   │   ├── lyricsEmbedder.js   Embed LRC into MP3/FLAC tags + .org backup orchestration
│   │   └── flacTagger.js       Self-contained FLAC metadata editor (replaces broken metaflac-js2)
│   ├── textfromtrack/
│   │   ├── tftClient.js        TextFromTrack REST API client
│   │   ├── transcriptionService.js  Full orchestration (validate → submit → poll → save)
│   │   ├── jobStore.js         JSON-backed job persistence
│   │   └── webhookService.js   TFT webhook lifecycle (register, HMAC-SHA256 verify, process)
│   ├── api/
│   │   ├── routes.js           Top-level router
│   │   ├── roonRoutes.js       /api/roon/*
│   │   ├── musicRoutes.js      /api/music/*
│   │   ├── lrclibRoutes.js     /api/lrclib/*
│   │   ├── lyricsRoutes.js     /api/lyrics/* (lyrics stage, kiosk)
│   │   └── textfromtrackRoutes.js  /api/tft/*
│   ├── storage/
│   │   ├── userSettings.js     Read/write user-settings.json (music roots, embed/backup defaults)
│   │   ├── lyricsPrefs.js      Per-track timing offset and picked LRCLIB version (lyrics-prefs.json)
│   │   ├── music-index.json    Local music library index (runtime)
│   │   ├── user-settings.json  Persistent user preferences (runtime, created on first save)
│   │   └── jobs.json           Transcription job history (runtime)
│   └── utils/
│       ├── logger.js           Pino logger
│       ├── normalize.js        Error codes, error builder, string normalizer
│       ├── fileUtils.js        Atomic JSON read/write
│       ├── sseService.js       Server-Sent Events broadcast (real-time job status push)
│       └── lrcCache.js         LRC content cache keyed by file path and track metadata
├── client/                     Vite + React frontend
│   ├── src/
│   │   ├── App.jsx             Main layout, polling, state management
│   │   ├── i18n/               English + French translations (i18next)
│   │   ├── lib/lrc.js          LRC parsing ([offset:] aware) and timestamp shifting
│   │   └── components/         HeroCard, LyricsStage, LyricsFullscreen, LyricsKiosk,
│                           SyncedLyrics, ZoneSelector, SearchPanel, FileTagsCard,
│                           LyricsSection, JobHistory, RoonStatus, LibrarySettings,
│                           AppPrefs, FilesManagement, TftApiKey
│   └── dist/                   Built frontend (served by Express in production)
└── scripts/
    ├── scan-library.js         CLI: npm run scan
    └── test-tft-api.js         CLI: npm run test:tft
```

**Data flow for LRC generation:**

1. Roon Transport API → zone subscription → `nowPlayingStore`
2. Frontend polls `/api/roon/now-playing` → displays track
3. Frontend calls `/api/music/match-current` → `matcher.js` scores local index tracks
4. User clicks **Generate LRC** → `POST /api/tft/generate-current`
5. Backend: validate → submit to TFT → save job → start background poll
6. Frontend receives SSE event via `/api/tft/events` (or polls `/api/tft/jobs/:id`) → shows progress
7. Backend: TFT done → download LRC → save next to source file → update index
8. Frontend shows `HAS_LRC_FILE`

---

## Development setup

Requires Node.js 22+.

```bash
git clone https://github.com/r45635/roon.app.textfromtrack.com.git
cd roon.app.textfromtrack.com
npm install
cd client && npm install && cd ..
cp .env.example .env   # fill in TFT_TOKEN and MUSIC_ROOTS
```

```bash
# Terminal 1 — backend (port 3888)
npm run dev

# Terminal 2 — Vite dev server (port 5173, proxies /api to 3888)
npm run dev:client   # VITE_API_TARGET=http://host:port to proxy /api elsewhere
```

```bash
# Production build
npm run build   # builds client/dist/
npm start       # Express serves API + static frontend at :3888
```

```bash
# Electron app
npm run electron:dev
npx electron-builder --mac --arm64 --dir   # packaged app in dist/, ad-hoc signed
```

> Shells inside VS Code (and other Electron hosts) export `ELECTRON_RUN_AS_NODE=1`: Electron then runs as plain Node (`app` is undefined, the packaged app exits silently). Prefix with `env -u ELECTRON_RUN_AS_NODE`.

> On a machine that already runs the installed app, give the dev backend its own port, storage and **Roon name** — otherwise Roon → Settings → Extensions lists two identical entries and you can't tell which one to remove:
>
> ```bash
> ROON_DISPLAY_NAME="TFT Companion DEV :3991" PORT=3991 TFT_USER_DATA_DIR=/tmp/tft-dev ROON_CORE_HOST=<core ip> npm run dev
> ```

---

## Environment variables

Copy `.env.example` to `.env` and fill in the values.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3888` | HTTP port for the Express server |
| `APP_BASE_URL` | `http://localhost:3888` | Public base URL |
| `ROON_EXTENSION_ID` | `com.textfromtrack.roon.companion` | Roon extension identifier |
| `ROON_DISPLAY_NAME` | `TextFromTrack Roon Companion` | Name shown in Roon Settings |
| `ROON_DISPLAY_VERSION` | _(app version)_ | Version shown in Roon Settings |
| `ROON_PUBLISHER` | `TextFromTrack` | Publisher shown in Roon Settings |
| `ROON_CORE_HOST` | _(empty)_ | Direct Roon Core IP — skips auto-discovery (required in Docker on macOS/Windows) |
| `ROON_CORE_PORT` | `9330` | Roon Core extension port used with `ROON_CORE_HOST` (Roon 2.x: `9330`; legacy 1.x: `9100`) |
| `ALLOWED_HOSTS` | _(empty)_ | Extra host names allowed to reach the UI/API, comma-separated (e.g. a reverse-proxy domain). `localhost`, IP addresses and LAN names (`*.local`, `*.lan`, single-label like `nas`) are always allowed; `*` disables the check |
| `MUSIC_ROOTS` | _(empty)_ | Comma-separated absolute paths to scan |
| `TFT_BASE_URL` | `https://app.textfromtrack.com/api/v1` | TextFromTrack API base URL |
| `TFT_TOKEN` | _(empty)_ | Your Personal Access Token |
| `TFT_DEFAULT_EXPORT_FORMAT` | `lrc` | Export format (`lrc`, `srt`, `txt`, `json`) |
| `TFT_DEFAULT_PINYIN` | `false` | Enable Pinyin romanization |
| `TFT_DEFAULT_VINTAGE` | `false` | Enable vintage transcription mode |
| `TFT_DEFAULT_AUDIO_TYPE` | `music` | Audio type hint for transcription (`music`, `speech`) |
| `TFT_DEFAULT_LANGUAGE` | _(empty)_ | Force a specific transcription language (ISO 639-1 code) |
| `WEBHOOK_BASE_URL` | _(empty)_ | Public base URL for TFT webhook delivery. When set, the app auto-registers a webhook with TFT on startup |
| `TFT_POLL_INTERVAL_MS` | `2000` | How often to poll for job status |
| `TFT_POLL_TIMEOUT_MS` | `600000` | Maximum polling duration (10 min) |
| `ACCESS_TOKEN` | _(empty)_ | Optional token required from other machines (UI and API). Give it once with a link `http://<host>:3888/?access_token=…` (sets a cookie; the tray's QR code includes it) or `Authorization: Bearer …`. This machine itself is exempt unless the request comes through a proxy |
| `UPDATE_CHECK` | `true` | `false` stops the backend from asking GitHub (at most every 6 h) whether a newer release exists |
| `LOG_LEVEL` | `info` | Pino log level (`fatal`/`error`/`warn`/`info`/`debug`/`trace`) |

**Runtime user settings** (`src/storage/user-settings.json`) — editable from the UI (**Library Settings** card), override the matching `.env` values when set:

| Key | Default | Description |
|---|---|---|
| `music_roots` | `[]` | Music root paths (overrides `MUSIC_ROOTS`) |
| `embed_lyrics_default` | `false` | Default state of the **embed `[LYRICS]` tag** checkbox |
| `backup_before_embed_default` | `true` | Default state of the **save `.org` backup** checkbox |
| `save_lrc_beside_source_default` | `false` | Default state of the **save LRC beside source** checkbox |
| `tft_token` | `""` | TFT Personal Access Token set via the UI (overrides `TFT_TOKEN` env var) |

---

## API reference

### Roon endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/roon/status` | Roon connection and authorization status |
| `GET` | `/api/roon/now-playing` | Current now-playing state of the active zone, or of `?zone_id=` |
| `GET` | `/api/roon/zones` | List of all Roon zones and outputs |
| `POST` | `/api/roon/active-zone` | Switch the extension's "active" zone |
| `POST` | `/api/roon/control` | Play / pause / next / previous (optional `zone_id`, else the active zone) |
| `POST` | `/api/roon/seek` | Seek the current track |
| `POST` | `/api/roon/volume` | Change output volume (absolute or relative) |
| `POST` | `/api/roon/mute` | Mute / unmute an output |
| `POST` | `/api/roon/settings` | Toggle shuffle / auto-radio / loop |
| `POST` | `/api/roon/transfer` | Transfer the queue to another zone |
| `POST` | `/api/roon/group` / `/ungroup` | Group / ungroup outputs |
| `GET` | `/api/roon/search` | Search Roon library (`?q=...&category=tracks\|albums\|artists`) |
| `POST` | `/api/roon/browse` | Low-level browse call (drill into items) |
| `POST` | `/api/roon/browse/load` | Load items from the current browse level |
| `POST` | `/api/roon/play-item` | Trigger "Play Now" on a previously-browsed item. Body: `{ item_key, hierarchy?, zone_or_output_id }` |

### Music endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/music/stream` | Stream a local file for preview (`?path=`, HTTP Range, music roots only) |
| `GET` | `/api/music/index/status` | Track count, last scan time, configured roots, live scan progress, last scan error, missing roots |
| `POST` | `/api/music/index/rescan` | Trigger a background library rescan |
| `GET` | `/api/music/config` | User-settings (music roots, embed/backup defaults) |
| `POST` | `/api/music/config` | Partial update: send only the keys to change |
| `GET` | `/api/music/match-current` | Match current Roon track to local file (lyrics status re-detected live) |
| `GET` | `/api/music/file-cover` | Return the embedded album art for a local file. Query: `?path=...` |
| `GET` | `/api/music/file-lyrics` | Read the embedded `LYRICS` tag and any sidecar `.lrc`. Query: `?path=...` |
| `GET` | `/api/music/file-tags` | Read all metadata tags for a local file. Query: `?path=...` |
| `POST` | `/api/music/file-lyrics` | Write (or update) the `LYRICS` tag. Body: `{ path, lrc_content, embed, backup, save_beside }` |
| `DELETE` | `/api/music/file-lyrics` | Remove the `LYRICS` tag. Query: `?path=...` |
| `GET` | `/api/music/open-folder` | Open the enclosing folder in the host OS file manager. Query: `?path=...` |

### LRCLIB endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/lrclib/lookup` | Look up lyrics from [lrclib.net](https://lrclib.net). Query: `?title=...&artist=...&album=...&duration=...&path=...` |
| `POST` | `/api/lrclib/save` | Save an LRCLIB result to disk and/or embed it. Body: `{ path, lrc_content, embed, backup, save_beside }` |

### Lyrics endpoints (with or without a music folder)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/lyrics/current` | Lyrics of the track playing in a zone: matched file (sidecar, embedded), cache, then LRCLIB. Query: `?zone_id=...&path=...` (both optional; `path` must be under a music root). Returns `{ track, library_configured, audio_path, lyrics: { found, source, text, synced, instrumental, lrclib_id, offset_ms, error? } }` |
| `POST` | `/api/lyrics/choose` | Use a specific LRCLIB record for a track. Body: `{ title, artist, album?, lrclib_id }` |
| `POST` | `/api/lyrics/custom` | Save edited lyrics (LRC editor) as the track's lyrics in the local cache. Body: `{ title, artist, album?, lrc }` |
| `POST` | `/api/lyrics/offset` | Save a track's timing offset (positive = later). Body: `{ title, artist, album?, offset_ms }` |

### Library endpoints (music folder required)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/library/summary` | Lyrics coverage (`.lrc` files, embedded, missing), scan state, reachability of each music root, current batch |
| `GET` | `/api/library/tracks` | Scanned tracks. Query: `?status=missing\|with\|all&q=...&offset=...&limit=...` (max 200) |
| `POST` | `/api/library/lrclib-batch` | Fetch lyrics from LRCLIB and write them into the files, in the background. Body: `{ paths }` or a filter `{ status, q }`, plus `synced_only` (default `true`). Never replaces lyrics already in or next to a file; waits and retries when LRCLIB is busy |
| `GET` | `/api/library/lrclib-batch` | State of the current or last batch (counts, current track, wait, last errors) |
| `POST` | `/api/library/lrclib-batch/cancel` | Stop after the current track |

### TextFromTrack endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/tft/config` | Whether a TFT token is currently configured. Returns `{ token_configured, token_source }` — never the raw token |
| `POST` | `/api/tft/config` | Save or clear the TFT token from user settings. Body: `{ tft_token }` |
| `GET` | `/api/tft/me` | Account info (token status, email, credit balance) |
| `POST` | `/api/tft/generate-current` | Submit current track for LRC generation. Body: `{ embed, backup, backup_conflict, force }` |
| `GET` | `/api/tft/jobs` | Local job history (newest first) |
| `GET` | `/api/tft/jobs/:jobId` | Single job status |
| `GET` | `/api/tft/job-lyrics` | Fetch the LRC content for a `done` job. Query: `?job_id=...` |
| `POST` | `/api/tft/retry` | Re-submit a `done` job with no real timestamps. Body: `{ job_id }` |
| `POST` | `/api/tft/embed` | Retroactively embed the LRC of a `done` job. Body: `{ job_id, backup, backup_conflict }` |
| `POST` | `/api/tft/reveal` | Open an `.lrc` file's enclosing folder in Finder. Body: `{ path }` |
| `GET` | `/api/tft/events` | SSE stream — pushes `{ type: 'job_updated', job_id }` events to connected clients |
| `POST` | `/api/tft/webhook` | Receive TFT webhook deliveries (HMAC-SHA256 verified). Auto-registered on startup when `WEBHOOK_BASE_URL` is set |

### Error envelope

```json
{
  "success": false,
  "error": {
    "code": "NO_CURRENT_TRACK",
    "message": "No track is currently playing in Roon.",
    "details": {}
  }
}
```

### Error codes

Defined in [src/utils/normalize.js](../src/utils/normalize.js).

| Code | HTTP | Meaning |
|---|---|---|
| `ROON_NOT_CONNECTED` | 503 | Roon Core not discovered / not reachable |
| `ROON_NOT_AUTHORIZED` | 403 | Extension not yet authorized in Roon Settings |
| `NO_CURRENT_TRACK` | 404 | No zone is playing right now |
| `NO_LOCAL_MATCH` | 404 | Matcher found no candidate file in the local index |
| `LOW_CONFIDENCE_MATCH` | 422 | Best candidate is too uncertain |
| `LYRICS_ALREADY_EXIST` | 409 | Track already has sidecar or embedded lyrics; pass `force: true` to bypass |
| `LRC_ALREADY_EXISTS` | 409 | `.lrc` already on disk at target path |
| `LRC_WRITE_FAILED` | 500 | Could not write/delete an `.lrc` sidecar |
| `LYRICS_EMBED_FAILED` | 500 | Embed step failed |
| `LYRICS_EMBED_UNSUPPORTED` | 415 | Unsupported extension (only `.mp3` / `.flac`) |
| `BACKUP_EXISTS` | 409 | `.org` backup already exists and `backup_conflict='ask'` |
| `TFT_TOKEN_MISSING` | 400 | `TFT_TOKEN` is empty in `.env` |
| `TFT_UNAUTHORIZED` | 401 | TFT rejected the token |
| `TFT_INSUFFICIENT_CREDITS` | 402 | Not enough `credit_available` |
| `TFT_RATE_LIMITED` | 429 | TFT rate limit hit |
| `TFT_TRACK_TOO_LONG` | 422 | Track exceeds TFT's duration cap |
| `TFT_UNSUPPORTED_FORMAT` | 415 | TFT does not accept the file extension |
| `TFT_EXPORT_EXPIRED` | 410 | Export endpoint no longer holds the result |
| `TFT_NOT_FOUND` | 404 | Job not found (locally or upstream) |
| `TFT_VALIDATION_ERROR` | 422 | TFT returned a validation error |
| `TFT_INTERNAL_ERROR` | 500 | TFT internal failure |
| `SOURCE_FILE_NOT_FOUND` | 404 | Matched audio file is gone from disk |
| `SOURCE_FILE_TOO_LARGE` | 413 | TFT rejected the file as too large |
| `SOURCE_FILE_UNREADABLE` | 500 | Cannot stat / read the file |
| `UNKNOWN_ERROR` | 400/500 | Catch-all |

---

## Known limitations

- **Roon does not expose the physical file path** via its Transport API. The app matches now-playing metadata (title, artist, album, duration) against a locally built index. Match confidence is shown in the UI (`high`, `medium`, `low`). Low-confidence matches are blocked from automatic submission.

- **The music index must be built manually.** Run `npm run scan` after setup and whenever new music is added.

- **Only `.mp3`, `.wav`, and `.flac` files can be submitted** to the TextFromTrack API. `.aiff`, `.aif`, and `.m4a` are indexed but cannot be uploaded.

- **Embedding `[LYRICS]` tags is supported only for MP3 and FLAC.** WAV files have no standard tag for synced lyrics — the embed step is silently skipped; the `.lrc` sidecar is still written.

- **TFT credit accounting** distinguishes `credit_balance` (total), `credit_reserved` (held by in-flight jobs), and `credit_available` (= balance − reserved). The app spends from `credit_available`.

- **Roon cloud/provider lyrics are not treated as local lyrics.** Only embedded ID3 (USLT) / FLAC (Vorbis `LYRICS`) tags and `.lrc` sidecar files are detected.

- **Job and index storage uses flat JSON files** (`jobs.json`, `music-index.json`). Sufficient for individual use; will not scale to very large libraries or concurrent access.

- **`metaflac-js2` is intentionally NOT used.** Calling `save()` after `setTag()` silently drops every other Vorbis comment AND every PICTURE block. The app ships [src/music/flacTagger.js](../src/music/flacTagger.js) — a self-contained FLAC editor that preserves all blocks byte-for-byte and verifies tag count post-write.

- **No authentication by default.** The app should only be exposed on `localhost` or a trusted local network — anyone who can reach port 3888 can use it, unless you set `ACCESS_TOKEN`. Browser-based attacks from other websites are blocked: state-changing requests from another origin are rejected (CSRF), and so are requests whose `Host` is a public domain (DNS rebinding; see `ALLOWED_HOSTS`). Do not publish the port to the Internet.

- **macOS builds are ad-hoc signed, not notarized.** First launch needs *Open Anyway* in *Privacy & Security*, and the app needs *Local Network* access to reach Roon. Builds must stay signed on their own: unsigned Electron apps share Electron's stock cdhash, and Apple revoked Electron 31.7.7's — v0.3.13–0.3.15 were blocked as "Malware" on Apple Silicon.

---

## Roadmap

### v0.2 ✓
- Multi-zone support and zone selector
- Search Roon library + **Play on zone** button
- Live re-detection of `lyrics_status` on every `match-current` call

### v0.3 ✓
- Docker container support

### v0.4 ✓
- Write lyrics into MP3 (ID3v2 USLT) / FLAC (Vorbis comment) tags, all-other-tags-preserved
- Optional `.org` backup before any tag write, with conflict resolution UI
- Retroactive embed from job history
- TFT v1.7 integration: `timestamps=required`, `has_timestamps` from `/segments`

### Early milestone ✓ — Synced lyrics display
- Sync toggle on File Tags, LRCLIB preview, and TFT preview zones
- Karaoke-style highlight + auto-scroll, locally-interpolated between Roon polls
- Unsaved-lyrics warning + 6-second discard countdown on track change

### v0.3.1 ✓ — Electron app + infrastructure
- **Electron desktop app** — single-download installer for macOS / Windows / Linux; tray icon spawns the Express server, opens the UI in the system browser; auto-update check on startup
- TFT API token configurable from the UI — no `.env` editing required
- SSE push channel (`/api/tft/events`) for real-time job status updates without polling
- TFT webhook integration — HMAC-SHA256 verified, auto-registered on startup when `WEBHOOK_BASE_URL` is set
- LRC cache layer — avoids redundant TFT downloads for previously-processed tracks
- `save_lrc_beside_source` option configurable as a per-operation default

### v0.3.17 ✓ — Roon 2.x and macOS fixes
- Direct connect uses Roon 2.x's port `9330` (`ROON_CORE_PORT`), with retries and explicit errors
- Discovery retries a Core whose first connection failed (it was ignored until restart)
- Backend exits on SIGTERM (no orphan after quitting the app, fast `docker stop`)
- Electron 44, ad-hoc signed macOS bundle, Local Network usage declared; Node 22

### v0.3.18 ✓ — macOS Local Network and library fixes
- Unique Mach-O UUIDs (after-pack hook): macOS can now prompt for and list the app under Local Network
- Local Network denial detected (`local_network_blocked`), with dialog, tray item and UI banner opening the right settings pane
- The backend no longer renames the Mac at every start (Bonjour host records under `tft-<hostname>.local`)
- music-metadata 12 (synced FLAC lyrics keep their timestamps, MP3 USLT lyrics found by the job route), `qs` override
- UI no longer shows "Backend offline" when only Roon is disconnected

### v0.3.19 ✓ — Security fixes
- Open-folder no longer goes through a shell (folder names like `$(cmd)` executed `cmd`)
- Cross-origin writes rejected (CSRF) and public Host names rejected (DNS rebinding; `ALLOWED_HOSTS`)
- TFT webhook verifies the raw body (it never worked and could crash the backend); async route errors no longer kill the server

### v0.4.0 ✓ — Lyrics without a music folder
- **Lyrics stage** under the player for every track, with or without a local file: karaoke sync on by default, click a line to seek, per-track timing offset, LRCLIB version picker, copy / download `.lrc`, "Save to file" when a file matched
- **Full-screen lyrics** (button or `F`) and a **kiosk page** `/#/lyrics?zone=…` for a tablet or TV (wake lock, own zone, linked from the phone QR page)
- Lyrics prefetched in the backend on every track change and cached; misses and LRCLIB outages remembered, so one LRCLIB round per track
- Roon title decorations ("(Remastered 2011)", "- Live", " / " artists) retried in simplified form
- A busy LRCLIB (`503 ServerOverloaded`) is reported as such, not as "no lyrics"
- Distinct empty states: server unreachable, Core not found, waiting for the extension to be enabled, macOS Local Network blocked, nothing playing
- Library tools hidden until a music folder is set; Docker music volume optional
- Fixes: Files Management toggles were never saved (rejected by the server while the UI said "Saved"), a UI-entered API key did not override `TFT_TOKEN`, undefined `INVALID_REQUEST` error code, tray credits line, second app launch now opens the UI, Job History Retry / Embed buttons, French strings in the English UI
- Removed: `PATH_MAPPINGS` (Roon never exposes file paths, so there was nothing to map)

### v0.5.0 ✓ — Library lyrics, editor, dark theme
- **Library lyrics** card: coverage (`.lrc` / embedded / missing), filters, search, and an **LRCLIB batch** that writes the missing lyrics into your files (1 track/s, waits 30/60/120 s when LRCLIB is busy, never replaces existing lyrics, cancellable)
- Optional **automatic save** of synced LRCLIB lyrics for the playing track when its file has none
- **LRC editor**: sync plain lyrics or fix timing by pressing Space on each line while Roon plays
- **Listen to the file**: preview the matched local file in the browser before spending credits
- Scan status in Settings (count, last scan, live progress, unreachable folders); a scan with every folder unreachable no longer empties the index
- **Dark theme** (system, or forced in App Preferences); SVG player icons, repeat mode shown, Roon's own mute, keyboard and touch sliders; phone layout (Job History as cards, 44 px targets)
- Readable error messages (e.g. read-only Docker music mount), TFT key checked with the service, "Top up credits" link
- Update notice (tray and UI), desktop notifications (TFT job, LRCLIB batch), optional **`ACCESS_TOKEN`**
- Open folder / reveal on Windows and Linux; "Follow playing track" (was "Auto Match File") with a banner when off; Job History "Show older jobs"

### v0.5.1 ✓ — LRCLIB busy handling
- A busy LRCLIB (503/429) is retried once at once; the Retry button really asks again; clearer "LRCLIB is overloaded" message

### v0.5.2 ✓ — Phone / TV access
- QR code reachable from the web UI (phone icon in the top bar, "On a phone / TV" in the lyrics stage), with a second QR code for the full-screen lyrics display
- The QR code and "Open on Network" no longer pick a self-assigned 169.254.x, VPN or bridge address
- Zone menu closes on an outside click or Escape; zone rows show the cover, state, grouped speakers and volume; dB and +/- -only volumes handled

### v0.5.3 ✓ — Screenshot mode
- App Preferences → Screenshot mode (or `?privacy=1`): neutral Core, zone, speaker, account and folder names on screen, for sharing screenshots and bug reports

### v0.5.4 ✓ — Polish
- Screenshot mode: neutral names stay the same on every page; paused zones don't show what they last played
- Instrumental breaks shown as ♪ in synced lyrics

### v0.5.5 ✓ — Polish
- Screenshot mode names in the UI language; shorter French labels; SVG controls in full screen

### v0.5.6 ✓ — Zone selection fix
- A zone with nothing loaded (stopped, empty queue) can be chosen again: the selection used to fall back silently to another zone

### v0.5.7 ✓ — Phone / TV page in French
- The QR page follows the UI language (`/api/qr?lang=fr`), or the browser's when opened from the tray

### Upcoming

#### Local tag editor (mp3tag-style, lyrics-aware)
Tag inspection (all fields), LYRICS write/delete and the LRC timing editor are done. Still pending: read/write every metadata field, bulk tag operations.

#### TextFromTrack batch
Generate AI lyrics for many library tracks at once, with the credit estimate shown before confirming.

#### Remote access
- Remote-backend mode of the desktop app with an `ACCESS_TOKEN`-protected backend
