# TextFromTrack Roon Companion — Install Guide

> **For the full styled guide**, open [`install.html`](install.html) in your browser.

---

## Table of Contents

- [Download](#download)
- [Requirements](#requirements)
- [Installation](#installation)
  - [macOS](#macos)
  - [Windows](#windows)
  - [Linux](#linux)
- [First Launch](#first-launch)
- [Docker (headless)](#docker-recommended-for-headless-installs)
- [Self-Hosted (VPS / NAS)](#self-hosted-install-vps--nas--server)
- [Updates](#updates)
- [FAQ](#faq)

---

## Download

All builds are published automatically from the [GitHub Releases page](https://github.com/r45635/roon.app.textfromtrack.com/releases).

| Platform | Format | Notes |
|---|---|---|
| **macOS** | `.dmg` / `.zip` | macOS 11 Big Sur or later · Universal (Apple Silicon + Intel) |
| **Windows** | `.exe` installer / portable `.zip` | Windows 10 or later · x64 |
| **Linux** | `.AppImage` / `.deb` | x86_64 · Debian/Ubuntu |

👉 [**Download the latest release**](https://github.com/r45635/roon.app.textfromtrack.com/releases/latest)

> Not seeing the right version? Browse [all releases on GitHub](https://github.com/r45635/roon.app.textfromtrack.com/releases) including pre-release builds.

---

## Requirements

| Requirement | Details |
|---|---|
| 🎵 **Roon Core** | A running Roon Core on your network (Nucleus, ROCK, or any Roon-supported device). The companion runs on the same machine or any computer on the same local network. |
| 🖥️ **Operating System** | macOS 11 Big Sur or later · Windows 10 (1903) or later · Ubuntu 20.04 / Debian 11 or later. The Electron app bundles its own Node.js runtime — no separate install needed. |
| 📂 **Music Library Access** | Local or network-mounted access to the same music files Roon serves. The app reads and writes FLAC/MP3/M4A tags directly on disk. |

> **Node.js not required for the desktop app.** Node.js ≥ 20 is only needed if you choose the [self-hosted / server install](#self-hosted-install-vps--nas--server).

---

## Installation

### macOS

1. **Open the `.dmg`** — Double-click the downloaded `.dmg` file. A Finder window opens.
2. **Drag to Applications** — Drag **TextFromTrack Companion.app** into the **Applications** folder shortcut shown in the window.
3. **First launch — bypass Gatekeeper** — Since the app is not yet notarized, macOS may block it on first launch. Right-click (or Control-click) the app in *Applications* → **Open** → confirm *Open* in the dialog. You only need to do this once.
4. **Find it in the menu bar** — The app runs as a tray icon in the macOS menu bar (top-right). Click it to open the context menu.

> ⚠️ **Apple Silicon — "damaged and can't be opened"?** Run:
> ```bash
> xattr -cr /Applications/TextFromTrack\ Companion.app
> ```

---

### Windows

1. **Run the installer** — Double-click `TextFromTrack Companion Setup X.X.X.exe`. The NSIS wizard runs silently and installs the app to `%LOCALAPPDATA%\Programs\TextFromTrack Companion`.
2. **Allow SmartScreen (first run)** — Windows may show a SmartScreen warning for unsigned software. Click **More info** → **Run anyway**.
3. **Find it in the system tray** — The app starts after install and adds an icon to the Windows system tray (bottom-right, near the clock). Right-click it for the menu.

---

### Linux

#### AppImage

```bash
# Replace with the actual filename
chmod +x TextFromTrack*.AppImage
./TextFromTrack*.AppImage
```

The app runs in the background and adds a tray icon to your desktop environment.

> Optional: install [AppImageLauncher](https://github.com/TheAssassin/AppImageLauncher) for system integration.

#### .deb (Debian/Ubuntu)

```bash
sudo dpkg -i textfromtrack-companion_*.deb
# Fix missing deps if any:
sudo apt-get install -f
```

Then find **TextFromTrack Companion** in your application launcher, or run `textfromtrack-companion` from a terminal.

---

## First Launch

The app starts silently in the tray. Here's how to complete the setup:

1. **Click "Open UI" in the tray menu** — Click the tray icon → **Open UI**. Your default browser opens to `http://localhost:3888`.
2. **Authorize with Roon** — In the **Roon** section of the app, you'll see a "Waiting for authorization" status. On your Roon Core, go to *Settings → Extensions* and enable **TextFromTrack Roon Companion**.
3. **Add your music library** — In *Settings → Music Library*, add the root path(s) where your music files live on this machine. Click **Scan Library**.
4. **(Optional) Add a TextFromTrack API key** — In *Settings → TextFromTrack API*, paste your API token to enable AI transcription for tracks that have no existing lyrics.

> ✅ Enable **Start at Login** in the tray menu so the companion is always running when your computer starts.

---

## Docker (recommended for headless installs)

The easiest way to run the companion on a NAS, VPS, Raspberry Pi, or any Linux server — no Node.js required, no build step, one command.

Images are published to:
- `ghcr.io/r45635/roon-companion` (GitHub Container Registry)
- `r45635/roon-companion` (Docker Hub)

Requires [Docker Engine](https://docs.docker.com/get-docker/) (Linux) or [Docker Desktop](https://www.docker.com/products/docker-desktop/) (macOS / Windows).

### Quick start

**1. Download `docker-compose.yml`**

```bash
curl -O https://raw.githubusercontent.com/r45635/roon.app.textfromtrack.com/main/docker-compose.yml
```

Or download it directly from the [GitHub repository](https://github.com/r45635/roon.app.textfromtrack.com).

**2. Edit the two required settings**

Open `docker-compose.yml` and set:
- `TFT_TOKEN` — your [TextFromTrack Personal Access Token](https://app.textfromtrack.com/account/tokens)
- The music volume path (left side of `- /path/to/your/music:/music:ro`) — the directory where your FLAC/MP3 files live on the host

**3. Start**

```bash
docker compose up -d
```

The image is pulled automatically. The UI is available at `http://localhost:3888` (or `http://<server-ip>:3888` from another machine).

**4. Authorize with Roon**

Open the UI, then on your Roon Core go to *Settings → Extensions* and enable **TextFromTrack Roon Companion**.

---

### macOS / Windows Docker Desktop — direct Core connection

Docker Desktop does not support `network_mode: host`, so Roon's automatic extension discovery (Sood UDP) cannot reach the container. Use `ROON_CORE_HOST` to connect directly instead:

```yaml
# In docker-compose.yml:
# 1. Comment out network_mode: host
# 2. Uncomment the ports block
# 3. Set the IP of your Roon Core machine
ROON_CORE_HOST: 192.168.1.10   # ← replace with your Roon Core IP
```

### Updating to a new version

```bash
docker compose pull
docker compose up -d
```

### Useful commands

```bash
# View logs
docker compose logs -f roon-companion

# Stop
docker compose down

# Persistent data is in ./data/ — back it up to preserve settings and job history
```

---

## Self-Hosted Install (VPS / NAS / Server)

Run the companion as a headless Node.js service — ideal for always-on machines, NAS, Raspberry Pi, or a VPS.

> Requires **Node.js ≥ 20** and **git**. The UI is still accessible in any browser at `http://<host>:3888`.

### Recommended: PM2 (process manager)

Keeps the server running, auto-restarts on crash, starts on boot.

```bash
# 1. Clone the repo
git clone https://github.com/r45635/roon.app.textfromtrack.com.git
cd roon.app.textfromtrack.com

# 2. Install dependencies
npm ci
cd client && npm ci && npm run build && cd ..

# 3. Configure
cp .env.example .env
# Edit .env: set MUSIC_ROOTS, PORT, etc.

# 4. Start with PM2
npm install -g pm2
pm2 start src/server.js --name tft-companion
pm2 save
pm2 startup     # follow instructions to enable boot
```

### Alternative: quick start (no PM2)

```bash
# Requires npm ≥ 9 and Node.js ≥ 20
npm install -g github:r45635/roon.app.textfromtrack.com

# Start
roon-companion

# Or with custom port
PORT=4000 roon-companion
```

### Updating (VPS)

```bash
ssh your-server
cd roon.app.textfromtrack.com

git pull
npm ci
cd client && npm run build && cd ..

pm2 restart tft-companion
```

### HTTPS with a reverse proxy

#### Nginx

```nginx
server {
  listen 443 ssl;
  server_name tft.yourdomain.com;

  ssl_certificate     /etc/letsencrypt/live/.../fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/.../privkey.pem;

  location / {
    proxy_pass         http://127.0.0.1:3888;
    proxy_http_version 1.1;
    proxy_set_header   Upgrade $http_upgrade;
    proxy_set_header   Connection "upgrade";
    proxy_set_header   Host $host;
    proxy_set_header   X-Real-IP $remote_addr;
  }
}
```

#### Caddy

```
tft.yourdomain.com {
    reverse_proxy localhost:3888
}
```

Caddy auto-provisions TLS via Let's Encrypt — run `caddy run`.

> ⚠️ If you expose the companion over the internet, protect it with a firewall or HTTP Basic Auth. The app has no built-in authentication and is designed for trusted local-network use.

---

## Updates

### Desktop app

The app checks GitHub Releases on startup. When a new version is available, a notification appears in the tray menu: *"Update to vX.Y.Z available"*.

You can also update manually by downloading the latest installer from the [Releases page](https://github.com/r45635/roon.app.textfromtrack.com/releases/latest) and installing over the existing version. Your settings are preserved in the OS user-data folder.

---

## FAQ

**The app doesn't appear in the tray after launch**

On Windows, the tray icon may be hidden in the overflow area. Click the **^** arrow near the clock and look for the TextFromTrack icon. On macOS, check the menu bar — if it's off-screen, try resizing other menu-bar icons.

---

**Roon shows "Waiting for authorization" indefinitely**

Ensure Roon Core and the companion are on the same local network subnet. Go to Roon → *Settings → Extensions* and manually click **Enable** next to *TextFromTrack Roon Companion*.

---

**My music files aren't found after scanning**

Check that the path in *Settings → Music Library* points to the **exact location on this machine**. If Roon sees files over SMB but the companion runs on a different machine, add a Path Mapping in settings (e.g. `smb://NAS/Music` → `/Volumes/Music`).

---

**Port 3888 is already in use**

For the Electron app, edit the `.env` file in the app's user-data folder and set `PORT=xxxx`. For the self-hosted install, set `PORT=xxxx` in your `.env` before starting the server.

---

**Where are settings and logs stored?**

Desktop app user-data:
- **macOS**: `~/Library/Application Support/TextFromTrack Companion/`
- **Windows**: `%APPDATA%\TextFromTrack Companion\`
- **Linux**: `~/.config/TextFromTrack Companion/`

---

© 2024 TextFromTrack · Open source under the [MIT license](../LICENSE)  
[User Guide](user-guide.md) · [GitHub](https://github.com/r45635/roon.app.textfromtrack.com) · [Releases](https://github.com/r45635/roon.app.textfromtrack.com/releases) · [Report Issue](https://github.com/r45635/roon.app.textfromtrack.com/issues)
