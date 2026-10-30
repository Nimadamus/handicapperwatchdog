// node --test backend/test.mjs
// Drives backend/core.mjs end to end against an in-memory KV and a fake Stripe that behaves like the real API
// for the calls we make. Covers checkout, sign in, webhooks (signature, replay, ordering), renewals, failed
// payments with grace, cancellation, deletion, the live billing guard, CSRF, cookie tampering and Pro keys.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handle, entitlement, verifyStripeSignature } from './core.mjs';

const SITE = 'https://handicapperwatchdog.com';
const enc = new TextEncoder();
const DAY = 86400, T = () => Math.floor(Date.now() / 1000);

function memKV() {
  const m = new Map();
  return { m, get: async (k) => { const v = m.get(k); if (!v) return null; if (v.exp && v.exp < Date.now()) { m.delete(k); return null; } return v.val; },
    put: async (k, val, o) => { m.set(k, { val, exp: o && o.expirationTtl ? Date.now() + o.expirationTtl * 1000 : 0 }); }, delete: async (k) => { m.delete(k); } };
}

function fakeStripe(env) {
  const S = { customers: {}, subs: {}, sessions: {}, portal: 0, calls: [], refunds: [], invoicePayments: {} };
  const priceObj = (id) => ({ id });
  S.makeSub = (customer, price, status = 'active', extra = {}) => {
    const id = 'sub_' + Math.random().toString(36).slice(2, 10);
    S.subs[id] = { id, object: 'subscription', customer, status, cancel_at_period_end: false,
      items: { data: [{ price: priceObj(price), current_period_end: T() + 30 * DAY }] }, metadata: { app: 'hwd' }, ...extra };
    return S.subs[id];
  };
  S.fetch = async (url, init) => {
    const u = new URL(url), method = init.method || 'GET';
    S.calls.push(method + ' ' + u.pathname);
    if (u.hostname === 'api.stripe.com') assert.equal(init.headers.authorization, 'Bearer ' + env.STRIPE_SECRET_KEY);
    const p = new URLSearchParams(method === 'GET' ? u.search : init.body);
    const ok = (d) => new Response(JSON.stringify(d), { status: 200 });
    let m;
    if (u.pathname === '/v1/checkout/sessions' && method === 'POST') {
      const id = 'cs_test_' + Math.random().toString(36).slice(2, 12);
      S.sessions[id] = { id, mode: p.get('mode'), metadata: { app: p.get('metadata[app]') }, status: 'open', price: p.get('line_items[0][price]'),
        customer: p.get('customer'), customer_email: p.get('customer_email'), success_url: p.get('success_url'), url: 'https://checkout.stripe.com/c/pay/' + id };
      return ok(S.sessions[id]);
    }
    if ((m = u.pathname.match(/^\/v1\/checkout\/sessions\/(cs_test_\w+)$/))) {
      const s = S.sessions[m[1]]; if (!s) return new Response('{"error":{"message":"No such session"}}', { status: 404 });
      return ok({ ...s, subscription: s.subscription ? S.subs[s.subscription] : null });
    }
    if (u.pathname === '/v1/customers' && method === 'GET') {
      const email = (p.get('email') || '').toLowerCase();
      return ok({ data: Object.values(S.customers).filter((c) => (c.email || '').toLowerCase() === email) });
    }
    if (u.pathname === '/v1/subscriptions' && method === 'GET') {
      const customer = p.get('customer');
      return ok({ data: Object.values(S.subs).filter((s) => !customer || s.customer === customer) });
    }
    if ((m = u.pathname.match(/^\/v1\/subscriptions\/(sub_\w+)$/)) && method === 'GET') return ok(S.subs[m[1]] || null);
    if ((m = u.pathname.match(/^\/v1\/subscriptions\/(sub_\w+)$/)) && method === 'DELETE') {
      if (S.subs[m[1]]) S.subs[m[1]].status = 'canceled';
      return ok(S.subs[m[1]] || { id: m[1], status: 'canceled' });
    }
    if ((m = u.pathname.match(/^\/v1\/checkout\/sessions\/(cs_test_\w+)\/expire$/)) && method === 'POST') {
      if (S.sessions[m[1]]) S.sessions[m[1]].status = 'expired';
      return ok(S.sessions[m[1]] || { id: m[1], status: 'expired' });
    }
    if (u.pathname === '/v1/refunds' && method === 'POST') { S.refunds.push(p.get('payment_intent')); return ok({ id: 're_test', status: 'succeeded' }); }
    if (u.pathname === '/v1/invoice_payments' && method === 'GET') return ok({ data: S.invoicePayments[p.get('invoice')] || [] });
    if (u.pathname === '/v1/billing_portal/sessions') { S.portal++; return ok({ url: 'https://billing.stripe.com/p/session/test_' + p.get('customer') }); }
    if (u.hostname === 'api.resend.com' || u.hostname === 'api.brevo.com') {
      if ((S.mailStatus || 200) >= 400) return new Response('{}', { status: S.mailStatus });
      S.mails = (S.mails || []).concat([{ host: u.hostname, body: JSON.parse(init.body) }]);
      return ok({ id: 'mail' });
    }
    return new Response('{"error":{"message":"unexpected ' + u.pathname + '"}}', { status: 400 });
  };
  // what Stripe does when the customer pays on the hosted page
  S.pay = (sessionId, email) => {
    const s = S.sessions[sessionId];
    const customer = s.customer || 'cus_' + Math.random().toString(36).slice(2, 10);
    const sub = S.makeSub(customer, s.price);
    sub.latest_invoice = { id: 'in_' + sub.id, payment_intent: 'pi_' + sub.id };
    S.customers[customer] = { id: customer, email };
    Object.assign(s, { status: 'complete', customer, subscription: sub.id, customer_details: { email }, payment_status: 'paid' });
    return { s, sub };
  };
  return S;
}

function setup(over = {}) {
  const env = { KV: memKV(), SITE_URL: SITE, SESSION_SECRET: 'sess_secret_for_tests_only', HWD_PRO_KEY: 'pro_key_for_tests_only',
    STRIPE_SECRET_KEY: 'sk_test_123', STRIPE_WEBHOOK_SECRET: 'whsec_test', STRIPE_PRICE_MONTHLY: 'price_m', STRIPE_PRICE_ANNUAL: 'price_a',
    DEV_MAIL_ECHO: '1', ...over };
  const S = fakeStripe(env);
  let cookie = '';
  const call = async (method, path, body, headers = {}) => {
    const h = { origin: SITE, ...(cookie ? { cookie } : {}), ...headers };
    if (body !== undefined && typeof body !== 'string') { h['content-type'] = 'application/json'; body = JSON.stringify(body); }
    const r = await handle(new Request(SITE + path, { method, headers: h, body }), env, { fetch: S.fetch });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0].endsWith('=') ? '' : sc.split(';')[0];
    return { status: r.status, body: await r.json() };
  };
  const hook = async (evt, secret = env.STRIPE_WEBHOOK_SECRET, t = T()) => {
    const body = JSON.stringify(evt);
    const k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = [...new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(t + '.' + body)))].map((x) => x.toString(16).padStart(2, '0')).join('');
    const r = await handle(new Request(SITE + '/api/webhook', { method: 'POST', headers: { 'stripe-signature': `t=${t},v1=${sig}` }, body }), env, { fetch: S.fetch });
    return { status: r.status, body: await r.json() };
  };
  return { env, S, call, hook, setCookie: (c) => { cookie = c; }, getCookie: () => cookie };
}

async function subscribe(t, plan = 'monthly', email = 'fan@example.com') {
  const c = await t.call('POST', '/api/checkout', { plan });
  assert.equal(c.status, 200);
  const sid = c.body.url.split('/').pop();
  const { sub } = t.S.pay(sid, email);
  const done = await t.call('GET', '/api/checkout/complete?session_id=' + sid);
  return { sid, sub, done };
}

test('anonymous visitor is free and gets no Pro key', async () => {
  const t = setup();
  const me = await t.call('GET', '/api/me');
  assert.equal(me.body.pro, false); assert.equal(me.body.signed_in, false);
  assert.equal((await t.call('GET', '/api/pro/key?id=0123456789')).status, 401);
});

test('monthly checkout creates the session with our price and metadata, then signs in as Pro', async () => {
  const t = setup();
  const { sid, done } = await subscribe(t, 'monthly');
  assert.equal(t.S.sessions[sid].price, 'price_m');
  assert.equal(t.S.sessions[sid].metadata.app, 'hwd');
  assert.ok(t.S.sessions[sid].success_url.startsWith(SITE + '/account.html?session_id='));
  assert.equal(done.status, 200); assert.equal(done.body.pro, true);
  const me = await t.call('GET', '/api/me');
  assert.equal(me.body.pro, true); assert.equal(me.body.plan, 'monthly'); assert.equal(me.body.email, 'fan@example.com');
});

test('annual plan maps to the annual price; unknown plans are refused', async () => {
  const t = setup();
  const { sid } = await subscribe(t, 'annual', 'yearly@example.com');
  assert.equal(t.S.sessions[sid].price, 'price_a');
  assert.equal((await t.call('GET', '/api/me')).body.plan, 'annual');
  const t2 = setup();
  assert.equal((await t2.call('POST', '/api/checkout', { plan: 'lifetime' })).status, 400);
});

test('an unpaid or foreign checkout session never grants access, and a session signs in only once', async () => {
  const t = setup();
  const c = await t.call('POST', '/api/checkout', { plan: 'monthly' });
  const sid = c.body.url.split('/').pop();
  assert.equal((await t.call('GET', '/api/checkout/complete?session_id=' + sid)).status, 400); // still open
  t.S.pay(sid, 'a@example.com');
  assert.equal((await t.call('GET', '/api/checkout/complete?session_id=' + sid)).status, 200);
  t.setCookie('');
  const again = await t.call('GET', '/api/checkout/complete?session_id=' + sid);
  assert.equal(again.status, 409);
  assert.equal((await t.call('GET', '/api/me')).body.pro, false);
  t.S.sessions.cs_test_other = { id: 'cs_test_other', mode: 'subscription', metadata: { app: 'someone_else' }, status: 'complete', customer: 'cus_x' };
  assert.equal((await t.call('GET', '/api/checkout/complete?session_id=cs_test_other')).status, 400);
  assert.equal((await t.call('GET', '/api/checkout/complete?session_id=bad')).status, 400);
});

test('webhook signature: valid accepted, wrong secret, stale timestamp and missing header refused', async () => {
  const t = setup();
  const evt = { id: 'evt_1', type: 'ping', data: { object: {} } };
  assert.equal((await t.hook(evt)).status, 200);
  assert.equal((await t.hook({ ...evt, id: 'evt_2' }, 'whsec_wrong')).status, 400);
  assert.equal((await t.hook({ ...evt, id: 'evt_3' }, t.env.STRIPE_WEBHOOK_SECRET, T() - 600)).status, 400);
  const r = await handle(new Request(SITE + '/api/webhook', { method: 'POST', body: '{}' }), t.env, { fetch: t.S.fetch });
  assert.equal(r.status, 400);
  assert.equal(await verifyStripeSignature('s', 't=1,v1=00', '{}', 1), false);
});

test('webhook replay is ignored (idempotent)', async () => {
  const t = setup();
  const { sub } = await subscribe(t);
  const upd = { id: 'evt_dup', type: 'customer.subscription.updated', data: { object: { ...sub, status: 'canceled' } } };
  assert.equal((await t.hook(upd)).body.ok, true);
  assert.equal((await t.call('GET', '/api/me')).body.pro, false);
  t.S.subs[sub.id].status = 'active';
  const active = { id: 'evt_new', type: 'customer.subscription.updated', data: { object: { ...sub, status: 'active' } } };
  await t.hook(active);
  assert.equal((await t.call('GET', '/api/me')).body.pro, true);
  const rep = await t.hook(upd); // replay of the old cancel must not undo the newer state
  assert.equal(rep.body.duplicate, true);
  assert.equal((await t.call('GET', '/api/me')).body.pro, true);
});

test('webhook checkout.session.completed alone provisions the account (customer closed the tab)', async () => {
  const t = setup();
  const c = await t.call('POST', '/api/checkout', { plan: 'annual' });
  const sid = c.body.url.split('/').pop();
  const { s } = t.S.pay(sid, 'tabcloser@example.com');
  await t.hook({ id: 'evt_cs', type: 'checkout.session.completed', data: { object: { ...s, subscription: s.subscription } } });
  // they come back later and sign in by email
  t.setCookie('');
  const l = await t.call('POST', '/api/login', { email: 'TabCloser@example.com' });
  assert.ok(l.body.dev_link);
  const tok = new URL(l.body.dev_link).searchParams.get('login');
  const v = await t.call('POST', '/api/login/verify', { token: tok });
  assert.equal(v.status, 200); assert.equal(v.body.pro, true);
  assert.equal((await t.call('POST', '/api/login/verify', { token: tok })).status, 400); // single use
});

test('renewal keeps access and moves the period end', async () => {
  const t = setup();
  const { sub } = await subscribe(t);
  const next = T() + 60 * DAY;
  t.S.subs[sub.id].items.data[0].current_period_end = next;
  await t.hook({ id: 'evt_paid', type: 'invoice.paid', data: { object: { customer: sub.customer, subscription: sub.id, status_transitions: { paid_at: T() } } } });
  const a = JSON.parse(t.env.KV.m.get('acct:' + t.env.KV.m.get('cust:' + sub.customer).val).val);
  assert.equal(a.period_end, next); assert.equal(entitlement(a).pro, true); assert.equal(a.payment_failed, false);
});

test('failed payment: past_due keeps access through a 3 day grace, then loses it; unpaid or canceled loses it', async () => {
  const t = setup();
  const { sub } = await subscribe(t);
  t.S.subs[sub.id].status = 'past_due';
  await t.hook({ id: 'evt_fail', type: 'invoice.payment_failed', data: { object: { customer: sub.customer, subscription: sub.id } } });
  const me = await t.call('GET', '/api/me');
  assert.equal(me.body.pro, true); assert.equal(me.body.payment_failed, true);
  const pe = T();
  assert.equal(entitlement({ status: 'past_due', period_end: pe }, pe + 2 * DAY).pro, true);
  assert.equal(entitlement({ status: 'past_due', period_end: pe }, pe + 4 * DAY).pro, false);
  assert.equal(entitlement({ status: 'unpaid', period_end: pe + DAY }).pro, false);
  assert.equal(entitlement({ status: 'incomplete' }).pro, false);
});

test('cancel at period end keeps access until Stripe ends the subscription', async () => {
  const t = setup();
  const { sub } = await subscribe(t);
  await t.hook({ id: 'evt_c1', type: 'customer.subscription.updated', data: { object: { ...t.S.subs[sub.id], cancel_at_period_end: true } } });
  let me = await t.call('GET', '/api/me');
  assert.equal(me.body.pro, true); assert.equal(me.body.cancel_at_period_end, true);
  await t.hook({ id: 'evt_c2', type: 'customer.subscription.deleted', data: { object: { ...t.S.subs[sub.id], status: 'canceled' } } });
  me = await t.call('GET', '/api/me');
  assert.equal(me.body.pro, false);
  assert.equal((await t.call('GET', '/api/pro/key?id=0123456789')).status, 402);
});

test('subscription events for customers we never sold to are ignored', async () => {
  const t = setup();
  const r = await t.hook({ id: 'evt_x', type: 'customer.subscription.updated', data: { object: { id: 'sub_x', customer: 'cus_unknown', status: 'active', items: { data: [] } } } });
  assert.equal(r.status, 200);
  assert.equal([...t.env.KV.m.keys()].filter((k) => k.startsWith('acct:')).length, 0);
});

test('customer portal needs a signed in billing customer', async () => {
  const t = setup();
  assert.equal((await t.call('POST', '/api/portal')).status, 401);
  await subscribe(t);
  const p = await t.call('POST', '/api/portal');
  assert.equal(p.status, 200); assert.ok(p.body.url.startsWith('https://billing.stripe.com/'));
});

test('live keys are refused until BILLING_LIVE=yes; missing config closes checkout', async () => {
  const t = setup({ STRIPE_SECRET_KEY: 'sk_live_abc' });
  assert.equal((await t.call('POST', '/api/checkout', { plan: 'monthly' })).status, 503);
  assert.match((await t.call('GET', '/api/health')).body.billing, /not approved/);
  const t2 = setup({ STRIPE_SECRET_KEY: '' });
  assert.equal((await t2.call('POST', '/api/checkout', { plan: 'monthly' })).status, 503);
  assert.equal((await t2.call('GET', '/api/me')).body.billing, false);
});

test('cross origin POSTs are refused (CSRF), webhook exempt', async () => {
  const t = setup();
  assert.equal((await t.call('POST', '/api/checkout', { plan: 'monthly' }, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await t.call('POST', '/api/logout', undefined, { origin: 'https://evil.example' })).status, 403);
});

test('tampered or expired cookies are anonymous', async () => {
  const t = setup();
  await subscribe(t);
  const good = t.getCookie();
  const [name, rest] = good.split('=');
  const [body, sig] = rest.split('.');
  t.setCookie(name + '=' + body + '.' + sig.slice(0, -2) + 'AA');
  assert.equal((await t.call('GET', '/api/me')).body.signed_in, false);
  const forged = Buffer.from(JSON.stringify({ a: 'someone', e: T() + 999 })).toString('base64url');
  t.setCookie(name + '=' + forged + '.' + sig);
  assert.equal((await t.call('GET', '/api/me')).body.signed_in, false);
});

test('login does not reveal whether an email has an account, and is rate limited', async () => {
  const t = setup();
  const r = await t.call('POST', '/api/login', { email: 'nobody@example.com' });
  assert.equal(r.status, 200); assert.equal(r.body.dev_link, undefined);
  assert.equal((await t.call('POST', '/api/login', { email: 'not-an-email' })).status, 400);
  for (let i = 0; i < 4; i++) await t.call('POST', '/api/login', { email: 'nobody@example.com' });
  assert.equal((await t.call('POST', '/api/login', { email: 'nobody@example.com' })).status, 429);
});

test('Pro key decrypts a file sealed by build.py, and only for a Pro account', async () => {
  const t = setup();
  const here = dirname(fileURLToPath(import.meta.url));
  const dir = mkdtempSync(join(tmpdir(), 'hwd-'));
  const py = `import os,sys,json;os.environ['HWD_PRO_KEY']='pro_key_for_tests_only';sys.path.insert(0,${JSON.stringify(join(here, '..'))});import build;open(${JSON.stringify(join(dir, 'x.bin'))},'w').write(build.seal('capper:0123456789',{'handle':'TestCapper','picks':[{'pick':'Over 55'}]}))`;
  execFileSync('python', ['-c', py]);
  const blob = readFileSync(join(dir, 'x.bin'), 'utf8');
  assert.equal((await t.call('GET', '/api/pro/key?id=0123456789')).status, 401);
  await subscribe(t);
  const k = await t.call('GET', '/api/pro/key?id=0123456789');
  assert.equal(k.status, 200);
  const raw = Buffer.from(blob, 'base64');
  const key = await crypto.subtle.importKey('raw', Buffer.from(k.body.key, 'base64'), 'AES-GCM', false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.subarray(0, 12) }, key, raw.subarray(12));
  const txt = new TextDecoder().decode(plain);
  assert.equal(JSON.parse(txt).handle, 'TestCapper');
  // another capper's key does not open this file
  const k2 = await t.call('GET', '/api/pro/key?id=abcdefabcd');
  const key2 = await crypto.subtle.importKey('raw', Buffer.from(k2.body.key, 'base64'), 'AES-GCM', false, ['decrypt']);
  await assert.rejects(crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.subarray(0, 12) }, key2, raw.subarray(12)));
  assert.equal((await t.call('GET', '/api/pro/key?id=../../etc')).status, 400);
});

test('a Pro member cannot start a second subscription', async () => {
  const t = setup();
  await subscribe(t);
  assert.equal((await t.call('POST', '/api/checkout', { plan: 'annual' })).status, 409);
});

test('sign in email goes through Brevo when configured, with the one time link and no echo', async () => {
  const t = setup({ BREVO_API_KEY: 'xkeysib-test', MAIL_FROM: 'login@handicapperwatchdog.com', DEV_MAIL_ECHO: '' });
  await subscribe(t, 'monthly', 'mailme@example.com');
  t.setCookie('');
  const r = await t.call('POST', '/api/login', { email: 'mailme@example.com' });
  assert.equal(r.status, 200); assert.equal(r.body.dev_link, undefined);
  const m = t.S.mails.pop();
  assert.equal(m.host, 'api.brevo.com'); assert.equal(m.body.to[0].email, 'mailme@example.com');
  const tok = m.body.textContent.match(/login=([A-Za-z0-9_-]+)/)[1];
  assert.equal((await t.call('POST', '/api/login/verify', { token: tok })).body.pro, true);
});

test('Pro key requests do not write to KV (free tier allows 1,000 writes a day) and are capped per hour', async () => {
  const t = setup();
  await subscribe(t);
  const before = t.env.KV.m.size;
  for (let i = 0; i < 5; i++) assert.equal((await t.call('GET', '/api/pro/key?id=0123456789')).status, 200);
  assert.equal(t.env.KV.m.size, before);
  let last;
  for (let i = 0; i < 400; i++) last = await t.call('GET', '/api/pro/key?id=0123456789');
  assert.equal(last.status, 429);
});

test('purchase confirmation goes to the customer once and the owner is notified once', async () => {
  const t = setup({ PURCHASE_NOTIFY_EMAIL: 'owner@example.com' });
  const { sub } = await subscribe(t, 'monthly', 'fan@example.com');
  await t.hook({ id: 'evt_cs_mail', type: 'checkout.session.completed', data: { object: { mode: 'subscription', metadata: { app: 'hwd' }, customer: sub.customer, customer_details: { email: 'fan@example.com' }, subscription: sub.id } } });
  const mails = (await t.call('GET', '/api/dev/mails')).body.mails;
  assert.equal(mails.filter((m) => m.to === 'fan@example.com' && m.subject === 'Your Watchdog Pro subscription').length, 1);
  assert.equal(mails.filter((m) => m.to === 'owner@example.com' && m.subject === 'New Watchdog Pro subscription').length, 1);
  assert.match(mails.find((m) => m.to === 'fan@example.com').text, /\$59\.99/);
  assert.match(mails.find((m) => m.to === 'owner@example.com').text, /fan@example.com/);
});

test('a renewal does not send another purchase notice', async () => {
  const t = setup({ PURCHASE_NOTIFY_EMAIL: 'owner@example.com' });
  const { sub } = await subscribe(t);
  const before = (await t.call('GET', '/api/dev/mails')).body.mails.length;
  await t.hook({ id: 'evt_renew_mail', type: 'invoice.paid', data: { object: { id: 'in_renew', customer: sub.customer, subscription: sub.id, billing_reason: 'subscription_cycle', status_transitions: { paid_at: T() } } } });
  assert.equal((await t.call('GET', '/api/dev/mails')).body.mails.length, before);
  assert.equal((await t.call('GET', '/api/me')).body.pro, true);
});

test('the same email cannot start a second subscription after signing out', async () => {
  const t = setup();
  await subscribe(t, 'monthly', 'fan@example.com');
  t.setCookie('');
  const sessions = Object.keys(t.S.sessions).length;
  const again = await t.call('POST', '/api/checkout', { plan: 'annual', email: 'Fan@Example.com' });
  assert.equal(again.status, 409);
  assert.equal(Object.keys(t.S.sessions).length, sessions);
});

test('two clicks for the same plan reuse one checkout, and switching plan expires the first', async () => {
  const t = setup();
  const a = await t.call('POST', '/api/checkout', { plan: 'monthly', email: 'new@example.com' });
  const b = await t.call('POST', '/api/checkout', { plan: 'monthly', email: 'new@example.com' });
  assert.equal(a.status, 200); assert.equal(b.body.url, a.body.url); assert.equal(Object.keys(t.S.sessions).length, 1);
  const c = await t.call('POST', '/api/checkout', { plan: 'annual', email: 'new@example.com' });
  assert.equal(c.status, 200); assert.notEqual(c.body.url, a.body.url);
  assert.equal(t.S.sessions[a.body.url.split('/').pop()].status, 'expired');
});

test('a second paid subscription for the same customer is canceled and refunded', async () => {
  const t = setup();
  const { sub } = await subscribe(t, 'monthly', 'fan@example.com');
  const extra = t.S.makeSub(sub.customer, 'price_m');
  extra.latest_invoice = { id: 'in_' + extra.id, payment_intent: 'pi_' + extra.id };
  const r = await t.hook({ id: 'evt_dup_sub', type: 'checkout.session.completed', data: { object: { mode: 'subscription', metadata: { app: 'hwd' }, customer: sub.customer, customer_details: { email: 'fan@example.com' }, subscription: extra.id } } });
  assert.equal(r.status, 200);
  assert.equal(t.S.subs[extra.id].status, 'canceled');
  assert.ok(t.S.refunds.includes('pi_' + extra.id));
  assert.equal((await t.call('GET', '/api/me')).body.plan, 'monthly');
  assert.ok((await t.call('GET', '/api/dev/mails')).body.mails.some((m) => m.subject === 'Duplicate Watchdog Pro checkout canceled'));
});

test('another product on the same Stripe customer does not block or get canceled', async () => {
  const t = setup();
  t.S.customers.cus_other = { id: 'cus_other', email: 'fan@example.com' };
  const foreign = t.S.makeSub('cus_other', 'price_other_product');
  const c = await t.call('POST', '/api/checkout', { plan: 'monthly', email: 'fan@example.com' });
  assert.equal(c.status, 200);
  assert.equal(t.S.subs[foreign.id].status, 'active');
});

test('failed payment and expiration each email the customer once', async () => {
  const t = setup();
  const { sub } = await subscribe(t, 'annual', 'fan@example.com');
  t.S.subs[sub.id].status = 'past_due';
  await t.hook({ id: 'evt_fail_mail', type: 'invoice.payment_failed', data: { object: { id: 'in_fail', customer: sub.customer, subscription: sub.id } } });
  await t.hook({ id: 'evt_fail_mail_2', type: 'invoice.payment_failed', data: { object: { id: 'in_fail', customer: sub.customer, subscription: sub.id } } });
  t.S.subs[sub.id].status = 'canceled';
  await t.hook({ id: 'evt_end_mail', type: 'customer.subscription.deleted', data: { object: { ...t.S.subs[sub.id], status: 'canceled' } } });
  const mails = (await t.call('GET', '/api/dev/mails')).body.mails.filter((m) => m.to === 'fan@example.com');
  assert.equal(mails.filter((m) => m.subject === 'Watchdog Pro payment failed').length, 1);
  assert.match(mails.find((m) => m.subject === 'Watchdog Pro payment failed').text, /3 days/);
  assert.equal(mails.filter((m) => m.subject === 'Your Watchdog Pro subscription has ended').length, 1);
  assert.equal((await t.call('GET', '/api/me')).body.pro, false);
});

test('an ended subscriber can start a new subscription', async () => {
  const t = setup();
  const { sub } = await subscribe(t, 'monthly', 'fan@example.com');
  t.S.subs[sub.id].status = 'canceled';
  await t.hook({ id: 'evt_end_resub', type: 'customer.subscription.deleted', data: { object: { ...t.S.subs[sub.id], status: 'canceled' } } });
  const c = await t.call('POST', '/api/checkout', { plan: 'annual' });
  assert.equal(c.status, 200);
  assert.equal(t.S.sessions[c.body.url.split('/').pop()].price, 'price_a');
});

test('an unpaid checkout does not grant Pro', async () => {
  const t = setup();
  const c = await t.call('POST', '/api/checkout', { plan: 'monthly' });
  const sid = c.body.url.split('/').pop();
  t.S.pay(sid, 'fan@example.com');
  t.S.sessions[sid].payment_status = 'unpaid';
  assert.equal((await t.call('GET', '/api/checkout/complete?session_id=' + sid)).status, 400);
  assert.equal((await t.call('GET', '/api/me')).body.pro, false);
});

test('dev mail log is hidden unless DEV_MAIL_ECHO is on', async () => {
  const t = setup({ DEV_MAIL_ECHO: '' });
  assert.equal((await t.call('GET', '/api/dev/mails')).status, 404);
});

test('an invoice that is not Watchdog Pro does not change the account', async () => {
  const t = setup();
  const { sub } = await subscribe(t, 'monthly', 'fan@example.com');
  const foreign = t.S.makeSub(sub.customer, 'price_other_product');
  await t.hook({ id: 'evt_foreign_fail', type: 'invoice.payment_failed', data: { object: { id: 'in_foreign', customer: sub.customer, subscription: foreign.id } } });
  await t.hook({ id: 'evt_nosub_fail', type: 'invoice.payment_failed', data: { object: { id: 'in_nosub', customer: sub.customer } } });
  const me = await t.call('GET', '/api/me');
  assert.equal(me.body.payment_failed, false);
  assert.equal(me.body.status, 'active');
  assert.equal(me.body.pro, true);
  assert.equal(t.S.subs[foreign.id].status, 'active');
});

test('a basil invoice still marks a failed Watchdog renewal', async () => {
  const t = setup();
  const { sub } = await subscribe(t);
  t.S.subs[sub.id].status = 'past_due';
  await t.hook({ id: 'evt_basil_parent', type: 'invoice.payment_failed', data: { object: { id: 'in_parent', customer: sub.customer, parent: { subscription_details: { subscription: sub.id } } } } });
  assert.equal((await t.call('GET', '/api/me')).body.payment_failed, true);
  const t2 = setup();
  const again = await subscribe(t2);
  t2.S.subs[again.sub.id].status = 'past_due';
  await t2.hook({ id: 'evt_basil_line', type: 'invoice.payment_failed', data: { object: { id: 'in_line', customer: again.sub.customer, lines: { data: [{ parent: { subscription_item_details: { subscription: again.sub.id } } }] } } } });
  assert.equal((await t2.call('GET', '/api/me')).body.pro, true);
  assert.equal((await t2.call('GET', '/api/me')).body.payment_failed, true);
});

test('a duplicate basil invoice refunds through invoice payments', async () => {
  const t = setup();
  const { sub } = await subscribe(t, 'monthly', 'fan@example.com');
  const extra = t.S.makeSub(sub.customer, 'price_m');
  extra.latest_invoice = { id: 'in_basil_' + extra.id, payments: { data: [{ payment: { type: 'payment_intent', payment_intent: 'pi_basil_' + extra.id } }] } };
  await t.hook({ id: 'evt_dup_basil', type: 'checkout.session.completed', data: { object: { mode: 'subscription', metadata: { app: 'hwd' }, customer: sub.customer, customer_details: { email: 'fan@example.com' }, subscription: extra.id } } });
  assert.equal(t.S.subs[extra.id].status, 'canceled');
  assert.ok(t.S.refunds.includes('pi_basil_' + extra.id));
  const fetched = t.S.makeSub(sub.customer, 'price_m');
  fetched.latest_invoice = { id: 'in_fetch_' + fetched.id };
  t.S.invoicePayments[fetched.latest_invoice.id] = [{ payment: { payment_intent: 'pi_fetch_' + fetched.id } }];
  await t.hook({ id: 'evt_dup_fetch', type: 'checkout.session.completed', data: { object: { mode: 'subscription', metadata: { app: 'hwd' }, customer: sub.customer, customer_details: { email: 'fan@example.com' }, subscription: fetched.id } } });
  assert.ok(t.S.refunds.includes('pi_fetch_' + fetched.id));
  const mail = (await t.call('GET', '/api/dev/mails')).body.mails.find((m) => m.subject === 'Duplicate Watchdog Pro checkout canceled');
  assert.match(mail.text, /charge was refunded/);
});

test('a failed payment email is retried and then sent once', async () => {
  const t = setup({ BREVO_API_KEY: 'xkeysib-test', MAIL_FROM: 'login@handicapperwatchdog.com', DEV_MAIL_ECHO: '' });
  const { sub } = await subscribe(t, 'annual', 'fan@example.com');
  t.S.subs[sub.id].status = 'past_due';
  t.S.mailStatus = 500;
  const evt = { id: 'evt_fail_retry', type: 'invoice.payment_failed', data: { object: { id: 'in_retry', customer: sub.customer, subscription: sub.id } } };
  assert.equal((await t.hook(evt)).status, 502);
  assert.equal((await t.call('GET', '/api/me')).body.payment_failed, true);
  t.S.mailStatus = 200;
  assert.equal((await t.hook(evt)).status, 200);
  assert.equal((await t.hook(evt)).body.duplicate, true);
  const fails = t.S.mails.filter((m) => m.body.subject === 'Watchdog Pro payment failed');
  assert.equal(fails.length, 1);
  assert.equal(fails[0].body.to[0].email, 'fan@example.com');
});
