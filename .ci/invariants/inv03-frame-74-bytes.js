// Invariant 3: a frame is exactly 74 bytes at fixed offsets:
//   seq u64 big-endian [0..8) | type u8 [8] | flags u8 [9] | sig ed25519 [10..74)
// No length field, no TLV, no JSON, no runtime negotiation. The signature covers
// the 74 bytes with the sig field zeroed, prefixed by the domain "BDOS-v1".
// DORMANT until frame code exists (a file in relay/, hub/, frame/ or js/home/
// that names the frame). The layout below is also checked against itself.
'use strict';
const files = require('../lib/files');
const { make } = require('../lib/result');

const ID = 'inv03';
const TITLE = 'Frame is exactly 74 bytes, fixed offsets, no length/TLV/JSON';
const LAYOUT = [['seq', 0, 8], ['type', 8, 1], ['flags', 9, 1], ['sig', 10, 64]];
const FRAME_BYTES = 74;
const NAMES_FRAME = /\bFRAME_(LEN|LENGTH|SIZE|BYTES)\b|BDOS-v1|\bframe_len\b|\bFrameLen\b/;
const CONST_RE = /\b(FRAME_(?:LEN|LENGTH|SIZE|BYTES)|frame_len|FrameLen)\b\s*(?::\s*[\w<>]+\s*)?=\s*(\d+)/g;
const BANNED = [
  [/JSON\.parse|serde_json|json\.loads|encoding\/json/, 'parses JSON'],
  [/\btlv\b|varint|protobuf|\bcbor\b|msgpack|bincode/i, 'uses a self-describing / TLV encoding'],
  [/read_?u16|readUInt16|getUint16|u16::from_be_bytes|ReadUint16|length_?prefix/i, 'reads a length field'],
  [/negotiat/i, 'negotiates at runtime'],
];
const SITE_HOME = files.SITE + '/js/home/';

function layoutProblems() {
  let next = 0;
  const out = [];
  for (const [name, off, len] of LAYOUT) {
    if (off !== next) out.push(`layout: ${name} starts at ${off}, expected ${next}`);
    next = off + len;
  }
  if (next !== FRAME_BYTES) out.push(`layout sums to ${next}, not ${FRAME_BYTES}`);
  return out;
}

function run(root) {
  const r = make(ID, TITLE);
  layoutProblems().forEach(r.fail);
  const candidates = files.listFiles(root).filter(f =>
    (f.startsWith('relay/') || f.startsWith('hub/') || f.startsWith('frame/') || f.startsWith(SITE_HOME)) && files.isText(f));
  const frameFiles = candidates.filter(f => NAMES_FRAME.test(files.read(root, f)));
  if (!frameFiles.length) {
    r.dormant('no frame code yet; arms itself when a file names FRAME_LEN or BDOS-v1');
    return r.done();
  }
  for (const f of frameFiles) {
    const text = files.read(root, f);
    for (const m of text.matchAll(CONST_RE))
      if (+m[2] !== FRAME_BYTES) r.fail(`${f}:${files.lineOf(text, m.index)} ${m[1]} = ${m[2]}, must be ${FRAME_BYTES}`);
    for (const [re, what] of BANNED) {
      const m = text.match(re);
      if (m) r.fail(`${f}:${files.lineOf(text, m.index)} frame code ${what}`);
    }
    if (/ed25519/i.test(text) && /verify/i.test(text) && !text.includes('BDOS-v1'))
      r.fail(`${f} verifies signatures without the BDOS-v1 domain prefix`);
  }
  r.note(`checked ${frameFiles.length} frame file(s) against the ${FRAME_BYTES}-byte layout`);
  return r.done();
}

module.exports = { id: ID, title: TITLE, run, LAYOUT, FRAME_BYTES };
