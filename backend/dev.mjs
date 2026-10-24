// Local test server: the built site (_site) plus the real API handler, backed by an in-memory KV and a fake
// Stripe that plays the hosted checkout and billing portal, so the whole subscription flow can be clicked
// through in a browser without any Stripe account.
//
//   HWD_PRO_KEY=... node backend/dev.mjs [port]        then open http://localhost:<port>/pricing.html
//
// Fake Stripe pages: /__stripe/checkout?s=<session>  (Pay / Cancel)
//                    /__stripe/portal?c=<customer>     (cancel at period end, payment fails, resume, end now)
// Each action sends a signed webhook to /api/webhook exactly as Stripe would.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handle } from './core.mjs';

const PORT = +(process.argv[2] || 8150);
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '_site');
const BIND = process.env.HWD_DEV_BIND || '127.0.0.1';
const SITE = 'http://' + (BIND === '127.0.0.1' ? 'localhost' : BIND) + ':' + PORT;
const kv = new Map();
const env = {
  KV: { get: async (k) => { const v = kv.get(k); return v && (!v.exp || v.exp > Date.now()) ? v.val : null; },
        put: async (k, val, o) => kv.set(k, { val, exp: o && o.expirationTtl ? Date.now() + o.expirationTtl * 1000 : 0 }), delete: async (k) => kv.delete(k) },
  SITE_URL: SITE, SESSION_SECRET: 'dev_session_secret', HWD_PRO_KEY: process.env.HWD_PRO_KEY || '',
  STRIPE_SECRET_KEY: 'sk_test_dev', STRIPE_WEBHOOK_SECRET: 'whsec_dev', STRIPE_PRICE_MONTHLY: 'price_month_1999', STRIPE_PRICE_ANNUAL: 'price_year_149',
  DEV_MAIL_ECHO: '1',
};
const DAY = 86400, T = () => Math.floor(Date.now() / 1000);
const S = { sessions: {}, subs: {} };
const ok = (d) => new Response(JSON.stringify(d), { status: 200, headers: { 'content-type': 'application/json' } });

async function fakeStripeFetch(url, init) {
  const u = new URL(url), m = init.method || 'GET', p = new URLSearchParams(m === 'GET' ? u.search : init.body);
  let x;
  if (u.pathname === '/v1/checkout/sessions' && m === 'POST') {
    const id = 'cs_test_' + Math.random().toString(36).slice(2, 14);
    S.sessions[id] = { id, object: 'checkout.session', mode: 'subscription', status: 'open', metadata: { app: p.get('metadata[app]') }, price: p.get('line_items[0][price]'),
      customer: p.get('customer') || null, customer_email: p.get('customer_email'), success_url: p.get('success_url').replace('{CHECKOUT_SESSION_ID}', id), cancel_url: p.get('cancel_url'),
      url: SITE + '/__stripe/checkout?s=' + id };
    return ok(S.sessions[id]);
  }
  if ((x = u.pathname.match(/^\/v1\/checkout\/sessions\/(\w+)$/))) { const s = S.sessions[x[1]]; return s ? ok({ ...s, subscription: s.subscription ? S.subs[s.subscription] : null }) : new Response('{"error":{"message":"no such session"}}', { status: 404 }); }
  if ((x = u.pathname.match(/^\/v1\/subscriptions\/(\w+)$/))) return ok(S.subs[x[1]]);
  if (u.pathname === '/v1/billing_portal/sessions') return ok({ url: SITE + '/__stripe/portal?c=' + p.get('customer') });
  return new Response('{"error":{"message":"unhandled"}}', { status: 400 });
}
const deps = { fetch: fakeStripeFetch };

async function webhook(type, object) {
  const body = JSON.stringify({ id: 'evt_' + Math.random().toString(36).slice(2, 12), type, data: { object } });
  const t = T();
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.STRIPE_WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = [...new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(t + '.' + body)))].map((b) => b.toString(16).padStart(2, '0')).join('');
  return handle(new Request(SITE + '/api/webhook', { method: 'POST', headers: { 'stripe-signature': `t=${t},v1=${sig}` }, body }), env, deps);
}

const PAGE = (title, inner) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<body style="font:15px system-ui;background:#f6f9fc;color:#1a1f36;display:grid;place-items:center;min-height:100vh;margin:0"><div style="background:#fff;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.08);padding:28px;max-width:420px;width:90%">
<div style="font-size:12px;color:#697386;letter-spacing:.08em;text-transform:uppercase">Stripe test mode (local fake)</div>${inner}</div>`;

const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.bin': 'text/plain', '.xml': 'application/xml', '.txt': 'text/plain' };

http.createServer(async (req, res) => {
  const u = new URL(req.url, SITE);
  try {
    if (u.pathname.startsWith('/api/')) {
      const chunks = []; for await (const c of req) chunks.push(c);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const r = await handle(new Request(SITE + req.url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body }), env, deps);
      res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer())); return;
    }
    if (u.pathname === '/__stripe/checkout') {
      const s = S.sessions[u.searchParams.get('s')];
      if (u.searchParams.get('pay')) {
        const customer = s.customer || 'cus_' + Math.random().toString(36).slice(2, 10);
        const sub = { id: 'sub_' + Math.random().toString(36).slice(2, 10), object: 'subscription', customer, status: 'active', cancel_at_period_end: false,
          items: { data: [{ price: { id: s.price }, current_period_end: T() + (s.price === env.STRIPE_PRICE_ANNUAL ? 365 : 30) * DAY }] } };
        S.subs[sub.id] = sub;
        Object.assign(s, { status: 'complete', customer, subscription: sub.id, customer_details: { email: u.searchParams.get('email') || 'tester@example.com' } });
        await webhook('checkout.session.completed', { ...s });
        res.writeHead(303, { location: s.success_url }); res.end(); return;
      }
      const amt = s.price === env.STRIPE_PRICE_ANNUAL ? '$149.00 per year' : '$19.99 per month';
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(PAGE('Checkout', `<h2>Subscribe to Watchdog Pro</h2><p style="font-size:22px;margin:4px 0 18px"><b>${amt}</b></p>
        <form><input type="hidden" name="s" value="${s.id}"><input type="hidden" name="pay" value="1"><label>Email<br><input name="email" value="${s.customer_email || 'tester@example.com'}" style="width:100%;padding:9px;margin:4px 0 12px;border:1px solid #ccd"></label>
        <label>Card<br><input value="4242 4242 4242 4242" readonly style="width:100%;padding:9px;margin:4px 0 16px;border:1px solid #ccd"></label>
        <button style="width:100%;padding:12px;background:#635bff;color:#fff;border:0;border-radius:6px;font-weight:600">Subscribe</button></form>
        <p><a href="${s.cancel_url}">Back</a></p>`));
      return;
    }
    if (u.pathname === '/__stripe/portal') {
      const c = u.searchParams.get('c'), sub = Object.values(S.subs).find((x) => x.customer === c);
      const act = u.searchParams.get('act');
      if (act && sub) {
        if (act === 'cancel') sub.cancel_at_period_end = true;
        if (act === 'resume') { sub.cancel_at_period_end = false; sub.status = 'active'; }
        if (act === 'fail') { sub.status = 'past_due'; await webhook('invoice.payment_failed', { customer: c, subscription: sub.id }); }
        if (act === 'renew') { sub.status = 'active'; sub.items.data[0].current_period_end += 30 * DAY; await webhook('invoice.paid', { customer: c, subscription: sub.id, status_transitions: { paid_at: T() } }); }
        if (act === 'end') sub.status = 'canceled';
        await webhook(act === 'end' ? 'customer.subscription.deleted' : 'customer.subscription.updated', { ...sub });
        res.writeHead(303, { location: SITE + '/account.html' }); res.end(); return;
      }
      const b = (a, t) => `<p><a href="?c=${c}&act=${a}" style="display:block;padding:10px;border:1px solid #dde;border-radius:6px;text-decoration:none;color:#1a1f36">${t}</a></p>`;
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(PAGE('Billing', `<h2>Manage billing</h2><p>Status: <b>${sub ? sub.status + (sub.cancel_at_period_end ? ', cancels at period end' : '') : 'none'}</b></p>` +
        b('cancel', 'Cancel at period end') + b('resume', 'Resume') + b('fail', 'Simulate a failed renewal payment') + b('renew', 'Simulate a successful renewal') + b('end', 'End subscription now') +
        `<p><a href="${SITE}/account.html">Return to Handicapper Watchdog</a></p>`));
      return;
    }
    let f = normalize(decodeURIComponent(u.pathname)).replace(/^[\\/]+/, '') || 'index.html';
    if (f.includes('..')) { res.writeHead(400); res.end(); return; }
    const data = await readFile(join(ROOT, f));
    res.writeHead(200, { 'content-type': types[extname(f)] || 'application/octet-stream' }); res.end(data);
  } catch (e) {
    res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found');
  }
}).listen(PORT, BIND,() => console.log('dev server ' + SITE));
