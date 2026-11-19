// Invariant 7: parameters are enforced on the hub. A change from the cloud is a
// request the hub may refuse (POLICY_REJECT); the relay never applies one.
// DORMANT until relay/ or hub/ exists. Then:
//  - relay code has no apply / set / push / force / override of policy, config,
//    parameters, settings or thresholds;
//  - hub policy code says POLICY_REJECT and keeps a last-known-good policy.
'use strict';
const files = require('../lib/files');
const { make } = require('../lib/result');

const ID = 'inv07';
const TITLE = 'Parameters enforced hub-side; cloud changes are requests the hub may reject';
const APPLY_RE = /\b(apply|set|push|force|override|write)_?(hub_?)?(policy|policies|config|configuration|param(?:eter)?s?|settings|thresholds?)\b/i;

function run(root) {
  const r = make(ID, TITLE);
  const home = files.homeSurface(root);
  if (!home.relay.length && !home.hub.length) {
    r.dormant('no relay/ or hub/ yet; arms itself when either appears');
    return r.done();
  }
  for (const f of home.relay) {
    const text = files.read(root, f);
    const m = text.match(APPLY_RE);
    if (m) r.fail(`${f}:${files.lineOf(text, m.index)} relay calls ${m[0]}; send a request the hub can refuse`);
  }
  for (const f of home.hub) {
    const text = files.read(root, f);
    if (!/polic/i.test(f) && !/\bpolicy\b/i.test(text)) continue;
    if (!text.includes('POLICY_REJECT')) r.fail(`${f}: hub policy code never says POLICY_REJECT`);
    if (!/last.?known.?good|\blkg\b/i.test(text)) r.fail(`${f}: hub policy code keeps no last-known-good policy`);
  }
  r.note(`checked ${home.relay.length} relay and ${home.hub.length} hub files`);
  return r.done();
}

module.exports = { id: ID, title: TITLE, run };
