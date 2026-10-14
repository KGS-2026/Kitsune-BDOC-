#!/usr/bin/env python3
"""Wireshark/tshark -> BDOC adapter.

Runs tshark in the background, geolocates public endpoints, and POSTs flows to
BDOC's IPC receiver so the globe can draw src->dst arcs.

Usage:
  python3 wireshark_adapter.py --test                 # synthetic flows, no capture
  python3 wireshark_adapter.py -i eth0                # live capture
  python3 wireshark_adapter.py -i eth0 --rate 20      # cap 20 flows/sec
  python3 wireshark_adapter.py --demo-lan --count 0   # endless demo traffic for the Network Builder

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
              22: "SSH", 25: "SMTP", 587: "SMTP", 993: "IMAP", 3389: "RDP",
              554: "RTSP", 1883: "MQTT", 8883: "MQTT", 5353: "MDNS", 123: "NTP",
              67: "DHCP", 68: "DHCP", 161: "SNMP", 502: "MODBUS", 445: "SMB"}

# tshark 3.x prints flags as 1/0, 4.x as True/False
def _on(v):
    return v in ("1", "True", "true")


def tcp_flags(syn, ack, fin, rst, psh):
    """Human flag string the globe prints on each packet: SYN, SYN-ACK, ACK, PSH-ACK, FIN, RST."""
    s, a, f, r, p = _on(syn), _on(ack), _on(fin), _on(rst), _on(psh)
    if r:
        return "RST"
    if s and a:
        return "SYN-ACK"
    if s:
        return "SYN"
    if f:
        return "FIN-ACK" if a else "FIN"
    if p and a:
        return "PSH-ACK"
    if a:
        return "ACK"
    return ""


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
    hi = (row.get("_proto_stack") or "").split(":")
    if "arp" in hi:
        return "ARP"
    if "icmp" in hi or "icmpv6" in hi:
        return "ICMP"
    for p in (row.get("dst_port"), row.get("src_port")):
        if p in PORT_PROTO:
            return PORT_PROTO[p]
    for cand in reversed(hi):
        if cand in ("tls", "http", "dns", "quic", "ssh", "mqtt", "rtsp", "ntp", "dhcp", "snmp", "smb2"):
            return cand.upper().replace("SMB2", "SMB")
    if "tcp" in hi:
        return "TCP"
    if "udp" in hi:
        return "UDP"
    return "IP"


def find_tshark():
    """tshark on PATH, else the standard install locations (the Windows installer does not
    add Wireshark to PATH). TSHARK=<path> overrides."""
    cands = [os.environ.get("TSHARK"), shutil.which("tshark")]
    if os.name == "nt":
        for base in (os.environ.get("ProgramFiles", r"C:\Program Files"), os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")):
            cands.append(os.path.join(base, "Wireshark", "tshark.exe"))
    else:
        cands += ["/Applications/Wireshark.app/Contents/MacOS/tshark", "/usr/bin/tshark", "/usr/local/bin/tshark", "/opt/homebrew/bin/tshark"]
    for c in cands:
        if c and os.path.isfile(c):
            return c
    return None


def list_interfaces(tshark):
    try:
        out = subprocess.run([tshark, "-D"], capture_output=True, text=True, timeout=20).stdout
    except Exception as e:
        print(f"ERROR: tshark -D failed: {e}", file=sys.stderr)
        return []
    return [ln.strip() for ln in out.splitlines() if ln.strip()]


def pick_interface(tshark, wanted):
    """Windows/macOS have no 'any' pseudo-interface: pick the first Wi-Fi/Ethernet adapter."""
    if wanted != "any" or sys.platform.startswith("linux"):
        return wanted
    lines = list_interfaces(tshark)
    pref = ("wi-fi", "wifi", "wlan", "ethernet", "en0", "en1")
    for want in pref:
        for ln in lines:
            low = ln.lower()
            if want in low and "loopback" not in low and "virtual" not in low and "vethernet" not in low:
                return ln.split(".", 1)[0].strip()   # "4. \Device\NPF_{..} (Wi-Fi)" -> "4"
    return lines[0].split(".", 1)[0].strip() if lines else wanted


def run_live(args, client, geo, limiter):
    tshark = find_tshark()
    if not tshark:
        print("ERROR: tshark not found. Install Wireshark (includes tshark + Npcap), set TSHARK=<path to tshark>, "
              "or use --demo-lan / --test.", file=sys.stderr)
        return 2
    args.interface = pick_interface(tshark, args.interface)

    fields = ["ip.src", "ip.dst", "tcp.srcport", "tcp.dstport", "udp.srcport",
              "udp.dstport", "frame.len", "frame.protocols",
              # p155: what the Network Builder animates per packet
              "tcp.flags.syn", "tcp.flags.ack", "tcp.flags.fin", "tcp.flags.reset", "tcp.flags.push",
              "icmp.type", "eth.src", "eth.dst", "ipv6.src", "ipv6.dst",
              "arp.src.proto_ipv4", "arp.dst.proto_ipv4", "dns.qry.name",
              "tls.handshake.extensions_server_name"]
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
            parts += [""] * (22 - len(parts))
            (src, dst, tsp, tdp, usp, udp_, flen, protos,
             fsyn, fack, ffin, frst, fpsh, icmpt, esrc, edst, v6s, v6d,
             arps, arpd, dnsq, sni) = parts[:22]
            src = src.split(",")[0] or v6s.split(",")[0] or arps
            dst = dst.split(",")[0] or v6d.split(",")[0] or arpd
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
            # p155: LAN packets are sent even without geo — the Network Builder places
            # them on the devices you drew. Arc layers still skip packets with no geo.
            payload = {
                "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "ts_ms": int(time.time() * 1000),
                "src_ip": row["src_ip"], "dst_ip": row["dst_ip"],
                "src_port": row["src_port"], "dst_port": row["dst_port"],
                "protocol": proto_label(row), "packet_size": row["packet_size"],
            }
            fl = tcp_flags(fsyn, fack, ffin, frst, fpsh)
            if fl:
                payload["tcp_flags"] = fl
            if icmpt:
                payload["icmp_type"] = int(icmpt.split(",")[0]) if icmpt.split(",")[0].isdigit() else icmpt
            if esrc:
                payload["src_mac"] = esrc
            if edst:
                payload["dst_mac"] = edst
            if dnsq:
                payload["info"] = "DNS " + dnsq.split(",")[0]
            elif sni:
                payload["info"] = "TLS SNI " + sni.split(",")[0]
            if gs:
                payload["geo_src"] = gs
            if gd:
                payload["geo_dst"] = gd
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


# Matches the "DEMO NETWORK" button in the BDOC Network Builder (js/modules/net-builder.js)
DEMO = {
    "laptop": "192.168.10.21", "pc": "192.168.10.22", "phone": "192.168.10.40",
    "camera": "192.168.10.60", "nvr": "192.168.10.50", "iot": "192.168.10.70",
    "router": "192.168.10.1", "server": "10.20.0.10", "dns": "8.8.8.8", "web": "93.184.215.14",
}


def run_demo_lan(args, client):
    """Endless, realistic conversation set so the Network Builder can be demoed with
    no capture rights: ARP, DNS, a full TCP 3-way handshake + TLS + teardown, ping,
    camera->NVR video, IoT MQTT, and a remote-site file sync."""
    D = DEMO
    web_geo = {"lat": 39.043, "lon": -77.487}   # Ashburn
    dns_geo = {"lat": 37.386, "lon": -122.084}  # Mountain View

    def pkt(src, dst, proto, sp=0, dp=0, size=74, flags=None, info=None, icmp=None):
        p = {"timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "ts_ms": int(time.time() * 1000),
             "src_ip": src, "dst_ip": dst, "src_port": sp, "dst_port": dp, "protocol": proto, "packet_size": size}
        if flags:
            p["tcp_flags"] = flags
        if info:
            p["info"] = info
        if icmp is not None:
            p["icmp_type"] = icmp
        if dst == D["web"] or src == D["web"]:
            p["geo_dst" if dst == D["web"] else "geo_src"] = web_geo
        if dst == D["dns"] or src == D["dns"]:
            p["geo_dst" if dst == D["dns"] else "geo_src"] = dns_geo
        client.send(p)
        time.sleep(args.interval)

    print(f"[wireshark --demo-lan] looping demo conversations to {client.url} (Ctrl+C to stop)")
    n = 0
    try:
        while args.count <= 0 or n < args.count:
            n += 1
            sp = random.randint(40000, 60000)
            pkt(D["laptop"], D["router"], "ARP", size=42, info="Who has 192.168.10.1? Tell 192.168.10.21")
            pkt(D["router"], D["laptop"], "ARP", size=42, info="192.168.10.1 is at 00:1a:2b:3c:4d:01")
            pkt(D["laptop"], D["dns"], "DNS", sp, 53, 72, info="DNS example.com")
            pkt(D["dns"], D["laptop"], "DNS", 53, sp, 88, info="DNS example.com A 93.184.215.14")
            pkt(D["laptop"], D["web"], "TCP", sp, 443, 74, "SYN")
            pkt(D["web"], D["laptop"], "TCP", 443, sp, 74, "SYN-ACK")
            pkt(D["laptop"], D["web"], "TCP", sp, 443, 66, "ACK")
            pkt(D["laptop"], D["web"], "TLS", sp, 443, 583, "PSH-ACK", "TLS Client Hello SNI example.com")
            pkt(D["web"], D["laptop"], "TLS", 443, sp, 1460, "ACK", "TLS Server Hello + cert")
            for _ in range(2):
                pkt(D["web"], D["laptop"], "TLS", 443, sp, 1460, "PSH-ACK", "Application data")
            pkt(D["laptop"], D["web"], "TCP", sp, 443, 66, "FIN-ACK")
            pkt(D["web"], D["laptop"], "TCP", 443, sp, 66, "FIN-ACK")
            pkt(D["pc"], D["server"], "ICMP", size=98, info="Echo (ping) request", icmp=8)
            pkt(D["server"], D["pc"], "ICMP", size=98, info="Echo (ping) reply", icmp=0)
            for _ in range(3):
                pkt(D["camera"], D["nvr"], "RTSP", 554, 49152, 1400, None, "RTP video stream")
            pkt(D["iot"], D["server"], "MQTT", random.randint(30000, 40000), 1883, 120, "PSH-ACK", "MQTT PUBLISH sensors/temp")
            pkt(D["phone"], D["router"], "DNS", sp + 1, 53, 70, info="DNS api.weather.gov")
            pkt(D["server"], D["pc"], "SMB", 445, sp + 2, 1460, "PSH-ACK", "SMB2 Read Response")
    except KeyboardInterrupt:
        pass
    print(f"[wireshark --demo-lan] {client.stats()}")
    return 0


def main():
    ap = argparse.ArgumentParser(description="Wireshark/tshark -> BDOC adapter")
    ap.add_argument("-i", "--interface", default="any", help="capture interface (default: any)")
    ap.add_argument("-f", "--filter", default="ip or ip6 or arp", help="BPF capture filter (default: ip or ip6 or arp)")
    ap.add_argument("--rate", type=float, default=25, help="max flows/sec sent to BDOC (0=unlimited)")
    ap.add_argument("--offline", action="store_true", help="never call the geolocation API")
    ap.add_argument("--test", action="store_true", help="send synthetic flows instead of capturing")
    ap.add_argument("--demo-lan", action="store_true",
                    help="loop a realistic LAN conversation (ARP, DNS, TCP handshakes, TLS, ICMP, RTSP, MQTT) "
                         "between the IPs of the Network Builder demo topology")
    ap.add_argument("--count", type=int, default=6, help="--test: number of flows; --demo-lan: loops (0 = forever)")
    ap.add_argument("-D", "--list-interfaces", action="store_true", help="print tshark's capture interfaces and exit")
    ap.add_argument("--interval", type=float, default=0.3, help="--test: seconds between flows")
    args = ap.parse_args()

    if args.list_interfaces:
        t = find_tshark()
        if not t:
            print("tshark not found (install Wireshark or set TSHARK=<path>)", file=sys.stderr)
            return 2
        print("\n".join(list_interfaces(t)))
        return 0

    client = BDOCClient("wireshark/packet")
    st = client.status()
    if st is None:
        print(f"WARNING: BDOC receiver not answering at {client.url}. "
              f"Start it with: node tools/bdoc-ipc-receiver.js", file=sys.stderr)
    else:
        print(f"[wireshark] BDOC receiver up (uptime {st.get('uptime_s')}s)")

    if args.test:
        return run_test(args, client)
    if args.demo_lan:
        return run_demo_lan(args, client)

    allow_net = not args.offline
    geo = GeoResolver(allow_network=allow_net, home=home_location(allow_net))
    if geo.home is None:
        print("[wireshark] note: no home location for the legacy geo arcs (set BDOC_HOME_LAT/BDOC_HOME_LON). "
              "LAN packets still reach the Network Builder.", file=sys.stderr)
    return run_live(args, client, geo, RateLimiter(args.rate))


if __name__ == "__main__":
    sys.exit(main())
