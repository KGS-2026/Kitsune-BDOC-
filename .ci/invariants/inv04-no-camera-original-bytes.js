// Invariant 4: no camera-original bytes reach the app. The hub re-encodes,
// strips metadata and names the files itself.
// DORMANT until relay/ or js/home/ exists. Then a tripwire (the real proof is
// the T212 normalizer gate):
//  - no camera protocols or camera endpoint paths in relay or home-client code;
//  - no download filename taken from the request;
//  - an image endpoint names its objects by ULID (the normalizer's own names).
'use strict';
const files = require('../lib/files');
const { make } = require('../lib/result');

const ID = 'inv04';
const TITLE = 'No camera-original bytes reach the app (hub re-encodes, owns names)';
const CAMERA_RE = /\b(rtsps?|rtmp|onvif):\/\/|\/ISAPI\/|snapshot\.cgi|\/cgi-bin\/|video\.mjpg|\/axis-cgi\/|:554\b|\bonvif\b/i;
const FILENAME_FROM_INPUT = /Content-Disposition[^\n]*(\$\{|\+\s*(req|event|e|body|params|query)\b)/i;
const ULID_MARK = /\[0-9A-HJKMNP-TV-Z\]\{26\}|\bulid\b/i;

function run(root) {
  const r = make(ID, TITLE);
  const home = files.homeSurface(root);
  if (!home.relay.length && !home.client.length) {
    r.dormant('no relay/ or js/home/ yet; arms itself when either appears');
    return r.done();
  }
  for (const f of [...home.relay, ...home.client]) {
    const text = files.read(root, f);
    const cam = text.match(CAMERA_RE);
    if (cam) r.fail(`${f}:${files.lineOf(text, cam.index)} camera endpoint "${cam[0]}": only the hub may talk to cameras`);
    const fn = text.match(FILENAME_FROM_INPUT);
    if (fn && f.startsWith('relay/')) r.fail(`${f}:${files.lineOf(text, fn.index)} download name comes from the request; the normalizer owns names`);
  }
  for (const f of home.relay.filter(f => /image/i.test(f.slice(f.lastIndexOf('/') + 1))))
    if (!ULID_MARK.test(files.read(root, f))) r.fail(`${f} serves images without ULID object names`);
  r.note(`checked ${home.relay.length} relay and ${home.client.length} home-client files`);
  return r.done();
}

module.exports = { id: ID, title: TITLE, run };
