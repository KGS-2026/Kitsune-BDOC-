// p204: compare a presented secret with the expected one in constant time.
// Both sides are hashed first so their lengths never leak through timing either.
const crypto = require('crypto');

function sameSecret(got, want) {
  if (typeof got !== 'string' || typeof want !== 'string' || !want) return false;
  const a = crypto.createHash('sha256').update(got).digest();
  const b = crypto.createHash('sha256').update(want).digest();
  return crypto.timingSafeEqual(a, b);
}

// Admin endpoints accept the key in the `x-admin-key` header (preferred: stays out of
// browser history and access logs) or, for old bookmarks, in ?key=.
function adminKeyFrom(event) {
  const h = (event && event.headers) || {};
  return h['x-admin-key'] || h['X-Admin-Key'] || ((event && event.queryStringParameters) || {}).key || '';
}

module.exports = { sameSecret, adminKeyFrom };
