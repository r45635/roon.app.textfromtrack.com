# TextFromTrack Roon Companion — User Guide

> **For the full styled guide**, open [`user-guide.html`](user-guide.html) in your browser.

---

## Table of Contents

- [Overview](#overview)
- [Getting Started](#getting-started)
- [Interface](#interface)
  - [Top Bar](#top-bar)
  - [Zone Selector](#zone-selector)
  - [Now Playing](#now-playing)
  - [Local File Match](#local-file-match)
  - [File Tags](#file-tags)
- [Lyrics](#lyrics)
  - [Lyrics Actions](#lyrics-actions)
  - [Search Panel](#search-panel)
  - [Job History](#job-history)
- [Configuration](#configuration)
  - [TextFromTrack API Key](#textfromtrack-api-key)
  - [App Preferences](#app-preferences)
  - [Library Settings](#library-settings)
- [Mobile](#mobile)

---

## Overview

TextFromTrack Roon Companion is a web app that automatically finds, generates, and embeds synced LRC lyrics into your local music library — right from your browser.

- 🎵 **Roon Extension** — syncs in real time with Roon playback
- 🎤 **AI Lyrics Generation** — transcribes lyrics from audio via TextFromTrack
- 🔍 **LRCLIB Search** — searches the free community lyrics database
- 🏷️ **Tag Editor** — reads and writes metadata tags (FLAC / MP3)
- 📱 **Mobile-Friendly** — fully responsive, works as a Roon remote from your phone

---

## Getting Started

TextFromTrack works as a Roon Extension. Open the web app in any browser — your Roon player state syncs in real time.

1. **Enable the Extension** — In Roon, go to **Settings → Extensions** and enable **"TextFromTrack Roon Companion"**.
2. **Open the Web App** — Navigate to the server's URL in your browser (default: `http://localhost:3888`). The interface loads with your current Roon playback state.
3. **Scan Your Library** — Go to **Configuration → Library Settings**, add your music root path(s), and click **Save & Rescan**.
4. **Generate Lyrics** — Play a track in Roon — the companion auto-matches the file and lets you fetch or generate synced lyrics in one click.

> 💡 Keep the web app open in a browser tab while you listen. Every time Roon switches tracks, the companion updates automatically.

---

## Interface

### Top Bar

The top bar gives you quick access to language switching, Roon connection status, and the configuration panel.

| Element | Description |
|---|---|
| 🎵 Logo / Title | App name — decorative. |
| EN / FR toggle | Switch the entire interface between English and French. The preference is saved in your browser. |
| Roon status dot | Green = connected and authorized. Red = disconnected or not yet authorized. Hover for details. |
| ⚙️ Configuration | Opens the configuration drawer on the right side of the screen. |

---

### Zone Selector

The zone bar sits just below the top bar. It shows the currently active Roon zone and lets you switch between zones or transfer playback.

- **Click the zone button** (e.g. "📻 Denon 150 R + 1") to open the zone picker.
- **Select a zone** to switch the companion's focus to that output. All now-playing data updates immediately.
- **⇄ Transfer** button moves playback from the current zone to the selected zone.
- **⊕ Group** button adds another zone into the current group for synchronized playback.

> ℹ️ Switching zones in the companion *does not* change what's playing in Roon — it only changes which zone the companion is *watching*.

---

### Now Playing

The main card shows everything about the track currently playing on your selected Roon zone.

| Feature | Description |
|---|---|
| 🖼️ Album Artwork | Displayed from Roon's own artwork store. Updates as soon as the track changes. |
| ⏯️ Transport Controls | Previous, Play/Pause, Next. Sends commands directly to your Roon zone. |
| 🔁 Repeat & Shuffle | Toggle repeat (off → all → one) and shuffle modes. State mirrors Roon in real time. |
| 🔊 Volume Control | +/− buttons adjust volume by the configured step (default 3). Shows master volume with a visual bar. |
| ⏱️ Progress Bar | Scrubable progress bar. Click anywhere on the bar to seek to that position in the track. |
| 🔗 Artist / Album Links | Click the artist or album name to immediately search for that artist/album in the Search panel. |

---

### Local File Match

When a track is playing, the companion searches your scanned music library for the corresponding local file. This is necessary before reading or writing tags.

The match strip shows the matched file path, format details (bitrate, duration, size), and **confidence score badges**:

| Badge color | Meaning |
|---|---|
| 🟢 Green | High confidence — exact or near-exact match on this field. |
| 🟡 Yellow | Medium confidence — partial match. Review before proceeding. |
| 🔴 Red | Low or zero confidence on this field. |
| ⚪ Gray | Field matched by alternative method (ISRC, duration fingerprint). |

> ⚠️ **Medium confidence match:** A confirmation dialog will appear before any write operation. You can also click **"Alternatives"** to review other candidate files and select the correct one manually.

> 💡 **Library not scanned?** Go to **Configuration → Library Settings**, add your music root, then click **Save & Rescan**. The scanner indexes your files in the background.

---

### File Tags

Once a local file is matched, the File Tags card reads and displays the audio file's embedded metadata tags — and lets you edit them.

#### Tags Tab

Displays the full set of metadata tags: Title, Artist, Album Artist, Album, Year, Genre, ISRC, Composer, MusicBrainz IDs, and format info (codec, bitrate, sample rate, bit depth, channels).

#### Artwork Tab

Shows the embedded album cover art, if any.

#### Lyrics Tab

Shows any lyrics currently embedded in the audio file (plain text or LRC format). You can also:

- **✎ Edit lyrics** — click "Edit lyrics" to manually type or paste lyrics into the file.
- **🗑 Delete lyrics** — remove the embedded LYRICS tag from the file entirely.

> ℹ️ Tag writing is supported for `FLAC` (Vorbis Comments) and `MP3` (ID3v2 tags). Other formats are read-only.

---

## Lyrics

### Lyrics Actions

Two primary actions let you fetch synced lyrics from external sources. Each saves the result as a `.lrc` sidecar file and optionally embeds it into the audio file.

| Action | Description |
|---|---|
| 🔍 **Search LRCLIB** | Searches the free, community-maintained LRCLIB database for synced lyrics. Instant and requires no account. Results appear in the LRCLIB panel below. |
| 🤖 **Generate with TFT** | Submits the audio file to the TextFromTrack AI service for transcription. Generates synced lyrics from the audio itself — useful when no lyrics exist in the database. |

> 💡 **Recommended workflow:** Try LRCLIB first (free, fast). If no result is found or the sync is poor, fall back to TextFromTrack AI generation (costs credits).

#### Options available before generating

| Option | Description |
|---|---|
| Force re-transcribe | Deletes existing `.lrc` and re-submits even if lyrics already exist. The old LYRICS tag is renamed to LYRICS.ORG as a backup. |
| Embed [LYRICS] tag | After saving the `.lrc` file, also writes the LRC content into the audio file's `LYRICS` tag (FLAC / MP3 only). |
| Save .org backup | Before any write, creates a `.flac.org` / `.mp3.org` backup of the original file. |
| Save LRC beside source | Saves the `.lrc` sidecar next to the audio file on disk. |

#### LRCLIB — Contribute Back

If you've obtained synced lyrics for a track not yet in LRCLIB, you can contribute them back anonymously with a single button. The app performs a Proof-of-Work challenge to prevent spam.

---

### Search Panel

The search panel lets you manually look up lyrics in the LRCLIB database by artist, track title, and album.

1. Fields are **auto-filled** from the currently playing track. You can edit them freely.
2. Click **Search** to query LRCLIB. Results appear as cards with a preview of the lyrics.
3. Select a result to save it as the track's lyrics. The LRC file is written and the tags card updates.

> ℹ️ Clicking an **artist or album button** in the Now Playing card automatically populates the search fields and opens the search panel.

---

### Job History

Every lyrics request — whether via TextFromTrack AI transcription or LRCLIB — creates a job. The history table tracks all past requests with their status, credit cost, and actions.

| Column | Description |
|---|---|
| Date | When the job was submitted. |
| Track / Artist | The track metadata at submission time. |
| Status | 🟢 Done · 🟡 Processing · 🔴 Error — live status updates while jobs run. |
| Credits | Credits charged for TFT jobs. Shows **LRCLIB** badge for free LRCLIB results, or **Cache** for cached hits (0 credits). |
| Track path | Filename of the source audio file. Includes action buttons for done jobs: **📁 Reveal in Finder** (opens enclosing folder) · **📋 Copy lyrics** (copies full LRC text to clipboard) · **👁 View lyrics** (opens a scrollable preview modal). |
| 🔄 Retry | Deletes the existing LRC and re-submits the job. Useful when timestamps were unavailable. |

> 💡 Click the clipboard icon to copy the LRC text to your clipboard, or the eye icon to read it in a preview modal. Works for both TFT and LRCLIB jobs.

> ⚠️ **No sync timestamps?** Sometimes the AI model returns plain lyrics without timestamps. The 🟡 **No sync** badge appears on those jobs. Use the 🔄 Retry button to re-submit with a different model.

---

## Configuration

Click the **⚙️ Configuration** button in the top bar to open the settings drawer.

### TextFromTrack API Key

The TFT transcription feature requires a Personal Access Token (PAT).

1. Create a PAT at [app.textfromtrack.com](https://app.textfromtrack.com/)
2. Click **⚙️ Configuration** in the top bar, then open the **TextFromTrack API Key** section
3. Paste your key in the field and click **Save**
4. The status badge turns green and the TFT panel shows your credit balance — you're ready

> 💡 **No account yet?** Register at [app.textfromtrack.com](https://app.textfromtrack.com). New accounts receive free credits to get started.

---

### App Preferences

| Setting | Description |
|---|---|
| Volume step (± per click) | How many Roon volume units each +/− button press changes. Default: 3. |
| Player refresh interval | How often the progress bar and volume update. Options: 500ms, 1s, 2s, 3s, 5s, or custom. Lower = more responsive, higher = less network traffic. |

---

### Library Settings

| Setting | Description |
|---|---|
| Music Roots | One or more local paths to your music folders. The scanner recursively indexes all `FLAC` and `MP3` files. |
| Embed [LYRICS] tag by default | When enabled, LRC content is also written into the file's `LYRICS` tag on every save (both LRCLIB and TFT results). |
| Save .org backup before embedding | Creates a `.flac.org` / `.mp3.org` backup before any tag write. Requires "Embed LYRICS tag" to be enabled. |
| Save LRC file next to audio source | Saves a `.lrc` sidecar next to the audio file. Note: Roon does not read LRC files natively. |
| Save & Rescan | Applies the settings and triggers a full library rescan. May take a few minutes for large libraries. |

> 💡 **Roon and LRC sidecars:** Roon does not read `.lrc` sidecar files. To use synced lyrics within Roon, enable **"Embed [LYRICS] tag"** — this writes the LRC into the audio file's tag, which Roon can display in compatible views.

---

## Mobile

The interface is fully responsive. On mobile devices (≤ 767px), the layout switches to a vertically stacked single-column design optimized for thumb navigation.

| Feature | Description |
|---|---|
| 📲 Compact Player | Album art, track title, and controls are stacked vertically for easy thumb access. |
| 🤌 Touch-Optimized | All tap targets are sized to at least 44×44px. Generous padding for error-free tapping. |
| 📡 Remote Control | Use your phone as a full Roon remote — control volume, skip tracks, switch zones, and fetch lyrics from the couch. |

---

TextFromTrack Roon Companion — Built with ❤️ for Roon users  
[Install Guide](install.md) · [GitHub](https://github.com/r45635/roon.app.textfromtrack.com) · [Releases](https://github.com/r45635/roon.app.textfromtrack.com/releases)
