// ============================================================
// gov-alert.js — FEMA national alerts for the BDOC banner (p181).
//
// GET /.netlify/functions/gov-alert
//   -> { ok, checked, national: [...], sources: { public, eas } }
// FEMA's feed sends no CORS header, so the page cannot read it directly. Keyless.
// Free on every plan: this is public safety, not a paid layer.
// The CDN keeps one answer for 20 s, so every open tab shares one call to FEMA.
// gov-alert-tick.mjs uses collect() to send the same alerts as Web Push.
// (c) 2026 Kitsune Global Solutions LLC
// ============================================================
'use strict';
const lib = require('./_lib/ipaws.js');

const UA = 'KitsuneGlobal/BDOC (kgsbdoc.netlify.app)';

async function getText(url, ms, fetchImpl) {
  const r = await fetchImpl(url, {
    headers: { 'User-Agent': UA, Accept: 'application/xml, text/xml, */*' },
    signal: AbortSignal.timeout(ms)
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.text();
}

function why(e) { return String((e && e.message) || e || 'error').slice(0, 80); }

async function collect({ now = Date.now(), fetchImpl = globalThis.fetch } = {}) {
  // "recent" only returns alerts that have not expired, so a wide window costs nothing.
  const since = new Date(now - 6 * 3600e3).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const sources = {};
  const alerts = [];
  const partial = [];

  const [pub, feed] = await Promise.allSettled([
    getText(lib.BASE + '/public/recent/' + since, 8000, fetchImpl),
    getText(lib.BASE + '/feed', 8000, fetchImpl)
  ]);

  if (pub.status === 'fulfilled') {
    try { alerts.push(...lib.parseCap(pub.value)); sources.public = 'ok'; } catch (e) { sources.public = 'parse: ' + why(e); }
  } else sources.public = why(pub.reason);

  if (feed.status === 'fulfilled') {
    sources.eas = 'ok';
    const entries = lib.parseEasFeed(feed.value)
      .filter(en => lib.NATIONAL[en.code] && lib.isEasUrl(en.url) && Date.parse(en.updated) > now - 3600e3)
      .slice(0, 3);
    await Promise.all(entries.map(async (en) => {
      try {
        const caps = lib.parseCap(await getText(en.url, 6000, fetchImpl));
        if (caps.length) { alerts.push(...caps); return; }
      } catch (_) { /* expired or not CAP: fall back to the feed entry */ }
      const p = lib.fromEasEntry(en, now);
      if (p) partial.push(p);
    }));
  } else sources.eas = why(feed.reason);

  return {
    ok: sources.public === 'ok' || sources.eas === 'ok',
    checked: new Date(now).toISOString(),
    national: lib.mergeNational(lib.nationalList(alerts, now).concat(partial)),
    sources
  };
}

exports.collect = collect;

exports.handler = async (event) => {
  const json = { 'Content-Type': 'application/json; charset=utf-8' };
  if (event && event.httpMethod && event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: json, body: JSON.stringify({ error: 'GET only' }) };
  }
  try {
    const out = await collect();
    return {
      statusCode: out.ok ? 200 : 502,
      headers: {
        ...json,
        'Cache-Control': 'public, max-age=10',
        'Netlify-CDN-Cache-Control': out.ok ? 'public, durable, s-maxage=20' : 'public, s-maxage=5'
      },
      body: JSON.stringify(out)
    };
  } catch (e) {
    return { statusCode: 502, headers: { ...json, 'Cache-Control': 'no-store' }, body: JSON.stringify({ ok: false, error: why(e), national: [] }) };
  }
};
