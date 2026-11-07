# Lyrics at home: the local cache and your own LRCLIB mirror

*Français : [Les paroles à la maison](lyrics-database.fr.md)*

The companion gets its lyrics from [LRCLIB](https://lrclib.net), a free community database. Two
things keep it working when lrclib.net is slow or down:

1. **The local cache**: on by default, nothing to set up. Every lyric the companion finds is kept
   on your computer, so a song you've already played never needs LRCLIB again.
2. **Your own LRCLIB mirror** (optional): a full copy of the LRCLIB database on a NAS or server at
   home. Songs you've never played are found too, without lrclib.net, and the lookups stay on your
   network.

- [The local cache](#1-the-local-cache)
- [Your own LRCLIB mirror](#2-your-own-lrclib-mirror): [what you need](#what-you-need) ·
  [install](#install-step-by-step) · [connect the companion](#step-6--point-the-companion-at-it) ·
  [update](#updating-to-a-newer-dump) · [security](#security) · [troubleshooting](#troubleshooting)

---

## 1. The local cache

### What it keeps

| Kept | Where it comes from |
|---|---|
| The lyrics of every track the companion found lyrics for | LRCLIB, when the track played or while it waited in the queue (the next three tracks are looked up in advance) |
| The version you picked | **Other versions** |
| Lyrics you edited or synced | The LRC editor |
| Lyrics written by the library batch | The LRCLIB fill of the *Library lyrics* card (see [your library](guide/library.md)) |
| Your timing offset and chosen version, per track | `lyrics-prefs.json`, next to the cache |

Each entry is a small `.lrc` text file, a few KB. A thousand songs take a few MB. Tracks are
recognized by **artist + title + album**, so the same song on another album is looked up again.

The badge next to *Lyrics* says **Saved copy** when lyrics come from the cache. Settings → App
Preferences → *Diagnostics — System Info* → **Load** shows its size and number of files (desktop
app).

Not kept on disk: "no lyrics for this song" is remembered for 30 minutes, and a failed lookup for
one minute, so a missing song doesn't hit LRCLIB on every play. Both are forgotten when the
companion restarts.

### Where it is

| Install | Cache | Timing and versions |
|---|---|---|
| **macOS** | `~/Library/Application Support/roon-companion-textfromtrack/storage/lrc-cache/` | `…/storage/lyrics-prefs.json` |
| **Windows** | `%APPDATA%\roon-companion-textfromtrack\storage\lrc-cache\` | `…\storage\lyrics-prefs.json` |
| **Linux** | `~/.config/roon-companion-textfromtrack/storage/lrc-cache/` | `…/storage/lyrics-prefs.json` |
| **Docker** | `data/lrc-cache/` in the folder mounted on `/app/src/storage` | `data/lyrics-prefs.json` |
| **Node.js** | `src/storage/lrc-cache/` | `src/storage/lyrics-prefs.json` |

It survives updates. In Docker it lives in your mounted `data` folder, so it also survives
re-creating the container.

### Back it up, move it, start over

- **Back up or move it:** copy the `storage` folder (Docker: `data`). It also holds your settings
  and your Roon pairing.
- **Start over:** quit the app (Docker: `docker compose stop`), delete `lrc-cache`, start again.
  Delete `lyrics-prefs.json` too to forget timing offsets and version choices. Lyrics you edited in
  the LRC editor without saving them into a music file live only in the cache: export them first (**Download** in the player) if you want
  to keep them.
- **One wrong lyric:** no need to clear anything. **Other versions** replaces it for that track.

The cache only knows songs you've already played. For the others, a server has to answer: lrclib.net,
or a mirror.

---

## 2. Your own LRCLIB mirror

LRCLIB publishes its whole database as a download, and its server is open source (MIT,
[tranxuanthang/lrclib](https://github.com/tranxuanthang/lrclib)). Run both at home, and the companion
asks your copy first.

**Worth it when:**
- lrclib.net is down or overloaded and you'd rather not wait;
- you want lookups to stay on your network: with lrclib.net removed from the list, nothing about what
  you play leaves the house;
- several screens or companions look up lyrics all day.

**Not worth it** if you have no machine with ~320 GB free and always on: the cache alone already
covers the songs you play often.

### What you need

| | |
|---|---|
| **Disk** | ~50 GB for the compressed dump, ~270 GB for the database, ~1.5 GB for the search index (October 2026 dump). Prefer an SSD for the database. A hard disk works, but lookups are slower: about 0.2 s each. |
| **Memory** | The server uses what its settings allow (`LRCLIB_MMAP_SIZE`, `mem_limit` below): on a NAS with 32 GB of RAM, a 12 GB cap was plenty. With less RAM, lower both. |
| **Docker** | On the machine that runs the mirror, plus `git` and Docker on the machine that builds the image (they can be the same). |
| **Network** | The companion must reach the mirror: same LAN, a fixed address. |
| **Time** | The download depends on your connection (49 GB). Decompressing takes ~20 min on an SSD, and the first search index ~5 min. |

The October 2026 dump holds 34.6 million tracks, 22.4 million of them with synced lyrics.

### Install, step by step

The examples use a folder `/srv/lrclib`. Replace it with yours, for example a shared folder on your
NAS, and replace `192.168.1.20` with the mirror machine's LAN address.

#### Step 1 — Download the dump

The dumps are listed on **[lrclib.net/db-dumps](https://lrclib.net/db-dumps)**, as files named
`lrclib-db-dump-<date>.sqlite3.gz`. Take the newest, copy its link, and download it where you have
room. `-C -` resumes after a cut:

```bash
mkdir -p /srv/lrclib/dumps && cd /srv/lrclib/dumps
curl -fL -C - --retry 20 --retry-delay 30 -o lrclib-db-dump-<date>.sqlite3.gz '<link copied from the page>'
gzip -t lrclib-db-dump-<date>.sqlite3.gz && echo "dump OK"   # checks the whole file; takes a while
```

If the download is cut, run the same `curl` again: it continues.

#### Step 2 — Decompress it

The database needs about **5.5 times** the size of the dump. Check the free space first
(`df -h /srv/lrclib`):

```bash
mkdir -p /srv/lrclib/data/db /srv/lrclib/data/index
gzip -dc /srv/lrclib/dumps/lrclib-db-dump-<date>.sqlite3.gz > /srv/lrclib/data/db/lrclib-<date>.sqlite3
```

Keeping the date in the file name lets you install a newer dump later next to the old one.

Optional check, if `sqlite3` is installed:

```bash
sqlite3 -readonly /srv/lrclib/data/db/lrclib-<date>.sqlite3 'PRAGMA user_version; SELECT max(id) FROM tracks;'
```

The second number should be in the tens of millions.

Keep the `.gz` as a recovery copy on another disk, or delete it once the mirror works.

#### Step 3 — Build the server image

LRCLIB doesn't publish a ready-made image: you build it from its source. It takes ~7 minutes on a
recent computer.

```bash
git clone https://github.com/tranxuanthang/lrclib.git
cd lrclib
git rev-parse --short HEAD          # note it: the project has no release numbers
docker build -t lrclib-server .
```

To build on your computer for a NAS of another kind (a Mac with Apple silicon is `arm64`, most NAS
are `amd64`):

```bash
docker buildx build --platform linux/amd64 -t lrclib-server --load .
docker save lrclib-server | gzip > lrclib-server.tar.gz
# copy lrclib-server.tar.gz to the NAS, then on the NAS:
docker load < lrclib-server.tar.gz
```

#### Step 4 — The compose file

In `/srv/lrclib`, create the two files below.

The **server** answers on port 3300 inside Docker only. A small **Caddy** proxy in front publishes it
on your LAN address, and only lets lookups through. The LRCLIB server also accepts new lyrics and
flags: without the proxy, anyone on your network could write into your copy.

`docker-compose.yml`:

```yaml
name: lrclib-mirror

services:
  lrclib:
    image: lrclib-server
    restart: unless-stopped
    command: ["lrclib", "serve", "--port", "3300", "--database", "/data/db/lrclib-<date>.sqlite3"]
    environment:
      LRCLIB_LOG: info
      # Part of the database kept in memory, in bytes. Stay under 75 % of the RAM you can spare:
      # 8 GiB here, for a machine with 16 GB or more. Lower it on a small machine.
      LRCLIB_MMAP_SIZE: "8589934592"
      # One search index per database file, so a newer dump never reuses an old index.
      LRCLIB_SEARCH_INDEX_DIR: /data/index/lrclib-<date>.sqlite3.tantivy
    volumes:
      # Read-write on purpose: the server sets up the database when it starts.
      # The proxy below is what makes the mirror read-only.
      - ./data/db:/data/db
      - ./data/index:/data/index
    mem_limit: 12g
    security_opt:
      - no-new-privileges:true

  proxy:
    image: caddy:2.10.2-alpine
    restart: unless-stopped
    depends_on:
      - lrclib
    ports:
      # Your mirror machine's LAN address, never 0.0.0.0, never forwarded by your router.
      - "192.168.1.20:3300:3300"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
    read_only: true
    tmpfs:
      - /data
      - /config
    cap_drop:
      - ALL
    cap_add:
      - NET_BIND_SERVICE   # the Caddy image needs it, or it won't start
    security_opt:
      - no-new-privileges:true
```

`Caddyfile`:

```caddyfile
{
	admin off
	auto_https off
}

:3300 {
	request_body {
		max_size 4KB
	}

	@read {
		method GET HEAD
		path /api/get /api/get/* /api/search
	}
	@write path /api/request-challenge /api/publish /api/flag

	route {
		respond /healthz "ok" 200
		reverse_proxy @read lrclib:3300
		respond @write "read-only mirror" 403
		respond "not found" 404
	}
}
```

`/api/get`, `/api/get/<id>` and `/api/search` are the only routes the companion uses.

#### Step 5 — Start it and check

```bash
cd /srv/lrclib
docker compose up -d
docker compose logs -f lrclib        # Ctrl-C to leave
```

From another computer on the network:

```bash
# An exact lookup: works as soon as the server is up
curl -s 'http://192.168.1.20:3300/api/get?artist_name=Josh+Woodward&track_name=The+Nest' | head -c 300

# A search: answers an error until the search index is built (~5 min the first time)
curl -s 'http://192.168.1.20:3300/api/search?q=josh+woodward+the+nest' | head -c 300

# Writes are refused: expect 403
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://192.168.1.20:3300/api/publish
```

The first answer is JSON with `"trackName":"The Nest"` and a `syncedLyrics` field. If the search
still errors after 15 minutes, look at `docker compose logs lrclib`.

#### Step 6 — Point the companion at it

Settings → **Lyrics Sources**:

1. Add `http://192.168.1.20:3300`.
2. Move it **above** `lrclib.net` with ↑.
3. Press **Test**: it should say the server answers.

Docker or headless install: set it in the environment instead. The setting in the app wins over the
variable.

```yaml
LRCLIB_URLS: http://192.168.1.20:3300,https://lrclib.net
```

In Docker, **Test** checks from inside the container: if it fails there and works from your
computer, the container can't reach that address. Run it with `network_mode: host`, as in the
companion's [docker-compose.yml](../docker-compose.yml).

### How the companion uses the list

- Servers are asked **in order**; the first one that has the song answers.
- **Not on the mirror** → the next server is asked. A dump is a snapshot, so songs added to LRCLIB
  since then are only on lrclib.net. Keep lrclib.net last to get them.
- **Mirror unreachable or slower than 5 s** → the next server is asked, and the mirror is skipped
  for one minute, so a mirror that's off doesn't slow every song.
- **Busy (503/429)** → the next server is asked at once; the last one gets one retry.
- "No lyrics" is decided by the **last** server only. If the last server fails, the song is reported
  as an error, not as "no lyrics", and is tried again a minute later.
- **Privacy:** every server asked receives the track's title, artist, album and length. With the
  mirror first, songs it has never reach lrclib.net. Remove lrclib.net from the list to keep every
  lookup at home, at the cost of songs newer than your dump.

Up to 5 servers. Several companions, on several computers, can share one mirror.

### Updating to a newer dump

LRCLIB publishes a new dump from time to time; yours keeps working in the meantime. To switch:

1. Download and decompress the new dump as in steps 1–2, **to a new file name**. You need room for
   both databases during the switch.
2. In `docker-compose.yml`, change the date in `--database` and in `LRCLIB_SEARCH_INDEX_DIR`.
3. `docker compose up -d`. Exact lookups work at once; search comes back once its new index is
   built, ~5 minutes.
4. Check as in step 5, then delete the old database and its `.tantivy` index folder.

To go back: put the old file name back in step 2 and `docker compose up -d`. The old index is still
there, so search works at once.

If the server stops right after the switch and its log mentions the database version or a
migration, the new dump needs a newer server: `git pull` in the `lrclib` folder, rebuild the image
(step 3), start again.

### Security

- **Keep it on your LAN.** Publish the proxy on the LAN address only, and don't forward the port on
  your router. The mirror has no authentication.
- **Read-only:** the proxy only lets lookups through; writes get `403`. The database stays identical
  to the dump.
- **No secret** anywhere: the data is public, there's no password to keep.
- **Backups:** nothing to back up but the `.gz` if you keep it. You can always download the data
  again.

### Troubleshooting

| Symptom | Likely cause, fix |
|---|---|
| **Test** in Lyrics Sources: unreachable or timed out | Wrong address or port, the machine's firewall (open 3300 for the LAN in the NAS settings), or the companion in a Docker bridge network: use `network_mode: host`. |
| **Test** says it's not an LRCLIB server | The address answers, but it's another service, or the proxy without the server behind it: `docker compose ps`. |
| Exact lookups work, search errors | The search index is still being built: wait, watch `docker compose logs lrclib`. |
| The server stops at once, its log mentions a read-only database | The database folder is mounted read-only, or not writable by Docker. It must be read-write; the proxy keeps the mirror read-only. |
| The proxy stops at once, `operation not permitted` | `cap_add: NET_BIND_SERVICE` is missing next to `cap_drop: ALL`. |
| A song is found on lrclib.net but not on the mirror | It was added after your dump. With lrclib.net last in the list, the companion finds it anyway. |
| Slow lookups | Database on a hard disk, or little memory. Move the database to an SSD, or raise `LRCLIB_MMAP_SIZE` if you have RAM to spare. |
| The server gets killed (out of memory) | Lower `LRCLIB_MMAP_SIZE`, or raise `mem_limit`. |

More about the server and its settings in [its README](https://github.com/tranxuanthang/lrclib). The
companion is not affiliated with LRCLIB.
