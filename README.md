# TextFromTrack Roon Companion

A local companion app that connects to Roon, detects the currently playing track, locates the physical audio source file, and generates synchronized `.lrc` lyrics through the [TextFromTrack](https://app.textfromtrack.com) API.

This is **not** an official Roon plugin. It is a standalone Node.js service that runs on the same machine (or local network) as your Roon Core.

---

## Table of contents

1. [Project purpose](#1-project-purpose)
2. [Architecture overview](#2-architecture-overview)
3. [Installation](#3-installation)
4. [Environment variables](#4-environment-variables)
5. [How to authorize the Roon extension](#5-how-to-authorize-the-roon-extension)
6. [How to scan the local music library](#6-how-to-scan-the-local-music-library)
7. [How to configure the TextFromTrack PAT token](#7-how-to-configure-the-textfromtrack-pat-token)
8. [How to generate LRC for the current Roon track](#8-how-to-generate-lrc-for-the-current-roon-track)
9. [API reference](#9-api-reference)
10. [Known limitations](#10-known-limitations)
11. [Roadmap](#11-roadmap)

---

## 1. Project purpose

Many Roon users have audio files that contain no lyrics. TextFromTrack can generate accurate, time-synchronized `.lrc` lyric files from audio transcription.

This companion app automates the full cycle:

```
Roon is playing a track
  → find the physical source file on disk
  → check whether local lyrics already exist
  → if not, submit the file to TextFromTrack
  → poll until transcription is done
  → download the .lrc export
  → save it next to the source audio file
  → Roon picks it up on the next library scan
```

The web UI runs at `http://localhost:3888` and shows live Roon status, match confidence, and job history.

---

## 2. Architecture overview

```
roon.app.textfromtrack.com/
├── src/                        Node.js / Express backend
│   ├── server.js               Express entry point
│   ├── config.js               Environment variable loader
│   ├── roon/
│   │   ├── roonClient.js       Roon API extension (discovery, pairing, zone subscription)
│   │   └── nowPlayingStore.js  In-memory now-playing state
│   ├── music/
│   │   ├── scanner.js          Recursive library scan → music-index.json
│   │   ├── matcher.js          Score-based metadata matching
│   │   ├── lyricsDetector.js   LRC sidecar + embedded lyrics detection
│   │   ├── lyricsEmbedder.js   Embed LRC into MP3/FLAC tags + .org backup orchestration
│   │   ├── flacTagger.js       Self-contained FLAC metadata editor (replaces broken metaflac-js2)
│   │   └── pathMapper.js       PATH_MAPPINGS resolution (SMB / NAS)
│   ├── textfromtrack/
│   │   ├── tftClient.js        TextFromTrack REST API client
│   │   ├── transcriptionService.js  Full orchestration (validate → submit → poll → save)
│   │   └── jobStore.js         JSON-backed job persistence
│   ├── api/
│   │   ├── routes.js           Top-level router
│   │   ├── roonRoutes.js       /api/roon/*
│   │   ├── musicRoutes.js      /api/music/*
│   │   ├── lrclibRoutes.js     /api/lrclib/*
│   │   └── textfromtrackRoutes.js  /api/tft/*
│   ├── storage/
│   │   ├── userSettings.js     Read/write user-settings.json (music roots, embed/backup defaults)
│   │   ├── music-index.json    Local music library index (runtime)
│   │   ├── user-settings.json  Persistent user preferences (runtime, created on first save)
│   │   └── jobs.json           Transcription job history (runtime)
│   └── utils/
│       ├── logger.js           Pino logger
│       ├── normalize.js        Error codes, error builder, string normalizer
│       └── fileUtils.js        Atomic JSON read/write
├── client/                     Vite + React frontend
│   ├── src/
│   │   ├── App.jsx             Main layout, polling, state management
│   │   ├── i18n/               English + French translations (i18next)
│   │   └── components/         RoonStatus, NowPlaying, ZoneSelector, SearchPanel,
│   │                           LocalMatch, TftPanel, JobHistory, LibrarySettings
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
6. Frontend polls `/api/tft/jobs/:id` → shows progress
7. Backend: TFT done → download LRC → save next to source file → update index
8. Frontend shows `HAS_LRC_FILE`

---

## 3. Installation

### Quick start (Docker — recommended for headless / server)

```bash
# 1. Download docker-compose.yml
curl -O https://raw.githubusercontent.com/r45635/roon.app.textfromtrack.com/main/docker-compose.yml

# 2. Edit TFT_TOKEN and the music volume path inside docker-compose.yml, then:
docker compose up -d
```

The UI is available at **http://localhost:3888**. See [docs/install.html](docs/install.html) for full Docker documentation (including macOS/Windows notes).

---

### Manual install (Node.js)

- **Node.js 20+** — https://nodejs.org
- A running **Roon Core** on the local network
- A **TextFromTrack account** — https://app.textfromtrack.com

### Steps

```bash
# Clone the repository
git clone https://github.com/r45635/roon.app.textfromtrack.com.git
cd roon.app.textfromtrack.com

# Install backend dependencies
npm install

# Install frontend dependencies
cd client && npm install && cd ..

# Copy the environment template
cp .env.example .env
```

Edit `.env` with your settings (see [section 4](#4-environment-variables)).

### Development

```bash
# Terminal 1 — start the backend API (port 3888)
npm run dev

# Terminal 2 — start the Vite dev server (port 5173, proxies /api to 3888)
npm run dev:client
```

Open **http://localhost:5173** in development, or **http://localhost:3888** after `npm run build`.

### Production build

```bash
npm run build     # builds client/dist/
npm start         # Express serves API + static frontend at :3888
```

---

## 4. Environment variables

Copy `.env.example` to `.env` and fill in the values.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3888` | HTTP port for the Express server |
| `APP_BASE_URL` | `http://localhost:3888` | Public base URL |
| `ROON_EXTENSION_ID` | `com.textfromtrack.roon.companion` | Roon extension identifier |
| `ROON_DISPLAY_NAME` | `TextFromTrack Roon Companion` | Name shown in Roon Settings |
| `ROON_DISPLAY_VERSION` | `0.1.0` | Version shown in Roon Settings |
| `ROON_PUBLISHER` | `TextFromTrack` | Publisher shown in Roon Settings |
| `ROON_CORE_HOST` | _(empty)_ | Direct Roon Core IP — skips auto-discovery (required in Docker on macOS/Windows) |
| `MUSIC_ROOTS` | _(empty)_ | Comma-separated absolute paths to scan |
| `PATH_MAPPINGS` | _(empty)_ | `from=to` pairs for SMB/NAS path translation (comma-separated) |
| `TFT_BASE_URL` | `https://app.textfromtrack.com/api/v1` | TextFromTrack API base URL |
| `TFT_TOKEN` | _(empty)_ | Your Personal Access Token |
| `TFT_DEFAULT_EXPORT_FORMAT` | `lrc` | Export format (`lrc`, `srt`, `txt`, `json`) |
| `TFT_DEFAULT_PINYIN` | `false` | Enable Pinyin romanization |
| `TFT_DEFAULT_VINTAGE` | `false` | Enable vintage transcription mode |
| `TFT_POLL_INTERVAL_MS` | `2000` | How often to poll for job status |
| `TFT_POLL_TIMEOUT_MS` | `600000` | Maximum polling duration (10 min) |
| `LOG_LEVEL` | `info` | Pino log level (`fatal`/`error`/`warn`/`info`/`debug`/`trace`) |

### Runtime user settings (`src/storage/user-settings.json`)

Editable from the UI (**Library Settings** card) and persisted between restarts. These override the matching `.env` values when set:

| Key | Default | Description |
|---|---|---|
| `music_roots` | `[]` | Music root paths (overrides `MUSIC_ROOTS`) |
| `path_mappings` | `[]` | Path mappings (overrides `PATH_MAPPINGS`) |
| `embed_lyrics_default` | `false` | Default state of the **embed `[LYRICS]` tag** checkbox |
| `backup_before_embed_default` | `true` | Default state of the **save `.org` backup** checkbox |

The file is created on first save; deleting it resets the runtime overrides without touching `.env`.

### Path mappings

If Roon stores file paths differently from how they appear locally (e.g. SMB network shares):

```env
# Roon sees: smb://NAS.local/Music/Artist/Track.flac
# Locally mounted at: /Volumes/Music/Artist/Track.flac
PATH_MAPPINGS=smb://NAS.local/Music=/Volumes/Music
```

Multiple mappings are comma-separated:

```env
PATH_MAPPINGS=smb://NAS.local/Music=/Volumes/Music,/volume2/music=/Volumes/Music
```

---

## 5. How to authorize the Roon extension

When the app starts, it registers itself as a Roon extension and begins discovery on the local network.

1. Open **Roon**
2. Go to **Settings → Setup → Extensions**
3. Find **"TextFromTrack Roon Companion"** in the list
4. Click **Enable**

The web UI will show **Authorized** in the Roon Connection section. The app now receives live now-playing updates from Roon.

> **Note:** Authorization must be granted once per Roon Core. The token is persisted by node-roon-api in `config.json` and survives restarts.

---

## 6. How to scan the local music library

The app must index your music files to match Roon now-playing tracks to physical files.

### Set MUSIC_ROOTS

In `.env`:

```env
MUSIC_ROOTS=/Users/yourname/Music,/Volumes/NAS/Music
```

### Run the scan

```bash
npm run scan
```

Output example:

```
Scanning music library…
Roots: /Volumes/Music

  Indexed: 12400 files  (3 errors)

✓ Scan complete: 12400 tracks indexed in 87.3s
  Index saved to: /path/to/src/storage/music-index.json
```

### Re-scan from the UI

Click **Scan Library** in the Local File Match section. The scan runs in the background; the UI polls for completion.

The index stores per-track metadata including:
- File path, title, artist, album, duration
- Embedded lyrics detection
- LRC sidecar file detection

---

## 7. How to configure the TextFromTrack PAT token

1. Log in to https://app.textfromtrack.com
2. Go to **Account → Tokens**
3. Create a new Personal Access Token (PAT)
4. Copy the token (it starts with `tft_pat_`)
5. Add it to `.env`:

```env
TFT_TOKEN=tft_pat_your_token_here
```

6. Restart the server

The UI will show your account email and credit balance. The token is **never** sent to the frontend — only `token_configured: true/false`, email, and credit balance are exposed.

---

## 8. How to generate LRC for the current Roon track

1. Start the app: `npm run dev`
2. Open **http://localhost:3888** (or http://localhost:5173 in dev)
3. Authorize the extension in Roon (see [section 5](#5-how-to-authorize-the-roon-extension))
4. **Play a track** in Roon
5. The **Now Playing** section updates automatically
6. The **Local File Match** section shows the matched file and lyrics status
7. If the track shows **No local lyrics**, click **"Generate LRC with TextFromTrack"**
8. The app submits the file and shows progress:
   - `Submitting file…`
   - `Job pending…`
   - `Processing…`
   - `Downloading LRC…`
   - `Embedding lyrics into file…` _(only when the embed option is on)_
   - `✓ LRC saved next to source file`
9. The lyrics status updates to **Has LRC file** (or **Has embedded lyrics** if you ticked embed)
10. Roon will pick up the new `.lrc` on the next library scan

### Generation options (per-job + global defaults)

Three checkboxes are exposed in the **TextFromTrack** panel, each with a global default editable in **Library Settings**:

- **Also embed `[LYRICS]` tag in audio file** — writes the LRC into the file itself in addition to the `.lrc` sidecar:
    - **MP3** → ID3v2 `USLT` frame, descriptor `LYRICS`
    - **FLAC** → Vorbis comment `LYRICS=…`
    - **WAV / others** → silently skipped (no standard tag for synced lyrics)
    - All other tags (artist, album, title, …) AND non-tag blocks (album art, seektable, …) are preserved byte-for-byte. Tag preservation is verified post-write (failure aborts the operation).
    - If a `LYRICS` tag already exists, it is renamed to `LYRICS.ORG` before the new one is written. An older `LYRICS.ORG` is overwritten by this rename.
- **Save a `.org` backup of the original file first** _(only visible when embed is on)_ — copies `Track.flac` → `Track.flac.org` byte-for-byte before any tag write. Default: **on**. Should the embed itself fail, the file is automatically restored from the backup. If `Track.flac.org` already exists, a modal asks: keep / overwrite / embed without backup / cancel. The auto-flow (one-click "Generate LRC") defaults to **keep** to never destroy an older safety copy.
- **Re-transcribe even if lyrics already exist** _(only visible when local lyrics already exist)_ — bypasses the "lyrics already exist" guard. The existing `.lrc` is deleted before the new download; an existing embedded `LYRICS` tag is renamed to `LYRICS.ORG` by the embed flow. **Charges new TFT credits.**

### Synchronized lyrics display (karaoke mode)

Every lyrics zone in the UI ships with a **Sync** toggle:

- **File Tags → Lyrics tab** (`FileTagsCard`) — sync the lyrics currently embedded in the audio file.
- **LRCLIB result preview** (`LyricsSection`) — sync the LRC just fetched from LRCLIB.
- **TextFromTrack result preview** (`LyricsSection`) — sync the LRC just generated by TFT.

Each toggle is independent — the user can sync the source they trust most for the current track. The shared component is [client/src/components/SyncedLyrics.jsx](client/src/components/SyncedLyrics.jsx).

**Behavior**
- The toggle is auto-disabled (greyed) when the LRC has no timestamps (e.g. plain LRCLIB result, or TFT export with the `--- Timestamps not available for this model ---` sentinel).
- The active line is highlighted, scaled, and auto-scrolled into view (`block: 'center'`). Faded mask at top/bottom of the scroll container gives a "floating" karaoke feel.
- Playback position is interpolated locally between Roon polls (~200ms tick) for a smooth highlight, snapping back to the truth on each new `seek_position` value.
- Header/metadata LRC tags (`[ti:…]`, `[ar:…]`, `[length:…]`, …) are dropped; multi-timestamp lines (`[00:01.00][00:05.00]Repeated`) are expanded to one entry per timestamp.

### Unsaved-lyrics warning on track change

LRCLIB and TFT results are considered "unsaved" when they have content displayed but have not been **transferred to File Tags** during the current session. When the Roon track changes and either source has unsaved content, [LyricsSection](client/src/components/LyricsSection.jsx) shows a modal with a 6-second countdown:

- **Yes, save now** — transfers each unsaved source to File Tags (same write path as the manual button), then resets the panel for the new track.
- **No, discard** (default) — applies the panel reset immediately without saving.
- **Countdown expires** — silently discards and applies (same as No). The countdown only controls the lyrics display transition; Roon playback is never paused.

The reset effect previously fired immediately on track change; it now runs only after the user resolves the prompt (or the countdown expires).

### TFT v1.7 timestamp handling

The companion app submits every transcription with `timestamps=required` (TFT v1.7+ multipart param), which forces a model that produces real per-segment timing — required for usable LRC output. The TFT API may still re-resolve the mode server-side (its music-mode block can flip `auto` → `required` for music jobs); the actual mode applied is echoed back in the 201 response as `timestamps_mode` and persisted on the local job.

After the job completes, `has_timestamps` is read from `GET /api/v1/transcriptions/:jobId/segments` (TFT v1.7+ exposes this field explicitly) and stored on the job alongside a `has_timestamps_source` flag (`segments_api` or `lrc_sentinel`) so you can tell at a glance whether the modern path or the legacy `--- Timestamps not available for this model ---` text fallback was used. If both `has_timestamps` is false and the badge appears in the **Job History** panel, hover the **⚠ No sync** chip to see the exact mode TFT applied.

**Deployment status caveat (verified 2026-05-09)**: the production endpoint at `https://app.textfromtrack.com/api/v1` does **not** yet honor `timestamps=required`. The form field is silently accepted (HTTP 201) but no `timestamps_mode` is echoed back, `/segments` does not include `has_timestamps`, and the resulting export uses `gpt-4o-transcribe` with all segments collapsed to `start=0, end=duration`. Until the v1.7 release ships, every job will trip the **⚠ No sync** badge with the tooltip "the deployed API likely pre-dates v1.7 and silently ignored the param" — and the 🔄 retry will not change the outcome. The forward-compatible client code is already in place; the day v1.7 deploys, behaviour will switch to honored-mode automatically with no app-side change required. A loud server-side warning is logged on every submission whose 201 response lacks `timestamps_mode`.

### Retroactive embed from history

If you generated lyrics without ticking embed, each `done` job in the **Job History** panel has a 🏷️ button that embeds the existing `.lrc` into the audio file on demand. Same backup / conflict-resolution UX as the main flow. The button is hidden once the job is embedded (UI updates optimistically, even before the next history poll).

### File naming

The LRC file is saved next to the source audio file with the same base name:

```
/Volumes/Music/Pink Floyd/DSOTM/06 Money.flac
→ /Volumes/Music/Pink Floyd/DSOTM/06 Money.lrc
→ /Volumes/Music/Pink Floyd/DSOTM/06 Money.flac.org   (when backup is on)
```

By default the app **will not overwrite** an existing `.lrc` and shows `HAS_LRC_FILE` to disable the button. Tick **Re-transcribe even if lyrics already exist** to override.

### Playing a Roon library track on a zone (Search panel)

The **Search Roon** panel lets you search the Roon library and trigger playback on any zone:

1. Type a query, pick a category (Tracks / Albums / Artists / All), Search.
2. Pick a target zone in the dropdown above the result list (defaults to the active zone).
3. Click **▶ Play** on any playable result.

The button only appears on items that Roon marks as directly playable (`hint: action_list` / `action` — typically tracks). Album / artist results require drilling first; the underlying `/api/roon/play-item` endpoint accepts any `item_key` from a fresh browse session.

---

## 9. API reference

### Roon endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/roon/status` | Roon connection and authorization status |
| `GET` | `/api/roon/now-playing` | Current now-playing state |
| `GET` | `/api/roon/zones` | List of all Roon zones and outputs |
| `POST` | `/api/roon/active-zone` | Switch the extension's "active" zone |
| `POST` | `/api/roon/control` | Play / pause / next / previous |
| `POST` | `/api/roon/seek` | Seek the current track |
| `POST` | `/api/roon/volume` | Change output volume (absolute or relative) |
| `POST` | `/api/roon/mute` | Mute / unmute an output |
| `POST` | `/api/roon/settings` | Toggle shuffle / auto-radio / loop |
| `POST` | `/api/roon/transfer` | Transfer the queue to another zone |
| `POST` | `/api/roon/group` / `/ungroup` | Group / ungroup outputs |
| `GET` | `/api/roon/search` | Search Roon library (`?q=...&category=tracks\|albums\|artists`) |
| `POST` | `/api/roon/browse` | Low-level browse call (drill into items) |
| `POST` | `/api/roon/browse/load` | Load items from the current browse level |
| `POST` | `/api/roon/play-item` | Trigger "Play Now" on a previously-browsed item, routed to a zone. Body: `{ item_key, hierarchy?, zone_or_output_id }` |

### Music endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/music/index/status` | Track count, last scan time, configured roots |
| `POST` | `/api/music/index/rescan` | Trigger a background library rescan |
| `GET` | `/api/music/config` | User-settings (music roots, path mappings, embed/backup defaults) |
| `POST` | `/api/music/config` | Persist user-settings; body accepts `music_roots`, `path_mappings`, `embed_lyrics_default`, `backup_before_embed_default` |
| `GET` | `/api/music/match-current` | Match current Roon track to local file. **Lyrics status is re-detected live** for the matched track and every alternative, then written through to the index, so the panel always reflects the current file state on disk. |
| `GET` | `/api/music/file-cover` | Return the embedded album art for a local file. Query: `?path=...` |
| `GET` | `/api/music/file-lyrics` | Read the embedded `LYRICS` tag (and any sidecar `.lrc`) for a local file. Query: `?path=...` |
| `GET` | `/api/music/file-tags` | Read all metadata tags for a local file. Query: `?path=...` |
| `POST` | `/api/music/file-lyrics` | Write (or update) the `LYRICS` tag in a local file. Body: `{ path, lrc_content, embed, backup, save_beside }` |
| `DELETE` | `/api/music/file-lyrics` | Remove the `LYRICS` tag from a local file. Query: `?path=...` |
| `GET` | `/api/music/open-folder` | Open the enclosing folder of a local file in the host OS file manager. Query: `?path=...` |

### LRCLIB endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/lrclib/lookup` | Look up lyrics from [lrclib.net](https://lrclib.net) for a given track. Query: `?title=...&artist=...&album=...&duration=...&path=...`. Tries `/api/get` (exact match with duration) first, then `/api/search` as fallback. Returns `{ found, synced, plain, instrumental, source }`. Hits a local LRC cache before reaching the network. |
| `POST` | `/api/lrclib/save` | Save an LRCLIB (or any) LRC result to disk and/or embed it into the audio file tags. Body: `{ path, lrc_content, embed, backup, save_beside }`. Returns `{ success, lrc_file, lyrics_embedded, backup_path }`. |

### TextFromTrack endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/tft/me` | Account info (token status, email, `credit_balance` / `credit_reserved` / `credit_available`) |
| `POST` | `/api/tft/generate-current` | Submit current track for LRC generation. Body accepts `{ embed, backup, backup_conflict, force }` (all optional). The upstream TFT call always sets `timestamps=required` (v1.7+) so the export is usable as LRC; the actually-applied `timestamps_mode` is persisted on the job. |
| `GET` | `/api/tft/jobs` | Local job history (newest first) |
| `GET` | `/api/tft/jobs/:jobId` | Single job status |
| `POST` | `/api/tft/retry` | Re-submit a `done` job that has no real timestamps. Body: `{ job_id }` |
| `POST` | `/api/tft/embed` | Retroactively embed the LRC of a `done` job into the audio file's `LYRICS` tag. Body: `{ job_id, backup, backup_conflict }`. Returns `409 BACKUP_EXISTS` (with `details.backup_path`) when `backup_conflict='ask'` and a `.org` already exists — the frontend then prompts the user. |
| `POST` | `/api/tft/reveal` | Open an `.lrc` file's enclosing folder in macOS Finder. Body: `{ path }` |

### Error envelope

All errors follow this shape:

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

Defined in [src/utils/normalize.js](src/utils/normalize.js).

| Code | Typical HTTP | Meaning |
|---|---|---|
| `ROON_NOT_CONNECTED` | 503 | Roon Core is not discovered / not reachable |
| `ROON_NOT_AUTHORIZED` | 403 | The extension is registered but not yet authorized in Roon Settings |
| `NO_CURRENT_TRACK` | 404 | No zone is playing right now |
| `NO_LOCAL_MATCH` | 404 | The matcher found no candidate file in the local index |
| `LOW_CONFIDENCE_MATCH` | 422 | Best candidate is too uncertain — manual confirmation required |
| `LYRICS_ALREADY_EXIST` | 409 | The track already has a sidecar or embedded lyrics; pass `force: true` to bypass |
| `LRC_ALREADY_EXISTS` | 409 | An `.lrc` is already on disk at the target path; pass `force` to delete and re-download |
| `LRC_WRITE_FAILED` | 500 | Could not write/delete an `.lrc` sidecar |
| `LYRICS_EMBED_FAILED` | 500 | Embed step failed (file write error, post-write tag-count check failed, …) |
| `LYRICS_EMBED_UNSUPPORTED` | 415 | Embedding requested for an unsupported extension (only `.mp3` / `.flac`) |
| `BACKUP_EXISTS` | 409 | `.org` backup already exists and `backup_conflict='ask'` — frontend should prompt the user. `details.backup_path` carries the conflicting path. |
| `TFT_TOKEN_MISSING` | 400 | `TFT_TOKEN` is empty in `.env` |
| `TFT_UNAUTHORIZED` | 401 | TFT rejected the token |
| `TFT_INSUFFICIENT_CREDITS` | 402 | Not enough `credit_available` (note: the cause is often `credit_reserved` > 0 even when `credit_balance` looks healthy) |
| `TFT_RATE_LIMITED` | 429 | TFT rate limit hit |
| `TFT_TRACK_TOO_LONG` | 422 | Track exceeds TFT's duration cap |
| `TFT_UNSUPPORTED_FORMAT` | 415 | TFT does not accept the file extension |
| `TFT_EXPORT_EXPIRED` | 410 | The export endpoint no longer holds the result for this job |
| `TFT_NOT_FOUND` | 404 | Job not found (locally or upstream) |
| `TFT_VALIDATION_ERROR` | 422 | TFT returned a validation error |
| `TFT_INTERNAL_ERROR` | 500 | TFT internal failure |
| `SOURCE_FILE_NOT_FOUND` | 404 | The matched audio file is gone from disk |
| `SOURCE_FILE_TOO_LARGE` | 413 | TFT rejected the file as too large after server-side conversion |
| `SOURCE_FILE_UNREADABLE` | 500 | Cannot stat / read the file (permissions, mount lost, …) |
| `UNKNOWN_ERROR` | 400/500 | Catch-all |

---

## 10. Known limitations

- **Roon does not expose the physical file path** via its Transport API. The app matches now-playing metadata (title, artist, album, duration) against a locally built index. Match confidence is shown in the UI (`high`, `medium`, `low`). Low-confidence matches are blocked from automatic submission.

- **The music index must be built manually.** Run `npm run scan` after setup and whenever new music is added. A future version will watch for file system changes automatically.

- **Only `.mp3`, `.wav`, and `.flac` files can be submitted** to the TextFromTrack API. Files in `.aiff`, `.aif`, or `.m4a` format will be detected during scanning but cannot be uploaded.

- **Embedding `[LYRICS]` tags is supported only for MP3 and FLAC.** WAV files have no standard tag for synced lyrics — the embed step is silently skipped for them; the `.lrc` sidecar is still written.

- **TFT enforces file-size and duration limits server-side.** The client no longer pre-rejects files; if your file is too long or too large after TFT's mono-128k MP3 conversion, the API responds with HTTP 413 / `track_too_long` and the message is surfaced verbatim in the UI.

- **TFT credit accounting** distinguishes `credit_balance` (total), `credit_reserved` (held by in-flight TFT-side jobs) and `credit_available` (= balance − reserved). The app spends from `credit_available`; a balance of 5 with 4 reserved gives only 1 spendable credit. The UI shows the breakdown in the TextFromTrack panel.

- **Roon cloud/provider lyrics are not treated as local lyrics.** The app only detects embedded ID3 (USLT) / FLAC (Vorbis `LYRICS`) tags and `.lrc` sidecar files.

- **Job and index storage uses flat JSON files** (`jobs.json`, `music-index.json`). This is sufficient for individual use but will not scale to very large libraries or concurrent access.

- **The `metaflac-js2` npm package is intentionally NOT used.** Its `parseVorbisComment()` and `parsePictureBlock()` bodies are commented out in source — calling `save()` after `setTag()` silently drops every other Vorbis comment AND every PICTURE block. The app ships a self-contained FLAC metadata editor in [src/music/flacTagger.js](src/music/flacTagger.js) that preserves all blocks byte-for-byte and verifies tag count post-write. If you find another FLAC tag library on npm to evaluate, run `tests/music/flacTagger.test.js` against it before swapping in.

- **Docker / NAS deployment is not yet supported.** The app is designed for local development use in v0.1.

- **No authentication.** The app should only be exposed on `localhost` or a trusted local network in v0.1.

---

## 11. Roadmap

### v0.2
- Better matching UI with manual file override
- ✓ Multi-zone support and zone selector
- Queue of all tracks missing lyrics
- Batch mode for full albums
- ✓ "Replace existing LRC" option with confirmation dialog (shipped as the **Re-transcribe even if lyrics exist** checkbox)
- ✓ Search Roon library + **Play on zone** button (browse → drill → trigger Play Now action with `zone_or_output_id`)
- ✓ Live re-detection of `lyrics_status` for matched track + alternatives on every `match-current` call (write-through to the index when drift is detected — the index is no longer the single source of truth for lyrics state)

### v0.3
- SQLite storage instead of JSON files
- Docker container support
- NAS deployment guide (Synology / QNAP)
- PATH_MAPPINGS configuration UI
- Admin settings page in the web UI

### v0.4
- ✓ Write lyrics directly into MP3 (ID3v2 USLT) / FLAC (Vorbis comment) tags, with all-other-tags-preserved guarantee
- ✓ Optional `.org` backup of the audio file before any tag write, with conflict resolution UI
- ✓ Idempotent retroactive embed from job history (post-transcription)
- ✓ TFT v1.7 integration: submit with `timestamps=required`, read `has_timestamps` from `/segments`, persist `timestamps_mode` on the job for traceability
- Export sync status report
- Roon playlist of all tracks missing lyrics (if supported by API)

### v0.5 — Local tag editor (mp3tag-style, lyrics-aware)
A first-class tag inspection and editing surface for files in the local library, with lyrics workflows promoted to first-class citizens.
- Read-side: parse and display every tag of any matched/selected file (ID3v2 frames for MP3, Vorbis comments for FLAC, MP4 atoms for M4A read-only at first); show pictures, technical info, and a hex/raw view of each tag block.
- Write-side: edit any field (artist, album, title, year, composer, genre, custom keys), staging changes locally before commit; per-file diff view; the existing `.org` backup mechanism is reused before any write.
- Bulk operations: select multiple files in the index, apply the same field edit (e.g. fix album artist on a whole CD), with dry-run preview.
- Lyrics-oriented workflows:
    - Side-by-side LRC sidecar ↔ embedded `LYRICS` tag, with a one-click reconcile (push sidecar into tag, pull tag into sidecar, or split-merge).
    - Inline LRC editor with timestamp-aware shortcuts (insert current playback time, nudge ±100 ms, split/merge lines).
    - `LYRICS.ORG` history: surface previous lyrics revisions kept by the embed flow and let the user pin/restore one.
    - Bulk LRC actions: re-export sidecars from embedded tags across an album, or strip embedded lyrics on demand.
- Safety: write-back uses the same `flacTagger` / `node-id3` plumbing as v0.4, with post-write tag-count verification and atomic temp-file rename.

### v0.5.5 — Synced lyrics display (shipped)
- ✓ Sync toggle on each of the three lyrics zones (File Tags, LRCLIB preview, TFT preview), reusing one component
- ✓ Smooth karaoke-style highlight + auto-scroll, with locally-interpolated playback position between Roon polls
- ✓ Auto-disabled when no timestamps (handles the legacy "Timestamps not available" sentinel)
- ✓ Unsaved-lyrics warning + 6-second discard countdown on Roon track change (default = No, Roon playback never blocked)

### v0.6 — Local player with synced lyrics verification
A built-in player so the user can audibly confirm the local match before spending TFT credits, and visually verify lyrics sync after generation.
- HTML5 `<audio>` playback streamed from the backend (range requests, `Accept-Ranges: bytes`) so the user can play the matched file from the browser without external tools.
- Side-by-side "Roon Now Playing" vs "Local File" header (title/artist/album/duration), with a confidence badge mirroring the matcher's verdict; one-click "Confirm match" button writes the chosen path back to the matcher.
- Synced LRC display: scrolling karaoke-style highlight of the current line, auto-centered, with click-to-seek on any line. The display engine is inspired by [r45635/audio-lyrics-extractor](https://github.com/r45635/audio-lyrics-extractor) — timed-text rendering + smooth interpolation between cues.
- Source toggle: render lyrics from the `.lrc` sidecar OR from the embedded `LYRICS` tag, so the user can directly compare both sources and spot drift.
- Optional waveform/spectrogram strip to spot silence vs. vocal regions (useful when reviewing fallback-model transcripts).
- Keyboard control: space to play/pause, ←/→ to seek ±5s, ↑/↓ to nudge a single LRC line by ±100 ms.

### v0.7
- HTTP Basic Auth or token auth when exposed outside localhost
- HTTPS reverse proxy deployment guide (Nginx / Caddy)
- Background job queue with priority and retry logic

### v1.0 — Public standalone distribution (Electron desktop app)

The goal of v1.0 is to make the app **installable by any Roon user without technical prerequisites** — no Node.js, no terminal, no Docker. A single download for macOS, Windows, and Linux.

#### Architecture: Electron tray app

Electron is the chosen approach because:
- The backend is **100% pure JavaScript** (no native binaries) — trivially bundleable.
- The frontend is already a browser-based React app — no window migration needed.
- A **tray-only** design (no `BrowserWindow`) keeps it lightweight: Electron just acts as the daemon that starts Express and puts an icon in the menu bar / system tray.

**Runtime model:**

```
electron electron/main.js
  ├── spawn child_process → node src/server.js   (Express + Roon SDK)
  ├── Tray icon  (menu bar on macOS / system tray on Windows + Linux)
  │     ├── Open UI          → shell.openExternal('http://localhost:3888')
  │     ├── ● Roon: <name>   → polled from /api/roon/status every 5 s
  │     ├── ◎ Credits: N     → polled from /api/tft/me every 60 s
  │     ├── ─────────────────
  │     ├── Start at login   → toggle (app.setLoginItemSettings)
  │     └── Quit
  └── app.on('window-all-closed') → suppress default quit, stay in tray
```

The UI stays in the user's default browser — `shell.openExternal()` on "Open UI". No `BrowserWindow` needed.

#### New files

```
electron/
  ├── main.js              Electron entry (tray, server spawn, IPC)
  └── assets/
        ├── icon.png              512×512 full-colour app icon
        ├── tray-icon.png         16×16 (Windows) / 22×22 (Linux)
        ├── tray-icon@2x.png      32×32 / 44×44 Retina
        └── tray-icon-mac.png     Monochrome template for macOS (follows dark/light mode)
electron-builder.yml             Build configuration (targets, signing, update channel)
```

#### Changes to existing files

- `package.json` — `"main"` field set to `"electron/main.js"`, new `electron:*` scripts, `electron` + `electron-builder` in devDependencies.
- `src/storage/userSettings.js` — use `app.getPath('userData')` for the storage folder when running inside Electron so that `user-settings.json` and `jobs.json` survive asar re-packaging.

#### Build targets

| Platform | Artifact | Notes |
|---|---|---|
| macOS | `.dmg` + universal `.zip` (arm64 + x64) | Code-signed + notarized (Apple Developer ID) |
| Windows | NSIS `.exe` installer + portable `.exe` | Code-signed (EV cert or self-signed for early builds) |
| Linux | `.AppImage` + `.deb` | No signing required |

#### npm scripts added

```json
"electron:dev":       "concurrently \"npm run dev\" \"wait-on http://localhost:3888 && electron .\"",
"electron:build":     "npm run build && electron-builder --mac --win --linux",
"electron:build:mac": "npm run build && electron-builder --mac",
"electron:publish":   "electron-builder --publish always"
```

#### Auto-update

`electron-updater` (bundled with electron-builder) publishes to GitHub Releases. The tray menu shows "Update to vX.Y.Z" when a newer release is detected.

#### Distribution channels

| Channel | Method | Audience |
|---|---|---|
| **GitHub Releases** | CI on push of `v*.*.*` tags | Primary — all users |
| `docs/install.html` (GitHub Pages) | Static download + install guide | Public marketing |
| Homebrew cask _(future)_ | `brew install --cask textfromtrack-companion` | macOS power users |
| Winget _(future)_ | `winget install TextFromTrack.Companion` | Windows power users |

#### Implementation checklist

- [x] `electron/main.js` — tray icon, server spawn, open-in-browser, start-at-login toggle
- [x] `electron-builder.yml` — appId, productName, mac/win/linux targets, GitHub publisher
- [x] `package.json` — Electron entry, scripts, devDependencies
- [x] SVG logo rasterized → `electron/assets/icon.png` (512×512), `tray-icon-mac.png` (22×22 monochrome template for macOS), `tray-icon.png` / `tray-icon@2x.png` (16/32 px colour for Windows + Linux)
- [x] `.github/workflows/release.yml` — matrix build on push of `v*.*.*` tags, publishes to GitHub Releases
- [x] `.github/workflows/ci.yml` — test suite on Node 20 + 22 on every PR/push to main
- [x] `docs/install.html` — public download page with dynamic GitHub Releases API, per-platform install steps, self-hosted guide
- [ ] `src/storage/userSettings.js` — resolve storage path via `app.getPath('userData')` when `process.type === 'browser'`
- [ ] Code-signing certificates (Apple Developer ID, Windows EV)

#### v0.9 early-access: npm global package

Before the Electron release, ship a `v0.9` for technical users (requires Node.js ≥ 20):

```bash
npm install -g @r45635/roon-companion
roon-companion   # starts the server at :3888
```
