"""Deploy Watchdog Pro staging in Stripe test mode. Never sets BILLING_LIVE. Never deploys the production route.

Refuses a live Stripe key. Prints names only, never secret values.
"""
import os
import secrets
import subprocess
import sys

sys.path.insert(0, os.path.dirname(__file__))
import hwd_secrets

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NEEDED = ('STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICE_MONTHLY', 'STRIPE_PRICE_ANNUAL',
          'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'BREVO_API_KEY', 'MAIL_FROM', 'PURCHASE_NOTIFY_EMAIL')
GENERATE = ('SESSION_SECRET', 'HWD_PRO_KEY', 'HWD_STAGING_MASK_KEY')


def main():
    d = hwd_secrets.load()
    changed = False
    for name in GENERATE:
        if not d.get(name):
            d[name] = secrets.token_urlsafe(32)
            changed = True
            print('generated and stored', name)
    if changed:
        hwd_secrets.save(d)
    key = d.get('STRIPE_SECRET_KEY') or ''
    if key.startswith('sk_live_') or key.startswith('rk_live_'):
        sys.exit('refused: live Stripe key. BILLING_LIVE stays off.')
    if os.environ.get('BILLING_LIVE') == 'yes' or d.get('BILLING_LIVE') == 'yes':
        sys.exit('refused: BILLING_LIVE=yes is not allowed from this deploy.')
    missing = [n for n in NEEDED if not d.get(n)]
    if missing:
        print('Staging was not deployed. Test mode is ready locally. These still need you:')
        for n in missing:
            print('  missing', n)
        print('No production route was deployed. BILLING_LIVE was not set.')
        return 2
    env = os.environ.copy()
    env.update({k: v for k, v in d.items() if k in hwd_secrets.NAMES})
    env['HWD_MASK_KEY'] = d['HWD_STAGING_MASK_KEY']
    env.pop('BILLING_LIVE', None)
    from cf_token_check import scope_ok
    ok, detail = scope_ok(d.get('CLOUDFLARE_API_TOKEN') or '', d.get('CLOUDFLARE_ACCOUNT_ID') or '')
    print(' '.join(detail))
    if not ok:
        print('Cloudflare token cannot stage. Nothing was created. BILLING_LIVE was not set.')
        return 1
    print('building staging site')
    if subprocess.call([sys.executable, 'build.py'], cwd=ROOT, env=env) != 0:
        return 1
    wrangler = ['npx', '--yes', 'wrangler@3', '--config', 'wrangler.staging.toml']
    if 'REPLACE_WITH_STAGING_KV_ID' in open(os.path.join(ROOT, 'wrangler.staging.toml'), encoding='utf-8').read():
        print('creating staging KV namespace')
        out = subprocess.check_output(wrangler + ['kv', 'namespace', 'create', 'HWD'], cwd=ROOT, env=env, text=True)
        import re
        m = re.search(r'id = "([0-9a-f]{32})"', out)
        if not m:
            print('KV namespace was not created')
            return 1
        path = os.path.join(ROOT, 'wrangler.staging.toml')
        text = open(path, encoding='utf-8').read().replace('REPLACE_WITH_STAGING_KV_ID', m.group(1))
        open(path, 'w', encoding='utf-8', newline='\n').write(text)
        print('staging KV created')
    for name in ('STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICE_MONTHLY', 'STRIPE_PRICE_ANNUAL',
                 'SESSION_SECRET', 'HWD_PRO_KEY', 'BREVO_API_KEY', 'MAIL_FROM', 'PURCHASE_NOTIFY_EMAIL'):
        subprocess.run(wrangler + ['secret', 'put', name], cwd=ROOT, env=env, input=d[name], text=True, check=True)
        print('secret set', name)
    if subprocess.call(wrangler + ['deploy'], cwd=ROOT, env=env) != 0:
        return 1
    print('Deployed staging only. Confirm /api/health says "billing":"test". BILLING_LIVE was not set.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
