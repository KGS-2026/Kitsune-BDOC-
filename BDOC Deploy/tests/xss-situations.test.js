// Regression guard for the SituationManager XSS (found during the AI-recon
// pass, 2026-10-23). sit.title/author/region/details/intel/activity were
// interpolated straight into innerHTML with no esc(). Safe today only because
// the data is static demo content — the SSP flags that the moment a real
// `situations` table feeds this, it becomes stored XSS through the InfoBox
// iframe chain (which still runs with allow-scripts + allow-same-origin).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

// Isolate the renderDetail-style block that builds spBody's innerHTML.
const start = html.indexOf("el.innerHTML=`<div class=\"sd-back\"");
assert.ok(start > 0, 'SituationManager detail render block not found — did it move?');
const end = html.indexOf('\n', html.indexOf('_drawArcs(sit)', start));
const block = html.slice(start, end);

const FIELDS = ['title', 'author', 'region', 'details', 'intel', 'activity'];

for (const f of FIELDS) {
  test(`SituationManager sit.${f} is escaped before innerHTML`, () => {
    assert.ok(
      block.includes(`esc(sit.${f})`),
      `sit.${f} is interpolated without esc() — stored XSS once situations are DB-backed`
    );
    // Also make sure the UNESCAPED form isn't still present somewhere else
    // in the same block (e.g. a duplicate interpolation).
    const bareForm = '${sit.' + f + '}';
    assert.ok(!block.includes(bareForm), `found a bare \${sit.${f}} still in the block`);
  });
}

test('esc() itself strips the five HTML metacharacters', () => {
  const m = html.match(/function esc\(s\)\{([^}]+)\}/);
  assert.ok(m, 'esc() definition not found');
  // crude but sufficient: confirm all five escapes are present in its body
  for (const ch of ['&amp;', '&lt;', '&gt;', '&quot;', '&#39;']) {
    assert.ok(m[1].includes(ch), `esc() is missing the ${ch} replacement`);
  }
});

test('SituationManager list cards escape title/region', () => {
  const i = html.indexOf('_sits.map(s=>`<div class="sit-card');
  assert.ok(i > 0, 'situation list render not found');
  const row = html.slice(i, html.indexOf('\n', i));
  assert.ok(row.includes('${esc(s.title)}') && row.includes('${esc(s.region)}'));
  assert.ok(!row.includes('${s.title}') && !row.includes('${s.region}'));
});
