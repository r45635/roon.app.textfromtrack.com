# Media storyboard — screenshots, mini videos, ad visuals

Production plan for the user documentation and the launch material of
TextFromTrack Roon Companion **v0.5.5**. Part A (player, no file access) is shot first;
Part B (library features) once a music folder is connected; Part C (install) mixes app
captures and OS / Roon dialogs.

## Ground rules

| Rule | How |
|---|---|
| **No personal data on screen** | App Preferences → *Screenshot mode* on (or `?privacy=1`): Core = "Roon Core", zones = Living Room / Kitchen / Office…, speakers = Speaker A/B…, e-mail = listener@example.com, folders = `/Music/…`, QR page = 192.168.1.20. Check every capture anyway: browser tabs, bookmarks bar, macOS menu bar, notifications, dock. |
| **Copyright-clean music** | Only songs by **Josh Woodward**, licensed **CC BY 4.0** (commercial use allowed with credit). Lyrics, recording and cover are his; LRCLIB has synced lyrics for them. Never show commercial covers or lyrics in ads. |
| **Credit line** (on every page, post and video that shows them) | Music – "The Nest", "My Favorite Regret", "Wake Up" by Josh Woodward (CC BY 4.0). Free download: https://www.joshwoodward.com/ |
| **Both languages** | Capture each UI shot in EN and FR (language switch in the top bar). Ads are written in both. |
| **Both themes** | Hero shots in light and dark. |
| **Clean browser** | Chrome window without extensions bar, 1440×900 viewport (desktop) and a 390×844 frame (phone). |

## Setup checklist (before shooting)

1. Add the three songs to the Roon library (download the MP3s from joshwoodward.com/song/TheNest, /MyFavoriteRegret, /WakeUp).
2. App v0.5.5 on the MacBook Air, paired with the Core; Screenshot mode on.
3. In Roon, play "The Nest" on the zone shown as *Living Room*; volume around 30; repeat off, shuffle off.
4. Check that lyrics show as **synced** (source badge "LRCLIB" or "Saved copy").
5. Close the settings drawer and pop-ups; scroll to top.

## Part A — the player (lyrics for everything Roon plays)

### Screenshots

| ID | Shot | Key content | Formats |
|---|---|---|---|
| A1 | **Hero** — player + lyrics stage, the active line in the middle | cover, title/artist, progress, highlighted line, Timing / Other versions / Full screen | light + dark, EN + FR |
| A2 | **Full-screen lyrics** | big lines over the blurred cover, transport | dark, EN |
| A3 | **Lyrics on a tablet / TV** (kiosk `/#/lyrics`) | one zone, full screen | 1024×768 frame |
| A4 | **Phone** | player + lyrics at 390 px | 390×844 frame, light + dark |
| A5 | **Zone menu** | covers, state, "+ 1 speaker", volume | light |
| A6 | **Other versions** | version picker with synced / not-synced badges | light |
| A7 | **Timing** close-up | − +0.5 s + | crop |
| A8 | **Empty state** | "Enable the extension in Roon" | light (capture before pairing a fresh instance, or skip) |
| A9 | **Settings** | Theme, Screenshot mode, TFT key check | dark |
| A10 | **Phone / TV QR page** | two QR codes (example address) | crop |

### Mini videos (GIF + MP4, 6–12 s, no sound)

| ID | Clip | Steps |
|---|---|---|
| V1 | **Karaoke** | hold on A1 for ~8 s while the highlight moves and the list scrolls |
| V2 | **Click a line to jump** | click a line two lines ahead → playback jumps, highlight follows |
| V3 | **Full screen** | press F → full screen, 4 s of lyrics → Esc |
| V4 | **Fix the timing** | click + twice → lines shift, value shows +1.0 s → click the value to reset |
| V5 | **Switch zone** | open the zone menu, pick another zone, lyrics follow |
| V6 | **Phone & TV** | QR page → phone frame showing the kiosk |

## Part B — your library (needs file access, shot later)

| ID | Shot / clip |
|---|---|
| B1 | Local match strip: confidence, format, "Listen to the file" player |
| B2 | Library Lyrics card: coverage bar, filters, "Fetch lyrics for these N tracks" |
| B3 | Batch running, then the summary (saved / not found / skipped) |
| B4 | LRC editor: stamping lines with Space (clip) |
| B5 | "Save to file" → File Tags show the embedded lyrics |
| B6 | TextFromTrack AI generation: progress → synced result (credits shown) |
| B7 | Settings: music folder with scan status; Files Management options |

## Part C — install (quick start)

| ID | Shot | Source |
|---|---|---|
| C1 | Release page with the downloads | GitHub (browser) |
| C2 | macOS: *Open Anyway* in Privacy & Security | Vincent (OS dialog) |
| C3 | macOS: Local Network permission prompt | Vincent (OS dialog) |
| C4 | **Roon → Settings → Extensions → Enable** | Vincent (Roon app) |
| C5 | Tray menu: Open UI / QR code / Notifications | Vincent (menu bar) |
| C6 | Docker: `docker compose up -d` in a terminal | terminal capture |

## Ad visuals (built from the captures)

| ID | Format | Use | Content |
|---|---|---|---|
| AD1 | 1280×640 | GitHub social preview, Docker Hub | A1 dark on a plain background, headline |
| AD2 | 1200×675 (16:9) | X, Mastodon, Reddit link posts, forum | A1 + A2 side by side, headline + 3 bullets |
| AD3 | 1080×1080 | Facebook, Instagram-style squares | phone frame (A4) + headline |
| AD4 | 1080×1350 | portrait feed | tablet kiosk (A3) + phone |
| AD5 | GIF/MP4 ≤ 15 s | Reddit / forum / README | V1 → V2 → V3 cut together |

Every ad visual carries: the product name, "Free & open source", the credit line
(small, bottom), and "Not affiliated with Roon Labs".

## File layout

```
docs/media/
  en/  player-hero-light.png  player-hero-dark.png  player-fullscreen.png  …
  fr/  (same names)
  clips/  karaoke.gif  karaoke.mp4  seek.gif  fullscreen.gif  timing.gif  zones.gif
docs/marketing/
  storyboard.md  ads.en.md  ads.fr.md  visuals/  (AD1–AD5)
```

## Privacy check before committing any image

- Look at the whole image at 100 %: no real Core/zone/speaker names, e-mail, IP address,
  folder path, browser tab titles, bookmarks, notifications or menu-bar items.
- Run the hub's screenshot scan rule (secrets, URIs, QR codes with real addresses, PII).
- QR codes only from the Screenshot-mode page (example address).
