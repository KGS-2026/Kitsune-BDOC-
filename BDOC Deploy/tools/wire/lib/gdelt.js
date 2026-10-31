// ============================================================
// wire/gdelt — GDELT GKG 15-minute ingestion
// ============================================================
// WHY THIS EXISTS
// GDELT sees local outlets in every country that no RSS list here will ever cover, and
// it comes with real coordinates. The search API answers 429 from datacenter IPs
// (see the 2026-10-28 note in proxy-gdelt.js), but the raw 15-minute GKG files on
// storage.googleapis.com are not rate limited. So this reads the files.
//
// PORTED FROM netlify/functions/proxy-gdelt.js: the unzip, the column positions and
// bestLoc(). Keep them in step. Col 10 is V2Locations with lat at index 5; col 9 is V1,
// where lat sits at index 4 and the two must not be mixed up. <PAGE_TITLE> is in col 26.
//
// DESIGN NOTES
// - lastupdate.txt starts on plain http (it 301s to https), so nothing is trusted from
//   it but a 14-digit stamp. The zip itself comes over https from a fixed host.
// - A file is 6 to 9 MB zipped and about 20 MB inflated, every 15 minutes. Inflating is
//   async so it does not freeze the event loop, and rows are found by indexOf so the
//   whole file is not split into an array of lines.
// - The title is tested first, and a miss costs one indexOf. Only a hit pays for
//   splitting the row into columns.
// - The first file after a restart is flagged firstPoll. It is still fresh, so without
//   the flag a restart could corroborate a story and page someone (ground rule 5).

'use strict';

const zlib = require('zlib');
const { promisify } = require('util');
const { UA } = require('./sources');
const { cleanText, domainOf, log, ownItem, safeUrl } = require('./util');

const inflateRaw = promisify(zlib.inflateRaw);

const LAST_UPDATE_URL = 'http://data.gdeltproject.org/gdeltv2/lastupdate.txt';
const GKG_BASE = 'https://storage.googleapis.com/data.gdeltproject.org/gdeltv2/';
const POLL_MS = 120000;
const MAX_ROWS = 200;
const ZIP_MAX = 64 * 1024 * 1024;
const CSV_MAX = 256 * 1024 * 1024; // the unit has MemoryMax=600M; a bad zip must not kill it
const LASTUPDATE_TIMEOUT_MS = 15000;
const ZIP_TIMEOUT_MS = 60000;
const QUARTER = 15 * 60000;

// Not a fixed publishing schedule, so a little over two cycles before we call it dead.
const STALE_MS = 35 * 60000;

// Honest radius by precision, same doctrine as the gazetteer in proxy-newsgeo.js: a
// country match is a centroid and must not look like a pin.
const RADIUS_BY_SCORE = { 1: 400000, 2: 120000, 3: 15000 };

// V2Locations (col 10): type#name#cc#adm1#adm2#lat#lon#fid#offset;…
// type 1 = country, 2 = state, 3+ = city or landmark. Most precise wins.
function bestLoc(v2) {
  let best = null;
  for (const l of String(v2).split(';')) {
    const p = l.split('#');
    if (p.length < 9) continue;
    const t = parseInt(p[0], 10) || 0;
    const lat = parseFloat(p[5]);
    const lon = parseFloat(p[6]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const score = t >= 3 ? 3 : t;
    if (!best || score > best.score) best = { score, name: p[1], cc: p[2], lat, lon };
    if (best.score === 3) break;
  }
  return best;
}

// First entry of a zip. Local-header sizes are 0 when the writer streamed the file, so
// the central directory is the fallback rather than failing on an empty slice.
async function unzipFirst(buf) {
  if (buf.length < 30 || buf.readUInt32LE(0) !== 0x04034b50) throw new Error('not a zip');
  const flags = buf.readUInt16LE(6);
  const method = buf.readUInt16LE(8);
  let compSize = buf.readUInt32LE(18);
  const nameLen = buf.readUInt16LE(26);
  const extraLen = buf.readUInt16LE(28);
  const start = 30 + nameLen + extraLen;
  if (flags & 0x08 && !compSize) {
    const dir = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    if (dir < 0) throw new Error('zip: no central directory');
    compSize = buf.readUInt32LE(dir + 20);
  }
  const data = buf.subarray(start, start + compSize);
  if (method === 0) return data;
  if (method !== 8) throw new Error('zip: unsupported method ' + method);
  return inflateRaw(data, { maxOutputLength: CSV_MAX });
}

// GKG stamps are UTC in 15-minute steps, and a file appears 15 to 25 minutes late.
function clockStamp(now) {
  const t = now - 30 * 60000;
  const d = new Date(t - (t % QUARTER));
  const p = (x) => String(x).padStart(2, '0');
  return '' + d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + p(d.getUTCHours()) + p(d.getUTCMinutes()) + '00';
}

function stampMs(s) {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(String(s));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
}

function rowsFrom(csv, prefilter, first) {
  const out = [];
  const seen = new Set();
  let total = 0;
  let hits = 0;
  let start = 0;
  let open = csv.indexOf('<PAGE_TITLE>');
  while (start < csv.length) {
    let end = csv.indexOf('\n', start);
    if (end < 0) end = csv.length;
    // Only search again once past the last match, or a file with few titles goes
    // quadratic: every row would rescan the distance to the same far-off tag.
    if (open >= 0 && open < start) open = csv.indexOf('<PAGE_TITLE>', start);
    let title = '';
    if (open >= 0 && open < end) {
      const close = csv.indexOf('</PAGE_TITLE>', open);
      if (close > open && close < end) title = csv.slice(open + 12, close).trim();
    }
    total++;
    const line = start;
    start = end + 1;
    if (!title || !prefilter(title)) continue;
    hits++;
    if (out.length >= MAX_ROWS) continue;

    const c = csv.slice(line, end).split('\t');
    if (c.length < 27) continue;
    const u = safeUrl(c[4]); // col 2 other than web means col 4 is not a url at all
    if (!u || seen.has(u)) continue;
    seen.add(u);
    const h = cleanText(title, 240);
    if (!h) continue;

    const raw = {
      sid: 'gdelt',
      sn: cleanText(c[3], 80) || 'GDELT',
      cls: 'aggregator',
      guid: c[0] || u,
      h,
      x: '',
      u,
      pt: stampMs(c[1]),
      pub: domainOf(c[3]) || domainOf(u),
      firstPoll: !!first,
      off: false
    };
    const loc = bestLoc(c[10] || '');
    if (loc) {
      raw.geo = { p: cleanText(loc.name, 120), lat: loc.lat, lon: loc.lon, r: RADIUS_BY_SCORE[loc.score] || 400000 };
      // GKG uses FIPS country codes (RS is Russia, UK not GB). Only US means the same
      // thing in both systems, and it is the only one anything here reads.
      if (loc.cc === 'US') raw.geo.cc = 'US';
    }
    out.push(ownItem(raw)); // the worst leak of all: these slices pin the whole decompressed file
  }
  return { raws: out, total, hits };
}

class Gdelt {
  constructor(opts) {
    const o = opts || {};
    this.prefilter = o.prefilter || (() => false);
    this.onItems = o.onItems || (() => {});
    this.fetchImpl = o.fetchImpl || ((url, init) => globalThis.fetch(url, init));
    this.now = o.now || Date.now;
    this.pollMs = o.pollMs || POLL_MS;

    this.running = false;
    this.first = true;
    this.lastStamp = null;
    this.lastEvent = null;
    this.lastErr = null;
    this.err = null;
    this.rows = 0;
    this.hits = 0;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._loop = this._run();
  }

  async stop() {
    this.running = false;
    clearTimeout(this._timer);
    if (this._wake) this._wake();
    await this._loop;
  }

  status() {
    const fresh = this.lastEvent != null && this.now() - this.lastEvent < STALE_MS;
    return {
      ok: fresh && !this.err,
      lastEvent: this.lastEvent,
      stamp: this.lastStamp,
      rows: this.rows,
      hits: this.hits,
      err: this.err
    };
  }

  async _run() {
    while (this.running) {
      await this.pollOnce();
      if (!this.running) break;
      await new Promise((resolve) => {
        this._wake = resolve;
        this._timer = setTimeout(resolve, this.pollMs);
      });
    }
  }

  async _get(url, timeoutMs) {
    const res = await this.fetchImpl(url, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res;
  }

  async _stamp() {
    try {
      const res = await this._get(LAST_UPDATE_URL, LASTUPDATE_TIMEOUT_MS);
      const m = /(\d{14})\.gkg\.csv\.zip/.exec(await res.text());
      if (m) return m[1];
    } catch (e) {
      log('warn', 'gdelt lastupdate failed, using the clock', { err: e });
    }
    return clockStamp(this.now()); // the files are served even when the index is not
  }

  // One poll. Never throws: a bad file is a status line, not a dead daemon.
  async pollOnce() {
    try {
      const stamp = await this._stamp();
      if (stamp === this.lastStamp) return [];
      const res = await this._get(GKG_BASE + stamp + '.gkg.csv.zip', ZIP_TIMEOUT_MS);
      const zip = Buffer.from(await res.arrayBuffer());
      if (zip.length > ZIP_MAX) throw new Error('zip too large');
      const csv = (await unzipFirst(zip)).toString('utf8');
      const hit = (title) => {
        try { return !!this.prefilter(title); } catch (_) { return false; }
      };
      const { raws, total, hits } = rowsFrom(csv, hit, this.first);
      if (raws.length) await this.onItems(raws);
      this.first = false;
      this.lastStamp = stamp;
      this.lastEvent = this.now();
      this.rows = total;
      this.hits = hits;
      this.err = null;
      log('info', 'gdelt file', { stamp, rows: total, hits, emitted: raws.length });
      return raws;
    } catch (e) {
      this.err = e && e.message ? e.message.slice(0, 200) : String(e);
      this.lastErr = this.now();
      log('warn', 'gdelt poll failed', { err: this.err });
      return [];
    }
  }
}

module.exports = { Gdelt, bestLoc, unzipFirst, clockStamp, rowsFrom, MAX_ROWS };
