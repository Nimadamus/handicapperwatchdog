// One time Stripe setup for Handicapper Watchdog, run after the owner creates the Stripe account.
//
//   STRIPE_SECRET_KEY=sk_test_... node backend/stripe_setup.mjs [--webhook https://handicapperwatchdog.com/api/webhook]
//
// Creates (or finds, by lookup key) the "Watchdog Pro" product with a $19.99 monthly and a $149 yearly price,
// a customer portal configuration (cancel at period end, update card, invoice history), and optionally the
// webhook endpoint. Prints the values to store as Worker secrets. Safe to run twice. Refuses live keys unless
// --live is passed, which is for the day live billing is approved.
const KEY = process.env.STRIPE_SECRET_KEY || '';
const args = process.argv.slice(2);
const webhookUrl = args.includes('--webhook') ? args[args.indexOf('--webhook') + 1] : null;
if (!/^sk_(test|live)_/.test(KEY)) { console.error('Set STRIPE_SECRET_KEY to the Handicapper Watchdog secret key.'); process.exit(1); }
if (KEY.startsWith('sk_live_') && !args.includes('--live')) { console.error('Live key refused. Live billing needs the owner\'s approval and --live.'); process.exit(1); }

function form(obj, prefix, out = []) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v === undefined) continue;
    if (Array.isArray(v)) v.forEach((x, i) => (typeof x === 'object' ? form(x, `${key}[${i}]`, out) : out.push(encodeURIComponent(`${key}[${i}]`) + '=' + encodeURIComponent(x))));
    else if (typeof v === 'object') form(v, key, out); else out.push(encodeURIComponent(key) + '=' + encodeURIComponent(v));
  }
  return out.join('&');
}
async function api(method, path, params) {
  const url = 'https://api.stripe.com/v1/' + path + (method === 'GET' && params ? '?' + form(params) : '');
  const r = await fetch(url, { method, headers: { authorization: 'Bearer ' + KEY, 'content-type': 'application/x-www-form-urlencoded' }, body: method === 'GET' ? undefined : form(params || {}) });
  const d = await r.json();
  if (!r.ok) throw new Error(path + ': ' + (d.error && d.error.message));
  return d;
}

const found = await api('GET', 'prices', { 'lookup_keys[]': undefined, limit: 100, active: 'true', expand: ['data.product'] });
const byKey = Object.fromEntries(found.data.filter((p) => p.lookup_key).map((p) => [p.lookup_key, p]));
let product = (byKey.hwd_pro_monthly || byKey.hwd_pro_annual || {}).product;
if (!product) product = await api('POST', 'products', { name: 'Watchdog Pro', description: 'Names, complete pick logs, search, comparisons and advanced filters on Handicapper Watchdog.', metadata: { app: 'hwd' } });
const monthly = byKey.hwd_pro_monthly || await api('POST', 'prices', { product: product.id, currency: 'usd', unit_amount: 1999, lookup_key: 'hwd_pro_monthly', 'recurring[interval]': 'month', metadata: { app: 'hwd' } });
const annual = byKey.hwd_pro_annual || await api('POST', 'prices', { product: product.id, currency: 'usd', unit_amount: 14900, lookup_key: 'hwd_pro_annual', 'recurring[interval]': 'year', metadata: { app: 'hwd' } });

const portals = await api('GET', 'billing_portal/configurations', { limit: 10, active: 'true' });
let portal = portals.data.find((c) => c.metadata && c.metadata.app === 'hwd');
if (!portal) portal = await api('POST', 'billing_portal/configurations', {
  'business_profile[headline]': 'Manage your Watchdog Pro subscription',
  'features[subscription_cancel][enabled]': 'true', 'features[subscription_cancel][mode]': 'at_period_end',
  'features[payment_method_update][enabled]': 'true', 'features[invoice_history][enabled]': 'true',
  'default_return_url': 'https://handicapperwatchdog.com/account.html', 'metadata[app]': 'hwd' });

let secret = null;
if (webhookUrl) {
  const hooks = await api('GET', 'webhook_endpoints', { limit: 50 });
  if (!hooks.data.find((h) => h.url === webhookUrl)) {
    const h = await api('POST', 'webhook_endpoints', { url: webhookUrl, enabled_events: ['checkout.session.completed', 'customer.subscription.created',
      'customer.subscription.updated', 'customer.subscription.deleted', 'invoice.paid', 'invoice.payment_failed'], metadata: { app: 'hwd' } });
    secret = h.secret;
  } else console.log('Webhook endpoint already exists; its signing secret is shown once in the Stripe dashboard.');
}
console.log('\nStore these as Worker secrets (wrangler secret put NAME):');
console.log('STRIPE_PRICE_MONTHLY =', monthly.id, '($19.99 / month)');
console.log('STRIPE_PRICE_ANNUAL  =', annual.id, '($149 / year)');
if (secret) console.log('STRIPE_WEBHOOK_SECRET = (printed once below, store it now)\n' + secret);
console.log('Portal configuration:', portal.id, '(set as the default in the Stripe dashboard if it is not already)');
