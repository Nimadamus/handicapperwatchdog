// End to end against a running dev server (backend/dev.mjs), acting like a browser: cookies, Origin header,
// redirects through the fake Stripe pages, then decrypting Pro data exactly as pro.js does.
//   node backend/e2e.mjs http://127.0.0.5:8150
import assert from 'node:assert/strict';

const BASE = process.argv[2] || 'http://localhost:8150';
let cookie = '';
const results = [];
async function req(path, opts = {}) {
  const r = await fetch(BASE + path, { redirect: 'manual', ...opts, headers: { ...(cookie ? { cookie } : {}), ...(opts.method === 'POST' ? { origin: BASE, 'content-type': 'application/json' } : {}), ...(opts.headers || {}) } });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = /Max-Age=0/.test(sc) ? '' : sc.split(';')[0];
  return r;
}
const j = async (path, opts) => { const r = await req(path, opts); return { status: r.status, body: await r.json() }; };
async function step(name, fn) { try { await fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name + ': ' + e.message]); } }
async function decrypt(file, id) {
  const k = await j('/api/pro/key?id=' + id);
  if (k.status !== 200) throw new Error('key ' + k.status);
  const raw = Buffer.from((await (await req(file)).text()).trim(), 'base64');
  const key = await crypto.subtle.importKey('raw', Buffer.from(k.body.key, 'base64'), 'AES-GCM', false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.subarray(0, 12) }, key, raw.subarray(12));
  return JSON.parse(new TextDecoder().decode(plain));
}
async function portal(act) {
  const p = await j('/api/portal', { method: 'POST', body: '{}' });
  assert.equal(p.status, 200);
  const r = await req(new URL(p.body.url).pathname + new URL(p.body.url).search + '&act=' + act);
  assert.equal(r.status, 303);
  return (await j('/api/me')).body;
}

const idx = await (await req('/data/index.json')).json();
const withProfile = idx.cappers.filter((c) => c.profile);
const target = withProfile[0];

await step('pages load (home, rankings, profile, pricing, account, compare, terms, privacy)', async () => {
  for (const p of ['/', '/cappers.html', '/capper.html?id=' + target.id, '/pricing.html', '/account.html', '/compare.html', '/terms.html', '/privacy.html']) {
    const r = await req(p); assert.equal(r.status, 200, p);
    const h = await r.text(); assert.ok(h.includes('pro.js'), p + ' loads pro.js');
    assert.ok(!/trustmyrecord|tmr pro/i.test(h), p + ' has no TMR branding');
  }
});
await step('anonymous: free, no Pro key, encrypted files unreadable without key', async () => {
  const me = await j('/api/me'); assert.equal(me.body.pro, false); assert.equal(me.body.billing, true);
  assert.equal((await j('/api/pro/key?id=' + target.id)).status, 401);
  const blob = await (await req('/data/x/' + target.id + '.bin')).text();
  assert.ok(!/handle|picks|http/i.test(Buffer.from(blob, 'base64').toString('latin1')), 'ciphertext only');
});
let sid;
await step('checkout monthly -> fake Stripe pay -> webhook -> success page signs in as Pro', async () => {
  const c = await j('/api/checkout', { method: 'POST', body: JSON.stringify({ plan: 'monthly' }) });
  assert.equal(c.status, 200);
  const u = new URL(c.body.url); sid = u.searchParams.get('s');
  const pay = await req(u.pathname + '?s=' + sid + '&pay=1&email=e2e@example.com');
  assert.equal(pay.status, 303);
  const loc = new URL(pay.headers.get('location'));
  assert.equal(loc.pathname, '/account.html');
  const done = await j('/api/checkout/complete?session_id=' + loc.searchParams.get('session_id'));
  assert.equal(done.status, 200); assert.equal(done.body.pro, true);
  const me = await j('/api/me'); assert.equal(me.body.plan, 'monthly'); assert.equal(me.body.email, 'e2e@example.com');
});
await step('Pro: capper file decrypts to a handle and a pick log that matches the public profile', async () => {
  const d = await decrypt('/data/x/' + target.id + '.bin', target.id);
  assert.ok(d.handle && d.handle.length > 1);
  const pub = await (await req('/data/p/' + target.id + '.json')).json();
  assert.equal(d.picks.length, pub.overview.picks, 'pick log size equals graded picks');
  const w = d.picks.filter((p) => p.result === 'won').length, l = d.picks.filter((p) => p.result === 'lost').length;
  assert.deepEqual([w, l], [pub.overview.w, pub.overview.l]);
  const net = d.picks.reduce((a, p) => a + (+p.pl || 0), 0);
  assert.ok(Math.abs(net - pub.overview.net) < 0.05, 'units match');
});
await step('Pro: names index decrypts and covers every board row', async () => {
  const n = await decrypt('/data/x/names.bin', 'names');
  const ids = new Set(n.map((x) => x[0]));
  assert.ok(idx.cappers.every((c) => ids.has(c.id)));
});
await step('second checkout refused while Pro', async () => {
  assert.equal((await j('/api/checkout', { method: 'POST', body: JSON.stringify({ plan: 'annual' }) })).status, 409);
});
await step('portal: cancel at period end keeps Pro', async () => { const me = await portal('cancel'); assert.equal(me.pro, true); assert.equal(me.cancel_at_period_end, true); });
await step('portal: resume', async () => { const me = await portal('resume'); assert.equal(me.cancel_at_period_end, false); assert.equal(me.pro, true); });
await step('failed renewal: past_due keeps Pro in grace and flags payment', async () => { const me = await portal('fail'); assert.equal(me.status, 'past_due'); assert.equal(me.pro, true); assert.equal(me.payment_failed, true); });
await step('successful renewal clears the failure', async () => { const me = await portal('renew'); assert.equal(me.status, 'active'); assert.equal(me.payment_failed, false); });
await step('subscription ended: Pro removed, key refused', async () => {
  const me = await portal('end'); assert.equal(me.pro, false);
  assert.equal((await j('/api/pro/key?id=' + target.id)).status, 402);
});
await step('sign out, then email link sign in restores the account', async () => {
  await j('/api/logout', { method: 'POST', body: '{}' });
  assert.equal((await j('/api/me')).body.signed_in, false);
  const l = await j('/api/login', { method: 'POST', body: JSON.stringify({ email: 'e2e@example.com' }) });
  const tok = new URL(l.body.dev_link).searchParams.get('login');
  const v = await j('/api/login/verify', { method: 'POST', body: JSON.stringify({ token: tok }) });
  assert.equal(v.status, 200); assert.equal((await j('/api/me')).body.email, 'e2e@example.com');
});
await step('annual checkout after resubscribing maps to the annual plan', async () => {
  const c = await j('/api/checkout', { method: 'POST', body: JSON.stringify({ plan: 'annual' }) });
  const u = new URL(c.body.url);
  const pay = await req(u.pathname + '?s=' + u.searchParams.get('s') + '&pay=1&email=e2e@example.com');
  const done = await j('/api/checkout/complete?session_id=' + new URL(pay.headers.get('location')).searchParams.get('session_id'));
  assert.equal(done.body.pro, true); assert.equal((await j('/api/me')).body.plan, 'annual');
});
await step('cross origin POST refused', async () => {
  const r = await req('/api/checkout', { method: 'POST', body: '{"plan":"monthly"}', headers: { origin: 'https://evil.example' } });
  assert.equal(r.status, 403);
});

for (const [s, n] of results) console.log(s, n);
const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
