// p200 (T200): one result shape for all twelve invariant checks.
//   PASS     armed, and the code it guards is clean
//   WARN     armed and clean, but an allowlisted exception is open or unsigned
//   DORMANT  the code it guards does not exist yet; the rule arms itself when it does
//   FAIL     a violation (any finding wins over every other state)
'use strict';

function make(id, title) {
  const r = { id, title, status: 'PASS', findings: [], notes: [] };
  let dormant = false, warn = false;
  return {
    fail: msg => { r.findings.push(msg); },
    note: msg => { r.notes.push(msg); },
    warn: msg => { warn = true; r.notes.push(msg); },
    dormant: why => { dormant = true; r.notes.push(why); },
    done: () => {
      r.status = r.findings.length ? 'FAIL' : dormant ? 'DORMANT' : warn ? 'WARN' : 'PASS';
      return r;
    },
  };
}

module.exports = { make };
