# Quick start — TextFromTrack Roon Companion

Synced lyrics for everything Roon plays, in five minutes. No music folder needed.

*Français : [quickstart.fr.md](quickstart.fr.md)*

## 1. Install

Pick **one**. Downloads: [latest release](https://github.com/r45635/roon.app.textfromtrack.com/releases/latest).

| Where | Download | First launch |
|---|---|---|
| **Mac** (Apple Silicon) | `TextFromTrack.Companion-<version>-arm64.dmg` | Drag the app to Applications and open it. macOS says it can't check the developer: **System Settings → Privacy & Security → Open Anyway**. Then **Allow** when it asks for *Local Network* access (needed to reach Roon). |
| **Mac** (Intel) | `TextFromTrack.Companion-<version>.dmg` | Same as above. |
| **Windows** | `TextFromTrack.Companion.Setup.<version>.exe` | SmartScreen may warn: **More info → Run anyway**. |
| **Linux** | `.AppImage` (any distro) or `.deb` | AppImage: `chmod +x` the file, then run it. |
| **NAS / server** (Docker) | `docker compose up -d` with the [docker-compose.yml](../docker-compose.yml) | Linux host: keep `network_mode: host`. Docker Desktop (Mac/Windows): use the `ports` block and set `ROON_CORE_HOST` to your Core's IP. |

The desktop app lives in the menu bar (Mac) or system tray (Windows/Linux): it starts the companion
and opens the UI in your browser.

## 2. Enable it in Roon

In Roon: **Settings → Extensions → TextFromTrack Roon Companion → Enable**.

The companion's page shows *"Enable the extension in Roon"* until you do.

## 3. Play something

Open the UI (menu bar icon → **Open UI**, or `http://localhost:3888`) and play any track in Roon —
streaming included. The lyrics appear under the player, highlighted line by line.

- **Click a line** to jump there; **Timing − / +** if they run early or late.
- **Full screen**: press **F**.
- **On a phone, tablet or TV**: the phone icon in the top bar shows QR codes for the app and
  for a full-screen lyrics display.

Lyrics come from [LRCLIB](https://lrclib.net), a free community database. If a song has none,
try **Other versions**.

## 4. Optional

- **Your music folder** (Settings → Library Settings): read and write lyrics in your files, fill your
  whole library from LRCLIB, sync lyrics yourself — see the [library guide](guide/library.md).
- **AI lyrics — coming soon**: [TextFromTrack](https://app.textfromtrack.com) will write synced lyrics for songs no
  one has transcribed. The service is still in development.
- **Access token** (`ACCESS_TOKEN`): require it from other devices on your network.

## Doesn't work?

| You see | Do |
|---|---|
| "Looking for your Roon Core…" for more than a minute | Roon and the companion must be on the same network. In Docker or across subnets, set `ROON_CORE_HOST` to the Core's IP. |
| "macOS is blocking the connection" | System Settings → Privacy & Security → **Local Network** → enable TextFromTrack Companion. |
| No extension in Roon's list | Restart the companion; check the Core is Roon 2.x (port 9330). |
| "LRCLIB is overloaded" | The free database is busy; it retries by itself. |

More: [FAQ](faq.md) · [player guide](guide/player.md) · [library guide](guide/library.md) · [full install guide](install.md) ·
[issues](https://github.com/r45635/roon.app.textfromtrack.com/issues)

*Not affiliated with Roon Labs.*
