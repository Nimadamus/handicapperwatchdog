// Watchdog Pro API: accounts, Stripe subscriptions, entitlements and Pro data keys.
//
// Runs as a Cloudflare Pages Function (functions/api/[[path]].js) next to the static site, so the session
// cookie is first party. Everything external is passed in: env (secrets, KV binding) and deps.fetch (Stripe,
// email), which is what lets backend/test.mjs drive every path with a fake Stripe.
//
// Billing safety: a live Stripe key is refused unless env.BILLING_LIVE === 'yes'. That switch is the owner's.
//
// Pro data never passes through here. The build publishes each capper's names and pick log encrypted with its
// own key (HMAC(HWD_PRO_KEY, 'capper:' + id)); this API only hands that key to a signed in subscriber.

const enc = new TextEncoder();
const DAY = 86400;
const GRACE_DAYS = 3;          // past_due keeps access this long past the period end while Stripe retries
const SESSION_DAYS = 30;
const LOGIN_TTL = 15 * 60;
const KEY_RATE = 400;          // capper keys per account per hour

// ---------- small helpers ----------
const now = () => Math.floor(Date.now() / 1000);
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
const err = (status, message) => json({ error: message }, status);
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const hex = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');
const randomId = (n = 18) => b64u(crypto.getRandomValues(new Uint8Array(n)));

async function hmac(secret, msg) {
  const k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, enc.encode(msg));
}
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
const validEmail = (e) => typeof e === 'string' && e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);

// ---------- KV records ----------
const kvGet = async (env, k) => { const v = await env.KV.get(k); return v ? JSON.parse(v) : null; };
const kvPut = (env, k, v, ttl) => env.KV.put(k, JSON.stringify(v), ttl ? { expirationTtl: ttl } : undefined);

async function accountByEmail(env, email, create) {
  email = email.trim().toLowerCase();
  const id = await env.KV.get('email:' + email);
  if (id) return kvGet(env, 'acct:' + id);
  if (!create) return null;
  const a = { id: randomId(12), email, created: now(), status: 'none' };
  await kvPut(env, 'acct:' + a.id, a);
  await env.KV.put('email:' + email, a.id);
  return a;
}
async function saveAccount(env, a) {
  a.updated = now();
  await kvPut(env, 'acct:' + a.id, a);
  if (a.customer) await env.KV.put('cust:' + a.customer, a.id);
  return a;
}

// ---------- entitlement ----------
export function entitlement(a, t = now()) {
  if (!a || !a.status) return { pro: false, reason: 'no subscription' };
  if (a.status === 'active' || a.status === 'trialing') return { pro: true, reason: a.cancel_at_period_end ? 'cancels at period end' : a.status };
  if (a.status === 'past_due' && a.period_end && t < a.period_end + GRACE_DAYS * DAY) return { pro: true, reason: 'payment retrying' };
  return { pro: false, reason: a.status };
}

// ---------- session cookie ----------
async function makeCookie(env, accountId) {
  const body = b64u(enc.encode(JSON.stringify({ a: accountId, e: now() + SESSION_DAYS * DAY })));
  const sig = b64u(await hmac(env.SESSION_SECRET, body));
  return `hwd_s=${body}.${sig}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * DAY}`;
}
async function readSession(env, req) {
  const m = (req.headers.get('cookie') || '').match(/(?:^|;\s*)hwd_s=([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)/);
  if (!m) return null;
  const want = b64u(await hmac(env.SESSION_SECRET, m[1]));
  if (!safeEqual(want, m[2])) return null;
  let p;
  try { p = JSON.parse(atob(m[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { return null; }
  if (!p.a || p.e < now()) return null;
  return kvGet(env, 'acct:' + p.a);
}

// ---------- Stripe ----------
function form(obj, prefix, out = []) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v === undefined || v === null) continue;
    if (typeof v === 'object') form(v, key, out); else out.push(encodeURIComponent(key) + '=' + encodeURIComponent(v));
  }
  return out.join('&');
}
async function stripe(env, deps, method, path, params) {
  const url = 'https://api.stripe.com/v1/' + path + (method === 'GET' && params ? '?' + form(params) : '');
  const r = await deps.fetch(url, {
    method,
    headers: { authorization: 'Bearer ' + env.STRIPE_SECRET_KEY, 'content-type': 'application/x-www-form-urlencoded', 'stripe-version': env.STRIPE_API_VERSION || '2025-03-31.basil' },
    body: method === 'GET' ? undefined : form(params || {}),
  });
  const d = await r.json();
  if (!r.ok) throw new Error('stripe ' + path + ': ' + ((d.error && d.error.message) || r.status));
  return d;
}
const billingReady = (env) => !!(env.STRIPE_SECRET_KEY && env.STRIPE_PRICE_MONTHLY && env.STRIPE_PRICE_ANNUAL);
const liveBlocked = (env) => /^(sk|rk)_live_/.test(env.STRIPE_SECRET_KEY || '') && env.BILLING_LIVE !== 'yes';
const planOf = (env, priceId) => priceId === env.STRIPE_PRICE_ANNUAL ? 'annual' : priceId === env.STRIPE_PRICE_MONTHLY ? 'monthly' : 'other';

function applySubscription(env, a, sub) {
  const item = sub.items && sub.items.data && sub.items.data[0];
  a.subscription = sub.id;
  a.customer = sub.customer;
  a.status = sub.status;
  a.cancel_at_period_end = !!sub.cancel_at_period_end;
  a.period_end = sub.current_period_end || (item && item.current_period_end) || a.period_end || null;
  a.plan = planOf(env, item && item.price && item.price.id);
  return a;
}

// Stripe-Signature: t=timestamp,v1=hex(hmac(secret, t + '.' + body)); 5 minute tolerance.
export async function verifyStripeSignature(secret, header, body, t0 = now()) {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')).filter((p) => p.length === 2).map(([k, v]) => [k, v]));
  const all = header.split(',').filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
  const t = +parts.t;
  if (!t || Math.abs(t0 - t) > 300 || !all.length) return false;
  const want = hex(await hmac(secret, t + '.' + body));
  return all.some((s) => safeEqual(s, want));
}

async function onWebhook(req, env, deps) {
  const body = await req.text();
  if (!(await verifyStripeSignature(env.STRIPE_WEBHOOK_SECRET, req.headers.get('stripe-signature'), body))) return err(400, 'bad signature');
  const evt = JSON.parse(body);
  if (await env.KV.get('evt:' + evt.id)) return json({ ok: true, duplicate: true });
  const o = evt.data && evt.data.object;
  const byCustomer = async (customer, email) => {
    let id = customer && await env.KV.get('cust:' + customer);
    if (id) return kvGet(env, 'acct:' + id);
    return email ? accountByEmail(env, email, true) : null;
  };
  switch (evt.type) {
    case 'checkout.session.completed': {
      if (o.mode !== 'subscription' || (o.metadata && o.metadata.app) !== 'hwd') break;
      const a = await byCustomer(o.customer, o.customer_details && o.customer_details.email);
      if (!a) break;
      a.customer = o.customer;
      if (o.subscription) applySubscription(env, a, await stripe(env, deps, 'GET', 'subscriptions/' + o.subscription));
      await saveAccount(env, a);
      break;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const a = await byCustomer(o.customer, null);
      if (!a) break; // not ours: subscriptions only attach to accounts made through our checkout
      applySubscription(env, a, o);
      await saveAccount(env, a);
      break;
    }
    case 'invoice.paid':
    case 'invoice.payment_failed': {
      const a = await byCustomer(o.customer, null);
      if (!a) break;
      if (evt.type === 'invoice.paid') { a.last_paid = o.status_transitions && o.status_transitions.paid_at || now(); a.payment_failed = false; }
      else { a.payment_failed = true; a.payment_failed_at = now(); }
      const subId = o.subscription || (o.parent && o.parent.subscription_details && o.parent.subscription_details.subscription);
      if (subId) applySubscription(env, a, await stripe(env, deps, 'GET', 'subscriptions/' + subId));
      await saveAccount(env, a);
      break;
    }
    default:
      break;
  }
  await env.KV.put('evt:' + evt.id, '1', { expirationTtl: 30 * DAY });
  return json({ ok: true });
}

// ---------- email (magic link) ----------
async function sendLogin(env, deps, email, link) {
  if (env.RESEND_API_KEY) {
    const r = await deps.fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { authorization: 'Bearer ' + env.RESEND_API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ from: env.MAIL_FROM, to: [email], subject: 'Your Handicapper Watchdog sign in link',
        text: `Sign in to Handicapper Watchdog:\n\n${link}\n\nThe link works once and expires in 15 minutes. If you did not ask for it, ignore this email.` }) });
    return r.ok;
  }
  return false;
}

// ---------- router ----------
export async function handle(req, env, deps = { fetch }) {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, '');
  const site = env.SITE_URL || url.origin;
  try {
    if (path === '/api/webhook' && req.method === 'POST') return await onWebhook(req, env, deps);

    // every other POST must come from our own pages
    if (req.method === 'POST') {
      const origin = req.headers.get('origin');
      if (origin !== new URL(site).origin) return err(403, 'cross origin request refused');
    }
    const acct = await readSession(env, req);

    if (path === '/api/health') return json({ ok: true, billing: billingReady(env) ? (liveBlocked(env) ? 'live key present, not approved' : /_live_/.test(env.STRIPE_SECRET_KEY) ? 'live' : 'test') : 'not configured' });

    if (path === '/api/me' && req.method === 'GET') {
      const e = entitlement(acct);
      return json({ signed_in: !!acct, email: acct && acct.email, pro: e.pro, reason: e.reason, plan: acct && acct.plan || null,
        status: acct && acct.status || null, period_end: acct && acct.period_end || null, cancel_at_period_end: !!(acct && acct.cancel_at_period_end),
        payment_failed: !!(acct && acct.payment_failed), billing: billingReady(env) && !liveBlocked(env) });
    }

    if (path === '/api/checkout' && req.method === 'POST') {
      if (!billingReady(env)) return err(503, 'Checkout is not open yet.');
      if (liveBlocked(env)) return err(503, 'Live billing has not been approved.');
      const { plan } = await req.json().catch(() => ({}));
      const price = plan === 'annual' ? env.STRIPE_PRICE_ANNUAL : plan === 'monthly' ? env.STRIPE_PRICE_MONTHLY : null;
      if (!price) return err(400, 'Unknown plan.');
      if (acct && entitlement(acct).pro) return err(409, 'You already have Watchdog Pro. Manage it from your account.');
      const s = await stripe(env, deps, 'POST', 'checkout/sessions', {
        mode: 'subscription', 'line_items[0][price]': price, 'line_items[0][quantity]': 1,
        success_url: site + '/account.html?session_id={CHECKOUT_SESSION_ID}', cancel_url: site + '/pricing.html?canceled=1',
        allow_promotion_codes: 'true', 'metadata[app]': 'hwd', 'subscription_data[metadata][app]': 'hwd',
        customer: acct && acct.customer || undefined, customer_email: acct && !acct.customer ? acct.email : undefined,
        client_reference_id: acct ? acct.id : undefined });
      return json({ url: s.url });
    }

    if (path === '/api/checkout/complete' && req.method === 'GET') {
      const sid = url.searchParams.get('session_id') || '';
      if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sid)) return err(400, 'Bad session.');
      const s = await stripe(env, deps, 'GET', 'checkout/sessions/' + sid, { 'expand[0]': 'subscription' });
      if (s.mode !== 'subscription' || (s.metadata && s.metadata.app) !== 'hwd' || s.status !== 'complete') return err(400, 'That checkout is not complete.');
      // one browser signs in from a given checkout, once: the session id is in the URL and could be shared
      if (await env.KV.get('cs:' + sid)) return err(409, 'This checkout was already used to sign in. Use the email sign in link instead.');
      let a = s.customer && await env.KV.get('cust:' + s.customer).then((id) => id && kvGet(env, 'acct:' + id));
      if (!a) a = await accountByEmail(env, (s.customer_details && s.customer_details.email) || s.customer_email, true);
      a.customer = s.customer;
      if (s.subscription && typeof s.subscription === 'object') applySubscription(env, a, s.subscription);
      await saveAccount(env, a);
      await env.KV.put('cs:' + sid, a.id, { expirationTtl: 90 * DAY });
      return json({ ok: true, pro: entitlement(a).pro, email: a.email }, 200, { 'set-cookie': await makeCookie(env, a.id) });
    }

    if (path === '/api/portal' && req.method === 'POST') {
      if (!acct) return err(401, 'Sign in first.');
      if (!acct.customer) return err(400, 'No billing account yet.');
      if (liveBlocked(env)) return err(503, 'Live billing has not been approved.');
      const p = await stripe(env, deps, 'POST', 'billing_portal/sessions', { customer: acct.customer, return_url: site + '/account.html' });
      return json({ url: p.url });
    }

    if (path === '/api/login' && req.method === 'POST') {
      const { email } = await req.json().catch(() => ({}));
      if (!validEmail(email)) return err(400, 'Enter a valid email.');
      const e = email.trim().toLowerCase();
      const rl = 'rl:login:' + e, n = +(await env.KV.get(rl) || 0);
      if (n >= 5) return err(429, 'Too many sign in links. Try again in an hour.');
      await env.KV.put(rl, String(n + 1), { expirationTtl: 3600 });
      // Links only go to addresses that already have an account; the reply is the same either way.
      const a = await accountByEmail(env, e, false);
      let dev;
      if (a) {
        const tok = randomId(24);
        await kvPut(env, 'login:' + tok, { a: a.id }, LOGIN_TTL);
        const link = site + '/account.html?login=' + tok;
        const sent = await sendLogin(env, deps, e, link);
        if (!sent && env.DEV_MAIL_ECHO === '1') dev = link; // local testing only
      }
      return json({ ok: true, message: 'If that email has a Watchdog Pro account, a sign in link is on its way.', ...(dev ? { dev_link: dev } : {}) });
    }

    if (path === '/api/login/verify' && req.method === 'POST') {
      const { token } = await req.json().catch(() => ({}));
      if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{20,64}$/.test(token)) return err(400, 'Bad link.');
      const rec = await kvGet(env, 'login:' + token);
      if (!rec) return err(400, 'That link has expired or was already used.');
      await env.KV.delete('login:' + token);
      const a = await kvGet(env, 'acct:' + rec.a);
      if (!a) return err(400, 'Account not found.');
      return json({ ok: true, pro: entitlement(a).pro, email: a.email }, 200, { 'set-cookie': await makeCookie(env, a.id) });
    }

    if (path === '/api/logout' && req.method === 'POST') return json({ ok: true }, 200, { 'set-cookie': 'hwd_s=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0' });

    if (path === '/api/pro/key' && req.method === 'GET') {
      if (!acct) return err(401, 'Sign in to Watchdog Pro.');
      if (!entitlement(acct).pro) return err(402, 'Watchdog Pro is required.');
      const id = url.searchParams.get('id') || '';
      if (!/^([0-9a-f]{10}|names)$/.test(id)) return err(400, 'Bad id.');
      const rk = 'rl:key:' + acct.id + ':' + Math.floor(now() / 3600), n = +(await env.KV.get(rk) || 0);
      if (n >= KEY_RATE) return err(429, 'Too many requests. Try again later.');
      await env.KV.put(rk, String(n + 1), { expirationTtl: 3700 });
      const key = await hmac(env.HWD_PRO_KEY, id === 'names' ? 'names' : 'capper:' + id);
      return json({ key: b64(key) });
    }

    return err(404, 'Not found.');
  } catch (e) {
    return err(502, 'Something went wrong. Please try again.');
  }
}
