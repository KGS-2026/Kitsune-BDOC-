# bdoc-wire

The LIVE WIRE collector. It reads about 130 sources, decides what each headline claims
and how far to believe it, and pushes the result to the owner's browser. Contract:
[`docs/LIVE-WIRE-SPEC.md`](../../docs/LIVE-WIRE-SPEC.md).

It runs on the droplet beside Hermes as a sandboxed systemd service. It only makes
outbound connections and opens no port. It has no npm dependencies and needs Node 22 or
newer at `/usr/bin/node`.

## Run it dry

`WIRE_DRY=1` collects, classifies and stores for real, but publishes and pages nothing.
Each published item is one line, and no credentials are needed.

```bash
cd tools/wire
WIRE_DRY=1 WIRE_DB=/tmp/wire-dry.db node wire.js
```

```
DRY item sev=1 st=reported n=1 cls=wire src=bbc-us tags=election | Trump says US voter fraud is 'rampant'
DRY upd c=7f3a... st=corroborated n=2 sev=1
DRY hb {"ts":...,"up":15,"ok":101,"total":136,"items1m":4,"official":{...}}
```

The first run prints little, because backlog from a source's first poll is stored but
not published. Delete the database to see a first run again. A line containing
`WOULD PAGE` is a page that would have gone out, but the page gate refuses everything
for the first five minutes of uptime.

To try it on the droplet without touching the service, copy to `/tmp` and keep the
database there. Never point a test run at `/opt/bdoc-wire` or the real database.

## Tests

```bash
node --test tests/wire-*.test.js
```

CI runs Node 20 with no `npm install`. The SQLite tests skip themselves there, so run
them on Node 22 or newer before a deploy that touches `store.js`.

## Deploy

**First time:** the owner runs `go-live.ps1` on the laptop. It adds the Netlify env vars,
writes the droplet env, installs the service from `origin/main` and redeploys the site.
Read its header first. It stops without changing anything if the env vars already exist.

**Updates:** install from git on the droplet, not from a Windows checkout, whose CRLF line
endings would break `deploy.sh`. This only fetches in the Hermes clone and never touches its
working tree:

```bash
cd /root/Kitsune-BDOC- && git fetch -q origin main && rm -rf /tmp/wire-src && mkdir /tmp/wire-src && git archive FETCH_HEAD 'BDOC Deploy/tools/wire' | tar -x -C /tmp/wire-src && bash '/tmp/wire-src/BDOC Deploy/tools/wire/deploy.sh'
```

`deploy.sh` can be run again at any time. It installs to `/opt/bdoc-wire`, installs the
unit and restarts the service. It never prints `/etc/bdoc-wire/env` and never overwrites
it.

On the first deploy it creates an empty env file and stops there. Fill it in, then
`systemctl restart bdoc-wire`:

| Name | What |
|---|---|
| `WIRE_TOPIC` | Secret Realtime topic. Must match Netlify. |
| `WIRE_INGEST_KEY` | Authorizes snapshot POSTs. Must match Netlify. |
| `SUPABASE_URL` | `https://<project>.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | Anon/publishable key. Never the service key. |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Page delivery. The daemon runs without them, and logs an error, but cannot reach the phone. |
| `WIRE_SITE` | Optional. Default `https://kgsbdoc.netlify.app`. |
| `WIRE_DB` | Optional. Default `/var/lib/bdoc-wire/wire.db`. |

Edit it with `nano`, not by pasting into a command, so a secret stays out of shell
history.

## Is it working?

```bash
systemctl status bdoc-wire
journalctl -u bdoc-wire -f --output=cat              # live
journalctl -u bdoc-wire --since "1 hour ago" --output=cat | grep '"msg":"status"' | tail -1
journalctl -u bdoc-wire --output=cat | grep -E '"msg":"(paged|page blocked|page delivery failed)"'
journalctl -u bdoc-wire -p err --since today
```

Logs are one JSON object per line. The `status` line, once a minute, is the summary:

| Field | Healthy | If not |
|---|---|---|
| `sourcesOk` / `sourcesTotal` | most of them | `journalctl ... | grep 'source failed'`, or the SOURCES panel on /wire |
| `bskyPerMin` | about 2900 | Bluesky stream down. It reconnects by itself after 30 s of silence. |
| `wikiPerMin` | in the thousands | Same, for Wikimedia. |
| `publish.lastErr`, `publish.failed` | null, 0 | Realtime problem. The feed falls back to the 60 s snapshot. |
| `publish.dropped` | 0 | Queue overflowed. Realtime has been down a while. |
| `pages.lastBlocked` | anything | Why the last critical story did not page. Read this first if a page was expected. |

`store.kind` in the snapshot's health must say `sqlite`. If it says `memory`, the
database would not open: the feed is live, but nothing survives a restart, and the log
has the reason.

## Query the database

There is no `sqlite3` on the droplet, and the daemon's state lives under a systemd
dynamic user, so use Node as root. Reads are safe while it runs.

```bash
cat > /tmp/q.js <<'EOF'
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('/var/lib/private/bdoc-wire/wire.db');
console.table(db.prepare(process.argv[2]).all());
EOF
node --disable-warning=ExperimentalWarning /tmp/q.js "SELECT datetime(t/1000,'unixepoch') AS utc, sev, st, n, src, substr(h,1,70) AS h FROM items WHERE sev >= 2 ORDER BY t DESC LIMIT 20"
```

Other useful queries:

```sql
-- Volume by class over the last hour
SELECT cls, COUNT(*) AS n FROM items WHERE t > (strftime('%s','now')-3600)*1000 GROUP BY cls;
-- Every page ever sent
SELECT datetime(t/1000,'unixepoch') AS utc, c FROM pages ORDER BY t DESC;
-- Everything in one story
SELECT src, st, substr(h,1,80) AS h FROM items WHERE c = '<id>' ORDER BY t;
-- Sources polled at least once
SELECT COUNT(*) FROM polled;
```

Tables: `items` (kept 30 days, full record as JSON in `j`), `seen` (14 days), `clusters`
(7 days), `polled`, `pages`, `kv` (Jetstream cursor, watch terms).

## Rotate the topic

Anyone holding `WIRE_TOPIC` can read the feed, so rotate it if it might have leaked. The
same steps rotate `WIRE_INGEST_KEY`.

1. Generate a value without echoing it into a shared terminal:
   `openssl rand -hex 24 > /root/new-topic && chmod 600 /root/new-topic`
2. Set it as `WIRE_TOPIC` in the Netlify site environment, then trigger a deploy.
   Environment changes only reach functions on a new deploy.
3. On the droplet:
   ```bash
   sed -i "s/^WIRE_TOPIC=.*/WIRE_TOPIC=$(cat /root/new-topic)/" /etc/bdoc-wire/env
   rm /root/new-topic
   systemctl restart bdoc-wire
   ```
4. Reload `/wire`. The page fetches the topic from the function, so an open tab picks it
   up on its next full load. Until the daemon restarts, the header shows `DEGRADED`, and
   that is expected.

Do steps 2 and 3 close together. Between them the two sides disagree and the live
channel is silent, though the 60 s snapshot keeps working unless you are rotating the
ingest key.

## Change what it believes

| To | Edit |
|---|---|
| Stop a false alarm | Add the phrase to `IDIOMS` in `lib/classify.js` and a line to `tests/wire-classify.test.js`. Idioms are removed before any rule runs, so one line fixes it everywhere. |
| Add or drop a source | `lib/sources.js` |
| Change what can page | `blockReason()` in `lib/alert.js` |
| Add a watch term | Use the WATCH panel on `/wire`. No deploy or restart needed. |

## Stop it

```bash
systemctl stop bdoc-wire      # flushes, posts a last snapshot, exits within 8 s
systemctl disable bdoc-wire   # and keep it off across reboots
```

The site then shows `COLLECTOR OFFLINE`, which is the truth.
