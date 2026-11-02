"""Readiness check for Watchdog Pro staging. Names and file facts only. Does not deploy or read secret values."""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import hwd_secrets

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NEEDED = ('STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICE_MONTHLY', 'STRIPE_PRICE_ANNUAL',
          'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'BREVO_API_KEY', 'MAIL_FROM', 'PURCHASE_NOTIFY_EMAIL')


def read(name):
    with open(os.path.join(ROOT, name), encoding='utf-8') as f:
        return f.read()


def main():
    bad = 0
    staging = read('wrangler.staging.toml')
    prod = read('wrangler.toml')
    if 'workers_dev = true' not in staging or 'routes' in staging:
        bad += 1
        print('FAIL staging toml has a route or workers_dev is off')
    else:
        print('PASS staging toml has no routes and workers_dev is on')
    if 'BILLING_LIVE' in staging and 'BILLING_LIVE = "yes"' in staging:
        bad += 1
        print('FAIL staging toml sets BILLING_LIVE')
    else:
        print('PASS staging toml does not set BILLING_LIVE')
    if 'REPLACE_WITH_STAGING_KV_ID' in staging:
        print('WAIT staging KV id is still a placeholder')
    if 'handicapperwatchdog.com' in prod and 'routes' in prod:
        print('PASS production route stays in wrangler.toml only')
    for page in ('pro-terms.html', 'pro-privacy.html'):
        text = read(page)
        if 'noindex' not in text or 'Draft for your review' not in text:
            bad += 1
            print('FAIL', page, 'is missing the draft notice or noindex')
        else:
            print('PASS', page, 'is draft and noindex')
    d = hwd_secrets.load()
    if (d.get('STRIPE_SECRET_KEY') or '').startswith(('sk_live_', 'rk_live_')) or d.get('BILLING_LIVE') == 'yes':
        bad += 1
        print('FAIL live billing material is in the local store')
    else:
        print('PASS local store has no live Stripe key and BILLING_LIVE is unset')
    missing = [n for n in NEEDED if not d.get(n)]
    print('MISSING', ' '.join(missing) if missing else 'none')
    if missing:
        bad += 1
    print('READY' if bad == 0 else 'NOT_READY')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
