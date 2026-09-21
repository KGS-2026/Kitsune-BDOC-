#!/usr/bin/env python3
"""Wireshark/tshark -> BDOC adapter.

Runs tshark in the background, geolocates public endpoints, and POSTs flows to
BDOC's IPC receiver so the globe can draw src->dst arcs.

Usage:
  python3 wireshark_adapter.py --test                 # synthetic flows, no capture
  python3 wireshark_adapter.py -i eth0                # live capture
  python3 wireshark_adapter.py -i eth0 --rate 20      # cap 20 flows/sec

Requires tshark for live capture:  apt install tshark   (or Wireshark on Win/macOS)
Non-root live capture on Linux:    dpkg-reconfigure wireshark-common && usermod -aG wireshark $USER
"""

import argparse
import ipaddress
import json
import os
import random
import shutil
import subprocess
import sys
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bdoc_client import BDOCClient, RateLimiter  # noqa: E402

GEO_CACHE_PATH = os.path.expanduser("~/.bdoc/geoip-cache.json")
# tshark's numeric ip.proto / tcp port -> a label the globe colors by.
PORT_PROTO = {443: "TLS", 8443: "TLS", 80: "HTTP", 8080: "HTTP", 53: "DNS",
              22: "SSH", 25: "SMTP", 587: "SMTP", 993: "IMAP", 3389: "RDP"}


class GeoResolver:
    """IP -> {lat,lon}. Cached on disk. Offline-safe: returns None, never blocks long."""

    def __init__(self, allow_network=True, home=None):
        self.allow_network = allow_network
        self.home = home  # {"lat":..,"lon":..} used for private/local addresses
        self.cache = {}
        self.failed = set()
        try:
            with open(GEO_CACHE_PATH) as f:
                self.cache = json.load(f)
        except Exception:
            self.cache = {}

    @staticmethod
    def is_public(ip):
        try:
            a = ipaddress.ip_address(ip)
        except ValueError:
            return False
        return not (a.is_private or a.is_loopback or a.is_link_local
                    or a.is_multicast or a.is_reserved or a.is_unspecified)

    def resolve(self, ip):
        if not self.is_public(ip):
            return self.home  # LAN endpoint sits at the operator's own position
        if ip in self.cache:
            return self.cache[ip]
        if ip in self.failed or not self.allow_network:
            return None
        try:
            url = f"http://ip-api.com/json/{ip}?fields=status,lat,lon"
            with urllib.request.urlopen(url, timeout=2.0) as r:
                d = json.loads(r.read().decode())
            if d.get("status") == "success":
                loc = {"lat": d["lat"], "lon": d["lon"]}
                self.cache[ip] = loc
                return loc
        except Exception:
            pass
        self.failed.add(ip)
        return None

    def save(self):
        try:
            os.makedirs(os.path.dirname(GEO_CACHE_PATH), exist_ok=True)
            with open(GEO_CACHE_PATH, "w") as f:
                json.dump(self.cache, f)
        except Exception:
            pass


def home_location(allow_network=True):
    """Best-effort operator position for LAN-side endpoints."""
    env_lat, env_lon = os.environ.get("BDOC_HOME_LAT"), os.environ.get("BDOC_HOME_LON")
    if env_lat and env_lon:
        try:
            return {"lat": float(env_lat), "lon": float(env_lon)}
        except ValueError:
            pass
    if allow_network:
        try:
            with urllib.request.urlopen("http://ip-api.com/json/?fields=status,lat,lon", timeout=2.0) as r:
                d = json.loads(r.read().decode())
            if d.get("status") == "success":
                return {"lat": d["lat"], "lon": d["lon"]}
        except Exception:
            pass
    return None


def proto_label(row):
    """Pick a human protocol label from tshark fields."""
    for p in (row.get("dst_port"), row.get("src_port")):
        if p in PORT_PROTO:
            return PORT_PROTO[p]
    hi = (row.get("_proto_stack") or "").split(":")
    for cand in reversed(hi):
        if cand in ("tls", "http", "dns", "quic", "ssh"):
            return cand.upper()
    return "TCP" if row.get("dst_port") else "IP"


def run_live(args, client, geo, limiter):
    tshark = shutil.which("tshark")
    if not tshark:
        print("ERROR: tshark not found. Install Wireshark/tshark, or use --test.", file=sys.stderr)
        return 2

    fields = ["ip.src", "ip.dst", "tcp.srcport", "tcp.dstport", "udp.srcport",
              "udp.dstport", "frame.len", "frame.protocols"]
    cmd = [tshark, "-i", args.interface, "-l", "-n", "-T", "fields", "-E", "separator=\t"]
    for f in fields:
        cmd += ["-e", f]
    if args.filter:
        cmd += ["-f", args.filter]

    print(f"[wireshark] capturing on {args.interface} -> {client.url}")
    try:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
    except Exception as e:
        print(f"ERROR: could not start tshark: {e}", file=sys.stderr)
        return 2

    last_report = time.time()
    if proc.stdout is None:
        print("ERROR: tshark produced no stdout stream", file=sys.stderr)
        proc.terminate()
        return 2
    try:
        for line in proc.stdout:
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 8:
                continue
            src, dst, tsp, tdp, usp, udp_, flen, protos = parts[:8]
            if not src or not dst:
                continue
            if not limiter.allow():
                continue

            row = {
                "src_ip": src,
                "dst_ip": dst,
                "src_port": int(tsp or usp or 0) if (tsp or usp) else 0,
                "dst_port": int(tdp or udp_ or 0) if (tdp or udp_) else 0,
                "packet_size": int(flen or 0),
                "_proto_stack": protos,
            }
            gs, gd = geo.resolve(src), geo.resolve(dst)
            if not gs or not gd:
                continue  # receiver draws arcs; no geo = nothing to draw
            payload = {
                "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "src_ip": row["src_ip"], "dst_ip": row["dst_ip"],
                "src_port": row["src_port"], "dst_port": row["dst_port"],
                "protocol": proto_label(row), "packet_size": row["packet_size"],
                "geo_src": gs, "geo_dst": gd,
            }
            client.send(payload)

            if time.time() - last_report > 30:
                print(f"[wireshark] {client.stats()}")
                geo.save()
                last_report = time.time()
    except KeyboardInterrupt:
        pass
    finally:
        proc.terminate()
        geo.save()
        print(f"[wireshark] final {client.stats()}")
    return 0


def run_test(args, client):
    """Synthetic flows so you can verify the pipeline with zero hardware."""
    cities = [
        ("Atlanta", 33.749, -84.388), ("San Jose", 37.339, -121.895),
        ("Ashburn", 39.043, -77.487), ("Frankfurt", 50.110, 8.682),
        ("Tokyo", 35.689, 139.692), ("Sao Paulo", -23.55, -46.633),
    ]
    protos = ["TLS", "HTTP", "DNS", "SSH"]
    print(f"[wireshark --test] sending {args.count} synthetic flows to {client.url}")
    for i in range(args.count):
        a, b = random.sample(cities, 2)
        p = random.choice(protos)
        payload = {
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "src_ip": f"10.0.0.{random.randint(2, 250)}",
            "dst_ip": f"93.184.{random.randint(1,254)}.{random.randint(1,254)}",
            "src_port": random.randint(20000, 60000),
            "dst_port": {"TLS": 443, "HTTP": 80, "DNS": 53, "SSH": 22}[p],
            "protocol": p,
            "packet_size": random.randint(60, 1500),
            "geo_src": {"lat": a[1], "lon": a[2]},
            "geo_dst": {"lat": b[1], "lon": b[2]},
        }
        ok = client.send(payload)
        print(f"  {i+1}/{args.count} {a[0]} -> {b[0]} {p:4} {'ok' if ok else 'FAIL'}")
        time.sleep(args.interval)
    print(f"[wireshark --test] {client.stats()}")
    return 0 if client.failed == 0 else 1


def main():
    ap = argparse.ArgumentParser(description="Wireshark/tshark -> BDOC adapter")
    ap.add_argument("-i", "--interface", default="any", help="capture interface (default: any)")
    ap.add_argument("-f", "--filter", default="ip", help="BPF capture filter (default: ip)")
    ap.add_argument("--rate", type=float, default=25, help="max flows/sec sent to BDOC (0=unlimited)")
    ap.add_argument("--offline", action="store_true", help="never call the geolocation API")
    ap.add_argument("--test", action="store_true", help="send synthetic flows instead of capturing")
    ap.add_argument("--count", type=int, default=6, help="--test: number of flows")
    ap.add_argument("--interval", type=float, default=0.3, help="--test: seconds between flows")
    args = ap.parse_args()

    client = BDOCClient("wireshark/packet")
    st = client.status()
    if st is None:
        print(f"WARNING: BDOC receiver not answering at {client.url}. "
              f"Start it with: node tools/bdoc-ipc-receiver.js", file=sys.stderr)
    else:
        print(f"[wireshark] BDOC receiver up (uptime {st.get('uptime_s')}s)")

    if args.test:
        return run_test(args, client)

    allow_net = not args.offline
    geo = GeoResolver(allow_network=allow_net, home=home_location(allow_net))
    if geo.home is None:
        print("[wireshark] note: no home location; LAN-side endpoints will be skipped. "
              "Set BDOC_HOME_LAT/BDOC_HOME_LON.", file=sys.stderr)
    return run_live(args, client, geo, RateLimiter(args.rate))


if __name__ == "__main__":
    sys.exit(main())
