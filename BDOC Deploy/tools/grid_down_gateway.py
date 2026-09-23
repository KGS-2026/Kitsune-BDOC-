#!/usr/bin/env python3
"""BDOC Grid-Down Gateway.

Runs on the operator's machine (Foxhound) or a field Pi. Talks to a Meshtastic
radio over USB serial or TCP -- NO INTERNET, NO MQTT, NO CLOUD -- and feeds the
local BDOC IPC receiver so the globe keeps working when the grid is down.

This is the piece that makes "works when the grid goes down" literally true:
the radio is the transport, the laptop is the server, the browser is the client,
and nothing leaves the room.

Modes:
  --serial /dev/ttyUSB0     USB-attached Meshtastic node (primary field mode)
  --tcp 192.168.1.50        Meshtastic node over LAN wifi
  --test                    Simulated mesh traffic, no hardware

Also handles inbound satellite imagery chunks (see satimg_reassembler.py),
which arrive as numbered fragments over the same radio link.

Install:
  pip install meshtastic pypubsub

Run:
  python3 grid_down_gateway.py --serial /dev/ttyUSB0
  python3 grid_down_gateway.py --test
"""

import argparse
import json
import os
import random
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "adapters"))
from bdoc_client import BDOCClient  # noqa: E402


def node_id_from(num):
    """Meshtastic numeric node id -> canonical !hex form."""
    try:
        n = int(num)
    except (TypeError, ValueError):
        return None
    if n <= 0:
        return None
    return "!" + format(n & 0xFFFFFFFF, "08x")


class GridDownGateway:
    def __init__(self, client, verbose=True):
        self.client = client
        self.verbose = verbose
        self.counts = {"position": 0, "nodeinfo": 0, "telemetry": 0, "text": 0, "satimg": 0}
        self.nodes = {}   # node_id -> merged record, so partial updates accumulate

    # -- record handling ---------------------------------------------------
    def _merge_and_send(self, node_id, fields):
        """Meshtastic sends position and identity in SEPARATE packets. Merging
        means a node keeps its name when only coordinates arrive, and keeps its
        coordinates when only a nodeinfo arrives."""
        rec = self.nodes.setdefault(node_id, {"node_id": node_id})
        rec.update({k: v for k, v in fields.items() if v is not None})
        rec["last_heard"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

        # The receiver requires numeric coordinates; hold back until we have them.
        if not isinstance(rec.get("latitude"), (int, float)):
            return False
        if not isinstance(rec.get("longitude"), (int, float)):
            return False
        return self.client.send(rec)

    def on_packet(self, packet, interface=None):
        try:
            dec = packet.get("decoded") or {}
            portnum = dec.get("portnum")
            src = node_id_from(packet.get("from"))
            if not src:
                return

            common = {
                "rssi": packet.get("rxRssi"),
                "snr": packet.get("rxSnr"),
            }

            if portnum == "POSITION_APP":
                pos = dec.get("position") or {}
                lat = pos.get("latitude")
                lon = pos.get("longitude")
                if lat is None and pos.get("latitudeI") is not None:
                    lat = pos["latitudeI"] / 1e7
                if lon is None and pos.get("longitudeI") is not None:
                    lon = pos["longitudeI"] / 1e7
                if lat is None or lon is None:
                    return
                if abs(lat) > 90 or abs(lon) > 180 or (lat == 0 and lon == 0):
                    return
                self.counts["position"] += 1
                self._merge_and_send(src, dict(common, latitude=lat, longitude=lon,
                                               altitude=pos.get("altitude") or 0))
                if self.verbose:
                    print(f"[gw] position {src} {lat:.5f},{lon:.5f}")

            elif portnum == "NODEINFO_APP":
                u = dec.get("user") or {}
                self.counts["nodeinfo"] += 1
                self._merge_and_send(src, dict(common,
                                               long_name=u.get("longName"),
                                               short_name=u.get("shortName"),
                                               hw_model=str(u.get("hwModel") or "")))
                if self.verbose:
                    print(f"[gw] nodeinfo {src} {u.get('longName')}")

            elif portnum == "TELEMETRY_APP":
                t = (dec.get("telemetry") or {}).get("deviceMetrics") or {}
                self.counts["telemetry"] += 1
                self._merge_and_send(src, dict(common, battery_level=t.get("batteryLevel")))
                if self.verbose:
                    print(f"[gw] telemetry {src} batt={t.get('batteryLevel')}")

            elif portnum == "TEXT_MESSAGE_APP":
                text = dec.get("text") or ""
                self.counts["text"] += 1
                if self.verbose:
                    print(f"[gw] text {src}: {text[:80]}")
                # Community reports (e.g. "semi blocking I-75 NB mile 42") ride here.
                self._handle_text(src, text)

        except Exception as e:
            print(f"[gw] packet error: {e}", file=sys.stderr)

    def _handle_text(self, src, text):
        """Plain text becomes a map-visible incident if it is geo-tagged.

        Convention (works with a stock Meshtastic client, no custom firmware):
            INC <lat> <lon> <free text>
        e.g.  INC 33.749 -84.388 semi blocking I-75 NB
        """
        parts = text.strip().split(None, 3)
        if len(parts) >= 4 and parts[0].upper() == "INC":
            try:
                lat, lon = float(parts[1]), float(parts[2])
            except ValueError:
                return
            sensor = {
                "sensor_id": f"inc-{src}-{int(time.time())}",
                "sensor_name": parts[3][:80],
                "latitude": lat, "longitude": lon,
                "value": 1, "unit": "", "status": "incident",
            }
            BDOCClient("sensor/reading", quiet=True).send(sensor)
            print(f"[gw] INCIDENT {lat:.4f},{lon:.4f} {parts[3][:60]}")

    # -- transports --------------------------------------------------------
    def run_meshtastic(self, serial_port=None, tcp_host=None):
        try:
            import meshtastic
            import meshtastic.serial_interface as serial_iface
            import meshtastic.tcp_interface as tcp_iface
            from pubsub import pub
        except ImportError:
            print("ERROR: pip install meshtastic pypubsub", file=sys.stderr)
            return 2

        def _on_receive(packet, interface=None, **kwargs):
            self.on_packet(packet, interface)

        pub.subscribe(_on_receive, "meshtastic.receive")

        try:
            if tcp_host:
                print(f"[gw] connecting to Meshtastic over TCP {tcp_host}")
                iface = tcp_iface.TCPInterface(hostname=tcp_host)
            else:
                print(f"[gw] connecting to Meshtastic on {serial_port or 'auto-detect'}")
                iface = serial_iface.SerialInterface(devPath=serial_port)
        except Exception as e:
            print(f"ERROR: cannot open radio: {e}", file=sys.stderr)
            print("  - is the node plugged in? is another app holding the port?", file=sys.stderr)
            return 2

        print("[gw] listening. NO INTERNET REQUIRED. Ctrl-C to stop.")
        try:
            while True:
                time.sleep(30)
                print(f"[gw] {self.counts} | forwarded={self.client.sent} failed={self.client.failed}")
        except KeyboardInterrupt:
            pass
        finally:
            try: iface.close()
            except Exception: pass
        return 0

    def run_test(self, duration=20):
        print("[gw] TEST MODE - simulated mesh traffic, no radio needed")
        base_lat, base_lon = 33.749, -84.388
        names = ["FIELD-1", "FIELD-2", "RELAY-HILL", "TRUCK-7"]
        ids = [f"!{random.randint(0x10000000, 0xfffffff0):08x}" for _ in names]

        for i, (nid, nm) in enumerate(zip(ids, names)):
            self.on_packet({"from": int(nid[1:], 16), "decoded":
                            {"portnum": "NODEINFO_APP",
                             "user": {"longName": nm, "shortName": nm[:4], "hwModel": 31}}})
        end = time.time() + duration
        while time.time() < end:
            nid = random.choice(ids)
            self.on_packet({
                "from": int(nid[1:], 16),
                "rxRssi": random.randint(-120, -40),
                "rxSnr": round(random.uniform(-15, 10), 2),
                "decoded": {"portnum": "POSITION_APP", "position": {
                    "latitude": base_lat + random.uniform(-0.15, 0.15),
                    "longitude": base_lon + random.uniform(-0.15, 0.15),
                    "altitude": random.randint(200, 400)}}
            })
            if random.random() < 0.25:
                self.on_packet({"from": int(nid[1:], 16), "decoded": {
                    "portnum": "TEXT_MESSAGE_APP",
                    "text": f"INC {base_lat + random.uniform(-0.1, 0.1):.4f} "
                            f"{base_lon + random.uniform(-0.1, 0.1):.4f} road blocked"}})
            time.sleep(1.5)

        print(f"[gw] test done: {self.counts} | forwarded={self.client.sent} failed={self.client.failed}")
        return 0 if self.client.failed == 0 else 1


def main():
    ap = argparse.ArgumentParser(description="BDOC grid-down mesh gateway")
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--serial", metavar="PORT", help="serial device, e.g. /dev/ttyUSB0 or COM3")
    g.add_argument("--tcp", metavar="HOST", help="Meshtastic node hostname/IP")
    g.add_argument("--test", action="store_true", help="simulate traffic, no hardware")
    ap.add_argument("--duration", type=int, default=20, help="--test duration seconds")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    client = BDOCClient("mesh/node")
    if client.status() is None:
        print("WARNING: BDOC IPC receiver not answering on 127.0.0.1:9876.", file=sys.stderr)
        print("         Start it first:  node tools/bdoc-ipc-receiver.js", file=sys.stderr)

    gw = GridDownGateway(client, verbose=not args.quiet)
    if args.test:
        return gw.run_test(args.duration)
    if not args.serial and not args.tcp:
        ap.error("choose one of --serial, --tcp, or --test")
    return gw.run_meshtastic(serial_port=args.serial, tcp_host=args.tcp)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(0)
