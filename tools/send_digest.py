"""Free weekly Handicapper Watchdog email (owner OK 19 Nov 2026).

Each confirmed subscriber gets: the last 7 days of GRADED results for the accounts they follow (from the public
data/index.json, the same numbers anyone can see on the site) and, if they opted in, review pages published that week.
Never pending picks. The API lists who is due this ISO week and we mark each one sent, so a rerun never mails twice.

Run weekly (scheduled task "HWD Weekly Digest", Monday 8 AM PT):
  python tools/hwd_secrets.py run -- python tools/send_digest.py [--dry-run] [--only you@example.com]
Needs ALERTS_TOKEN and BREVO_API_KEY in the environment (hwd_secrets.py run provides them).
"""
import argparse, datetime, json, os, re, subprocess, sys, urllib.request
from zoneinfo import ZoneInfo

API = 'https://api.handicapperwatchdog.com'
SITE = 'https://handicapperwatchdog.com'
SENDER = {'email': 'contact@handicapperwatchdog.com', 'name': 'Handicapper Watchdog'}
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = {'user-agent': 'hwd-digest'}
QA = re.compile(r'\+hwdqa|qa-hwd-probe', re.I)


def get(url, headers=None):
    req = urllib.request.Request(url, headers={**UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.load(r)


def post(url, body, headers):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method='POST',
                                 headers={**UA, 'content-type': 'application/json', 'accept': 'application/json', **headers})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.status


def rec(w, l, p):
    return f'{w}-{l}' + (f'-{p}' if p else '')


def units(x):
    return ('+' if x > 0 else '') + f'{x:.2f} units'


def new_reviews(days=7):
    """Review pages added to main in the last `days` days: [(slug, title)]."""
    subprocess.run(['git', '-C', REPO, 'fetch', '-q', 'origin'], check=False)
    out = subprocess.run(['git', '-C', REPO, 'log', 'origin/main', f'--since={days} days ago', '--diff-filter=A',
                          '--name-only', '--format=', '--', 'content/reviews_v2'], capture_output=True, text=True).stdout
    res = []
    for path in dict.fromkeys(x.strip() for x in out.splitlines() if x.strip().endswith('.json')):
        slug = os.path.basename(path)[:-5]
        try:
            d = json.loads(subprocess.run(['git', '-C', REPO, 'show', 'origin/main:' + path], capture_output=True,
                                          text=True, encoding='utf-8').stdout)
            res.append((slug, d.get('h1') or slug))
        except Exception:
            res.append((slug, slug))
    return res


def body_for(acct, by_id, reviews):
    parts = []
    follows = [by_id[i] for i in acct['follows'] if i in by_id]
    if follows:
        lines = []
        for c in follows:
            r7, name = c.get('r7') or {}, c.get('name') or ('#' + c['id'][:6].upper())
            src = f" ({c['src']})" if c.get('src') else ''
            week = (f"Last 7 days: {rec(r7.get('w', 0), r7.get('l', 0), r7.get('p', 0))}, {units(r7.get('net', 0))}"
                    if r7.get('picks') else 'No graded picks in the last 7 days.')
            lines.append(f"{name}{src}\n  {week}\n  All time: {rec(c['w'], c['l'], c.get('p', 0))}, {units(c.get('units', 0))} "
                         f"over {c['picks']:,} graded picks\n  {SITE}/handicappers/{c['id']}.html")
        parts.append('Accounts you follow\n\n' + '\n\n'.join(lines))
    if acct.get('reviews') and reviews:
        parts.append('New review pages this week\n\n' + '\n'.join(f'{t}\n  {SITE}/reviews/{s}.html' for s, t in reviews))
    if not parts:
        return None
    return ('Your weekly Handicapper Watchdog email. Graded results only, never picks before a game.\n\n' +
            '\n\n'.join(parts) +
            f'\n\nFollow or unfollow accounts from any profile, or browse the rankings: {SITE}/cappers.html\n\n'
            'Records are past results, not predictions or a guarantee. 21+. Gambling problem? Call 1 800 GAMBLER.\n\n'
            f"Stop these emails: {acct['unsub']}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--only')
    a = ap.parse_args()
    tok, key = os.environ.get('ALERTS_TOKEN'), os.environ.get('BREVO_API_KEY')
    if not tok or (not key and not a.dry_run):
        sys.exit('missing ALERTS_TOKEN or BREVO_API_KEY')
    today = datetime.datetime.now(ZoneInfo('America/Los_Angeles')).date()
    iso = today.isocalendar()
    week = f'{iso[0]}-W{iso[1]:02d}'
    due = get(f'{API}/api/digest/list?week={week}', {'x-alerts-token': tok})['accounts']
    if a.only:
        due = [x for x in due if x['email'] == a.only.lower()]
    print(f'{today} week {week}: {len(due)} due', flush=True)
    if not due:
        return
    by_id = {c['id']: c for c in get(SITE + '/data/index.json?digest=' + str(today))['cappers']}
    reviews = new_reviews()
    sent = skipped = failed = 0
    for acct in due:
        text = None if QA.search(acct['email']) else body_for(acct, by_id, reviews)  # QA addresses never get real mail
        if a.dry_run:
            print('---', acct['email'], '\n' + (text or '(nothing to send)'))
            continue
        if text:
            try:
                post('https://api.brevo.com/v3/smtp/email', {'sender': SENDER, 'to': [{'email': acct['email']}],
                     'subject': 'Your weekly Handicapper Watchdog results', 'textContent': text,
                     'headers': {'List-Unsubscribe': '<' + acct['unsub'] + '>'}}, {'api-key': key})
                sent += 1
            except Exception as e:
                failed += 1
                print('send failed', acct['id'], str(e)[:120], flush=True)
                continue
        else:
            skipped += 1
        post(f'{API}/api/digest/sent', {'week': week, 'id': acct['id']}, {'x-alerts-token': tok})
    print(f'sent {sent}, nothing to say {skipped}, failed {failed}', flush=True)


if __name__ == '__main__':
    main()
