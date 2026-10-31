#!/usr/bin/env node
// tools/desktop/vendor.js — copies every CDN dependency into electron/vendor
//
// WHY THIS EXISTS: index.html loads Cesium, the auth client and a handful of libraries from
// CDNs. With no internet the desktop app had no globe at all, which is the one moment it
// exists for. electron/main.js redirects those CDN urls here when offline. The bytes are the
// same files at the same pinned versions, so index.html's SRI hashes still pass and the web
// app does not change. Run before electron-builder. The output is gitignored.
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const OUT = path.join(__dirname, '..', '..', 'electron', 'vendor');
const CESIUM = '1.146.0';

// Keep in step with the <script> tags and lazy loaders in index.html.
const FILES = {
  'supabase.min.js': 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.min.js',
  'purify.min.js': 'https://cdnjs.cloudflare.com/ajax/libs/dompurify/3.1.6/purify.min.js',
  'jspdf.umd.min.js': 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/3.0.3/jspdf.umd.min.js',
  'satellite.min.js': 'https://cdnjs.cloudflare.com/ajax/libs/satellite.js/5.0.0/satellite.min.js',
  'mqtt.min.js': 'https://unpkg.com/mqtt@5.16.1/dist/mqtt.min.js',
  'milsymbol.min.js': 'https://cdn.jsdelivr.net/npm/milsymbol@2.2.0/dist/milsymbol.min.js',
  'ne_110m_admin_0_countries.geojson': 'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@v5.1.2/geojson/ne_110m_admin_0_countries.geojson'
};

async function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'files'), { recursive: true });

  for (const [name, url] of Object.entries(FILES)) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
    fs.writeFileSync(path.join(OUT, 'files', name), Buffer.from(await r.arrayBuffer()));
    console.log('ok', name);
  }

  const tmp = fs.mkdtempSync(path.join(os.homedir(), '.bdoc-vendor-'));
  try {
    execSync(`npm pack cesium@${CESIUM} --silent`, { cwd: tmp, stdio: 'inherit' });
    execSync(`tar -xzf cesium-${CESIUM}.tgz package/Build/Cesium`, { cwd: tmp, stdio: 'inherit' });
    fs.cpSync(path.join(tmp, 'package', 'Build', 'Cesium'), path.join(OUT, 'cesium'), { recursive: true });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  for (const need of ['cesium/Cesium.js', 'cesium/Widgets/widgets.css', 'cesium/Assets/Textures/NaturalEarthII/tilemapresource.xml']) {
    if (!fs.existsSync(path.join(OUT, need))) throw new Error('missing ' + need);
  }
  console.log('vendor ready');
}

main().catch((e) => { console.error(e); process.exit(1); });
