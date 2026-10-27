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

**What leaves my network?**
To find lyrics, a track's title, artist, album and length go to LRCLIB. Once every few hours the
app asks GitHub whether a new version exists (`UPDATE_CHECK=false` turns that off). Nothing else.
Other devices on your network can be asked for a token (`ACCESS_TOKEN`).

**Docker on a Mac or Windows PC?**
Docker Desktop can't use host networking, so Roon can't discover the container: use the `ports`
block of the [docker-compose.yml](../docker-compose.yml) and set `ROON_CORE_HOST` to your Core's IP.

**Something else?** Open an [issue](https://github.com/r45635/roon.app.textfromtrack.com/issues) —
Screenshot mode (App Preferences) hides your names and folders if you attach a picture.

*Not affiliated with Roon Labs.*
