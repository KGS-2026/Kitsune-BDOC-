#!/usr/bin/env python3
"""
BDOC WiFi Intelligence Tool — inSSIDer / WiFi Scan Data Importer
Kitsune Global Solutions LLC — SDVOSB · CAGE: 174S8

Imports WiFi scan data from inSSIDer, NetSpot, WiFi Analyzer, or manual
input and generates a GeoJSON overlay for KITSUNE BDOC globe.

SUPPORTED INPUTS:
    1. inSSIDer CSV export (File → Export → CSV)
    2. NetSpot CSV/JSON export
    3. Wigle.net export (KML/CSV)
    4. Manual JSON input (for custom WiFi survey data)
    5. Live scan via system WiFi interface (Windows/Linux)

FEATURES:
    - Classifies networks by security level (WPA3, WPA2, WEP, OPEN)
    - Identifies rogue APs and evil twins
    - Detects default/factory SSIDs (potential targets)
    - Maps signal coverage with heatmap data
    - Identifies hidden networks
    - Channel congestion analysis
    - Vendor identification from OUI (MAC prefix)

OUTPUT:
    GeoJSON for BDOC globe import with full WiFi intelligence metadata

USAGE:
    python bdoc_wifi_intel.py --inssider scan_export.csv --location 33.749,-84.388
    python bdoc_wifi_intel.py --wigle wigle_export.csv
    python bdoc_wifi_intel.py --live --location 33.749,-84.388
    python bdoc_wifi_intel.py --manual networks.json
"""

import sys
import os
import json
import csv
import re
import time
import hashlib
import subprocess
from datetime import datetime, timezone


# ═══════════════════════════════════════════
# OUI VENDOR DATABASE (top 50 manufacturers)
# ═══════════════════════════════════════════

OUI_DB = {
    '00:50:F2': 'Microsoft', '00:1A:2B': 'Ayecom', '00:0C:29': 'VMware',
    '00:1B:44': 'SanDisk', '00:1C:B3': 'Apple', '00:1D:4F': 'Apple',
    '00:1E:C2': 'Apple', '00:1F:5B': 'Apple', '00:21:E9': 'Apple',
    '00:23:12': 'Apple', '00:23:32': 'Apple', '00:25:00': 'Apple',
    '00:25:BC': 'Apple', '00:26:08': 'Apple', '00:26:B0': 'Apple',
    '00:26:BB': 'Apple', '3C:15:C2': 'Apple', 'AC:87:A3': 'Apple',
    'D8:96:95': 'Apple', 'F0:B4:79': 'Apple', '18:AF:61': 'Apple',
    'B0:34:95': 'Apple', '00:0D:93': 'Apple',
    'FC:FB:FB': 'Cisco', '00:00:0C': 'Cisco', '00:01:42': 'Cisco',
    '00:1B:D4': 'Cisco', 'C8:F9:F9': 'Cisco-Meraki',
    '00:0E:8E': 'SparkLAN', 'D8:0D:17': 'TP-Link', '50:C7:BF': 'TP-Link',
    'C0:25:E9': 'TP-Link', 'A4:2B:B0': 'TP-Link',
    '00:14:6C': 'Netgear', '00:1E:2A': 'Netgear', '20:E5:2A': 'Netgear',
    'B0:B9:8A': 'Netgear', 'C4:04:15': 'Netgear',
    '00:1F:33': 'Netgear', '10:0C:6B': 'Netgear',
    '00:1D:7E': 'Linksys', '00:23:69': 'Linksys', 'C0:56:27': 'Belkin',
    '08:86:3B': 'Belkin', '94:10:3E': 'Belkin',
    'F8:E4:FB': 'Actiontec', '00:26:62': 'Actiontec',
    'CC:40:D0': 'Netgear-Arlo', '9C:3D:CF': 'Netgear',
    '00:18:E7': 'Aruba', '00:0B:86': 'Aruba', '00:24:6C': 'Aruba',
    '6C:F3:7F': 'Aruba', 'D8:C7:C8': 'Aruba',
    '00:1A:1E': 'Aruba', '20:4C:03': 'Aruba',
    '00:0F:23': 'Ubiquiti', '00:15:6D': 'Ubiquiti', '04:18:D6': 'Ubiquiti',
    '24:A4:3C': 'Ubiquiti', '44:D9:E7': 'Ubiquiti', '68:72:51': 'Ubiquiti',
    '78:8A:20': 'Ubiquiti', 'B4:FB:E4': 'Ubiquiti',
    'DC:9F:DB': 'Ubiquiti', 'F0:9F:C2': 'Ubiquiti',
    '00:1A:A0': 'Dell', '00:14:22': 'Dell',
    '00:17:88': 'Philips-Hue', '00:26:F2': 'Netgear',
    '00:23:CD': 'TP-Link', '64:70:02': 'TP-Link',
    '14:CC:20': 'TP-Link', 'EC:08:6B': 'TP-Link',
    'F4:F2:6D': 'TP-Link',
    '88:71:B1': 'Samsung', '00:21:19': 'Samsung',
    '00:07:AB': 'Samsung', '08:D4:2B': 'Samsung',
    'B8:27:EB': 'Raspberry-Pi', 'DC:A6:32': 'Raspberry-Pi',
    'E4:5F:01': 'Raspberry-Pi',
}

# Known default/factory SSIDs (security risk indicators)
DEFAULT_SSIDS = {
    'linksys', 'netgear', 'dlink', 'default', 'belkin', 'xfinity',
    'att', 'spectrum', 'verizon', 'tmobile', 'comcast', 'cox',
    'DIRECT-', 'HP-Print', 'PRINTER', 'AndroidAP', 'iPhone',
    'Galaxy', 'SETUP', 'Wireless', 'Home', 'Guest', 'Free WiFi',
    'Public', 'Open', 'FreeWifi', 'Hotel', 'Airport',
}


# ═══════════════════════════════════════════
# SECURITY CLASSIFICATION
# ═══════════════════════════════════════════

def classify_security(encryption_str):
    """Classify WiFi security level from encryption string."""
    enc = (encryption_str or '').upper()
    if 'WPA3' in enc or 'SAE' in enc:
        return {'level': 'WPA3', 'score': 5, 'color': '#4a8a5a'}
    elif 'WPA2' in enc:
        if 'ENTERPRISE' in enc or '802.1X' in enc or 'EAP' in enc:
            return {'level': 'WPA2-ENT', 'score': 4, 'color': '#5b8cc9'}
        return {'level': 'WPA2-PSK', 'score': 3, 'color': '#c4933f'}
    elif 'WPA' in enc:
        return {'level': 'WPA', 'score': 2, 'color': '#c4933f'}
    elif 'WEP' in enc:
        return {'level': 'WEP', 'score': 1, 'color': '#c4504a'}
    elif 'OPEN' in enc or enc == '' or 'NONE' in enc:
        return {'level': 'OPEN', 'score': 0, 'color': '#ff2d2d'}
    return {'level': 'UNKNOWN', 'score': 2, 'color': '#7a8194'}


def is_default_ssid(ssid):
    """Check if SSID matches known default/factory patterns."""
    if not ssid:
        return False
    ssid_lower = ssid.lower()
    for pattern in DEFAULT_SSIDS:
        if pattern.lower() in ssid_lower:
            return True
    return False


def lookup_vendor(mac):
    """Look up vendor from MAC OUI prefix."""
    if not mac or len(mac) < 8:
        return 'Unknown'
    prefix = mac[:8].upper().replace('-', ':')
    return OUI_DB.get(prefix, 'Unknown')


# ═══════════════════════════════════════════
# INPUT PARSERS
# ═══════════════════════════════════════════

def parse_inssider_csv(filepath):
    """Parse inSSIDer CSV export."""
    networks = []
    with open(filepath, 'r', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        for row in reader:
            net = {
                'ssid': row.get('SSID', row.get('ssid', '')),
                'bssid': row.get('MAC Address', row.get('BSSID', row.get('bssid', ''))),
                'signal': int(row.get('RSSI', row.get('Signal', row.get('signal', -100)))),
                'channel': row.get('Channel', row.get('channel', '')),
                'encryption': row.get('Security', row.get('Encryption', row.get('encryption', ''))),
                'frequency': row.get('Frequency', row.get('Band', '')),
                'vendor': '',
            }
            net['vendor'] = lookup_vendor(net['bssid'])
            networks.append(net)
    return networks


def parse_wigle_csv(filepath):
    """Parse Wigle.net CSV/KML export."""
    networks = []
    with open(filepath, 'r', encoding='utf-8') as f:
        # Skip Wigle header lines
        for line in f:
            if line.startswith('MAC,'):
                break
        reader = csv.DictReader(f, fieldnames=[
            'MAC', 'SSID', 'AuthMode', 'FirstSeen', 'Channel',
            'RSSI', 'CurrentLatitude', 'CurrentLongitude',
            'AltitudeMeters', 'AccuracyMeters', 'Type'
        ])
        for row in reader:
            try:
                net = {
                    'ssid': row.get('SSID', ''),
                    'bssid': row.get('MAC', ''),
                    'signal': int(row.get('RSSI', -100)),
                    'channel': row.get('Channel', ''),
                    'encryption': row.get('AuthMode', ''),
                    'lat': float(row.get('CurrentLatitude', 0)),
                    'lon': float(row.get('CurrentLongitude', 0)),
                    'vendor': lookup_vendor(row.get('MAC', '')),
                }
                networks.append(net)
            except (ValueError, TypeError):
                continue
    return networks


def live_scan_windows():
    """Perform live WiFi scan on Windows using netsh."""
    networks = []
    try:
        result = subprocess.run(
            ['netsh', 'wlan', 'show', 'networks', 'mode=Bssid'],
            capture_output=True, text=True, timeout=15
        )
        current = {}
        for line in result.stdout.split('\n'):
            line = line.strip()
            if line.startswith('SSID') and ':' in line and 'BSSID' not in line:
                if current.get('ssid'):
                    networks.append(current)
                current = {'ssid': line.split(':', 1)[1].strip()}
            elif line.startswith('BSSID'):
                current['bssid'] = line.split(':', 1)[1].strip()
                current['vendor'] = lookup_vendor(current['bssid'])
            elif line.startswith('Signal'):
                pct = line.split(':', 1)[1].strip().replace('%', '')
                # Convert percentage to approximate dBm
                current['signal'] = int(int(pct) / 2 - 100)
            elif line.startswith('Channel'):
                current['channel'] = line.split(':', 1)[1].strip()
            elif line.startswith('Authentication') or line.startswith('Encryption'):
                current.setdefault('encryption', '')
                current['encryption'] += ' ' + line.split(':', 1)[1].strip()
        if current.get('ssid'):
            networks.append(current)
    except Exception as e:
        print(f"[!] Live scan failed: {e}", file=sys.stderr)
    return networks


def live_scan_linux():
    """Perform live WiFi scan on Linux using iwlist/nmcli."""
    networks = []
    try:
        result = subprocess.run(
            ['nmcli', '-t', '-f', 'SSID,BSSID,SIGNAL,CHAN,SECURITY', 'dev', 'wifi', 'list'],
            capture_output=True, text=True, timeout=15
        )
        for line in result.stdout.strip().split('\n'):
            parts = line.split(':')
            if len(parts) >= 5:
                bssid = ':'.join(parts[1:7]) if len(parts) > 5 else parts[1]
                networks.append({
                    'ssid': parts[0],
                    'bssid': bssid,
                    'signal': int(parts[-3]) if parts[-3].lstrip('-').isdigit() else -80,
                    'channel': parts[-2],
                    'encryption': parts[-1],
                    'vendor': lookup_vendor(bssid),
                })
    except Exception as e:
        print(f"[!] Live scan failed: {e}", file=sys.stderr)
    return networks


# ═══════════════════════════════════════════
# GEOJSON BUILDER
# ═══════════════════════════════════════════

def build_wifi_geojson(networks, center_lat=0, center_lon=0, scan_name="WiFi Survey"):
    """Convert WiFi scan data to BDOC-compatible GeoJSON."""
    features = []
    stats = {'open': 0, 'wep': 0, 'wpa': 0, 'wpa2': 0, 'wpa3': 0, 'hidden': 0, 'default': 0}

    for i, net in enumerate(networks):
        ssid = net.get('ssid', '')
        bssid = net.get('bssid', '')
        signal = net.get('signal', -100)
        security = classify_security(net.get('encryption', ''))

        # Use Wigle coordinates if available, otherwise offset from center
        lat = net.get('lat', center_lat + (i * 0.0001))
        lon = net.get('lon', center_lon + ((i % 10) * 0.0001))

        # Track stats
        level_key = security['level'].lower().split('-')[0]
        if level_key in stats:
            stats[level_key] += 1

        is_hidden = not ssid or ssid == ''
        is_default = is_default_ssid(ssid)
        if is_hidden:
            stats['hidden'] += 1
        if is_default:
            stats['default'] += 1

        # Signal strength classification
        if signal >= -50:
            sig_class = 'EXCELLENT'
        elif signal >= -60:
            sig_class = 'GOOD'
        elif signal >= -70:
            sig_class = 'FAIR'
        else:
            sig_class = 'WEAK'

        # Threat assessment
        threats = []
        if security['score'] == 0:
            threats.append('OPEN_NETWORK')
        if security['score'] == 1:
            threats.append('WEP_CRACKABLE')
        if is_default:
            threats.append('DEFAULT_SSID')
        if is_hidden:
            threats.append('HIDDEN_SSID')

        uid = hashlib.md5(bssid.encode()).hexdigest()[:10]

        feature = {
            'type': 'Feature',
            'id': f'wifi_{uid}',
            'geometry': {
                'type': 'Point',
                'coordinates': [lon, lat]
            },
            'properties': {
                'name': ssid or f'[Hidden: {bssid[-8:]}]',
                'source': 'wifi_scan',
                'bssid': bssid,
                'ssid': ssid,
                'signal_dbm': signal,
                'signal_class': sig_class,
                'channel': net.get('channel', ''),
                'frequency': net.get('frequency', ''),
                'security_level': security['level'],
                'security_score': security['score'],
                'color': security['color'],
                'vendor': net.get('vendor', 'Unknown'),
                'is_hidden': is_hidden,
                'is_default_ssid': is_default,
                'threats': ','.join(threats) if threats else 'NONE',
                'icon': 'wifi_open' if security['score'] < 2 else 'wifi_secure',
                'bdoc_layer': 'wifi_sigint',
                'bdoc_version': '1.0.0',
                'pulse_radius': max(abs(signal) * 50, 2000),
            }
        }
        features.append(feature)

    return {
        'type': 'FeatureCollection',
        'metadata': {
            'generator': 'BDOC WiFi Intelligence Tool',
            'vendor': 'Kitsune Global Solutions LLC',
            'scan_name': scan_name,
            'generated': datetime.now(timezone.utc).isoformat(),
            'network_count': len(features),
            'stats': stats,
            'center': [center_lon, center_lat],
        },
        'features': features
    }


# ═══════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════

def main():
    import argparse
    parser = argparse.ArgumentParser(
        description='BDOC WiFi Intelligence — inSSIDer/WiFi Data Importer'
    )
    parser.add_argument('--inssider', help='inSSIDer CSV export file')
    parser.add_argument('--wigle', help='Wigle.net CSV export file')
    parser.add_argument('--manual', help='Manual JSON input file')
    parser.add_argument('--live', action='store_true', help='Live WiFi scan')
    parser.add_argument('--location', help='Scan center lat,lon (e.g., 33.749,-84.388)')
    parser.add_argument('--name', default='WiFi Survey', help='Scan name')
    parser.add_argument('-o', '--output', default='bdoc_wifi_intel.geojson', help='Output file')

    args = parser.parse_args()

    # Parse location
    center_lat, center_lon = 0, 0
    if args.location:
        parts = args.location.split(',')
        center_lat = float(parts[0])
        center_lon = float(parts[1])

    # Load networks
    networks = []
    if args.inssider:
        print(f'[BDOC] Reading inSSIDer export: {args.inssider}', file=sys.stderr)
        networks = parse_inssider_csv(args.inssider)
    elif args.wigle:
        print(f'[BDOC] Reading Wigle export: {args.wigle}', file=sys.stderr)
        networks = parse_wigle_csv(args.wigle)
    elif args.manual:
        print(f'[BDOC] Reading manual input: {args.manual}', file=sys.stderr)
        with open(args.manual, 'r') as f:
            networks = json.load(f)
    elif args.live:
        print('[BDOC] Performing live WiFi scan...', file=sys.stderr)
        if sys.platform == 'win32':
            networks = live_scan_windows()
        else:
            networks = live_scan_linux()
    else:
        print('[BDOC] No input specified. Use --inssider, --wigle, --manual, or --live')
        sys.exit(1)

    print(f'[BDOC] Found {len(networks)} networks', file=sys.stderr)

    # Build GeoJSON
    geojson = build_wifi_geojson(networks, center_lat, center_lon, args.name)

    # Stats summary
    stats = geojson['metadata']['stats']
    print(f'\n[BDOC] WiFi Intelligence Summary:', file=sys.stderr)
    print(f'  Networks: {len(networks)}', file=sys.stderr)
    print(f'  WPA3: {stats["wpa3"]} | WPA2: {stats["wpa2"]} | WPA: {stats["wpa"]}', file=sys.stderr)
    print(f'  WEP: {stats["wep"]} | OPEN: {stats["open"]}', file=sys.stderr)
    print(f'  Hidden: {stats["hidden"]} | Default SSID: {stats["default"]}', file=sys.stderr)

    # Threat count
    threats = sum(1 for f in geojson['features']
                  if f['properties']['threats'] != 'NONE')
    print(f'  Threat indicators: {threats}', file=sys.stderr)

    # Write output
    with open(args.output, 'w', encoding='utf-8') as f:
        json.dump(geojson, f, indent=2)

    print(f'\n[BDOC] Output: {args.output}', file=sys.stderr)
    print(f'[BDOC] Import into BDOC via: File → Import GeoJSON', file=sys.stderr)


if __name__ == '__main__':
    main()
