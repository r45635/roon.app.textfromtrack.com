# FAQ — TextFromTrack Roon Companion

*Français : [faq.fr.md](faq.fr.md) · [Quick start](quickstart.md) · [The player](guide/player.md) · [Your library](guide/library.md)*

**Does it change anything in Roon?**
No. It's a Roon extension that reads what zones play and sends the controls you use (play, seek,
volume…). It never edits your Roon library. Lyrics only reach your files if you set a music folder
and save them there — see [your library](guide/library.md).

**A song has no lyrics. Why?**
Lyrics come from [LRCLIB](https://lrclib.net), a free community database: most popular songs are
there, rare ones may not be. Try **Other versions** with a simpler title. AI lyrics for the rest,
with TextFromTrack, are coming later — that service is still in development.

**"LRCLIB is unreachable" or "overloaded" — what can I do?**
lrclib.net, the free server behind the lyrics, is sometimes down or overloaded for hours; the app
tries again every minute, and **Retry** asks at once. To stop depending on it, run a mirror — a
copy of LRCLIB's database on your own server or NAS: its [server](https://github.com/tranxuanthang/lrclib)
is open source and the database is a public download. Then Settings → **Lyrics Sources**: add the
mirror and move it above lrclib.net. Each lookup tries the servers in that order, and **Test**
checks one. Step by step, with what it takes (~320 GB of disk):
[your own LRCLIB mirror](lyrics-database.md#2-your-own-lrclib-mirror).

**Where are the lyrics kept? How do I clear them?**
Every lyric found is kept in a local cache, so a song you've played once is instant the next time,
even when LRCLIB is down. Where it lives, what it holds and how to start over:
[the local cache](lyrics-database.md#1-the-local-cache).

**Does it work with Roon ARC?**
No. The companion is a web page served on your home network (`http://<computer>:3888`); it doesn't
add lyrics inside Roon ARC. On your phone at home, scan the QR code (phone icon in the top bar).

**Do I need a music folder or an account?**
No. Lyrics for everything Roon plays work without either. A music folder only adds writing lyrics
into your files.

**Will it mess up my tags?**
No. Writing lyrics changes only the lyrics (an MP3's lyrics frame, a FLAC's LYRICS comment); every
other tag and the artwork are copied as they were and checked after the write. A `.org` copy of the
original is kept by default.

**Does Roon show the lyrics it writes?**
Roon reads lyrics embedded in your files' tags: in Roon, Settings → Library → Import settings, set
*Lyrics* and *Synchronized lyrics* to *Prefer file*, then let Roon rescan. Don't count on Roon
reading `.lrc` files beside the tracks.

**macOS says it can't check the developer.**
The app isn't notarized by Apple yet. Open it once, then System Settings → Privacy & Security →
**Open Anyway**. Allow *Local Network* access when asked — it's how the app reaches Roon.

**macOS asks to access a network volume.**
That happens when your music folder is on a NAS share or an external drive: click **Allow**. Until
you do, the library scan waits. Because the app isn't signed by Apple yet, macOS asks again after
each update. Missed it? System Settings → Privacy & Security → Files and Folders → TextFromTrack
Companion → *Network Volumes*.

**Can several screens show lyrics at once?**
Yes. Every phone, tablet or TV browser can open the lyrics display, and each one follows its own
zone (**Zone** button).

**Is there a dedicated screen?**
Yes: [TFT Panel](https://r45635.github.io/tft-panel/), free open-source firmware for three 7" touch
screens. It is a remote you never have to unlock — the cover, the lyrics in time with the song,
play, skip, volume, zones and your whole library — and it becomes a clock when the music stops.
[Install it from Chrome or Edge](https://r45635.github.io/tft-panel/install.html).

It can take what is playing from this companion, which also finds and ranks the lyrics; keep the
companion running and the panel finds it by itself. The desktop app serves only while it is open:
quit it and the screens fall silent (a fresh install starts it at login; the container is the
always-on way). It can also reach Roon on its own, and then it only needs the words — see the next
question.

**My panel talks to Roon itself. Do I still need this?**
Only for the lyrics, because Roon serves none. Run this companion with `ROON_ENABLED=false` and it
becomes a lyrics server and nothing else: it never pairs with Roon, there is no second extension to
enable, and your panels find it on the network. You still get what only a machine of yours can give
— the `.lrc` files beside your music, the local cache and your own LRCLIB mirror before the public
service. If the panel cannot find it by itself (on Docker Desktop the container is behind a VM, so its
announcement never reaches your LAN), give the panel this machine's address: the companion answers
LRCLIB's own `GET /api/get`. The songs your panels asked for are listed on the companion's page,
under **Asked by your screens**: mark wrong lyrics, pick another version, paste the right words or
shift the timing there, and the panel gets the fix the next time it asks for that song.

**What leaves my network?**
To find lyrics, a track's title, artist, album and length go to LRCLIB (lrclib.net, or the servers
listed in Settings → Lyrics Sources) — for the playing track and the next three in the zone's queue. Once every few hours the
app asks GitHub whether a new version exists (`UPDATE_CHECK=false` turns that off). Nothing else.
Other devices on your network can be asked for a token (`ACCESS_TOKEN`).

**Docker on a Mac or Windows PC?**
Docker Desktop runs containers inside a VM, so Roon's discovery cannot reach one: use the `ports`
block of the [docker-compose.yml](../docker-compose.yml) and set `ROON_CORE_HOST` to your Core's IP.

**Something else?** Open an [issue](https://github.com/r45635/roon.app.textfromtrack.com/issues) —
Screenshot mode (App Preferences) hides your names and folders if you attach a picture.

*Not affiliated with Roon Labs.*
