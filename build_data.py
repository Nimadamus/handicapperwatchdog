"""Builds data.json for handicapperwatchdog.com from the records TrustMyRecord publishes.

Names never leave this script: every row gets a random id per build, the handle, slug, avatar,
forum list and profile link are dropped, and the last pick is cut to the date. The site is static,
so whatever is in data.json is public; keep it that way.
"""
import hashlib
import hmac
import json
import os
import secrets
import sys
import urllib.request
from datetime import datetime, timezone

SRC = 'https://trustmyrecord.com/around-the-web/'
MARKER = 'window.__ATW_DATA ='
ALLOWED = {'x', 'reddit', 'covers', 'therx', 'sbr', 'predictem'}  # outside handicappers only
MIN_GRADED = 20
TOP = 25
# Stable ids across refreshes without revealing the name: HMAC of the slug under a key kept as a
# repository secret. Without the key (a local run) ids are random for that build.
KEY = (os.environ.get('HWD_MASK_KEY') or secrets.token_hex(16)).encode()


def fetch():
    req = urllib.request.Request(SRC + '?cb=' + secrets.token_hex(4), headers={'User-Agent': 'HandicapperWatchdog/1.0'})
    html = urllib.request.urlopen(req, timeout=60).read().decode('utf-8')
    i = html.index(MARKER) + len(MARKER)
    return json.JSONDecoder().raw_decode(html[i:].lstrip())[0]


def rec(r):
    p = [int(x) for x in str(r).split('-')] + [0, 0, 0]
    return p[0], p[1], p[2]


def build(raw):
    rows = [x for x in raw.get('handicappers', []) if x.get('source') in ALLOWED and int(x.get('graded') or 0) > 0]
    graded = sum(int(x['graded']) for x in rows)
    qual = [x for x in rows if int(x['graded']) >= MIN_GRADED and x.get('units') is not None]
    up = [x for x in qual if float(x['units']) > 0]
    qual.sort(key=lambda x: -float(x['units']))
    used, out = set(), []
    for x in qual[:TOP]:
        h = hmac.new(KEY, x['slug'].encode(), hashlib.sha256).hexdigest().upper()
        mid = h[:4]
        k = 4
        while mid in used:
            k += 1
            mid = h[:k]
        used.add(mid)
        w, l, p = rec(x['record'])
        sports = sorted((x.get('by_sport') or {}).items(), key=lambda kv: -int(kv[1].get('graded') or 0))
        out.append({'id': mid, 'source': x.get('source_label') or x['source'], 'wins': w, 'losses': l, 'pushes': p,
                    'graded': int(x['graded']), 'win_rate': x.get('win_rate'), 'units': round(float(x['units']), 2),
                    'roi': x.get('roi'), 'streak': int(x.get('streak') or 0), 'sports': [k for k, _ in sports[:3]],
                    'last_pick': (x.get('last_pick_at') or '')[:10] or None})
    newest = max((x.get('last_pick_at') or '' for x in rows), default='')
    return {'built_at': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'newest_pick': newest[:10] or None,
            'tracked': len(rows), 'graded_picks': graded, 'qualified': len(qual), 'profitable': len(up),
            'min_graded': MIN_GRADED, 'top': out}


if __name__ == '__main__':
    data = build(fetch())
    if not data['top']:
        sys.exit('no rows: refusing to publish an empty board')
    with open('data.json', 'w', encoding='utf-8') as f:
        json.dump(data, f, separators=(',', ':'))
    print('tracked', data['tracked'], 'picks', data['graded_picks'], 'qualified', data['qualified'], 'profitable', data['profitable'])
