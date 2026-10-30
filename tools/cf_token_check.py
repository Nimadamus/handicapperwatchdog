"""Read-only Cloudflare token check. Prints HTTP codes and permission names, never a token.

  python tools/cf_token_check.py
"""
import json
import os
import re
import sys
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(__file__))
import hwd_secrets

FORBIDDEN = ('DNS', 'Member', 'Billing', 'SSL', 'Zone Settings', 'Account Settings', 'Administrator')


def _get(url, token):
    req = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + token, 'User-Agent': 'hwd-cf-check'})
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            return r.status, r.read(200_000)
    except urllib.error.HTTPError as e:
        return e.code, e.read(20_000)
    except Exception as e:
        return 0, type(e).__name__.encode()


def scope_ok(token, account):
    """True only when this token can list Workers and KV and shows no forbidden permission."""
    lines = []
    ok = True
    if not token or not account:
        return False, ['token or account id missing']
    st, body = _get('https://api.cloudflare.com/client/v4/user/tokens/verify', token)
    lines.append(f'verify_http={st}')
    token_id = None
    try:
        res = json.loads(body).get('result') or {}
        token_id = res.get('id') if isinstance(res, dict) else None
    except Exception:
        pass
    st, body = _get(f'https://api.cloudflare.com/client/v4/accounts/{account}/workers/scripts', token)
    count = None
    try:
        data = json.loads(body)
        if isinstance(data.get('result'), list):
            count = len(data['result'])
    except Exception:
        pass
    lines.append(f'workers_http={st} count={count}')
    if st != 200:
        ok = False
    st, _ = _get(f'https://api.cloudflare.com/client/v4/accounts/{account}/storage/kv/namespaces', token)
    lines.append(f'kv_http={st}')
    if st != 200:
        ok = False
    if token_id:
        st, body = _get(f'https://api.cloudflare.com/client/v4/user/tokens/{token_id}', token)
        lines.append(f'policy_http={st}')
        try:
            groups = []
            for pol in (json.loads(body).get('result') or {}).get('policies') or []:
                for g in pol.get('permission_groups') or []:
                    if isinstance(g, dict) and g.get('name'):
                        groups.append(g['name'])
            lines.append('permissions=' + ', '.join(groups))
            if any(any(bad.lower() in name.lower() for bad in FORBIDDEN) for name in groups):
                ok = False
                lines.append('forbidden_permission=yes')
            if not any('Workers Scripts' in name for name in groups) or not any('Workers KV' in name for name in groups):
                ok = False
                lines.append('workers_kv_permission=missing')
        except Exception:
            lines.append('policy_unparsed')
            ok = False
    else:
        lines.append('policy_unreadable')
        ok = False
    return ok, lines


def main():
    store = hwd_secrets.load()
    account = store.get('CLOUDFLARE_ACCOUNT_ID') or ''
    lines = []
    token = store.get('CLOUDFLARE_API_TOKEN') or ''
    if token:
        ok, detail = scope_ok(token, account)
        lines.append('hwd_token ' + ' '.join(detail) + ' usable=' + str(ok).lower())
    else:
        lines.append('hwd_token absent')
    cred = os.path.join(os.path.expanduser('~'), 'CREDENTIALS.md')
    stream = ''
    if os.path.exists(cred):
        text = open(cred, encoding='utf-8', errors='ignore').read()
        m = re.search(r'(?m)^CF_STREAM_API_TOKEN=(.+)$', text)
        stream = m.group(1).strip() if m else ''
    if stream:
        ok, detail = scope_ok(stream, account)
        lines.append('stream_token ' + ' '.join(detail) + ' usable=' + str(ok).lower())
    report = '\n'.join(lines) + '\n'
    for secret in (token, stream, account):
        if secret and secret in report:
            sys.exit(3)
    sys.stdout.write(report)
    return 0


if __name__ == '__main__':
    sys.exit(main())
