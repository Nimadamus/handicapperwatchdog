"""Proves the free and Pro boundary on a built site. Run after build.py: python tools/verify_boundary.py [_site]

Anything sealed for Pro must not appear in public JSON, page source or scripts. Exits 1 on any leak.
"""
import glob
import json
import os
import re
import sys

SITE = sys.argv[1] if len(sys.argv) > 1 else '_site'
DEEP = ('advanced', 'after', 'form_picks', 'market_detail', 'fav_dog', 'plus_money', 'odds_buckets', 'over_under', 'home_away', 'teams_backing', 'teams_fading',
        'conference_backing', 'division_backing', 'weekday', 'month', 'season', 'sport_detail', 'roi_curve', 'rolling_win', 'activity', 'best_sport', 'best_market',
        'curve', 'curve_dates', 'form_days', 'sports', 'markets', 'streaks')
fails = []
n = 0
for f in glob.glob(os.path.join(SITE, 'data', 'p', '*.json')):
    p = json.load(open(f, encoding='utf-8'))
    n += 1
    if p.get('detail') is False:
        continue
    bad = [k for k in DEEP if k in p]
    if bad or len(p.get('ledger') or []) > 10 or set(p.get('windows') or {}) - {'r7', 'r30'}:
        fails.append((f, bad))
print('public profiles checked', n, 'with deep data', len(fails))

idx = json.load(open(os.path.join(SITE, 'data', 'index.json'), encoding='utf-8'))
extra = {k for r in idx['cappers'] for k in r} - {'id', 'w', 'l', 'p', 'picks', 'win_pct', 'units', 'roi', 'streak', 'last_pick', 'first_pick', 'profile', 'basic', 'tier', 'r7', 'r30', 'sports', 'bs', 'spark'}
if extra:
    fails.append(('index extra fields', sorted(extra)))
per_sport = {}
for r in idx['cappers']:
    for k in r.get('bs') or {}:
        per_sport[k] = per_sport.get(k, 0) + 1
if per_sport and max(per_sport.values()) > 25:
    fails.append(('index sport rows over limit', max(per_sport.values())))
print('index rows', len(idx['cappers']), 'sport rows capped at', max(per_sport.values() or [0]))

for name in ('home.json', 'ids.json'):
    b = open(os.path.join(SITE, 'data', name), encoding='utf-8').read()
    if re.search(r'"(ledger|teams_backing|selection|matchup|handle|username|slug)"', b):
        fails.append((name, 'protected key'))
    print(name, len(b) // 1024, 'KB')

bins = glob.glob(os.path.join(SITE, 'data', 'x', '*.bin'))
for f in bins[:300] + [os.path.join(SITE, 'data', 'x', 'pending.bin')]:
    if os.path.exists(f) and re.search(r'["{]|matchup|selection|ledger', open(f, encoding='utf-8').read()):
        fails.append((f, 'not ciphertext'))
print('sealed files', len(bins))

for f in glob.glob(os.path.join(SITE, 'sports', '*.html')):
    rows = len(re.findall(r'<td class="l rk">', open(f, encoding='utf-8').read()))
    if rows > 25:
        fails.append((f, 'sport page rows %d' % rows))
leak = re.compile(r'th-\d{4}|"handle"|"username"|teams_backing|sport_detail')
pages = glob.glob(os.path.join(SITE, '**', '*.html'), recursive=True)
for f in pages:
    if leak.search(open(f, encoding='utf-8').read()):
        fails.append((f, 'page source'))
print('pages scanned', len(pages))
print('RESULT', 'FAIL ' + str(fails[:6]) if fails else 'PASS')
sys.exit(1 if fails else 0)
