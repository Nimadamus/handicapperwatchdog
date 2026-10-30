"""Local secret store for the Watchdog Pro launch, so keys never go through chat.

Secrets are encrypted with Windows DPAPI (readable only by this Windows user on this machine) in
%USERPROFILE%\\.hwd\\secrets.dpapi.

  python tools/hwd_secrets.py set STRIPE_SECRET_KEY       prompts for the value without echoing it
  python tools/hwd_secrets.py list                        names only, never values
  python tools/hwd_secrets.py run -- node backend/stripe_setup.mjs --webhook https://handicapperwatchdog.com/api/webhook
                                                          runs a command with every stored secret in its environment
"""
import getpass
import json
import os
import subprocess
import sys

import win32crypt

PATH = os.path.join(os.path.expanduser('~'), '.hwd', 'secrets.dpapi')
NAMES = ('STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICE_MONTHLY', 'STRIPE_PRICE_ANNUAL', 'STRIPE_PORTAL_CONFIG',
         'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'HWD_PRO_KEY', 'SESSION_SECRET', 'BREVO_API_KEY', 'MAIL_FROM',
         'PURCHASE_NOTIFY_EMAIL', 'HWD_STAGING_MASK_KEY')


def load():
    if not os.path.exists(PATH):
        return {}
    with open(PATH, 'rb') as f:
        return json.loads(win32crypt.CryptUnprotectData(f.read(), None, None, None, 0)[1].decode())


def save(d):
    os.makedirs(os.path.dirname(PATH), exist_ok=True)
    with open(PATH, 'wb') as f:
        f.write(win32crypt.CryptProtectData(json.dumps(d).encode(), 'hwd', None, None, None, 0))


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    cmd = sys.argv[1]
    d = load()
    if cmd == 'set':
        name = sys.argv[2]
        if name not in NAMES:
            sys.exit('unknown name; one of: ' + ', '.join(NAMES))
        if name == 'STRIPE_SECRET_KEY':
            print('Use the TEST key (sk_test_...). Live keys are refused until live billing is approved.')
        v = getpass.getpass(name + ': ').strip()
        if name == 'STRIPE_SECRET_KEY' and not v.startswith('sk_test_'):
            sys.exit('refused: not a test key')
        d[name] = v
        save(d)
        print('stored', name)
    elif cmd == 'list':
        for n in NAMES:
            print(('set     ' if d.get(n) else 'missing ') + n)
    elif cmd == 'run':
        argv = sys.argv[sys.argv.index('--') + 1:]
        sys.exit(subprocess.call(argv, env={**os.environ, **d}))
    else:
        sys.exit(__doc__)


if __name__ == '__main__':
    main()
