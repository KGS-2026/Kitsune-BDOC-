#!/usr/bin/env python3
"""BDOC Skybridge -- satellite data -> binary -> mesh radio -> pixels on the laptop.

A ground station (dish + SDR + SatDump/goestools, solar-powered) receives weather
satellite data. Skybridge turns each product into a compact BINARY message, cuts it
into Meshtastic-sized chunks, adds one XOR parity chunk so any single lost packet is
rebuilt on arrival, and transmits it on Meshtastic's private-app port (256). On the
customer side, tools/grid_down_gateway.py hands every mesh packet to the local BDOC
receiver, and js/modules/skybridge.js rebuilds the bits into pixels, polygons and
text on the map. No internet anywhere in the chain.

PRODUCTS (one message each)
  1  RASTER   geo-referenced grid, 1 or 2 bits per cell (cloud tops / storms),
              row-major north->south, west->east, MSB-first, deflate-compressed
  2  POLYGONS warning areas (tornado, severe t-storm, flash flood ...), 0.01 deg
  3  TEXT     bulletins / global alerts, UTF-8, deflate when it helps

WIRE FORMAT  "BDSB/1"
  chunk  = magic 0xB1 | msg_id u16 | seq u8 (0xFF = parity) | n_data u8 |
           flags u8 (bit0 parity present) | msg_len u16 | payload (<= 199 B)
           -> 8 B header + payload = at most 207 B, under Meshtastic's ~233 B limit
  message= type u8 | product u8 | unix_time u32 | body ... | crc32 u32
  RASTER body  : south,west,north,east i16 (x100 deg) | w u16 | h u16 | bits u8 |
                 codec u8 (0 raw, 1 deflate-raw) | data
  POLYGON body : count u8 | per polygon: event u8 | expires u32 | npts u8 |
                 npts x (lat i16, lon i16) at 0.01 deg
  TEXT body    : codec u8 | utf-8 bytes (deflate-raw when codec = 1)

USAGE
  # real satellite product (equirectangular PNG from SatDump, bbox of the image):
  python3 tools/skybridge.py raster goes_ir.png --bbox 24,-92,37,-75 --size 128 --out ir.bin
  python3 tools/skybridge.py warnings nws_alerts.geojson --out warn.bin
  python3 tools/skybridge.py text "GRID ALERT: ..." --out bulletin.bin
  # transmit on a Meshtastic radio (dedicated channel index 1, MediumFast pacing):
  python3 tools/skybridge.py send ir.bin warn.bin --radio serial:COM5 --channel 1 --preset MEDIUM_FAST
  # no radio: simulate a gateway + relay chain into the local BDOC receiver
  python3 tools/skybridge.py send ir.bin --sim --loss 0.08
  # full demo: synthetic storm field + sample warnings + a bulletin, simulated over the mesh
  python3 tools/skybridge.py demo
  # verify on this machine: rebuild a captured chunk log into PNG + JSON
  python3 tools/skybridge.py decode chunks.jsonl --out-dir decoded/

Only Python 3.8+ stdlib is required; Pillow is used when reading/writing PNG files,
and the `meshtastic` package only for --radio.
"""

import argparse
import base64
import json
import math
import os
import random
import struct
import sys
import time
import zlib

MAGIC = 0xB1
PORTNUM = 256                    # Meshtastic PRIVATE_APP (256-511 = private range)
HDR = struct.Struct(">BHBBBH")   # magic, msg_id, seq, n_data, flags, msg_len  (8 bytes)
CHUNK = 199                      # payload bytes per chunk
PARITY_SEQ = 0xFF
T_RASTER, T_POLY, T_TEXT = 1, 2, 3
PRODUCTS = {"ir": 1, "vis": 2, "storm": 3, "lightning": 4, "other": 9}
PRODUCT_NAMES = {v: k for k, v in PRODUCTS.items()}

# warning types -- index is what goes over the air
EVENTS = ["Other", "Tornado Warning", "Severe Thunderstorm Warning", "Flash Flood Warning",
          "Flood Warning", "Extreme Wind Warning", "Snow Squall Warning", "Special Marine Warning",
          "Hurricane Warning", "Tropical Storm Warning", "Storm Surge Warning", "Winter Storm Warning",
          "Blizzard Warning", "Red Flag Warning", "Tornado Watch", "Severe Thunderstorm Watch",
          "Hurricane Watch", "Tsunami Warning", "Civil Emergency Message", "Shelter In Place Warning",
          "Evacuation Immediate", "Fire Warning"]

# LoRa time-on-air for a full 207-byte chunk (+ ~16 B Meshtastic header), per preset (s)
PRESETS = {"LONG_FAST": (11, 250), "MEDIUM_FAST": (9, 250), "SHORT_FAST": (7, 250), "SHORT_TURBO": (7, 500),
           "LONG_SLOW": (12, 125), "MEDIUM_SLOW": (10, 250), "SHORT_SLOW": (8, 250), "LONG_MODERATE": (11, 125)}


def lora_airtime(payload_bytes, sf, bw_khz, cr=1, preamble=16):
    ts = (2 ** sf) / (bw_khz * 1000.0)
    de = 1 if ts > 0.016 else 0
    n = 8 + max(math.ceil((8 * payload_bytes - 4 * sf + 28 + 16) / (4 * (sf - 2 * de))) * (cr + 4), 0)
    return (preamble + 4.25) * ts + n * ts


def deflate(b):
    c = zlib.compressobj(9, zlib.DEFLATED, -15)
    return c.compress(b) + c.flush()


def inflate(b):
    return zlib.decompress(b, -15)


# ------------------------------------------------------------------ messages
def _deg(v):
    return max(-32768, min(32767, int(round(v * 100))))


def _quantiles(values, qs):
    s = sorted(values)
    return [s[min(len(s) - 1, int(q * (len(s) - 1)))] for q in qs]


def grid_from_image(img, size=128):
    """PIL image (any mode) -> (w, h, rows of 0..255). Keeps the image's aspect ratio."""
    g = img.convert("L")
    W, H = g.size
    if W >= H:
        w, h = size, max(1, round(size * H / W))
    else:
        w, h = max(1, round(size * W / H)), size
    g = g.resize((w, h))
    px = list(g.getdata()) if not hasattr(g, "get_flattened_data") else list(g.get_flattened_data())
    return w, h, [px[r * w:(r + 1) * w] for r in range(h)]


def quantize(rows, bits, thresholds=None, invert=False):
    """0..255 rows -> level rows. Default thresholds put the top 45/25/10 % of the scene
    (brightest = coldest cloud tops in an enhanced IR image) into levels 1/2/3."""
    flat = [p for r in rows for p in r]
    if invert:
        rows = [[255 - p for p in r] for r in rows]
        flat = [255 - p for p in flat]
    levels = (1 << bits) - 1
    if thresholds is None:
        qs = [0.55, 0.75, 0.90] if bits == 2 else [0.70]
        thresholds = _quantiles(flat, qs)
    out = []
    for r in rows:
        row = []
        for p in r:
            lv = 0
            for t in thresholds:
                if p > t:
                    lv += 1
            row.append(min(levels, lv))
        out.append(row)
    return out, thresholds


def despeckle(lrows, min_neighbours=3):
    """Drop isolated non-zero cells (drawn borders, coastlines, sensor noise) so the
    radio doesn't spend airtime on them and the map doesn't show salt-and-pepper."""
    h, w = len(lrows), len(lrows[0])
    out = [r[:] for r in lrows]
    for y in range(h):
        for x in range(w):
            if not lrows[y][x]:
                continue
            n = 0
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    if (dy or dx) and 0 <= y + dy < h and 0 <= x + dx < w and lrows[y + dy][x + dx]:
                        n += 1
            if n < min_neighbours:
                out[y][x] = 0
    return out


def pack_levels(lrows, bits):
    per = 8 // bits
    out = bytearray()
    cur, n = 0, 0
    for r in lrows:
        for v in r:
            cur = (cur << bits) | (v & ((1 << bits) - 1))
            n += 1
            if n == per:
                out.append(cur)
                cur, n = 0, 0
    if n:
        out.append(cur << (bits * (per - n)))
    return bytes(out)


def unpack_levels(data, w, h, bits):
    per, mask = 8 // bits, (1 << bits) - 1
    vals = []
    for byte in data:
        for k in range(per):
            vals.append((byte >> (8 - bits * (k + 1))) & mask)
    vals = vals[:w * h]
    return [vals[r * w:(r + 1) * w] for r in range(h)]


def _wrap(mtype, product, t, body):
    head = struct.pack(">BBI", mtype, product, int(t))
    msg = head + body
    return msg + struct.pack(">I", zlib.crc32(msg) & 0xFFFFFFFF)


def build_raster(lrows, bbox, bits, product="ir", t=None):
    s, w_, n, e = bbox
    h, w = len(lrows), len(lrows[0])
    raw = pack_levels(lrows, bits)
    comp = deflate(raw)
    codec, data = (1, comp) if len(comp) < len(raw) else (0, raw)
    body = struct.pack(">hhhhHHBB", _deg(s), _deg(w_), _deg(n), _deg(e), w, h, bits, codec) + data
    return _wrap(T_RASTER, PRODUCTS.get(product, 9), t or time.time(), body)


def _simplify(pts, max_pts=40):
    if len(pts) <= max_pts:
        return pts
    step = len(pts) / float(max_pts)
    return [pts[int(i * step)] for i in range(max_pts)]


def build_polygons(polys, t=None):
    """polys: [{event: name or index, expires: unix, coords: [[lon, lat], ...]}]"""
    body = bytearray([min(255, len(polys))])
    for p in polys[:255]:
        ev = p.get("event", 0)
        idx = ev if isinstance(ev, int) else (EVENTS.index(ev) if ev in EVENTS else 0)
        coords = _simplify([c for c in p["coords"]], 40)
        if len(coords) > 1 and coords[0] == coords[-1]:
            coords = coords[:-1]
        body += struct.pack(">BIB", idx, int(p.get("expires", 0)), len(coords))
        for lon, lat in coords:
            body += struct.pack(">hh", _deg(lat), _deg(lon))
    return _wrap(T_POLY, 0, t or time.time(), bytes(body))


def build_text(text, priority=1, t=None):
    raw = text.encode("utf-8")
    comp = deflate(raw)
    codec, data = (1, comp) if len(comp) < len(raw) else (0, raw)
    return _wrap(T_TEXT, max(0, min(3, priority)), t or time.time(), bytes([codec]) + data)


def parse_message(msg):
    if len(msg) < 10:
        raise ValueError("message too short")
    body, crc = msg[:-4], struct.unpack(">I", msg[-4:])[0]
    if zlib.crc32(body) & 0xFFFFFFFF != crc:
        raise ValueError("CRC mismatch")
    mtype, product, t = struct.unpack(">BBI", body[:6])
    b = body[6:]
    if mtype == T_RASTER:
        s, w_, n, e, w, h, bits, codec = struct.unpack(">hhhhHHBB", b[:14])
        data = b[14:]
        data = inflate(data) if codec == 1 else data
        return {"type": "raster", "product": PRODUCT_NAMES.get(product, "other"), "time": t,
                "bbox": [s / 100, w_ / 100, n / 100, e / 100], "w": w, "h": h, "bits": bits,
                "rows": unpack_levels(data, w, h, bits)}
    if mtype == T_POLY:
        cnt, off, polys = b[0], 1, []
        for _ in range(cnt):
            ev, exp, npts = struct.unpack(">BIB", b[off:off + 6]); off += 6
            pts = []
            for _k in range(npts):
                la, lo = struct.unpack(">hh", b[off:off + 4]); off += 4
                pts.append([lo / 100, la / 100])
            polys.append({"event": EVENTS[ev] if ev < len(EVENTS) else "Other", "expires": exp, "coords": pts})
        return {"type": "polygons", "time": t, "polygons": polys}
    if mtype == T_TEXT:
        codec, data = b[0], b[1:]
        data = inflate(data) if codec == 1 else data
        return {"type": "text", "priority": product, "time": t, "text": data.decode("utf-8", "replace")}
    raise ValueError(f"unknown message type {mtype}")


# ------------------------------------------------------------------ framing + FEC
def frame(msg, msg_id, parity=True):
    if len(msg) > 254 * CHUNK:
        raise ValueError(f"message is {len(msg)} B; max {254 * CHUNK} B per message -- reduce --size")
    parts = [msg[i:i + CHUNK] for i in range(0, len(msg), CHUNK)] or [b""]
    n = len(parts)
    flags = 1 if parity else 0
    out = [HDR.pack(MAGIC, msg_id & 0xFFFF, i, n, flags, len(msg)) + p for i, p in enumerate(parts)]
    if parity:
        plen = len(parts[0])
        par = bytearray(plen)
        for p in parts:
            for k, byte in enumerate(p):
                par[k] ^= byte
        out.append(HDR.pack(MAGIC, msg_id & 0xFFFF, PARITY_SEQ, n, flags, len(msg)) + bytes(par))
    return out


class Reassembler:
    """Feed chunks in any order, with duplicates and gaps. Returns the parsed message
    (plus stats) as soon as it is complete -- rebuilding one missing chunk from parity."""

    def __init__(self, ttl=3600):
        self.msgs, self.done, self.ttl = {}, {}, ttl

    def feed(self, chunk):
        if len(chunk) < HDR.size or chunk[0] != MAGIC:
            return None
        _, mid, seq, n, flags, mlen = HDR.unpack(chunk[:HDR.size])
        if mid in self.done and time.time() - self.done[mid] < self.ttl:
            return None
        st = self.msgs.setdefault(mid, {"n": n, "len": mlen, "data": {}, "parity": None, "t": time.time()})
        if st["n"] != n or st["len"] != mlen:          # msg id reused: start over
            st = self.msgs[mid] = {"n": n, "len": mlen, "data": {}, "parity": None, "t": time.time()}
        payload = chunk[HDR.size:]
        if seq == PARITY_SEQ:
            st["parity"] = payload
        elif seq < n:
            st["data"][seq] = payload
        return self._try(mid)

    def progress(self, mid):
        st = self.msgs.get(mid)
        return None if not st else (len(st["data"]), st["n"], st["parity"] is not None)

    def _try(self, mid):
        st = self.msgs[mid]
        n, have = st["n"], st["data"]
        recovered = None
        if len(have) < n:
            missing = [i for i in range(n) if i not in have]
            if len(missing) != 1 or st["parity"] is None:
                return None
            m = missing[0]
            full = len(st["parity"])
            size = full if m < n - 1 else st["len"] - (n - 1) * full
            rec = bytearray(st["parity"])
            for i, p in have.items():
                for k, byte in enumerate(p):
                    rec[k] ^= byte
            have[m] = bytes(rec[:size])
            recovered = m
        msg = b"".join(have[i] for i in range(n))[:st["len"]]
        try:
            parsed = parse_message(msg)
        except Exception as e:
            del self.msgs[mid]
            return {"msg_id": mid, "error": str(e)}
        del self.msgs[mid]
        self.done[mid] = time.time()
        parsed.update({"msg_id": mid, "bytes": len(msg), "chunks": n, "recovered_chunk": recovered})
        return parsed


# ------------------------------------------------------------------ inputs
def nws_geojson_to_polys(fc):
    """api.weather.gov /alerts/active GeoJSON (or an EMWIN-derived equivalent) -> polygons."""
    out = []
    for f in fc.get("features", []):
        g, p = f.get("geometry") or {}, f.get("properties") or {}
        if not g or g.get("type") not in ("Polygon", "MultiPolygon"):
            continue      # zone-only alerts have no polygon; they go out as TEXT
        rings = [g["coordinates"][0]] if g["type"] == "Polygon" else [poly[0] for poly in g["coordinates"]]
        exp = p.get("expires") or p.get("ends")
        try:
            from datetime import datetime
            exp_t = int(datetime.fromisoformat(exp.replace("Z", "+00:00")).timestamp()) if exp else 0
        except Exception:
            exp_t = 0
        for r in rings:
            out.append({"event": p.get("event", "Other"), "expires": exp_t, "coords": r})
    return out


def synthetic_storm_field(bbox, w=256, h=192, seed=7):
    """Stand-in for a SatDump IR product when no dish is attached: smooth cloud field
    with a squall line and two cold-topped cells. Brighter = colder cloud tops."""
    rnd = random.Random(seed)
    s, wl, n, e = bbox
    cells = [(rnd.uniform(0, 1), rnd.uniform(0, 1), rnd.uniform(0.04, 0.12), rnd.uniform(0.3, 0.8)) for _ in range(18)]
    cells += [(0.42, 0.55, 0.05, 1.0), (0.62, 0.38, 0.04, 0.95)]          # two strong cells
    rows = []
    for j in range(h):
        y = j / (h - 1)
        row = []
        for i in range(w):
            x = i / (w - 1)
            v = 0.0
            for cx, cy, r, a in cells:
                d2 = (x - cx) ** 2 + (y - cy) ** 2
                v += a * math.exp(-d2 / (2 * r * r))
            line = 0.55 * math.exp(-((y - (0.25 + 0.9 * x)) ** 2) / (2 * 0.035 ** 2))   # squall line SW->NE
            v += line + 0.08 * math.sin(17 * x + 5 * y) + rnd.uniform(-0.03, 0.03)
            row.append(max(0, min(255, int(v * 170))))
        rows.append(row)
    return w, h, rows


SAMPLE_POLYS = [   # demo only -- shapes in the style of NWS storm-based warnings near Atlanta
    {"event": "Tornado Warning", "minutes": 45, "coords": [[-84.62, 33.62], [-84.38, 33.70], [-84.30, 33.58], [-84.55, 33.49]]},
    {"event": "Severe Thunderstorm Warning", "minutes": 60, "coords": [[-84.10, 34.05], [-83.62, 34.22], [-83.48, 33.95], [-83.95, 33.78], [-84.18, 33.86]]},
    {"event": "Flash Flood Warning", "minutes": 180, "coords": [[-84.48, 33.82], [-84.28, 33.86], [-84.22, 33.72], [-84.36, 33.66], [-84.52, 33.70]]},
]


# ------------------------------------------------------------------ transport
def _post(route, payload):
    import urllib.request
    req = urllib.request.Request(f"http://127.0.0.1:{os.environ.get('BDOC_IPC_PORT', '9876')}/api/v1/{route}",
                                 data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=3) as r:
        return r.status


def send_sim(chunks_by_msg, gateway="!b0c00001", relays=("!b0c00002", "!b0c00003"), hop_limit=3,
             loss=0.0, pace=0.25, station="GS-ATL", satellite="GOES-19", log=None):
    """Simulate what a gateway hears: the satellite downlink to the station, then every
    chunk broadcast by the mesh gateway and re-broadcast by each relay (hop_limit falling).
    Each RF transmission is one mesh/packet event, exactly like a real capture."""
    rnd = random.Random(42)
    pid = rnd.randint(1, 1 << 30)
    sent = lost = 0
    for label, chunks in chunks_by_msg:
        _post("mesh/packet", {"from": satellite, "to": station, "portnum": "SAT_DOWNLINK", "size": sum(len(c) for c in chunks),
                              "info": f"downlink {label}"})
        for c in chunks:
            seq = c[3]
            senders = [(gateway, hop_limit)] + [(r, hop_limit - 1 - k) for k, r in enumerate(relays) if hop_limit - 1 - k >= 0]
            pid += 1
            for frm, hl in senders:
                if loss and rnd.random() < loss:
                    lost += 1
                    continue
                ev = {"from": frm, "to": "^all", "id": pid, "portnum": "PRIVATE_APP", "portnum_num": PORTNUM,
                      "hop_limit": hl, "hop_start": hop_limit, "size": len(c), "rssi": rnd.randint(-118, -70),
                      "snr": round(rnd.uniform(-12, 9), 2), "payload_b64": base64.b64encode(c).decode(),
                      "info": f"{label} {'parity' if seq == PARITY_SEQ else f'{seq + 1}/{c[4]}'} msg {struct.unpack('>H', c[1:3])[0]}"}
                _post("mesh/packet", ev)
                if log is not None:
                    log.append(ev)
                sent += 1
                time.sleep(pace)
    return sent, lost


def send_radio(chunks_by_msg, radio, channel=1, preset="MEDIUM_FAST", repeat=1, plain_text=None):
    try:
        import meshtastic.serial_interface as si
        import meshtastic.tcp_interface as ti
    except ImportError:
        print("ERROR: pip install meshtastic", file=sys.stderr)
        return 2
    kind, _, addr = radio.partition(":")
    iface = ti.TCPInterface(hostname=addr) if kind == "tcp" else si.SerialInterface(devPath=addr or None)
    sf, bw = PRESETS[preset]
    pace = lora_airtime(HDR.size + CHUNK + 16, sf, bw) * 1.3
    total = sum(len(c) for _, cs in chunks_by_msg for c in cs)
    print(f"[sky] {total} chunks on channel {channel} at {pace:.2f} s pacing ({preset}) -- ~{total * pace * repeat:.0f} s on air")
    try:
        for r in range(repeat):
            for label, chunks in chunks_by_msg:
                for c in chunks:
                    iface.sendData(c, destinationId="^all", portNum=PORTNUM, channelIndex=channel, wantAck=False)
                    time.sleep(pace)
                print(f"[sky] sent {label} ({len(chunks)} chunks) pass {r + 1}/{repeat}")
        if plain_text:
            # stock Meshtastic phone apps can't read port 256 -- give them the bulletin as plain text too
            iface.sendText(plain_text[:200], channelIndex=channel)
    finally:
        iface.close()
    return 0


# ------------------------------------------------------------------ cli
def report(label, msg):
    n = math.ceil(len(msg) / CHUNK) + 1
    print(f"{label}: {len(msg)} B -> {n} chunks incl. parity")
    for p in ("LONG_FAST", "MEDIUM_FAST", "SHORT_FAST"):
        sf, bw = PRESETS[p]
        t = lora_airtime(HDR.size + CHUNK + 16, sf, bw)
        print(f"    {p:12s} {n * t:6.1f} s airtime per hop")


def _write(path, msg):
    with open(path, "wb") as f:
        f.write(msg)


def _msg_id(msg):
    return zlib.crc32(msg) & 0xFFFF or 1


def main():
    ap = argparse.ArgumentParser(description="BDOC Skybridge: satellite data over mesh radio")
    sub = ap.add_subparsers(dest="cmd", required=True)

    r = sub.add_parser("raster", help="equirectangular image -> RASTER message")
    r.add_argument("image")
    r.add_argument("--bbox", required=True, help="south,west,north,east of the IMAGE (degrees)")
    r.add_argument("--crop", help="south,west,north,east to send (default: whole image)")
    r.add_argument("--size", type=int, default=128, help="long side in cells (default 128)")
    r.add_argument("--bits", type=int, choices=(1, 2), default=2)
    r.add_argument("--product", choices=list(PRODUCTS), default="ir")
    r.add_argument("--invert", action="store_true", help="for raw IR where cold = dark")
    r.add_argument("--enhanced", action="store_true", help="colour-enhanced IR (NOAA/SatDump palettes): use the brightest channel so blue/green cold tops count as cold")
    r.add_argument("--thresholds", help="comma list of 0-255 cut points (3 for 2-bit, 1 for 1-bit); default = scene quantiles")
    r.add_argument("--median", type=int, default=0, help="median filter size (3 removes drawn borders/coastlines)")
    r.add_argument("--keep-speckle", action="store_true", help="don't remove isolated cells")
    r.add_argument("--trim-bottom", type=int, default=0, help="pixels of caption/footer to cut off before georeferencing")
    r.add_argument("--out", required=True)

    w = sub.add_parser("warnings", help="NWS alerts GeoJSON -> POLYGONS message")
    w.add_argument("geojson")
    w.add_argument("--out", required=True)

    t = sub.add_parser("text", help="bulletin -> TEXT message")
    t.add_argument("text")
    t.add_argument("--priority", type=int, default=1, help="0 routine .. 3 flash")
    t.add_argument("--out", required=True)

    s = sub.add_parser("send", help="transmit message files")
    s.add_argument("files", nargs="+")
    s.add_argument("--radio", help="serial:COM5 | serial:/dev/ttyUSB0 | tcp:192.168.1.50")
    s.add_argument("--channel", type=int, default=1, help="dedicated Skybridge channel index (keep it off the public channel)")
    s.add_argument("--preset", choices=list(PRESETS), default="MEDIUM_FAST")
    s.add_argument("--repeat", type=int, default=1)
    s.add_argument("--plain-text", help="also send this as a normal text message for stock phone apps")
    s.add_argument("--sim", action="store_true", help="no radio: simulate gateway + relays into the local BDOC receiver")
    s.add_argument("--loss", type=float, default=0.0, help="--sim: probability each RF packet is lost")
    s.add_argument("--pace", type=float, default=0.25, help="--sim: seconds between RF packets")

    d = sub.add_parser("demo", help="synthetic storm field + sample warnings + bulletin over a simulated mesh")
    d.add_argument("--loss", type=float, default=0.06)
    d.add_argument("--pace", type=float, default=0.2)
    d.add_argument("--loop", type=int, default=1, help="repeat the broadcast N times (0 = forever)")
    d.add_argument("--save", help="write the generated messages and a PNG preview to this folder")
    d.add_argument("--size", type=int, default=128, help="cells on the long side (128 -> ~5 radio packets)")

    x = sub.add_parser("decode", help="captured chunks (JSONL of mesh/packet events or raw .bin) -> PNG/JSON")
    x.add_argument("inputs", nargs="+")
    x.add_argument("--out-dir", default="skybridge-decoded")

    a = ap.parse_args()

    if a.cmd == "raster":
        from PIL import Image
        img = Image.open(a.image)
        if a.trim_bottom:
            img = img.crop((0, 0, img.size[0], img.size[1] - a.trim_bottom))
        if a.enhanced:
            from PIL import ImageChops
            rgb = img.convert("RGB").split()
            img = ImageChops.lighter(ImageChops.lighter(rgb[0], rgb[1]), rgb[2])
        if a.median:
            from PIL import ImageFilter
            img = img.convert("L").filter(ImageFilter.MedianFilter(a.median))
        bb = [float(v) for v in a.bbox.split(",")]
        if a.crop:
            cs, cw, cn, ce = [float(v) for v in a.crop.split(",")]
            W, H = img.size
            fx = lambda lon: (lon - bb[1]) / (bb[3] - bb[1]) * W
            fy = lambda lat: (bb[2] - lat) / (bb[2] - bb[0]) * H
            img = img.crop((int(fx(cw)), int(fy(cn)), int(math.ceil(fx(ce))), int(math.ceil(fy(cs)))))
            bb = [cs, cw, cn, ce]
        wdt, hgt, rows = grid_from_image(img, a.size)
        th_in = [int(v) for v in a.thresholds.split(",")] if a.thresholds else None
        lrows, th = quantize(rows, a.bits, thresholds=th_in, invert=a.invert)
        if not a.keep_speckle:
            lrows = despeckle(lrows)
        msg = build_raster(lrows, bb, a.bits, a.product)
        _write(a.out, msg)
        report(f"RASTER {wdt}x{hgt} {a.bits}-bit (thresholds {th})", msg)
        return 0

    if a.cmd == "warnings":
        with open(a.geojson) as f:
            polys = nws_geojson_to_polys(json.load(f))
        msg = build_polygons(polys)
        _write(a.out, msg)
        report(f"POLYGONS x{len(polys)}", msg)
        return 0

    if a.cmd == "text":
        msg = build_text(a.text, a.priority)
        _write(a.out, msg)
        report("TEXT", msg)
        return 0

    if a.cmd == "send":
        batch = []
        for p in a.files:
            with open(p, "rb") as f:
                msg = f.read()
            parse_message(msg)                       # refuse to transmit something that won't decode
            batch.append((os.path.basename(p), frame(msg, _msg_id(msg))))
        if a.sim:
            sent, lost = send_sim(batch, loss=a.loss, pace=a.pace)
            print(f"[sky] simulated {sent} RF packets ({lost} lost) into the local receiver")
            return 0
        if not a.radio:
            ap.error("--radio or --sim required")
        return send_radio(batch, a.radio, a.channel, a.preset, a.repeat, a.plain_text)

    if a.cmd == "demo":
        bbox = (31.0, -86.5, 35.5, -81.0)               # Georgia and neighbours
        n = 0
        while True:
            now = time.time()
            w_, h_, rows = synthetic_storm_field(bbox, w=a.size, h=round(a.size * 0.75), seed=7 + n)
            lrows, _ = quantize(rows, 2)
            m_r = build_raster(lrows, bbox, 2, "ir", now)
            m_p = build_polygons([dict(p, expires=int(now + p["minutes"] * 60)) for p in SAMPLE_POLYS], now)
            m_t = build_text("BDOC SKYBRIDGE TEST: squall line entering west Georgia 2100Z. Tornado warning SW Atlanta "
                             "until 2145Z. Grid status Atlanta metro: partial outages. This is a demonstration "
                             "broadcast over the BDOC mesh.", 2, now)
            if a.save:
                os.makedirs(a.save, exist_ok=True)
                for nm, m in (("ir.bin", m_r), ("warnings.bin", m_p), ("bulletin.bin", m_t)):
                    _write(os.path.join(a.save, nm), m)
            for lbl, m in (("IR clouds", m_r), ("warnings", m_p), ("bulletin", m_t)):
                report(lbl, m)
            batch = [("IR", frame(m_r, _msg_id(m_r))), ("WARN", frame(m_p, _msg_id(m_p))), ("TEXT", frame(m_t, _msg_id(m_t)))]
            sent, lost = send_sim(batch, loss=a.loss, pace=a.pace)
            print(f"[sky] demo pass {n + 1}: {sent} RF packets simulated, {lost} lost")
            n += 1
            if a.loop and n >= a.loop:
                return 0
            time.sleep(5)

    if a.cmd == "decode":
        os.makedirs(a.out_dir, exist_ok=True)
        ra, results = Reassembler(), []
        for path in a.inputs:
            if path.endswith(".bin"):
                results.append(dict(parse_message(open(path, "rb").read()), source=path))
                continue
            for line in open(path):
                line = line.strip()
                if not line:
                    continue
                ev = json.loads(line)
                if ev.get("payload_b64"):
                    res = ra.feed(base64.b64decode(ev["payload_b64"]))
                    if res:
                        results.append(res)
        for i, res in enumerate(results):
            if res.get("type") == "raster":
                try:
                    from PIL import Image
                    im = Image.new("L", (res["w"], res["h"]))
                    scale = 255 // ((1 << res["bits"]) - 1)
                    im.putdata([v * scale for row in res["rows"] for v in row])
                    out = os.path.join(a.out_dir, f"raster-{res.get('msg_id', i)}.png")
                    im.save(out)
                    print(f"[sky] raster {res['w']}x{res['h']} bbox {res['bbox']} -> {out}")
                except ImportError:
                    print("[sky] raster decoded (pip install Pillow to write PNG)")
                res = {k: v for k, v in res.items() if k != "rows"}
            print(json.dumps(res)[:400])
        with open(os.path.join(a.out_dir, "decoded.json"), "w") as f:
            json.dump([{k: v for k, v in r.items() if k != "rows"} for r in results], f, indent=1)
        return 0


if __name__ == "__main__":
    sys.exit(main())
