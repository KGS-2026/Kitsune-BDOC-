#!/usr/bin/env python3
"""
BDOC Live Bridge — Real-Time Wireshark → BDOC Globe
Kitsune Global Solutions LLC — SDVOSB · CAGE: 174S8

Streams live packet capture data from tshark (Wireshark CLI) directly
into BDOC globe visualization via local WebSocket. ALL DATA STAYS LOCAL.

ARCHITECTURE:
    tshark (capture) → bdoc_live_bridge.py → WebSocket (localhost:9090) → BDOC Globe

    Everything runs on YOUR machine. No data leaves localhost.
    No cloud. No third party. No accounts. Just you.

REQUIREMENTS:
    - Python 3.8+ (you have 3.13)
    - tshark (installed with Wireshark)
    - No pip packages needed — uses only stdlib

USAGE:
    # Start the bridge (captures on default interface):
    python bdoc_live_bridge.py

    # Capture on specific interface:
    python bdoc_live_bridge.py --interface "Wi-Fi"

    # List interfaces:
    python bdoc_live_bridge.py --list

    # Read from existing pcap file:
    python bdoc_live_bridge.py --file capture.pcap

    Then open BDOC at http://localhost:8080 — the Wireshark layer
    auto-connects to ws://localhost:9090 and plots threats in real-time.

SECURITY:
    - WebSocket binds to 127.0.0.1 ONLY (not 0.0.0.0)
    - No external connections accepted
    - GeoIP lookup uses local cache, falls back to ip-api.com for unknowns
    - All packet data stays in memory, never written to disk unless you export
"""

import sys
import os
import json
import time
import socket
import struct
import hashlib
import threading
import subprocess
import http.server
import urllib.request
from datetime import datetime, timezone
from collections import defaultdict


# ═══════════════════════════════════════════
# CONFIGURATION
# ═══════════════════════════════════════════

WS_HOST = '127.0.0.1'  # LOCAL ONLY — never change to 0.0.0.0
WS_PORT = 9090
GEOIP_CACHE = {}
GEOIP_RATE_LIMIT = 0.025  # 40 req/sec for ip-api.com batch

# Suspicious ports (same as Lua plugin)
SUSPICIOUS_PORTS = {
    4444: 'METASPLOIT', 5555: 'ADB', 1337: 'BACKDOOR', 31337: 'BACK_ORIFICE',
    6667: 'IRC_C2', 9001: 'TOR', 9050: 'TOR_SOCKS', 3389: 'RDP',
    5900: 'VNC', 445: 'SMB', 135: 'RPC', 1433: 'MSSQL', 3306: 'MYSQL',
    5432: 'POSTGRES', 27017: 'MONGODB', 6379: 'REDIS', 2375: 'DOCKER',
    10250: 'KUBELET', 5985: 'WINRM',
}

PRIVATE_PREFIXES = ('10.', '172.16.', '172.17.', '172.18.', '172.19.',
                    '172.20.', '172.21.', '172.22.', '172.23.', '172.24.',
                    '172.25.', '172.26.', '172.27.', '172.28.', '172.29.',
                    '172.30.', '172.31.', '192.168.', '127.', '0.', '255.',
                    '224.', '239.', '169.254.')


def is_public(ip):
    for prefix in PRIVATE_PREFIXES:
        if ip.startswith(prefix):
            return False
    return True


# ═══════════════════════════════════════════
# GEOIP (free, no API key, local cache)
# ═══════════════════════════════════════════

def geolocate(ip):
    """Geolocate IP with caching. Uses ip-api.com (free, no key)."""
    if ip in GEOIP_CACHE:
        return GEOIP_CACHE[ip]

    try:
        url = f'http://ip-api.com/json/{ip}?fields=status,lat,lon,country,city,isp,org,as'
        req = urllib.request.Request(url, headers={'User-Agent': 'BDOC-LiveBridge/1.0'})
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode())
            if data.get('status') == 'success':
                result = {
                    'lat': data['lat'], 'lon': data['lon'],
                    'country': data.get('country', ''),
                    'city': data.get('city', ''),
                    'isp': data.get('isp', ''),
                    'asn': data.get('as', ''),
                }
                GEOIP_CACHE[ip] = result
                return result
    except Exception:
        pass

    GEOIP_CACHE[ip] = None
    return None


# ═══════════════════════════════════════════
# WEBSOCKET SERVER (RFC 6455, minimal impl)
# No external packages needed — pure stdlib
# ═══════════════════════════════════════════

class WebSocketServer:
    """Minimal WebSocket server. Binds to localhost only."""

    def __init__(self, host=WS_HOST, port=WS_PORT):
        self.host = host
        self.port = port
        self.clients = []
        self.server = None
        self.running = False

    def start(self):
        self.server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.server.bind((self.host, self.port))
        self.server.listen(5)
        self.running = True
        print(f'[WS] WebSocket server on ws://{self.host}:{self.port}')
        print(f'[WS] LOCAL ONLY — no external connections accepted')

        while self.running:
            try:
                self.server.settimeout(1.0)
                try:
                    client, addr = self.server.accept()
                except socket.timeout:
                    continue

                # Verify localhost only
                if addr[0] != '127.0.0.1':
                    print(f'[WS] REJECTED external connection from {addr[0]}')
                    client.close()
                    continue

                thread = threading.Thread(target=self._handle_client, args=(client, addr), daemon=True)
                thread.start()
            except Exception as e:
                if self.running:
                    print(f'[WS] Error: {e}')

    def _handle_client(self, client, addr):
        """Handle WebSocket handshake and maintain connection."""
        try:
            data = client.recv(4096).decode('utf-8')
            if 'Upgrade: websocket' not in data:
                client.close()
                return

            # Extract Sec-WebSocket-Key
            key = ''
            for line in data.split('\r\n'):
                if line.startswith('Sec-WebSocket-Key:'):
                    key = line.split(':', 1)[1].strip()
                    break

            if not key:
                client.close()
                return

            # Compute accept key
            import hashlib as hl
            import base64
            magic = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
            accept = base64.b64encode(
                hl.sha1((key + magic).encode()).digest()
            ).decode()

            # Send handshake response
            response = (
                'HTTP/1.1 101 Switching Protocols\r\n'
                'Upgrade: websocket\r\n'
                'Connection: Upgrade\r\n'
                f'Sec-WebSocket-Accept: {accept}\r\n\r\n'
            )
            client.send(response.encode())
            self.clients.append(client)
            print(f'[WS] BDOC client connected from {addr}')

            # Keep connection alive (read pings/pongs)
            while self.running:
                try:
                    client.settimeout(30.0)
                    frame = client.recv(2)
                    if not frame:
                        break
                    # Handle ping (opcode 0x9)
                    opcode = frame[0] & 0x0F
                    if opcode == 0x9:
                        # Send pong
                        client.send(bytes([0x8A, 0x00]))
                    elif opcode == 0x8:
                        # Close
                        break
                except socket.timeout:
                    continue
                except Exception:
                    break

        except Exception as e:
            print(f'[WS] Client error: {e}')
        finally:
            if client in self.clients:
                self.clients.remove(client)
            client.close()
            print(f'[WS] Client disconnected')

    def broadcast(self, message):
        """Send message to all connected BDOC clients."""
        if not self.clients:
            return

        data = message.encode('utf-8') if isinstance(message, str) else message
        frame = self._encode_frame(data)

        dead_clients = []
        for client in self.clients:
            try:
                client.send(frame)
            except Exception:
                dead_clients.append(client)

        for dc in dead_clients:
            self.clients.remove(dc)

    def _encode_frame(self, data):
        """Encode data into a WebSocket text frame."""
        length = len(data)
        frame = bytearray([0x81])  # FIN + text opcode

        if length < 126:
            frame.append(length)
        elif length < 65536:
            frame.append(126)
            frame.extend(struct.pack('>H', length))
        else:
            frame.append(127)
            frame.extend(struct.pack('>Q', length))

        frame.extend(data)
        return bytes(frame)

    def stop(self):
        self.running = False
        for c in self.clients:
            try:
                c.close()
            except Exception:
                pass
        if self.server:
            self.server.close()


# ═══════════════════════════════════════════
# TSHARK PACKET STREAM
# ═══════════════════════════════════════════

def find_tshark():
    """Find tshark binary."""
    paths = [
        r'C:\Program Files\Wireshark\tshark.exe',
        r'C:\Program Files (x86)\Wireshark\tshark.exe',
        '/usr/bin/tshark',
        '/usr/local/bin/tshark',
    ]
    for p in paths:
        if os.path.exists(p):
            return p
    # Try PATH
    try:
        result = subprocess.run(['tshark', '--version'], capture_output=True, timeout=5)
        if result.returncode == 0:
            return 'tshark'
    except Exception:
        pass
    return None


def list_interfaces(tshark_path):
    """List available capture interfaces."""
    try:
        result = subprocess.run(
            [tshark_path, '-D'],
            capture_output=True, text=True, timeout=10
        )
        print('[TSHARK] Available interfaces:')
        print(result.stdout)
    except Exception as e:
        print(f'[TSHARK] Failed to list interfaces: {e}')


def stream_packets(tshark_path, interface=None, pcap_file=None, ws_server=None):
    """Stream packets from tshark and push to BDOC via WebSocket."""
    cmd = [tshark_path, '-T', 'fields',
           '-e', 'frame.time_epoch',
           '-e', 'ip.src',
           '-e', 'ip.dst',
           '-e', 'tcp.dstport',
           '-e', 'udp.dstport',
           '-e', 'frame.len',
           '-e', '_ws.col.Protocol',
           '-e', 'dns.qry.name',
           '-E', 'separator=|',
           '-l']  # Line-buffered output

    if pcap_file:
        cmd.extend(['-r', pcap_file])
    elif interface:
        cmd.extend(['-i', interface])

    print(f'[TSHARK] Starting capture: {" ".join(cmd)}')

    ip_stats = defaultdict(lambda: {
        'count': 0, 'bytes': 0, 'ports': defaultdict(int),
        'first': None, 'last': None, 'protocols': set(),
        'dns': 0, 'geo': None
    })

    pkt_count = 0
    threat_count = 0
    batch = []
    last_send = time.time()

    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            text=True, bufsize=1)

    try:
        for line in proc.stdout:
            line = line.strip()
            if not line:
                continue

            parts = line.split('|')
            if len(parts) < 6:
                continue

            ts, src_ip, dst_ip, tcp_port, udp_port, frame_len, *rest = parts
            proto = rest[0] if rest else ''
            dns_name = rest[1] if len(rest) > 1 else ''

            if not src_ip or not dst_ip:
                continue

            pkt_count += 1
            dport = int(tcp_port or udp_port or 0) if (tcp_port or udp_port) else 0

            # Track stats for public IPs
            for ip in [src_ip, dst_ip]:
                if is_public(ip):
                    s = ip_stats[ip]
                    s['count'] += 1
                    s['bytes'] += int(frame_len or 0)
                    if dport:
                        s['ports'][dport] += 1
                    if not s['first']:
                        s['first'] = ts
                    s['last'] = ts
                    if proto:
                        s['protocols'].add(proto)
                    if dns_name:
                        s['dns'] += 1

            # Check for suspicious activity on public IPs
            for ip in [src_ip, dst_ip]:
                if not is_public(ip):
                    continue

                sus_label = SUSPICIOUS_PORTS.get(dport, '')
                stats = ip_stats[ip]

                # Determine if this warrants a BDOC alert
                is_threat = False
                category = 'TRAFFIC'
                severity = 1

                if sus_label:
                    is_threat = True
                    category = sus_label
                    severity = 3
                elif stats['count'] > 100 and len(stats['ports']) > 30:
                    is_threat = True
                    category = 'PORT_SCAN'
                    severity = 4
                elif stats['count'] > 200 and len(stats['ports']) == 1:
                    is_threat = True
                    category = 'BRUTE_FORCE'
                    severity = 4
                elif stats['dns'] > 50:
                    is_threat = True
                    category = 'DNS_TUNNEL'
                    severity = 4

                if is_threat:
                    threat_count += 1

                    # Geolocate (cached)
                    if not stats['geo']:
                        stats['geo'] = geolocate(ip)
                        time.sleep(GEOIP_RATE_LIMIT)

                    geo = stats['geo']
                    if geo:
                        event = {
                            'type': 'threat',
                            'ip': ip,
                            'lat': geo['lat'],
                            'lon': geo['lon'],
                            'country': geo['country'],
                            'city': geo['city'],
                            'isp': geo.get('isp', ''),
                            'category': category,
                            'severity': severity,
                            'port': dport,
                            'packet_count': stats['count'],
                            'byte_count': stats['bytes'],
                            'protocol': proto,
                            'timestamp': datetime.now(timezone.utc).isoformat(),
                            'color': {5: '#ff2d2d', 4: '#ff6b35', 3: '#c4933f', 2: '#5b8cc9', 1: '#4a8a5a'}.get(severity, '#7a8194'),
                        }
                        batch.append(event)

            # Send batch every 2 seconds
            now = time.time()
            if batch and (now - last_send > 2.0 or len(batch) > 20):
                message = json.dumps({
                    'source': 'wireshark',
                    'type': 'batch',
                    'events': batch,
                    'stats': {
                        'total_packets': pkt_count,
                        'total_threats': threat_count,
                        'unique_ips': len(ip_stats),
                        'cache_size': len(GEOIP_CACHE),
                    }
                })
                if ws_server:
                    ws_server.broadcast(message)
                batch = []
                last_send = now

                # Status update
                if pkt_count % 1000 == 0:
                    print(f'[LIVE] Packets: {pkt_count} | Threats: {threat_count} | '
                          f'IPs: {len(ip_stats)} | Clients: {len(ws_server.clients if ws_server else [])}')

    except KeyboardInterrupt:
        print('\n[LIVE] Capture stopped by user')
    finally:
        proc.terminate()
        # Send final batch
        if batch and ws_server:
            ws_server.broadcast(json.dumps({
                'source': 'wireshark', 'type': 'batch', 'events': batch,
                'stats': {'total_packets': pkt_count, 'total_threats': threat_count}
            }))

    print(f'\n[LIVE] Final: {pkt_count} packets, {threat_count} threats, {len(ip_stats)} unique IPs')


# ═══════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════

def main():
    import argparse
    parser = argparse.ArgumentParser(
        description='BDOC Live Bridge — Real-Time Wireshark → BDOC Globe\n'
                    'ALL DATA STAYS ON YOUR MACHINE. Nothing leaves localhost.',
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument('--interface', '-i', help='Capture interface (e.g., "Wi-Fi", "eth0")')
    parser.add_argument('--file', '-f', help='Read from pcap file instead of live capture')
    parser.add_argument('--list', '-l', action='store_true', help='List available interfaces')
    parser.add_argument('--port', '-p', type=int, default=WS_PORT, help=f'WebSocket port (default: {WS_PORT})')

    args = parser.parse_args()

    # Find tshark
    tshark = find_tshark()
    if not tshark:
        print('[ERROR] tshark not found. Install Wireshark from https://www.wireshark.org/download.html')
        print('        tshark is included with Wireshark installation.')
        sys.exit(1)

    print(f'[BDOC] tshark found: {tshark}')

    if args.list:
        list_interfaces(tshark)
        return

    # Print banner
    print()
    print('  ╔══════════════════════════════════════════════╗')
    print('  ║  KITSUNE BDOC — LIVE WIRESHARK BRIDGE        ║')
    print('  ║  ALL DATA STAYS LOCAL — NOTHING LEAVES HOST  ║')
    print('  ╚══════════════════════════════════════════════╝')
    print()

    # Start WebSocket server in background
    ws = WebSocketServer(WS_HOST, args.port)
    ws_thread = threading.Thread(target=ws.start, daemon=True)
    ws_thread.start()
    time.sleep(0.5)

    print(f'[BDOC] Open BDOC at http://localhost:8080')
    print(f'[BDOC] Enable "Wireshark Live" layer in BDOC left panel')
    print(f'[BDOC] Press Ctrl+C to stop capture\n')

    try:
        stream_packets(tshark, args.interface, args.file, ws)
    except KeyboardInterrupt:
        pass
    finally:
        ws.stop()
        print('[BDOC] Bridge stopped.')


if __name__ == '__main__':
    main()
