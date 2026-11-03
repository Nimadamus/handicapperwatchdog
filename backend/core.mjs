// Watchdog Pro API: accounts, Stripe subscriptions, entitlements and Pro data keys.
//
// Runs as a Cloudflare Pages Function (functions/api/[[path]].js) next to the static site, so the session
// cookie is first party. Everything external is passed in: env (secrets, KV binding) and deps.fetch (Stripe,
// email), which is what lets backend/test.mjs drive every path with a fake Stripe.
//
// Billing safety: a live Stripe key is refused unless env.BILLING_LIVE === 'yes'. That switch is the owner's.
//
// Pro data never passes through here. The build publishes each capper's full graded pick ledger encrypted with its own
// key (HMAC(HWD_PRO_KEY, 'capper:' + id)) and the eligible pending picks under HMAC(HWD_PRO_KEY, 'pending'); this API
// only hands those keys to a signed in subscriber. No plan ever receives a handicapper name, handle or account link.

const enc = new TextEncoder();
const DAY = 86400;
const GRACE_DAYS = 3;          // past_due keeps access this long past the period end while Stripe retries
const SESSION_DAYS = 30;
const LOGIN_TTL = 15 * 60;
const KEY_RATE = 400;          // capper keys per account per hour
const KEY_COUNTS = new Map();

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

// ---------- first party funnel counters (no personal data: event, traffic source host, landing path, offer slot) ----------
// Aggregate daily counts only, keyed by Pacific date, kept 120 days. Read back with GET /api/ev/summary (alerts token).
const EVENTS = new Set(['land', 'pricing', 'offer_click', 'checkout', 'cancel']);
const BOTS = /bot|crawl|spider|slurp|headless|lighthouse|preview|facebookexternalhit|embedly|monitor/i;
const tag = (v, n) => String(v || '').toLowerCase().replace(/[^a-z0-9./|_-]/g, '').slice(0, n);
const ptDate = (t = Date.now()) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
export function attribution(a) {
  a = a && typeof a === 'object' ? a : {};
  return { src: tag(a.s, 40) || 'unknown', landing: tag(a.l, 60) || 'unknown', slot: tag(a.slot, 60) || 'none' };
}
async function countEvent(env, body, ua) {
  if (!body || !EVENTS.has(body.e) || BOTS.test(ua || '')) return false;
  const a = attribution(body), key = 'ev:' + ptDate();
  const day = (await kvGet(env, key)) || {};
  const k = [body.e, a.src, body.e === 'land' ? a.landing : body.e === 'offer_click' ? a.slot : '-'].join(' ');
  if (!(k in day) && Object.keys(day).length >= 600) return false;   // a flood of made up sources cannot grow the record without limit
  day[k] = (day[k] || 0) + 1;
  await kvPut(env, key, day, 120 * 86400);
  return true;
}

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
    body: method === 'GET' || method === 'DELETE' ? undefined : form(params || {}),
  });
  const d = await r.json();
  if (!r.ok) throw new Error('stripe ' + path + ': ' + ((d.error && d.error.message) || r.status));
  return d;
}
const billingReady = (env) => !!(env.STRIPE_SECRET_KEY && env.STRIPE_PRICE_MONTHLY && env.STRIPE_PRICE_ANNUAL);
const liveBlocked = (env) => /^(sk|rk)_live_/.test(env.STRIPE_SECRET_KEY || '') && env.BILLING_LIVE !== 'yes';
const planOf = (env, priceId) => priceId === env.STRIPE_PRICE_ANNUAL ? 'annual' : priceId === env.STRIPE_PRICE_MONTHLY ? 'monthly' : 'other';
const BILLABLE = new Set(['active', 'trialing', 'past_due']);
const priceIdOf = (sub) => {
  const item = sub && sub.items && sub.items.data && sub.items.data[0];
  const price = item && item.price;
  if (!price) return '';
  return typeof price === 'string' ? price : (price.id || '');
};
// Only Watchdog Pro prices. A shared Stripe account must never treat another product as ours.
const isOurPrice = (env, sub) => {
  const id = priceIdOf(sub);
  return !!id && (id === env.STRIPE_PRICE_MONTHLY || id === env.STRIPE_PRICE_ANNUAL);
};
// Basil moved Invoice.subscription under parent.subscription_details, and a line can carry it too.
function invoiceSubscriptionId(o) {
  if (!o) return '';
  if (typeof o.subscription === 'string') return o.subscription;
  const parent = o.parent && o.parent.subscription_details && o.parent.subscription_details.subscription;
  if (typeof parent === 'string') return parent;
  for (const line of (o.lines && o.lines.data) || []) {
    const id = line && line.parent && line.parent.subscription_item_details && line.parent.subscription_item_details.subscription;
    if (typeof id === 'string') return id;
  }
  return '';
}
const planLabel = (plan) => plan === 'annual' ? 'annual ($499 a year)' : plan === 'monthly' ? 'monthly ($49.99 a month)' : (plan || 'Watchdog Pro');
const pacificNow = () => new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

async function customersByEmail(env, deps, email) {
  const list = await stripe(env, deps, 'GET', 'customers', { email, limit: 10 });
  return (list.data || []).filter((c) => c && c.id && c.email && c.email.toLowerCase() === email);
}
async function ourBillableSub(env, deps, customerId) {
  if (!customerId) return null;
  const list = await stripe(env, deps, 'GET', 'subscriptions', { customer: customerId, status: 'all', limit: 20 });
  return (list.data || []).find((s) => BILLABLE.has(s.status) && isOurPrice(env, s)) || null;
}
function paymentIntentId(inv) {
  if (!inv || typeof inv !== 'object') return '';
  const legacy = typeof inv.payment_intent === 'string' ? inv.payment_intent : (inv.payment_intent && inv.payment_intent.id);
  if (legacy) return legacy;
  const rows = (inv.payments && inv.payments.data) || [];
  for (const row of rows) {
    const p = row && row.payment && row.payment.payment_intent;
    const id = typeof p === 'string' ? p : (p && p.id);
    if (id) return id;
  }
  return '';
}
// Basil (2025-03-31) removed Invoice.payment_intent. Older webhooks still send it.
async function refundInvoice(env, deps, inv) {
  if (!inv || typeof inv !== 'object') return false;
  let pi = paymentIntentId(inv);
  if (!pi && inv.id) {
    try {
      const list = await stripe(env, deps, 'GET', 'invoice_payments', { invoice: inv.id, limit: 5 });
      pi = paymentIntentId({ payments: list });
    } catch { /* no payment to refund */ }
  }
  if (!pi) return false;
  try { await stripe(env, deps, 'POST', 'refunds', { payment_intent: pi }); } catch { /* already refunded or not captured */ }
  return true;
}
async function cancelDuplicate(env, deps, sub) {
  const id = typeof sub === 'string' ? sub : sub.id;
  let full = typeof sub === 'object' ? sub : null;
  if (!full || !full.latest_invoice) {
    try { full = await stripe(env, deps, 'GET', 'subscriptions/' + id, { 'expand[0]': 'latest_invoice' }); } catch { full = full || { id }; }
  }
  const inv = full && full.latest_invoice;
  try { await stripe(env, deps, 'DELETE', 'subscriptions/' + id); }
  catch (e) { if (!/canceled|No such subscription/i.test(String(e && e.message))) throw e; }
  return refundInvoice(env, deps, inv);
}

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
      let sub = o.subscription;
      if (typeof sub === 'string') sub = await stripe(env, deps, 'GET', 'subscriptions/' + sub);
      if (sub) await adoptSubscription(env, deps, a, sub);
      else await saveAccount(env, a);
      if (a.email) await env.KV.delete('openchk:' + a.email);
      break;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const a = await byCustomer(o.customer, null);
      if (!a || !isOurPrice(env, o)) break; // another product on a shared Stripe account is not ours
      if (evt.type !== 'customer.subscription.deleted' && a.subscription && a.subscription !== o.id && entitlement(a).pro) {
        await cancelDuplicate(env, deps, o);
        break;
      }
      applySubscription(env, a, o);
      await saveAccount(env, a);
      if (evt.type === 'customer.subscription.deleted') {
        await sendOnce(env, deps, 'mail:ended:' + o.id, a.email, 'Your Watchdog Pro subscription has ended',
          `Your Watchdog Pro subscription has ended.\n\nThe rankings stay free. You can subscribe again at ${env.SITE_URL || 'https://handicapperwatchdog.com'}/pricing.html`);
      }
      break;
    }
    case 'invoice.paid':
    case 'invoice.payment_failed': {
      const a = await byCustomer(o.customer, null);
      if (!a) break;
      const subId = invoiceSubscriptionId(o);
      const sub = subId ? await stripe(env, deps, 'GET', 'subscriptions/' + subId) : null;
      // An invoice with no Watchdog price must not flag this account or clear a real failure.
      if (!sub || !isOurPrice(env, sub)) break;
      if (sub && a.subscription && a.subscription !== sub.id && entitlement(a).pro) {
        await cancelDuplicate(env, deps, sub);
        break;
      }
      if (evt.type === 'invoice.paid') { a.last_paid = o.status_transitions && o.status_transitions.paid_at || now(); a.payment_failed = false; }
      else { a.payment_failed = true; a.payment_failed_at = now(); }
      if (sub) applySubscription(env, a, sub);
      await saveAccount(env, a);
      if (evt.type === 'invoice.payment_failed') {
        await sendOnce(env, deps, 'mail:fail:' + (o.id || evt.id), a.email, 'Watchdog Pro payment failed',
          `Your Watchdog Pro renewal payment did not go through.\n\nPro stays on for ${GRACE_DAYS} days while Stripe retries. Update your card from ${env.SITE_URL || 'https://handicapperwatchdog.com'}/account.html so access does not end.`);
      }
      break;
    }
    default:
      break;
  }
  await env.KV.put('evt:' + evt.id, '1', { expirationTtl: 30 * DAY });
  return json({ ok: true });
}

// ---------- email ----------
async function sendMail(env, deps, to, subject, text, replyTo) {
  if (!validEmail(to) || !subject || !text) return false;
  // QA accounts never send real mail (owner asked 2026-11-02: no test emails to his inbox).
  if (env.DEV_MAIL_ECHO !== '1' && /\+hwdqa|qa-hwd-probe/i.test(to + ' ' + text + ' ' + (replyTo || ''))) return true;
  if (env.DEV_MAIL_ECHO === '1') {
    const log = (await kvGet(env, 'dev:mails')) || [];
    log.push({ to, subject, text, replyTo });
    await kvPut(env, 'dev:mails', log);
  }
  if (env.BREVO_API_KEY && env.MAIL_FROM) {
    const r = await deps.fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST', headers: { 'api-key': env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ sender: { email: env.MAIL_FROM, name: 'Handicapper Watchdog' }, to: [{ email: to }], subject, textContent: text, ...(replyTo && validEmail(replyTo) ? { replyTo: { email: replyTo } } : {}) }) });
    return r.ok;
  }
  if (env.RESEND_API_KEY && env.MAIL_FROM) {
    const r = await deps.fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { authorization: 'Bearer ' + env.RESEND_API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject, text, ...(replyTo && validEmail(replyTo) ? { reply_to: replyTo } : {}) }) });
    return r.ok;
  }
  return env.DEV_MAIL_ECHO === '1';
}
async function sendOnce(env, deps, key, to, subject, text) {
  if (!to || await env.KV.get(key)) return;
  const ok = await sendMail(env, deps, to, subject, text);
  if (!ok) {
    // A configured provider that failed must not be marked sent. The webhook then
    // returns 502 so Stripe retries. No provider means local dev, and that stays quiet.
    if (env.BREVO_API_KEY || env.RESEND_API_KEY) throw new Error('mail not sent');
    return;
  }
  await env.KV.put(key, '1', { expirationTtl: 400 * DAY });
}
async function sendPurchaseNotices(env, deps, a) {
  if (!a || !a.email || !a.subscription) return;
  const plan = planLabel(a.plan);
  const site = env.SITE_URL || 'https://handicapperwatchdog.com';
  await sendOnce(env, deps, 'mail:purchase:' + a.subscription, a.email, 'Your Watchdog Pro subscription',
    `You are subscribed to Watchdog Pro (${plan}).\n\nComplete graded pick ledgers on every profile, eligible pending picks before the start, and side by side comparisons are unlocked now. Handicapper names and account links are not part of any plan.\n\nManage or cancel any time: ${site}/account.html\n\nSign in later from that page with this email. Stripe also emails a receipt.`);
  const owner = (env.PURCHASE_NOTIFY_EMAIL || '').trim().toLowerCase();
  if (owner && owner !== a.email.toLowerCase()) {
    await sendOnce(env, deps, 'mail:owner:' + a.subscription, owner, 'New Watchdog Pro subscription',
      `New Watchdog Pro subscription.\n\nEmail: ${a.email}\nPlan: ${plan}\nStatus: ${a.status}\nSubscription: ${a.subscription}\nTime: ${pacificNow()} PT`);
  }
}
async function sendLogin(env, deps, email, link) {
  const text = `Sign in to Handicapper Watchdog:\n\n${link}\n\nThe link works once and expires in 15 minutes. If you did not ask for it, ignore this email.`;
  return sendMail(env, deps, email, 'Your Handicapper Watchdog sign in link', text);
}

// Keep one billable Watchdog Pro subscription per account. A second one is canceled and refunded.
async function adoptSubscription(env, deps, a, sub) {
  if (!sub || !isOurPrice(env, sub)) return { account: a, duplicate: false };
  const fresh = (await kvGet(env, 'acct:' + a.id)) || a;
  if (fresh.subscription && fresh.subscription !== sub.id && entitlement(fresh).pro) {
    const refunded = await cancelDuplicate(env, deps, sub);
    await sendOnce(env, deps, 'mail:dup:' + sub.id, fresh.email || a.email, 'Duplicate Watchdog Pro checkout canceled',
      `You already have Watchdog Pro, so this extra checkout was canceled${refunded ? ' and the charge was refunded' : ''}.\n\nManage the subscription you already have: ${env.SITE_URL || 'https://handicapperwatchdog.com'}/account.html`);
    return { account: fresh, duplicate: true };
  }
  const base = { ...fresh, customer: sub.customer || fresh.customer || a.customer };
  applySubscription(env, base, sub);
  await saveAccount(env, base);
  if (entitlement(base).pro) await sendPurchaseNotices(env, deps, base);
  return { account: base, duplicate: false };
}


// ---------- pregame alerts ----------
// Opt-in email when a followed anonymous account posts an eligible pending pick. The scheduler (GitHub Actions, after
// each site build) calls POST /api/alerts/run with ALERTS_TOKEN; the API decrypts the same pending.bin the site serves.
const ALERT_MAX_PER_DAY = 8;
async function unsubSig(env, id) { return hex(await hmac(env.SESSION_SECRET, 'unsub:' + id)).slice(0, 32); }
async function setAlerts(env, a, on) {
  a.alerts = !!on;
  const set = new Set((await kvGet(env, 'alertset')) || []);
  if (on) set.add(a.id); else set.delete(a.id);
  await kvPut(env, 'alertset', [...set]);
  await saveAccount(env, a);
}
async function loadPending(env, deps) {
  const site = env.SITE_URL || 'https://handicapperwatchdog.com';
  const r = await deps.fetch(site + '/data/x/pending.bin?alerts=' + Date.now(), { cache: 'no-store' });
  if (!r.ok) throw new Error('pending.bin ' + r.status);
  const raw = Uint8Array.from(atob((await r.text()).trim()), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', await hmac(env.HWD_PRO_KEY, 'pending'), 'AES-GCM', false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, key, raw.slice(12));
  return JSON.parse(new TextDecoder().decode(plain));
}
async function runAlerts(env, deps, nowMs = Date.now()) {
  const d = await loadPending(env, deps);
  const picks = (d.picks || []).filter((p) => p.id && p.start && Date.parse(p.start) > nowMs);
  const site = env.SITE_URL || 'https://handicapperwatchdog.com';
  const out = { accounts: 0, emails: 0, picks: 0 };
  for (const id of (await kvGet(env, 'alertset')) || []) {
    const a = await kvGet(env, 'acct:' + id);
    if (!a || !a.alerts || !entitlement(a).pro || !(a.follows || []).length) continue;
    out.accounts++;
    const fresh = [];
    for (const p of picks.filter((x) => a.follows.includes(x.id))) {
      const k = 'al:' + a.id + ':' + hex(await crypto.subtle.digest('SHA-256', enc.encode([p.id, p.matchup, p.selection, p.start].join('|')))).slice(0, 24);
      if (await env.KV.get(k)) continue;
      fresh.push([k, p]);
    }
    if (!fresh.length) continue;
    const day = new Date(nowMs).toISOString().slice(0, 10), rk = 'alday:' + a.id + ':' + day, n = +(await env.KV.get(rk) || 0);
    if (n >= ALERT_MAX_PER_DAY) continue;
    const when = (iso) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', hour: 'numeric', minute: '2-digit' }) + ' PT';
    const lines = fresh.slice(0, 20).map(([, p]) => `#${p.id.slice(0, 6).toUpperCase()} (${p.cw}-${p.cl}${p.cp ? '-' + p.cp : ''}, ${p.cu > 0 ? '+' : ''}${p.cu} units)
  ${p.league}: ${p.matchup}
  ${p.selection}${p.odds != null ? ' (' + (p.odds > 0 ? '+' : '') + p.odds + ')' : ''}, starts ${when(p.start)}`);
    const unsub = `${env.API_URL || 'https://api.handicapperwatchdog.com'}/api/alerts/off?a=${a.id}&s=${await unsubSig(env, a.id)}`;
    const ok = await sendMail(env, deps, a.email, fresh.length === 1 ? 'New pick from an account you follow' : fresh.length + ' new picks from accounts you follow',
      `Accounts you follow on Handicapper Watchdog posted ${fresh.length === 1 ? 'an eligible pick' : 'eligible picks'} before the start:

${lines.join('\n\n')}${fresh.length > 20 ? '\n\n...and ' + (fresh.length - 20) + ' more' : ''}

All of today's picks: ${site}/picks.html

Records are past results, not predictions or a guarantee. 21+. Gambling problem? Call 1 800 GAMBLER.

Stop these alerts: ${unsub}
Or turn them off from ${site}/account.html`);
    if (!ok) continue;
    for (const [k] of fresh) await env.KV.put(k, '1', { expirationTtl: 4 * DAY });
    await env.KV.put(rk, String(n + 1), { expirationTtl: 2 * DAY });
    out.emails++; out.picks += fresh.length;
  }
  return out;
}

// ---------- router ----------
// The site is static on GitHub Pages and the API answers on api.handicapperwatchdog.com, so the site's own origin gets
// credentialed CORS. Any other origin gets no CORS headers (and its POSTs are refused below).
export async function handle(req, env, deps = { fetch }) {
  const origin = req.headers.get('origin');
  const site = new URL(env.SITE_URL || req.url).origin;
  const cors = origin && origin === site && origin !== new URL(req.url).origin;
  if (req.method === 'OPTIONS') {
    if (!cors) return new Response(null, { status: 403 });
    return new Response(null, { status: 204, headers: { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true',
      'access-control-allow-methods': 'GET, POST', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '600', vary: 'Origin' } });
  }
  const res = await route(req, env, deps);
  if (!cors) return res;
  const out = new Response(res.body, res);
  out.headers.set('access-control-allow-origin', origin);
  out.headers.set('access-control-allow-credentials', 'true');
  out.headers.append('vary', 'Origin');
  return out;
}

async function route(req, env, deps) {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, '');
  const site = env.SITE_URL || url.origin;
  try {
    if (path === '/api/webhook' && req.method === 'POST') return await onWebhook(req, env, deps);
    if (path === '/api/alerts/run' && req.method === 'POST') {
      const t = req.headers.get('x-alerts-token') || '';
      if (!env.ALERTS_TOKEN || !safeEqual(t, env.ALERTS_TOKEN)) return err(401, 'no');
      return json(await runAlerts(env, deps));
    }
    if (path === '/api/alerts/off' && req.method === 'GET') {
      const id = url.searchParams.get('a') || '', sig = url.searchParams.get('s') || '';
      const a = /^[A-Za-z0-9_-]{8,40}$/.test(id) && safeEqual(sig, await unsubSig(env, id)) ? await kvGet(env, 'acct:' + id) : null;
      if (a) await setAlerts(env, a, false);
      return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Alerts</title><body style="font:16px system-ui;background:#0b1220;color:#e6edf6;padding:40px"><h1 style="font-size:22px">${a ? 'Pick alerts are off' : 'That link is not valid'}</h1><p>${a ? 'You will not get more pick alert emails. Turn them back on any time from your account page.' : 'Turn alerts off from your account page instead.'}</p><p><a style="color:#e7c675" href="${env.SITE_URL || 'https://handicapperwatchdog.com'}/account.html">Your account</a></p></body>`, { status: a ? 200 : 400, headers: { 'content-type': 'text/html; charset=utf-8' } });
    }

    if (path === '/api/ev/summary' && req.method === 'GET') {
      const t = req.headers.get('x-alerts-token') || '';
      if (!env.ALERTS_TOKEN || !safeEqual(t, env.ALERTS_TOKEN)) return err(401, 'no');
      const n = Math.min(120, Math.max(1, parseInt(url.searchParams.get('days') || '30', 10) || 30)), out = {};
      for (let i = 0; i < n; i++) { const d = ptDate(Date.now() - i * 86400000); const v = await kvGet(env, 'ev:' + d); if (v) out[d] = v; }
      return json({ days: out });
    }

    // every other POST must come from our own pages
    if (req.method === 'POST') {
      const origin = req.headers.get('origin');
      if (origin !== new URL(site).origin) return err(403, 'cross origin request refused');
    }
    const acct = await readSession(env, req);

    if (path === '/api/health') return json({ ok: true, billing: billingReady(env) ? (liveBlocked(env) ? 'live key present, not approved' : /_live_/.test(env.STRIPE_SECRET_KEY) ? 'live' : 'test') : 'not configured' });

    if (path === '/api/dev/mails' && req.method === 'GET') {
      if (env.DEV_MAIL_ECHO !== '1') return err(404, 'Not found.');
      return json({ mails: (await kvGet(env, 'dev:mails')) || [] });
    }

    if (path === '/api/ev' && req.method === 'POST') {
      let body = null;
      try { body = JSON.parse((await req.text()).slice(0, 2000)); } catch { body = null; }
      return json({ ok: await countEvent(env, body, req.headers.get('user-agent')) });
    }

    if (path === '/api/me' && req.method === 'GET') {
      const e = entitlement(acct);
      return json({ signed_in: !!acct, email: acct && acct.email, pro: e.pro, reason: e.reason, plan: acct && acct.plan || null,
        status: acct && acct.status || null, period_end: acct && acct.period_end || null, cancel_at_period_end: !!(acct && acct.cancel_at_period_end), alerts: !!(acct && acct.alerts), follows: acct && acct.follows ? acct.follows.length : 0,
        payment_failed: !!(acct && acct.payment_failed), billing: billingReady(env) && !liveBlocked(env) });
    }

    if (path === '/api/checkout' && req.method === 'POST') {
      if (!billingReady(env)) return err(503, 'Checkout is not open yet.');
      if (liveBlocked(env)) return err(503, 'Live billing has not been approved.');
      const body = await req.json().catch(() => ({}));
      const plan = body.plan;
      const price = plan === 'annual' ? env.STRIPE_PRICE_ANNUAL : plan === 'monthly' ? env.STRIPE_PRICE_MONTHLY : null;
      if (!price) return err(400, 'Unknown plan.');
      if (acct && entitlement(acct).pro) return err(409, 'You already have Watchdog Pro. Manage it from your account.');
      const email = acct && acct.email ? acct.email : (validEmail(body.email) ? body.email.trim().toLowerCase() : '');
      let customerId = acct && acct.customer || null;
      const customerIds = new Set(customerId ? [customerId] : []);
      if (email) for (const c of await customersByEmail(env, deps, email)) customerIds.add(c.id);
      for (const id of customerIds) {
        if (await ourBillableSub(env, deps, id)) return err(409, 'This email already has Watchdog Pro. Sign in and manage billing instead of starting another subscription.');
      }
      if (!customerId && customerIds.size) customerId = [...customerIds][0];
      if (email) {
        const prev = await kvGet(env, 'openchk:' + email);
        if (prev && prev.id) {
          let open = null;
          try { open = await stripe(env, deps, 'GET', 'checkout/sessions/' + prev.id); } catch { open = null; }
          if (open && open.status === 'open' && prev.plan === plan) return json({ url: open.url || prev.url });
          if (open && open.status === 'open') {
            try { await stripe(env, deps, 'POST', 'checkout/sessions/' + prev.id + '/expire'); } catch { /* session already closed */ }
          }
        }
      }
      const at = attribution(body.attr);
      const s = await stripe(env, deps, 'POST', 'checkout/sessions', {
        'metadata[src]': at.src, 'metadata[landing]': at.landing, 'metadata[slot]': at.slot,
        'subscription_data[metadata][src]': at.src, 'subscription_data[metadata][landing]': at.landing, 'subscription_data[metadata][slot]': at.slot,
        mode: 'subscription', 'line_items[0][price]': price, 'line_items[0][quantity]': 1,
        success_url: site + '/account.html?session_id={CHECKOUT_SESSION_ID}', cancel_url: site + '/pricing.html?canceled=1',
        allow_promotion_codes: 'true', 'metadata[app]': 'hwd',
        // Shared Stripe account: show the Watchdog name and colors on Checkout, not the account's business name.
        'branding_settings[display_name]': 'Handicapper Watchdog', 'branding_settings[background_color]': '#0b1220', 'branding_settings[button_color]': '#e7c675', 'subscription_data[metadata][app]': 'hwd',
        customer: customerId || undefined, customer_email: !customerId && email ? email : undefined,
        client_reference_id: acct ? 'hwd_' + acct.id : undefined });
      if (email) await kvPut(env, 'openchk:' + email, { id: s.id, url: s.url, plan }, 30 * 60);
      return json({ url: s.url });
    }

    if (path === '/api/checkout/complete' && req.method === 'GET') {
      const sid = url.searchParams.get('session_id') || '';
      if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sid)) return err(400, 'Bad session.');
      const s = await stripe(env, deps, 'GET', 'checkout/sessions/' + sid, { 'expand[0]': 'subscription' });
      if (s.mode !== 'subscription' || (s.metadata && s.metadata.app) !== 'hwd' || s.status !== 'complete') return err(400, 'That checkout is not complete.');
      if (s.payment_status && s.payment_status !== 'paid' && s.payment_status !== 'no_payment_required') return err(400, 'Payment is not confirmed.');
      // one browser signs in from a given checkout, once: the session id is in the URL and could be shared
      if (await env.KV.get('cs:' + sid)) return err(409, 'This checkout was already used to sign in. Use the email sign in link instead.');
      let a = s.customer && await env.KV.get('cust:' + s.customer).then((id) => id && kvGet(env, 'acct:' + id));
      if (!a) a = await accountByEmail(env, (s.customer_details && s.customer_details.email) || s.customer_email, true);
      a.customer = s.customer;
      let duplicate = false;
      if (s.subscription && typeof s.subscription === 'object') {
        const adopted = await adoptSubscription(env, deps, a, s.subscription);
        a = adopted.account; duplicate = adopted.duplicate;
      } else await saveAccount(env, a);
      if (a.email) await env.KV.delete('openchk:' + a.email);
      await env.KV.put('cs:' + sid, a.id, { expirationTtl: 90 * DAY });
      return json({ ok: true, pro: entitlement(a).pro, email: a.email, plan: a.plan || null, duplicate }, 200, { 'set-cookie': await makeCookie(env, a.id) });
    }

    if (path === '/api/portal' && req.method === 'POST') {
      if (!acct) return err(401, 'Sign in first.');
      if (!acct.customer) return err(400, 'No billing account yet.');
      if (liveBlocked(env)) return err(503, 'Live billing has not been approved.');
      const p = await stripe(env, deps, 'POST', 'billing_portal/sessions', { customer: acct.customer, return_url: site + '/account.html', configuration: env.STRIPE_PORTAL_CONFIG || undefined });
      return json({ url: p.url });
    }

    if (path === '/api/alerts' && req.method === 'POST') {
      if (!acct) return err(401, 'Sign in first.');
      const b = await req.json().catch(() => ({}));
      if (b.on && !entitlement(acct).pro) return err(402, 'Pick alerts are part of Watchdog Pro.');
      await setAlerts(env, acct, !!b.on);
      return json({ alerts: acct.alerts });
    }

    // Followed handicappers (anonymous Watchdog IDs), stored on the account. Pro feature; list kept even if Pro lapses.
    if (path === '/api/follows') {
      if (!acct) return err(401, 'Sign in to follow handicappers.');
      if (req.method === 'GET') return json({ ids: acct.follows || [] });
      if (req.method === 'POST') {
        if (!entitlement(acct).pro) return err(402, 'Following is part of Watchdog Pro.');
        const b = await req.json().catch(() => ({}));
        const id = String(b.id || '').toLowerCase();
        if (!/^[0-9a-f]{6,16}$/.test(id)) return err(400, 'Unknown Watchdog ID.');
        const set = new Set(acct.follows || []);
        if (b.on === false) set.delete(id); else { if (!set.has(id) && set.size >= 100) return err(400, 'You can follow up to 100 handicappers.'); set.add(id); }
        acct.follows = [...set];
        await saveAccount(env, acct);
        return json({ ids: acct.follows });
      }
    }

    // Support: the site has no inbox, so the form mails the owner with the customer as reply-to and keeps a copy in KV.
    if (path === '/api/contact' && req.method === 'POST') {
      const b = await req.json().catch(() => ({}));
      if (b.website) return json({ ok: true }); // honeypot
      const email = String(b.email || '').trim().toLowerCase(), topic = String(b.topic || 'Question').slice(0, 60);
      const message = String(b.message || '').trim();
      if (!validEmail(email)) return err(400, 'Enter a valid email so we can reply.');
      if (message.length < 10) return err(400, 'Add a few more words so we can help.');
      if (message.length > 4000) return err(400, 'Keep the message under 4,000 characters.');
      const ip = req.headers.get('cf-connecting-ip') || 'x';
      for (const k of ['rl:contact:ip:' + ip, 'rl:contact:em:' + email]) {
        const n = +(await env.KV.get(k) || 0);
        if (n >= 5) return err(429, 'Too many messages. Try again in an hour.');
        await env.KV.put(k, String(n + 1), { expirationTtl: 3600 });
      }
      const ent = acct ? entitlement(acct) : null;
      const id = Date.now().toString(36) + randomId(4);
      await kvPut(env, 'contact:' + id, { email, topic, message, pro: !!(ent && ent.pro), at: now() }, 180 * DAY);
      const owner = env.SUPPORT_EMAIL || env.PURCHASE_NOTIFY_EMAIL;
      const sent = owner && await sendMail(env, deps, owner, 'Watchdog support: ' + topic,
        `From: ${email}${acct ? (ent && ent.pro ? ' (Watchdog Pro member)' : ' (signed in, not Pro)') : ''}
Topic: ${topic}
Ref: ${id}

${message}

Reply to this email to answer the customer.`, email);
      await sendMail(env, deps, email, 'We received your message',
        `Thanks for writing to Handicapper Watchdog. Your message (ref ${id}) reached us and we reply by email, usually within one business day.

Billing: manage or cancel Watchdog Pro any time at ${site}/account.html

Your message:
${message}`);
      return sent ? json({ ok: true, ref: id }) : err(503, 'The message could not be sent right now. Please try again shortly.');
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
        await sendLogin(env, deps, e, link);
        if (env.DEV_MAIL_ECHO === '1') dev = link; // local testing only; never set this in production
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
      if (!/^([0-9a-f]{10}|pending)$/.test(id)) return err(400, 'Bad id.');
      // Counted in memory per Worker instance, not in KV: KV's free tier allows 1,000 writes a day and every
      // profile a subscriber opens asks for a key. A best effort cap per instance is enough to stop bulk copying.
      const rk = acct.id + ':' + Math.floor(now() / 3600), n = (KEY_COUNTS.get(rk) || 0) + 1;
      if (KEY_COUNTS.size > 5000) KEY_COUNTS.clear();
      KEY_COUNTS.set(rk, n);
      if (n > KEY_RATE) return err(429, 'Too many requests. Try again later.');
      const key = await hmac(env.HWD_PRO_KEY, id === 'pending' ? 'pending' : 'capper:' + id);
      return json({ key: b64(key) });
    }

    return err(404, 'Not found.');
  } catch (e) {
    return err(502, 'Something went wrong. Please try again.');
  }
}
