// Admin user tools — P109 (2026-08-04)
// Why this exists: Supabase's BUILT-IN email sender is hard-limited (~2 emails/hour,
// best-effort delivery) and is explicitly "not for production". Travon signed up with
// Yahoo and the confirmation email never arrived. Until custom SMTP (Resend) is wired
// in the Supabase dashboard, this function lets us diagnose and manually confirm users.
//
// Security: same gate as export-contacts.js — requires ?key=<ADMIN_EXPORT_KEY>.
// Uses SUPABASE_SERVICE_KEY (service role, server-only).
//
// Usage:
//   .../admin-user?key=ADMIN_KEY&action=status&email=someone@yahoo.com
//   .../admin-user?key=ADMIN_KEY&action=confirm&email=someone@yahoo.com
//
exports.handler = async (event) => {
  const p = event.queryStringParameters || {};
  const adminKey = process.env.ADMIN_EXPORT_KEY;
  if (!adminKey) return resp(503, { error: 'ADMIN_EXPORT_KEY not set' });
  if ((p.key || '') !== adminKey) return resp(403, { error: 'Forbidden' });

  const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ulgxbqhbgbyxlzoyxcus.supabase.co';
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SERVICE_KEY) return resp(503, { error: 'SUPABASE_SERVICE_KEY not set' });

  const email = (p.email || '').trim().toLowerCase();
  const action = p.action || 'status';
  if (!email) return resp(400, { error: 'email param required' });

  const H = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' };

  // Find user via GoTrue admin API
  const q = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=100`, { headers: H });
  if (!q.ok) return resp(502, { error: 'admin users list failed: ' + q.status });
  const data = await q.json();
  const users = data.users || data || [];
  const user = users.find(u => (u.email || '').toLowerCase() === email);
  if (!user) return resp(404, { error: 'no user with that email', total_users: users.length });

  const summary = {
    id: user.id, email: user.email,
    email_confirmed_at: user.email_confirmed_at || null,
    created_at: user.created_at, last_sign_in_at: user.last_sign_in_at || null,
    confirmed: !!user.email_confirmed_at,
  };

  if (action === 'status') return resp(200, summary);

  if (action === 'confirm') {
    if (user.email_confirmed_at) return resp(200, { ...summary, note: 'already confirmed' });
    const upd = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${user.id}`, {
      method: 'PUT', headers: H, body: JSON.stringify({ email_confirm: true }),
    });
    if (!upd.ok) return resp(502, { error: 'confirm failed: ' + upd.status, body: await upd.text() });
    const updated = await upd.json();
    return resp(200, { id: updated.id, email: updated.email, email_confirmed_at: updated.email_confirmed_at, confirmed: true, note: 'manually confirmed — user can now sign in' });
  }

  return resp(400, { error: 'unknown action (use status|confirm)' });
};

function resp(statusCode, obj) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}
