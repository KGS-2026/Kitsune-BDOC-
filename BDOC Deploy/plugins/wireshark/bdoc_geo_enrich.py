#!/usr/bin/env python3
"""
BDOC Geo-Enrichment Script for Wireshark Exports
Kitsune Global Solutions LLC — SDVOSB · CAGE: 174S8

Takes the GeoJSON output from the Wireshark Lua plugin and enriches
IP addresses with geolocation data using free APIs.

Usage:
    python bdoc_geo_enrich.py bdoc_wireshark_export.geojson
    python bdoc_geo_enrich.py input.geojson -o enriched.geojson

Geolocation Sources (no API key required):
    - ip-api.com (free, 45 req/min)
    - ipapi.co (free, 1000/day)
"""

import json
import sys
import time
import urllib.request
import urllib.error


def geolocate_ip(ip_addr):
    """Geolocate an IP using ip-api.com (free, no key needed)."""
    url = f"http://ip-api.com/json/{ip_addr}?fields=status,country,city,lat,lon,isp,org,as"
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'BDOC-GeoEnrich/1.0'})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())
            if data.get('status') == 'success':
                return {
                    'lat': data['lat'],
                    'lon': data['lon'],
                    'country': data.get('country', ''),
                    'city': data.get('city', ''),
                    'isp': data.get('isp', ''),
                    'org': data.get('org', ''),
                    'asn': data.get('as', ''),
                }
    except Exception as e:
        print(f"  [!] GeoIP failed for {ip_addr}: {e}", file=sys.stderr)
    return None


def enrich_geojson(input_path, output_path):
    """Read GeoJSON, geolocate IPs, write enriched output."""
    with open(input_path, 'r', encoding='utf-8') as f:
        geojson = json.load(f)

    features = geojson.get('features', [])
    total = len(features)
    enriched = 0
    failed = 0

    print(f"[BDOC] Enriching {total} features with geolocation...", file=sys.stderr)

    for i, feature in enumerate(features):
        props = feature.get('properties', {})
        ip = props.get('name', '')

        if not props.get('needs_geolocation', False):
            continue

        # Rate limit: ip-api.com allows 45/min
        if i > 0 and i % 40 == 0:
            print(f"  [*] Rate limit pause (45/min)... {i}/{total}", file=sys.stderr)
            time.sleep(62)

        geo = geolocate_ip(ip)
        if geo:
            feature['geometry']['coordinates'] = [geo['lon'], geo['lat']]
            props['country'] = geo['country']
            props['city'] = geo['city']
            props['isp'] = geo['isp']
            props['org'] = geo['org']
            props['asn'] = geo['asn']
            props['needs_geolocation'] = False
            enriched += 1
        else:
            failed += 1

        if (i + 1) % 10 == 0:
            print(f"  [{i+1}/{total}] Enriched: {enriched}, Failed: {failed}", file=sys.stderr)

    # Update metadata
    geojson.setdefault('metadata', {})
    geojson['metadata']['geolocation_enriched'] = True
    geojson['metadata']['enriched_count'] = enriched
    geojson['metadata']['failed_count'] = failed

    # Remove features with no geolocation
    geojson['features'] = [
        f for f in features
        if f['geometry']['coordinates'] != [0, 0]
    ]

    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(geojson, f, indent=2)

    print(f"\n[BDOC] Complete: {enriched} enriched, {failed} failed, "
          f"{len(geojson['features'])} total features", file=sys.stderr)
    print(f"[BDOC] Output: {output_path}", file=sys.stderr)


def main():
    if len(sys.argv) < 2:
        print("Usage: python bdoc_geo_enrich.py <input.geojson> [-o output.geojson]")
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = input_path.replace('.geojson', '_enriched.geojson')

    if '-o' in sys.argv:
        idx = sys.argv.index('-o')
        if idx + 1 < len(sys.argv):
            output_path = sys.argv[idx + 1]

    enrich_geojson(input_path, output_path)


if __name__ == '__main__':
    main()
