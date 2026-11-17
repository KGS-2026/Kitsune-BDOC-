// Invariant 8: model artifacts load by commit SHA + hash + signature only.
// DORMANT until home code (relay/, hub/, js/home/) refers to a model. Then:
//  - no moving reference (:latest, /resolve/main/, @main, a branch path);
//  - a JSON manifest entry that names a model carries a 40-hex commit, a 64-hex
//    sha256 and a signature;
//  - other code loads models through that manifest, not by URL.
// (The desktop app's offline AI pulls Ollama models by tag; that is outside the
// home module and is logged in HANDOFF, not checked here.)
'use strict';
const files = require('../lib/files');
const { make } = require('../lib/result');

const ID = 'inv08';
const TITLE = 'Model artifacts load by commit SHA + hash + signature only';
const MODEL_RE = /\.(onnx|tflite|gguf|safetensors|pth?|ckpt|engine|rknn|hef)\b|from_pretrained\(|ollama\s+(pull|run)|huggingface\.co\/|\bhf\.co\//i;
const MOVING_RE = /:latest\b|\/resolve\/(main|master)\/|@(main|master)\b|\/(main|master)\/[^\s"']+\.(onnx|tflite|gguf|safetensors|pth?)/i;

function manifestProblems(f, json) {
  const out = [];
  const visit = (node, at) => {
    if (Array.isArray(node)) return node.forEach((x, i) => visit(x, `${at}[${i}]`));
    if (!node || typeof node !== 'object') return;
    const refs = Object.values(node).some(v => typeof v === 'string' && MODEL_RE.test(v));
    if (refs) {
      if (!/^[0-9a-f]{40}$/i.test(node.commit || '')) out.push(`${f} ${at}: model entry without a 40-hex commit`);
      if (!/^[0-9a-f]{64}$/i.test(node.sha256 || '')) out.push(`${f} ${at}: model entry without a sha256`);
      if (!node.signature) out.push(`${f} ${at}: model entry without a signature`);
    }
    for (const [k, v] of Object.entries(node)) if (v && typeof v === 'object') visit(v, `${at}.${k}`);
  };
  visit(json, '$');
  return out;
}

function run(root) {
  const r = make(ID, TITLE);
  const home = files.homeSurface(root);
  const scope = [...home.relay, ...home.hub, ...home.client];
  const refs = scope.filter(f => MODEL_RE.test(files.read(root, f)));
  if (!refs.length) {
    r.dormant('no home code refers to a model yet; arms itself when one does');
    return r.done();
  }
  for (const f of refs) {
    const text = files.read(root, f);
    const mv = text.match(MOVING_RE);
    if (mv) r.fail(`${f}:${files.lineOf(text, mv.index)} moving model reference "${mv[0]}"`);
    if (/\.json$/i.test(f)) {
      let json;
      try { json = JSON.parse(text); } catch (_) { r.fail(`${f}: model manifest is not valid JSON`); continue; }
      manifestProblems(f, json).forEach(r.fail);
    } else {
      text.split('\n').forEach((line, i) => {
        if (MODEL_RE.test(line) && !/manifest/i.test(line) && !/[0-9a-f]{64}/i.test(line))
          r.fail(`${f}:${i + 1} loads a model outside the pinned manifest`);
      });
    }
  }
  r.note(`checked ${refs.length} file(s) that refer to models`);
  return r.done();
}

module.exports = { id: ID, title: TITLE, run };
