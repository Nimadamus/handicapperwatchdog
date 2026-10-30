// One time Stripe setup for Handicapper Watchdog, run after the owner creates the Stripe account.
//
//   STRIPE_SECRET_KEY=sk_test_... node backend/stripe_setup.mjs [--webhook https://handicapperwatchdog.com/api/webhook]
//
// Creates (or finds, by lookup key) the "Watchdog Pro" product with a $59.99 monthly and a $499 yearly price,
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

const account = await api('GET', 'account');
const shown = `${account.settings && account.settings.dashboard && account.settings.dashboard.display_name || ''} ${account.business_profile && account.business_profile.name || ''}`;
if (/trustmyrecord|realai|betlegend|bet legend/i.test(shown)) {
  console.error('Refused: this Stripe account is ' + shown.trim() + '. Handicapper Watchdog needs its own account.');
  process.exit(1);
}
const balance = await api('GET', 'balance');
if (balance.livemode && !args.includes('--live')) { console.error('Live account refused. Live billing needs the owner\'s approval and --live.'); process.exit(1); }
console.log('Stripe account:', shown.trim() || '(unnamed)', balance.livemode ? 'live' : 'test');

const found = await api('GET', 'prices', { limit: 100, active: 'true', expand: ['data.product'] });
const byKey = Object.fromEntries(found.data.filter((p) => p.lookup_key).map((p) => [p.lookup_key, p]));
let product = (byKey.hwd_pro_monthly_5999 || byKey.hwd_pro_annual_49900 || {}).product;
if (!product) product = await api('POST', 'products', { name: 'Watchdog Pro', description: 'Names, complete pick logs, search, comparisons and advanced filters on Handicapper Watchdog.', metadata: { app: 'hwd' } });
const monthly = byKey.hwd_pro_monthly_5999 || await api('POST', 'prices', { product: product.id, currency: 'usd', unit_amount: 5999, lookup_key: 'hwd_pro_monthly_5999', 'recurring[interval]': 'month', metadata: { app: 'hwd' } });
const annual = byKey.hwd_pro_annual_49900 || await api('POST', 'prices', { product: product.id, currency: 'usd', unit_amount: 49900, lookup_key: 'hwd_pro_annual_49900', 'recurring[interval]': 'year', metadata: { app: 'hwd' } });

if (monthly.unit_amount !== 5999 || monthly.recurring.interval !== 'month') throw new Error('monthly price is not $59.99 a month');
if (annual.unit_amount !== 49900 || annual.recurring.interval !== 'year') throw new Error('annual price is not $499 a year');
// Older test prices ($19.99 / $149, canceled 2026-10-24) must never be sold: archive any that exist.
for (const old of found.data.filter((p) => ['hwd_pro_monthly', 'hwd_pro_annual'].includes(p.lookup_key))) await api('POST', 'prices/' + old.id, { active: 'false' });
const portals = await api('GET', 'billing_portal/configurations', { limit: 10, active: 'true' });
let portal = portals.data.find((c) => c.metadata && c.metadata.app === 'hwd');
if (!portal) portal = await api('POST', 'billing_portal/configurations', {
  'business_profile[headline]': 'Manage your Watchdog Pro subscription',
  'features[subscription_cancel][enabled]': 'true', 'features[subscription_cancel][mode]': 'at_period_end',
  'features[payment_method_update][enabled]': 'true', 'features[invoice_history][enabled]': 'true',
  'features[subscription_update][enabled]': 'true', 'features[subscription_update][default_allowed_updates][0]': 'price',
  'features[subscription_update][proration_behavior]': 'create_prorations',
  'features[subscription_update][products][0][product]': product.id,
  'features[subscription_update][products][0][prices][0]': monthly.id, 'features[subscription_update][products][0][prices][1]': annual.id,
  'default_return_url': 'https://handicapperwatchdog.com/account.html', 'metadata[app]': 'hwd' });

let secret = null;
if (webhookUrl) {
  const hooks = await api('GET', 'webhook_endpoints', { limit: 50 });
  if (!hooks.data.find((h) => h.url === webhookUrl)) {
    const h = await api('POST', 'webhook_endpoints', { url: webhookUrl, enabled_events: ['checkout.session.completed', 'customer.subscription.created',
      'customer.subscription.updated', 'customer.subscription.deleted', 'invoice.paid', 'invoice.payment_failed'], metadata: { app: 'hwd' } });
    secret = h.secret;
  } else console.log('Webhook endpoint already exists. Copy its signing secret from the Stripe dashboard.');
}
console.log('\nStore these as Worker secrets (wrangler secret put NAME):');
console.log('STRIPE_PRICE_MONTHLY =', monthly.id, '($59.99 / month)');
console.log('STRIPE_PRICE_ANNUAL  =', annual.id, '($499 / year)');
if (secret) {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const dest = path.join(os.homedir(), '.hwd', 'stripe_webhook_once.txt');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, secret, { encoding: 'utf8', flag: 'w' });
  console.log('STRIPE_WEBHOOK_SECRET was written to', dest);
  console.log('It was not printed. Store it, then delete that file.');
}
console.log('Portal configuration:', portal.id);
