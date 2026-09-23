#!/usr/bin/env python3
"""Satellite imagery over mesh radio -- chunked transmit and reassembly.

THE CONSTRAINT THAT DRIVES THIS DESIGN
--------------------------------------
Meshtastic LoRa is roughly 1-5 kbps of usable application throughput, with a
~200 byte payload per packet, and it is a SHARED medium -- every byte you send
is airtime nobody else in the mesh can use. A 1 MB JPEG is not "slow" on that
link, it is antisocial: tens of minutes of continuous transmission that jams
the channel other people need for text.

So imagery over mesh is only honest if it is tiny. This module targets
grayscale tactical thumbnails measured in SINGLE-DIGIT KILOBYTES:

    128x128 grayscale, 16 levels, RLE  ->  typically 1-4 KB
    at ~200 usable bytes/packet        ->  ~10-25 packets
    at ~1 packet/sec with backoff      ->  roughly 30-60 seconds

That is a usable recon thumbnail in under a minute. A full-color photo is not
attempted on purpose -- if you need one, move it over wifi/LTE and use the mesh
only to announce that it exists.

FORMAT
------
Header packet:   SATIMG|<id>|H|<w>|<h>|<levels>|<nchunks>|<crc32>
Data packet:     SATIMG|<id>|D|<seq>|<base64 payload>

Receiver reassembles by id, verifies CRC32, and pushes a data: URL to BDOC.
Missing chunks are reported so the sender can retransmit just those.

Usage:
  # encode + show what it would cost on air
  python3 satimg_mesh.py encode input.png --out chunks.json

  # decode chunks back to a PNG
  python3 satimg_mesh.py decode chunks.json --out recovered.png

  # listen for chunks arriving from the gateway and post to BDOC
  python3 satimg_mesh.py listen
"""

import argparse
import base64
import binascii
import json
import os
import sys

MAX_PAYLOAD = 180          # bytes of base64 per data packet, leaves header room
DEFAULT_SIZE = 128
DEFAULT_LEVELS = 16


# ---------------------------------------------------------------- encoding
def quantize(pixels, levels):
    """8-bit grayscale -> N levels. Fewer levels compress far better over RLE."""
    step = 256 // levels
    return [min(levels - 1, p // step) for p in pixels]


def rle_encode(values):
    """Run-length encode as (count, value) pairs, count capped at 255."""
    out = bytearray()
    if not values:
        return bytes(out)
    cur, run = values[0], 1
    for v in values[1:]:
        if v == cur and run < 255:
            run += 1
        else:
            out.append(run)
            out.append(cur)
            cur, run = v, 1
    out.append(run)
    out.append(cur)
    return bytes(out)


def rle_decode(data):
    out = []
    for i in range(0, len(data) - 1, 2):
        out.extend([data[i + 1]] * data[i])
    return out


def encode_image(path, size=DEFAULT_SIZE, levels=DEFAULT_LEVELS, img_id=None):
    try:
        from PIL import Image
    except ImportError:
        print("ERROR: pip install Pillow", file=sys.stderr)
        return None

    im = Image.open(path).convert("L").resize((size, size))
    pixels = list(im.getdata())  # noqa: deprecated in Pillow 14, still correct in 10-13
    q = quantize(pixels, levels)
    raw = rle_encode(q)
    crc = binascii.crc32(raw) & 0xFFFFFFFF

    b64 = base64.b64encode(raw).decode()
    chunks = [b64[i:i + MAX_PAYLOAD] for i in range(0, len(b64), MAX_PAYLOAD)]
    img_id = img_id or f"{abs(hash(path)) % 100000:05d}"

    packets = [f"SATIMG|{img_id}|H|{size}|{size}|{levels}|{len(chunks)}|{crc}"]
    packets += [f"SATIMG|{img_id}|D|{i}|{c}" for i, c in enumerate(chunks)]

    return {
        "id": img_id, "width": size, "height": size, "levels": levels,
        "raw_bytes": len(raw), "b64_bytes": len(b64),
        "chunks": len(chunks), "crc32": crc, "packets": packets,
        "est_seconds": round(len(packets) * 1.2, 1),
    }


# ---------------------------------------------------------------- decoding
class Reassembler:
    """Collects SATIMG packets until an image is complete."""

    def __init__(self):
        self.images = {}   # id -> {meta, chunks{}}

    def feed(self, line):
        """Returns a completed image dict, or None."""
        if not line.startswith("SATIMG|"):
            return None
        parts = line.split("|", 4)
        if len(parts) < 4:
            return None
        _, img_id, kind = parts[0], parts[1], parts[2]

        if kind == "H":
            f = line.split("|")
            if len(f) < 8:
                return None
            self.images[img_id] = {
                "meta": {"width": int(f[3]), "height": int(f[4]),
                         "levels": int(f[5]), "nchunks": int(f[6]), "crc32": int(f[7])},
                "chunks": {},
            }
            return None

        if kind == "D":
            if img_id not in self.images:
                return None     # header not heard yet; sender must resend it
            # Radio noise and partial frames reach this parser. A bad sequence
            # number must drop the packet, never kill the listener loop.
            try:
                seq = int(parts[3])
            except (ValueError, IndexError):
                return None
            if len(parts) < 5:
                return None
            if seq < 0 or seq >= self.images[img_id]["meta"]["nchunks"]:
                return None
            self.images[img_id]["chunks"][seq] = parts[4]
            return self._try_complete(img_id)

        return None

    def missing(self, img_id):
        e = self.images.get(img_id)
        if not e:
            return None
        return [i for i in range(e["meta"]["nchunks"]) if i not in e["chunks"]]

    def _try_complete(self, img_id):
        e = self.images[img_id]
        n = e["meta"]["nchunks"]
        if len(e["chunks"]) < n:
            return None
        b64 = "".join(e["chunks"][i] for i in range(n))
        try:
            raw = base64.b64decode(b64)
        except Exception:
            return None
        if (binascii.crc32(raw) & 0xFFFFFFFF) != e["meta"]["crc32"]:
            print(f"[satimg] {img_id} CRC MISMATCH - corrupt, discarding", file=sys.stderr)
            del self.images[img_id]
            return None
        pixels = rle_decode(raw)
        del self.images[img_id]
        return {"id": img_id, "meta": e["meta"], "pixels": pixels}


def to_png(result, out_path):
    try:
        from PIL import Image
    except ImportError:
        print("ERROR: pip install Pillow", file=sys.stderr)
        return False
    m = result["meta"]
    step = 256 // m["levels"]
    data = [min(255, p * step) for p in result["pixels"]]
    expected = m["width"] * m["height"]
    if len(data) < expected:
        data += [0] * (expected - len(data))
    im = Image.new("L", (m["width"], m["height"]))
    im.putdata(data[:expected])
    im.save(out_path)
    return True


# ---------------------------------------------------------------- cli
def main():
    ap = argparse.ArgumentParser(description="Satellite imagery over mesh radio")
    sub = ap.add_subparsers(dest="cmd", required=True)

    e = sub.add_parser("encode", help="image -> mesh packets")
    e.add_argument("input")
    e.add_argument("--out", default="chunks.json")
    e.add_argument("--size", type=int, default=DEFAULT_SIZE)
    e.add_argument("--levels", type=int, default=DEFAULT_LEVELS)

    d = sub.add_parser("decode", help="mesh packets -> image")
    d.add_argument("input")
    d.add_argument("--out", default="recovered.png")

    sub.add_parser("listen", help="read SATIMG lines on stdin, post to BDOC")

    args = ap.parse_args()

    if args.cmd == "encode":
        r = encode_image(args.input, args.size, args.levels)
        if not r:
            return 2
        with open(args.out, "w") as f:
            json.dump(r, f, indent=2)
        print(f"image id     : {r['id']}")
        print(f"grid         : {r['width']}x{r['height']} @ {r['levels']} levels")
        print(f"compressed   : {r['raw_bytes']} bytes ({r['b64_bytes']} b64)")
        print(f"packets      : {r['chunks']} data + 1 header")
        print(f"est. airtime : ~{r['est_seconds']}s at 1.2s/packet")
        if r["chunks"] > 40:
            print("WARNING: >40 packets is a long channel occupancy. "
                  "Reduce --size or --levels.", file=sys.stderr)
        print(f"written      : {args.out}")
        return 0

    if args.cmd == "decode":
        with open(args.input) as f:
            blob = json.load(f)
        packets = blob["packets"] if isinstance(blob, dict) else blob
        r = Reassembler()
        done = None
        for p in packets:
            done = r.feed(p) or done
        if not done:
            print("ERROR: incomplete or corrupt packet set", file=sys.stderr)
            return 1
        if to_png(done, args.out):
            print(f"recovered -> {args.out}")
            return 0
        return 2

    if args.cmd == "listen":
        sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "adapters"))
        from bdoc_client import BDOCClient
        client = BDOCClient("sensor/reading", quiet=True)
        r = Reassembler()
        print("[satimg] reading SATIMG lines on stdin...")
        for line in sys.stdin:
            done = r.feed(line.strip())
            if done:
                print(f"[satimg] COMPLETE {done['id']} "
                      f"{done['meta']['width']}x{done['meta']['height']}")
                out = f"satimg-{done['id']}.png"
                to_png(done, out)
                print(f"[satimg] wrote {out}")
        return 0


if __name__ == "__main__":
    sys.exit(main())
