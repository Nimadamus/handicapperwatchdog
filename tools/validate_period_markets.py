"""Read only check of the markets the full game score cannot grade: team totals, MLB first five, and first half lines.

python tools/validate_period_markets.py [out.json]
Reads the published ledgers, fetches period scores from public MLB and ESPN feeds, regrades in memory and reports
disagreements. It changes nothing. A disagreement is a lead for review, never an automatic correction.
"""
import collections
import concurrent.futures as cf
import json
import re
import sys
import urllib.request

SITE = 'https://handicapperwatchdog.com/'
ESPN = {'NFL': 'football/nfl', 'NCAAF': 'football/college-football', 'NBA': 'basketball/nba', 'NCAAB': 'basketball/mens-college-basketball', 'WNBA': 'basketball/wnba'}


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'hwd-audit'}), timeout=40) as r:
        return json.load(r)


def grade(v):
    return 'P' if v == 0 else 'W' if v > 0 else 'L'


def rows():
    idx = get(SITE + 'data/index.json?v=audit')
    ids = [r['id'] for r in idx['cappers'] if r['picks'] >= 20]

    def one(i):
        try:
            return get(SITE + 'data/p/%s.json?v=audit' % i).get('ledger') or []
        except Exception:
            return []
    with cf.ThreadPoolExecutor(10) as ex:
        return [x for led in ex.map(one, ids) for x in led]


_mlb, _espn = {}, {}


def mlb_games(date):
    if date not in _mlb:
        d = get('https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=%s&hydrate=linescore' % date)
        _mlb[date] = [g for day in d.get('dates', []) for g in day.get('games', [])]
    return _mlb[date]


def espn_games(sport, date):
    k = (sport, date)
    if k not in _espn:
        extra = '&groups=80&limit=300' if sport == 'NCAAF' else '&groups=50&limit=400' if sport == 'NCAAB' else ''
        try:
            _espn[k] = get('https://site.api.espn.com/apis/site/v2/sports/%s/scoreboard?dates=%s%s' % (ESPN[sport], date.replace('-', ''), extra)).get('events', [])
        except Exception:
            _espn[k] = []
    return _espn[k]


def periods(x):
    """(away periods, home periods) for the ledger row's game, matched on team names and final score."""
    m = re.fullmatch(r'(.+?) @ (.+)', x.get('m') or '')
    f = re.fullmatch(r'(\d+)-(\d+)', str(x.get('f') or ''))
    if not m or not f:
        return None
    a, h, fa, fh = m[1], m[2], int(f[1]), int(f[2])
    day = x['d']
    if x['sp'] == 'MLB':
        for g in mlb_games(day):
            t = g['teams']
            if t['away']['team']['name'] == a and t['home']['team']['name'] == h and t['away'].get('score') == fa and t['home'].get('score') == fh:
                inn = g.get('linescore', {}).get('innings', [])
                return [i.get('away', {}).get('runs', 0) or 0 for i in inn], [i.get('home', {}).get('runs', 0) or 0 for i in inn]
        return None
    if x['sp'] in ESPN:
        for e in espn_games(x['sp'], day):
            c = e['competitions'][0]['competitors']
            aw = next((t for t in c if t['homeAway'] == 'away'), None)
            ho = next((t for t in c if t['homeAway'] == 'home'), None)
            if aw and ho and int(aw.get('score') or -1) == fa and int(ho.get('score') or -1) == fh and aw['team'].get('displayName') == a and ho['team'].get('displayName') == h:
                ls = lambda t: [int(float(p.get('value') or 0)) for p in t.get('linescores', [])]
                return ls(aw), ls(ho)
    return None


def check(x):
    """Returns (bucket, expected result) or None when the row cannot be checked."""
    mk, pk, r = x.get('mk') or '', (x.get('pk') or '').replace('−', '-'), x.get('r')
    g = re.fullmatch(r'(.+?) @ (.+)', x.get('m') or '')
    f = re.fullmatch(r'(\d+)-(\d+)', str(x.get('f') or ''))
    if not g or not f:
        return None
    A, H = g[1], g[2]
    if mk == 'Team total':
        t = re.fullmatch(r'(.+?) (over|under) (\d+(?:\.\d+)?)', pk, re.I)
        if not t or t[1] not in (A, H):
            return None
        mine = int(f[1]) if t[1] == A else int(f[2])
        v = mine - float(t[3])
        return 'Team total', grade(v if t[2].lower() == 'over' else -v)
    n = 5 if mk.startswith('First 5') else 0
    if not n and not mk.startswith('First half'):
        return None
    p = periods(x)
    if not p:
        return ('unmatched', None)
    if not n:
        n = 1 if x['sp'] in ('NCAAB',) else 2
    if len(p[0]) < n:
        return ('unmatched', None)
    a, h = sum(p[0][:n]), sum(p[1][:n])
    if mk.endswith('total'):
        t = re.fullmatch(r'(Over|Under) (\d+(?:\.\d+)?)', pk)
        if not t:
            return None
        v = a + h - float(t[2])
        return mk, grade(v if t[1] == 'Over' else -v)
    t = re.fullmatch(r'(.+?) ([+-]\d+(?:\.\d+)?)', pk)
    team, sp = (t[1], float(t[2])) if t else (pk, 0.0)
    if team not in (A, H):
        return None
    mine, opp = (a, h) if team == A else (h, a)
    return mk, grade(mine + sp - opp)


def main():
    all_rows = [x for x in rows() if x.get('r') in ('W', 'L', 'P')]
    seen, tally, bad = set(), collections.Counter(), []
    todo = []
    for x in all_rows:
        k = (x.get('d'), x.get('m'), x.get('pk'), x.get('mk'), x.get('f'))
        if k not in seen:
            seen.add(k)
            todo.append(x)
    for x in todo:
        try:
            c = check(x)
        except Exception:
            c = ('error', None)
        if not c:
            continue
        b, res = c
        tally[b + ' checked' if res else b] += 1
        if res and res != x['r']:
            tally[b + ' disagree'] += 1
            bad.append({k: x.get(k) for k in ('d', 'sp', 'm', 'pk', 'mk', 'f', 'r')} | {'expected': res})
    print(json.dumps(dict(sorted(tally.items())), indent=0))
    if len(sys.argv) > 1:
        json.dump(bad, open(sys.argv[1], 'w'), indent=0)
    for b in bad[:12]:
        print(b)


if __name__ == '__main__':
    main()
