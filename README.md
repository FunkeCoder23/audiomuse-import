# audiomuse-import

Copy the music analysis you already did in [AudioMuse-AI](https://github.com/NeptuneHub/AudioMuse-AI)
into a [SUB/WAVE](https://github.com/perminder-klair/subwave) station, so the AI DJ
knows your library without tagging it all over again.

SUB/WAVE's DJ chooses music by mood, energy, tempo and key. On a fresh station it has
to work those out for every track, which on a big library takes hours. If AudioMuse
has already analysed the same music, this tool reads its results and writes them
straight into SUB/WAVE's library database. It takes a couple of minutes.

- **Fills in moods, BPM, musical key, energy and genre** for every track AudioMuse knows.
- **Leaves your existing SUB/WAVE tags alone** unless you ask it to overwrite them.
- **Has a dry-run mode** that shows how many tracks match before anything is written.
- **Works on a brand-new station** with an empty library, as well as an established one.

## Before you start

You need:

1. **A SUB/WAVE station that has started at least once.** The first boot creates
   `library.db`, the database this tool writes into.
2. **An AudioMuse-AI instance that has analysed your library**, reachable over HTTP
   from wherever you run the tool (for example `http://192.168.1.20:8000`).
3. **Both pointed at the same Navidrome server.** The tool matches tracks by
   Navidrome's song id, so the match is exact, with no guessing by filename. If
   AudioMuse is connected to Jellyfin, Plex, Emby or LMS instead, the ids won't line
   up and the tool will refuse to run.
4. **Docker** (the easy way) **or Node.js 20 or newer** on the machine that holds
   your SUB/WAVE `state/` folder.

### Find your SUB/WAVE `state/` folder

Everything below needs the path to your station's `state/` folder, which holds
`library.db`:

| How you installed SUB/WAVE | Where `state/` usually is |
| --- | --- |
| `subwave` CLI | `~/subwave/state` |
| `docker compose` from a clone | `state/`, next to `docker-compose.yml` |
| Custom `STATE_DIR` in `.env` | whatever `STATE_DIR` is set to |
| Unraid / all-in-one container | the host folder you mapped to `/var/sub-wave` |

Check you have the right one: it should contain a file called `library.db`.

## Run it with Docker (recommended)

This needs nothing installed except Docker, and it avoids file-permission problems,
because SUB/WAVE's containers create `library.db` as root.

**1. Preview.** Replace the two placeholders, then run:

```bash
docker run --rm --network host \
  -v /path/to/subwave/state:/state \
  node:22 \
  npx -y github:getsubwave/audiomuse-import \
    --audiomuse-url http://localhost:8000 \
    --library-db /state/library.db \
    --dry-run
```

- `/path/to/subwave/state` is your `state/` folder from above.
- `http://localhost:8000` is your AudioMuse address. `--network host` lets the
  container reach services on the host as `localhost` (Linux). On macOS or Windows,
  or if AudioMuse runs on another machine, use its LAN address instead, for
  example `http://192.168.1.20:8000`.

You'll see a few sample mappings, then how many tracks **would update** (already
in your SUB/WAVE library) and how many **would be added** as new. On a station
that has been running a while, nearly everything should be "would update". If
it's mostly "would be added", stop and read
[the last troubleshooting entry](#mostly-would-be-added). Nothing is written.

**2. Import.** Run the same command without `--dry-run`.

**3. Finish in SUB/WAVE.** See [After the import](#after-the-import).

## Run it with Node.js

If you'd rather not use Docker, any machine with Node.js 20+ that can see your
`state/` folder will do.

```bash
git clone https://github.com/getsubwave/audiomuse-import.git
cd audiomuse-import
npm install

# preview
node import.mjs --audiomuse-url http://localhost:8000 \
  --library-db /path/to/subwave/state/library.db --dry-run

# import
node import.mjs --audiomuse-url http://localhost:8000 \
  --library-db /path/to/subwave/state/library.db
```

Or skip the clone and run it straight from GitHub:

```bash
npx github:getsubwave/audiomuse-import \
  --audiomuse-url http://localhost:8000 \
  --library-db /path/to/subwave/state/library.db --dry-run
```

If you get `attempt to write a readonly database`, `library.db` belongs to root
(SUB/WAVE's containers created it). Use the Docker method above instead.

## After the import

Open SUB/WAVE's admin console and go to **Library**:

- **Tagging coverage** should have jumped. Any tracks AudioMuse hadn't analysed are
  still untagged; SUB/WAVE's own tagger picks those up as usual.
- **Run an acoustic analysis pass** (the *Acoustic analysis* strip on the same page).
  AudioMuse doesn't measure where a song's intro and ending fall, how loud it is, or
  what it "sounds like" in SUB/WAVE's terms, and those drive smooth transitions and
  sonic search. The import deliberately leaves those tracks marked as not yet
  analysed, so the pass covers them.

It's fine to import while the station is on air. SUB/WAVE shares the database
safely, but it's tidier not to run the import during a big tagging or analysis
pass.

## What comes across

| From AudioMuse | Into SUB/WAVE | How |
| --- | --- | --- |
| `tempo` | BPM | copied as is |
| `key` + `scale` | musical key | converted to [Camelot notation](https://mixedinkey.com/camelot-wheel/) (A minor → `8A`) |
| `energy` | energy | bucketed into `low` / `medium` / `high` |
| mood and style tags | moods | translated into SUB/WAVE's mood vocabulary (`calm`, `energetic`, `reflective`, `celebratory`, `romantic`, `focus`). The full table is `AUDIOMUSE_MOOD_MAP` in [`map.mjs`](map.mjs) |
| the strongest genre tag | genre | only fills a track with no genre yet |

### What doesn't come across

- **Audio embeddings.** AudioMuse's CLAP/MusiCNN vectors come from a different model
  than SUB/WAVE's, so they can't power SUB/WAVE's "sounds like" search.
- **Intro/ending timing, song structure, loudness, beat grid, vocal sections.**
  AudioMuse doesn't measure these. SUB/WAVE's acoustic analysis does.

So the import replaces SUB/WAVE's slow **tagging** step, not its **acoustic
analysis**. That's why the last step above matters.

## How it decides what to write

- **Default: fill the gaps.** A track that already has BPM, key or moods in SUB/WAVE
  keeps them. Only empty fields are filled.
- **`--overwrite`:** AudioMuse's values replace SUB/WAVE's for BPM, key, moods and
  energy. Genre is still only filled where empty.
- **Tracks SUB/WAVE hasn't seen yet are added**, using AudioMuse's title, artist and
  album. That's what makes it useful on a brand-new station.
- **Imported moods count as hand-set tags.** SUB/WAVE treats them the way it treats
  tags you set yourself: its tagger won't redo them, and that includes *Re-decide
  moods*.
- **Tracks with nothing usable** (no tempo, key or mood) are skipped and counted as
  "no usable signal".

## Options

```
node import.mjs [options]
```

| Option | Default | What it does |
| --- | --- | --- |
| `--audiomuse-url <url>` | `$AUDIOMUSE_URL` | Your AudioMuse address. Required. |
| `--library-db <path>` | `$STATE_DIR/library.db`, else `./state/library.db` | The SUB/WAVE database to write into. |
| `--dry-run` | off | Show what would happen; write nothing. |
| `--overwrite` | off | Replace existing BPM, key, moods and energy instead of only filling gaps. |
| `--mood-cutoff <0..1>` | `0.4` | How confident an AudioMuse tag must be to count as a mood or genre. Raise it for fewer, surer moods. |
| `--limit <n>` | none | Stop after `n` AudioMuse tracks. Handy for a quick test. |
| `-h`, `--help` | | Show help. |

You can set `AUDIOMUSE_URL` and `STATE_DIR` as environment variables instead of
passing the first two options.

## Troubleshooting

**`library.db not found`.** The path is wrong, or SUB/WAVE hasn't started yet.
Check the folder contains `library.db`, then pass it with `--library-db`.

**`library.db schema is vN, need >= v16`.** Your SUB/WAVE is older than this tool
expects. Update SUB/WAVE, start it once so it upgrades its database, then run the
import again.

**`AudioMuse is configured for 'jellyfin', not navidrome`** (or plex, emby, lms).
Track ids from those servers can't be matched to SUB/WAVE's. AudioMuse has to
analyse the same Navidrome that SUB/WAVE plays from.

**`...returned 200 but the body was not JSON`** or **`no "tracks" array`.** The URL
isn't reaching AudioMuse's API. Usually it's a typo, the wrong port, or a login page
in front of it. Opening `<your-url>/api/sync?page=1&limit=1` in a browser should
return JSON.

**`fetch failed` / `ECONNREFUSED`.** The tool can't reach AudioMuse at all. From
inside Docker, `localhost` only means the host when you use `--network host`
(Linux). Otherwise use the machine's LAN IP.

**`attempt to write a readonly database`.** `library.db` is owned by root. Use the
Docker method, or run Node as a user that can write to the `state/` folder.

<a id="mostly-would-be-added"></a>
**The dry run says most tracks "would be added", but the station already has its
library.** AudioMuse's track ids don't match your Navidrome's current ones, so
importing would add duplicate rows instead of tagging the tracks you have. The
usual cause: Navidrome 0.64 changed most of its track ids, and AudioMuse analysed
your library before that upgrade and hasn't rescanned since. Bring AudioMuse up to
date with your Navidrome, check the dry run again, then import. (If you already
imported, SUB/WAVE's library sync removes rows that aren't on your music server;
a large removal waits for you to confirm it.)

## How it works

AudioMuse exposes its whole library over `GET /api/sync`, keyed by the media
server's song id. SUB/WAVE keys its `tracks` table by the same Navidrome (Subsonic)
song id. So when both point at one Navidrome, AudioMuse's id *is* SUB/WAVE's id and
the join is exact, with no Navidrome login needed.

The tool pages through `/api/sync` 500 tracks at a time, translates each track
([`map.mjs`](map.mjs), pure functions), and writes them in batched SQLite
transactions ([`import.mjs`](import.mjs)). It never changes SUB/WAVE's database
schema. It refuses to run against a database older than it understands, and only
writes columns SUB/WAVE already has. Its one dependency is
[`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3).

## Development

```bash
npm install
npm test
```

`map.test.mjs` pins the pure mappings (tag parsing, Camelot conversion, energy
buckets, the mood map). `import.test.mjs` runs the whole CLI against a fake
AudioMuse server and a throwaway database shaped like SUB/WAVE's.

This tool used to live in the SUB/WAVE repository under `tools/audiomuse-import`.
Its history came with it.

Issues and pull requests are welcome. If SUB/WAVE changes how it stores tags,
`TAGGER_VERSION` and `MIN_USER_VERSION` at the top of `import.mjs` have to follow.

## License

MIT. See [LICENSE](LICENSE).
