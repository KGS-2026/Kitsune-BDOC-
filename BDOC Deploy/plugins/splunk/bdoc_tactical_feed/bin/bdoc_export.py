#!/usr/bin/env python3
"""
BDOC Tactical Feed — Splunk Export Script
Kitsune Global Solutions LLC

Exports Splunk search results to GeoJSON format compatible with BDOC globe.
Can push to BDOC instance via API or write to local file for manual import.

Usage (from Splunk):
    | map search="| savedsearch 'BDOC - Threat Events (Last 24h)'" | script python bdoc_export.py

Usage (standalone):
    python bdoc_export.py --input results.csv --output bdoc_threats.geojson
    python bdoc_export.py --input results.csv --push https://kgsbdoc.netlify.app/api/ingest
"""

import sys
import os
import json
import csv
import time
import hashlib
from datetime import datetime, timezone

# Splunk SDK import (available in Splunk Python environment)
try:
    import splunklib.results as results
    SPLUNK_ENV = True
except ImportError:
    SPLUNK_ENV = False


def severity_to_color(level):
    """Map threat severity to BDOC color scheme."""
    colors = {
        5: '#ff2d2d',  # CRITICAL — red
        4: '#ff6b35',  # HIGH — orange-red
        3: '#c4933f',  # MEDIUM — amber
        2: '#5b8cc9',  # LOW — blue
        1: '#4a8a5a',  # INFO — green
    }
    return colors.get(int(level), '#7a8194')


def category_to_icon(cat):
    """Map event category to BDOC marker type."""
    icons = {
        'INTRUSION': 'skull',
        'FIREWALL': 'shield',
        'PROXY': 'filter',
        'MALWARE': 'biohazard',
        'PORT_SCAN': 'radar',
        'FLOOD': 'wave',
        'EXFIL': 'upload',
        'BRUTE_FORCE': 'key',
        'APT': 'crosshair',
        'ANOMALY': 'alert',
    }
    return icons.get(cat, 'dot')


def build_geojson(events):
    """Convert enriched Splunk events to GeoJSON FeatureCollection."""
    features = []

    for evt in events:
        lat = evt.get('lat')
        lon = evt.get('lon')
        if not lat or not lon:
            continue

        try:
            lat = float(lat)
            lon = float(lon)
        except (ValueError, TypeError):
            continue

        # Build unique ID from source IP + time
        raw_id = f"{evt.get('src_ip', 'unknown')}_{evt.get('_time', time.time())}"
        uid = hashlib.md5(raw_id.encode()).hexdigest()[:12]

        severity = int(evt.get('threat_level', evt.get('severity', 2)))
        category = evt.get('category', evt.get('anomaly_type', 'GENERAL'))
        event_count = int(evt.get('event_count', evt.get('fail_count', 1)))

        feature = {
            'type': 'Feature',
            'id': uid,
            'geometry': {
                'type': 'Point',
                'coordinates': [lon, lat]
            },
            'properties': {
                'name': f"{category}: {evt.get('src_ip', 'Unknown')}",
                'source': 'splunk',
                'category': category,
                'icon': category_to_icon(category),
                'severity': severity,
                'color': severity_to_color(severity),
                'src_ip': evt.get('src_ip', ''),
                'dest_ip': evt.get('dest_ip', ''),
                'country': evt.get('Country', ''),
                'city': evt.get('City', ''),
                'event_count': event_count,
                'actions': evt.get('actions', ''),
                'apt_group': evt.get('apt_group', ''),
                'malware_family': evt.get('malware_family', ''),
                'timestamp': evt.get('_time', datetime.now(timezone.utc).isoformat()),
                'last_seen': evt.get('last_seen', ''),
                'bdoc_layer': 'splunk_threats',
                'bdoc_version': '1.0.0',
                'pulse_radius': min(max(event_count * 100, 5000), 200000),
            }
        }
        features.append(feature)

    return {
        'type': 'FeatureCollection',
        'metadata': {
            'generator': 'BDOC Tactical Feed for Splunk',
            'vendor': 'Kitsune Global Solutions LLC',
            'generated': datetime.now(timezone.utc).isoformat(),
            'event_count': len(features),
        },
        'features': features
    }


def read_csv_input(filepath):
    """Read Splunk CSV export."""
    events = []
    with open(filepath, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            events.append(dict(row))
    return events


def read_stdin():
    """Read piped Splunk results from stdin."""
    events = []
    reader = csv.DictReader(sys.stdin)
    for row in reader:
        events.append(dict(row))
    return events


def push_to_bdoc(geojson, endpoint):
    """POST GeoJSON to BDOC ingest API."""
    import urllib.request
    data = json.dumps(geojson).encode('utf-8')
    req = urllib.request.Request(
        endpoint,
        data=data,
        headers={
            'Content-Type': 'application/json',
            'X-BDOC-Source': 'splunk',
            'X-BDOC-Version': '1.0.0',
        },
        method='POST'
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, resp.read().decode()
    except Exception as e:
        return 0, str(e)


def main():
    import argparse
    parser = argparse.ArgumentParser(description='BDOC Tactical Feed — Splunk Export')
    parser.add_argument('--input', '-i', help='CSV input file (Splunk export)')
    parser.add_argument('--output', '-o', default='bdoc_threats.geojson', help='GeoJSON output file')
    parser.add_argument('--push', help='BDOC API endpoint to push results to')
    parser.add_argument('--stdin', action='store_true', help='Read from stdin (Splunk pipe mode)')

    args = parser.parse_args()

    # Read events
    if args.stdin or (not args.input and not sys.stdin.isatty()):
        events = read_stdin()
    elif args.input:
        events = read_csv_input(args.input)
    else:
        print('[BDOC] No input specified. Use --input FILE or --stdin', file=sys.stderr)
        sys.exit(1)

    print(f'[BDOC] Processing {len(events)} events...', file=sys.stderr)

    # Convert to GeoJSON
    geojson = build_geojson(events)
    print(f'[BDOC] Generated {len(geojson["features"])} geolocated features', file=sys.stderr)

    # Output
    if args.push:
        status, body = push_to_bdoc(geojson, args.push)
        print(f'[BDOC] Push to {args.push}: HTTP {status}', file=sys.stderr)
        if status != 200:
            print(f'[BDOC] Response: {body}', file=sys.stderr)
    else:
        with open(args.output, 'w', encoding='utf-8') as f:
            json.dump(geojson, f, indent=2)
        print(f'[BDOC] Wrote {args.output}', file=sys.stderr)


if __name__ == '__main__':
    main()
