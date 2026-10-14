# BDOC Grid-Down Operations

How BDOC keeps working when the internet, the cell network, or the power grid is gone.

## The four link tiers

BDOC never asks "am I online?" — `navigator.onLine` lies (a laptop on wifi with
a dead uplink still reports online). It probes real endpoints and picks the best
available tier:

| Tier | Source | Needs | Shown as |
|---|---|---|---|
| `cloud` | Netlify functions → Supabase | internet | **ONLINE** (green) |
| `local` | BDOC IPC receiver `127.0.0.1:9876` | nothing but the laptop | **LOCAL** (amber) |
| `mesh` | Meshtastic radio via the local receiver | a radio, no IP at all | **MESH** (lime, pulsing) |
| `cache` | IndexedDB last known state | nothing | **CACHED** (red, pulsing) |

Failover and recovery are automatic. When a link returns, anything captured
while dark is replayed from the outbox.

The badge at the top of the screen always states which tier is live and how old
the data is. **A stale picture that looks live is the dangerous failure mode** —
that badge exists specifically to prevent it.

## Grid-down startup (no internet at all)

Two processes on the operator's machine. Nothing leaves the room.

```bash
# 1. the receiver — BDOC catches data here
node tools/bdoc-ipc-receiver.js

# 2. the radio gateway — talks to the Meshtastic node over USB
python3 tools/grid_down_gateway.py --serial /dev/ttyUSB0
#    Windows:  python3 tools/grid_down_gateway.py --serial COM3
#    LAN node: python3 tools/grid_down_gateway.py --tcp 192.168.1.50
#    no radio: python3 tools/grid_down_gateway.py --test
```

Then open BDOC. The badge should read **MESH** once the gateway forwards a node.

Requires: `pip install meshtastic pypubsub`

## Community incident reports over radio

Any stock Meshtastic client can put an incident on the map. No custom firmware.
Send a text message in this form:

```
INC <lat> <lon> <description>
INC 33.7490 -84.3880 semi blocking I-75 NB mile 42
```

The gateway parses it into a map marker. Malformed messages are ignored, not
crashed on.

## Satellite imagery over radio

### The constraint, stated honestly

Meshtastic LoRa gives roughly **1–5 kbps** of usable throughput on a **shared**
medium. Every byte you transmit is airtime nobody else in the mesh can use.
A 1 MB photo is not merely slow — it is antisocial, occupying the channel for
tens of minutes that other people need for text.

So imagery over mesh is only honest if it is **tiny**. Measured, not estimated:

```
input    : 512×512 PNG, 170,526 bytes
output   : 128×128, 16 grey levels, RLE → 3,942 bytes
ratio    : 43× smaller
packets  : 31 (1 header + 30 data)
airtime  : ~37 seconds at 1.2 s/packet
fidelity : 2.9% mean absolute error; road, structures, and buildings all legible
```

That is a usable recon thumbnail in about half a minute. Full-colour imagery is
deliberately **not** attempted — move those over wifi/LTE and use the mesh only
to announce that they exist.

### Usage

```bash
# encode and see the real airtime cost before you transmit
python3 tools/satimg_mesh.py encode recon.png --out chunks.json

# rebuild on the receiving side
python3 tools/satimg_mesh.py decode chunks.json --out recovered.png

# live: reassemble chunks arriving from the gateway
python3 tools/satimg_mesh.py listen
```

Wire format:

```
SATIMG|<id>|H|<w>|<h>|<levels>|<nchunks>|<crc32>     header
SATIMG|<id>|D|<seq>|<base64>                          data
```

Verified behaviours: out-of-order arrival reassembles correctly; missing chunks
are reported by index (`missing()`) so only the gaps need retransmission;
corrupted payloads are caught by CRC32 and discarded rather than rendered;
malformed packets never kill the listener.

## Skybridge — satellite data over the mesh (p156)

`tools/skybridge.py` supersedes `satimg_mesh.py` for satellite products. The
differences: geo-referenced (it lands on the map, not as a loose PNG), binary on
Meshtastic's private port 256 instead of base64 text (no 33 % bloat), one XOR
parity chunk per message (any single lost packet is rebuilt on arrival), no
"header must be heard" failure mode, and three product types:

| Product | What goes over the air | Typical size | Packets (incl. parity) |
|---|---|---|---|
| RASTER | 128-cell grid, 2 bits/cell (clear / thin / thick / coldest tops), deflate | 350–800 B | 3–5 |
| POLYGONS | warning areas at 0.01°, event type, expiry | ~85 B for 3 warnings | 2 |
| TEXT | bulletin, UTF-8, deflate | 80–170 B | 2 |

Airtime per hop for a 207-byte chunk: LongFast 2.2 s, MediumFast 0.64 s,
ShortFast 0.20 s. A real GOES-19 band-13 Southeast sector (Oct 14, 13:01Z)
encoded to 353 B = 3 packets = 2.3 s on MediumFast.

Chain:

```
dish + LNA + SDR  ->  SatDump / goestools  ->  skybridge.py raster|warnings|text
   ->  skybridge.py send --radio serial:COM5 --channel 1 --preset MEDIUM_FAST
   ~~ LoRa mesh (relays re-broadcast) ~~
   ->  customer radio on USB  ->  grid_down_gateway.py  ->  bdoc-ipc-receiver.js
   ->  BDOC layer "Skybridge Sat-over-Mesh" (js/modules/skybridge.js)
```

```bash
# ground station
python tools/skybridge.py raster ir.png --bbox 24,-92,37,-75 --size 128 --out ir.bin
python tools/skybridge.py warnings alerts.geojson --out warn.bin
python tools/skybridge.py text "GRID ALERT ..." --priority 3 --out msg.bin
python tools/skybridge.py send ir.bin warn.bin msg.bin --radio serial:COM5 --channel 1 --preset MEDIUM_FAST \
       --plain-text "GRID ALERT ..."      # stock phone apps can't read port 256; give them the text too
# customer laptop
node tools/bdoc-ipc-receiver.js
python tools/grid_down_gateway.py --serial COM5
# no hardware: full simulated broadcast into the local receiver
python tools/skybridge.py demo --loop 0
```

Rules: put Skybridge on its own channel (index 1+), never the public LongFast
channel; run on 902–928 MHz unlicensed (Part 15), not ham mode (Part 97 bars
commercial traffic and encryption). Receive-only reception of unencrypted
weather broadcasts needs no license in the US; do not decrypt encrypted streams.

What a Georgia station can hear: GOES-19 East / GOES-18 West (HRIT/EMWIN,
~1.2 m dish), Meteor-M N2-3/N2-4 (Russian polar, 137 MHz, V-dipole), FY-3 and
MetOp (polar, L-band tracking dish). Russian, Chinese, Korean and Japanese
GEOSTATIONARY satellites are below the horizon from the US — those need a
station abroad. NOAA-15/18/19 APT is decommissioned.

## On-device storage

`js/bdoc-offline-store.js` (IndexedDB):

- **entities** — last known state per feature, source-tagged and age-stamped
- **tiles** — operator-pinned AOI imagery for offline map rendering
- **outbox** — records captured offline, replayed on reconnect
- **meta** — sync bookkeeping

Behaviours that matter in the field:

- Bounded (20k entities / 4k tiles / 5k queued) with oldest-first eviction, so a
  tactical device cannot fill its disk with stale telemetry.
- Requests `navigator.storage.persist()` so the browser will not evict the
  cache under storage pressure.
- A 4xx on replay **drops** the record (permanently bad payload); a 5xx
  **keeps** it for retry. Verified in tests.
- Every failure path degrades. A storage error must never blank the map.

## Service worker fixes made for grid-down

Two real bugs that would have broken offline mode:

1. **Cache keys include the `?v=` query string.** The precache list carried
   stale tags (`auth.js?v=p70`) while the live page requested `?v=p136`, so a
   cached file never matched a real request. Same-origin lookups now fall back
   to `ignoreSearch: true`.
2. **`cache.addAll()` is atomic.** One 404 in the precache list rejected the
   entire batch and left an *empty* offline cache. Entries are now cached
   individually with `Promise.allSettled`, so one bad URL cannot wipe out
   grid-down capability.

## Hardware

Minimum viable field kit:

- Meshtastic node (RAK4631, Heltec V3, or T-Beam) — the radio
- USB cable to the laptop, or LAN if the node has wifi
- Battery/solar for the node if grid power is the thing that failed

The laptop runs the receiver, the gateway, and the browser. No server, no cloud,
no cell service required.

## Verification status

Tested by execution, not assumption:

- Link manager: all 6 failover scenarios (cloud → local → mesh → cache → recovery),
  including no-IndexedDB degradation
- Offline store: persistence, read-back, eviction, outbox replay, 4xx-vs-5xx
  semantics, source isolation — against a real IndexedDB
- Gateway: nodeinfo/position merge, junk-coordinate rejection, malformed-text
  survival, incident parsing
- Imagery: round-trip, out-of-order, missing-chunk reporting, CRC corruption
  detection, malformed-packet survival, visual fidelity confirmed

Not yet tested against physical radio hardware — that needs a Meshtastic node on
the bench.
