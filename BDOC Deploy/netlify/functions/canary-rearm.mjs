// BDOC p205: re-arm the site canary once a day.
// After a canary hit the Healthchecks check HC_SITE_CANARY is DOWN, and a DOWN check doesn't
// alert again. This OK ping turns it back UP so the next hit pages Travon again. If this
// function ever stops running, the check goes DOWN on its own ("canary not re-armed"), which
// is also worth knowing. Check schedule: period 1 day, grace 2 hours.
export default async () => {
  const hc = process.env.HC_SITE_CANARY;
  if (!hc) return new Response('HC_SITE_CANARY not set', { status: 200 });
  try {
    await fetch(hc.replace(/\/$/, ''), { method: 'POST', body: 're-armed (daily)', signal: AbortSignal.timeout(5000) });
  } catch (e) {
    console.log('canary re-arm ping failed:', e && e.message);
  }
  return new Response('ok', { status: 200 });
};

export const config = { schedule: '17 9 * * *' };
