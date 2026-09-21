#!/usr/bin/env python3
"""WiFi scanner -> BDOC adapter (the inSSIDer role).

Scans nearby access points and POSTs them to BDOC's IPC receiver, which the
globe renders as signal-colored markers with channel/security detail.

Cross-platform backends, auto-detected:
  Linux   : nmcli  (preferred) or  iw dev <if> scan
  Windows : netsh wlan show networks mode=bssid
  macOS   : airport -s

Usage:
  python3 inssider_adapter.py --test              # synthetic networks
  python3 inssider_adapter.py                     # scan every 30s
  python3 inssider_adapter.py --once              # single scan
  BDOC_HOME_LAT=33.75 BDOC_HOME_LON=-84.39 python3 inssider_adapter.py
"""

import argparse
import json
import os
import platform
import random
import re
import shutil
import subprocess
import sys
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bdoc_client import BDOCClient  # noqa: E402


# ---------------------------------------------------------------- helpers
def chan_to_band(ch):
    try:
        ch = int(ch)
    except (TypeError, ValueError):
        return None
    if 1 <= ch <= 14:
        return 2.4
    if 32 <= ch <= 177:
        return 5.0
    return 6.0 if ch > 177 else None


def quality_to_dbm(pct):
    """nmcli/netsh report 0-100% quality; map to the usual dBm range."""
    try:
        pct = float(pct)
    except (TypeError, ValueError):
        return None
    pct = max(0.0, min(100.0, pct))
    return round(-100 + (pct * 0.6), 1)   # 0% -> -100dBm, 100% -> -40dBm


def get_location(allow_network=True):
    lat, lon = os.environ.get("BDOC_HOME_LAT"), os.environ.get("BDOC_HOME_LON")
    if lat and lon:
        try:
            return {"lat": float(lat), "lon": float(lon)}
        except ValueError:
            pass
    if allow_network:
        try:
            with urllib.request.urlopen("http://ip-api.com/json/?fields=status,lat,lon", timeout=2.5) as r:
                d = json.loads(r.read().decode())
            if d.get("status") == "success":
                return {"lat": d["lat"], "lon": d["lon"]}
        except Exception:
            pass
    return None


# ---------------------------------------------------------------- backends
def scan_nmcli():
    exe = shutil.which("nmcli")
    if not exe:
        return None
    fields = "SSID,BSSID,CHAN,FREQ,SIGNAL,SECURITY,RATE"
    try:
        out = subprocess.run(
            [exe, "-t", "-f", fields, "device", "wifi", "list", "--rescan", "yes"],
            capture_output=True, text=True, timeout=45,
        )
    except Exception:
        return None
    if out.returncode != 0:
        return None

    nets = []
    for line in out.stdout.splitlines():
        if not line.strip():
            continue
        # nmcli -t escapes the colons inside a BSSID as '\:'
        parts = re.split(r"(?<!\\):", line)
        parts = [p.replace("\\:", ":") for p in parts]
        if len(parts) < 6:
            continue
        ssid, bssid, chan, freq, signal, security = parts[:6]
        dbm = quality_to_dbm(signal)
        nets.append({
            "ssid": ssid or "(hidden)",
            "bssid": bssid.upper(),
            "channel": int(chan) if chan.isdigit() else None,
            "frequency_ghz": chan_to_band(chan),
            "signal_dbm": dbm,
            "signal_quality_percent": int(signal) if signal.isdigit() else None,
            "security": security or "Open",
            "vendor": None,
            "phytype": None,
        })
    return nets or None


def scan_netsh():
    if platform.system() != "Windows":
        return None
    exe = shutil.which("netsh")
    if not exe:
        return None
    try:
        out = subprocess.run([exe, "wlan", "show", "networks", "mode=bssid"],
                             capture_output=True, text=True, timeout=45)
    except Exception:
        return None
    if out.returncode != 0:
        return None

    nets, cur = [], None
    for raw in out.stdout.splitlines():
        line = raw.strip()
        m = re.match(r"^SSID\s+\d+\s*:\s*(.*)$", line)
        if m:
            cur = {"ssid": m.group(1).strip() or "(hidden)", "security": "Open",
                   "bssid": None, "channel": None, "signal_quality_percent": None}
            continue
        if cur is None:
            continue
        if line.startswith("Authentication"):
            cur["security"] = line.split(":", 1)[1].strip()
        elif line.startswith("BSSID"):
            if cur.get("bssid"):
                nets.append(_finish_netsh(cur))
                cur = dict(cur)
            cur["bssid"] = line.split(":", 1)[1].strip().upper()
        elif line.startswith("Signal"):
            v = line.split(":", 1)[1].strip().rstrip("%")
            cur["signal_quality_percent"] = int(v) if v.isdigit() else None
        elif line.startswith("Channel"):
            v = line.split(":", 1)[1].strip()
            cur["channel"] = int(v) if v.isdigit() else None
    if cur and cur.get("bssid"):
        nets.append(_finish_netsh(cur))
    return nets or None


def _finish_netsh(c):
    return {
        "ssid": c["ssid"], "bssid": c["bssid"], "channel": c["channel"],
        "frequency_ghz": chan_to_band(c["channel"]),
        "signal_dbm": quality_to_dbm(c["signal_quality_percent"]),
        "signal_quality_percent": c["signal_quality_percent"],
        "security": c["security"], "vendor": None, "phytype": None,
    }


def scan_airport():
    if platform.system() != "Darwin":
        return None
    path = ("/System/Library/PrivateFrameworks/Apple80211.framework/Versions/"
            "Current/Resources/airport")
    if not os.path.exists(path):
        return None
    try:
        out = subprocess.run([path, "-s"], capture_output=True, text=True, timeout=45)
    except Exception:
        return None
    if out.returncode != 0:
        return None

    nets = []
    for line in out.stdout.splitlines()[1:]:
        m = re.match(r"^\s*(.+?)\s+([0-9a-f:]{17})\s+(-?\d+)\s+(\d+)", line, re.I)
        if not m:
            continue
        ssid, bssid, rssi, chan = m.groups()
        nets.append({
            "ssid": ssid.strip() or "(hidden)", "bssid": bssid.upper(),
            "channel": int(chan), "frequency_ghz": chan_to_band(chan),
            "signal_dbm": float(rssi),
            "signal_quality_percent": max(0, min(100, int((float(rssi) + 100) / 0.6))),
            "security": "unknown", "vendor": None, "phytype": None,
        })
    return nets or None


def scan_once():
    for backend in (scan_nmcli, scan_netsh, scan_airport):
        nets = backend()
        if nets:
            return nets, backend.__name__
    return [], None


def synthetic():
    names = ["HomeNet", "xfinitywifi", "ATT-5G-9021", "Pixel_4821", "BDOC-FIELD-1", "(hidden)"]
    out = []
    for i, n in enumerate(names):
        ch = random.choice([1, 6, 11, 36, 44, 149])
        pct = random.randint(25, 99)
        out.append({
            "ssid": n,
            "bssid": ":".join(f"{random.randint(0,255):02X}" for _ in range(6)),
            "channel": ch, "frequency_ghz": chan_to_band(ch),
            "signal_dbm": quality_to_dbm(pct), "signal_quality_percent": pct,
            "security": random.choice(["WPA2", "WPA3", "WPA2-Enterprise", "Open"]),
            "vendor": random.choice(["Netgear", "Cisco", "Ubiquiti", "TP-Link"]),
            "phytype": random.choice(["802.11n", "802.11ac", "802.11ax"]),
        })
    return out


# ---------------------------------------------------------------- analysis
def annotate_interference(nets):
    """Flag co-channel and overlapping-channel neighbors (the inSSIDer core value)."""
    by_chan = {}
    for n in nets:
        if n.get("channel"):
            by_chan.setdefault(n["channel"], []).append(n)
    for n in nets:
        ch = n.get("channel")
        if not ch:
            n["co_channel_count"] = 0
            n["overlapping_count"] = 0
            continue
        n["co_channel_count"] = max(0, len(by_chan.get(ch, [])) - 1)
        overlap = 0
        if (n.get("frequency_ghz") or 0) == 2.4:
            # 2.4GHz channels are 5MHz apart but 20MHz wide -> +/-4 overlaps.
            for other_ch, group in by_chan.items():
                if other_ch != ch and abs(other_ch - ch) < 5:
                    overlap += len(group)
        n["overlapping_count"] = overlap
    return nets


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description="WiFi scanner -> BDOC adapter")
    ap.add_argument("--interval", type=float, default=30, help="seconds between scans")
    ap.add_argument("--once", action="store_true", help="single scan then exit")
    ap.add_argument("--test", action="store_true", help="synthetic networks, no adapter needed")
    ap.add_argument("--offline", action="store_true", help="never call the geolocation API")
    args = ap.parse_args()

    client = BDOCClient("wifi/scan")
    if client.status() is None:
        print(f"WARNING: BDOC receiver not answering at {client.url}. "
              f"Start it with: node tools/bdoc-ipc-receiver.js", file=sys.stderr)

    loc = get_location(allow_network=not args.offline)
    if loc is None:
        print("ERROR: no location. Set BDOC_HOME_LAT and BDOC_HOME_LON "
              "(WiFi scans need a position to plot).", file=sys.stderr)
        return 2
    print(f"[wifi] location {loc['lat']:.4f},{loc['lon']:.4f}")

    while True:
        if args.test:
            nets, backend = synthetic(), "synthetic"
        else:
            nets, backend = scan_once()

        if not nets:
            print("[wifi] no networks found (no wifi adapter, or scanning needs privileges). "
                  "Try --test to verify the pipeline.", file=sys.stderr)
        else:
            annotate_interference(nets)
            payload = {
                "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "location": loc,
                "backend": backend,
                "networks": nets,
            }
            ok = client.send(payload)
            worst = max((n for n in nets if n.get("co_channel_count") is not None),
                        key=lambda n: n["co_channel_count"], default=None)
            note = f" busiest ch{worst['channel']} ({worst['co_channel_count']} co-channel)" if worst else ""
            print(f"[wifi] {backend}: {len(nets)} networks -> {'ok' if ok else 'FAIL'}{note}")

        if args.once:
            return 0 if client.failed == 0 else 1
        time.sleep(args.interval)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(0)
