"""Builds handicapperwatchdog.com into _site/ from the records TrustMyRecord already publishes.

Sources (read only, never computed differently from TMR):
  index    https://trustmyrecord.com/around-the-web/            window.__ATW_DATA, every tracked capper
  profile  https://trustmyrecord.com/around-the-web/<slug>/     window.__WD_RESEARCH, the full breakdown + pick history

Privacy rule for this site: nothing that identifies a capper is published. Each capper gets an id that is an
HMAC of the slug under HWD_MASK_KEY (a repository secret). Handles, slugs, avatars, forum names, post text,
post links, matchups and exact post times never reach _site/. The pick history is used here to compute the
per sport breakdowns and is then dropped.

The raw research is cached in .cache/ (Actions cache, never published) and a profile is fetched again only when
the capper has posted since and the cached copy is older than PROFILE_TTL, so TMR serves each profile a few times
a day at most, gzipped.
"""
import base64
import gzip
import hashlib
import hmac
import json
import os
import re
import secrets
import shutil
import sys
import time
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone, timedelta

BASE = 'https://trustmyrecord.com/around-the-web/'
ALLOWED = {'x', 'reddit', 'covers', 'therx', 'sbr', 'predictem'}  # outside handicappers only, never TMR members
KEY = (os.environ.get('HWD_MASK_KEY') or secrets.token_hex(16)).encode()
# Watchdog Pro data (names, pick logs) is published only encrypted. Each capper file has its own AES-GCM key,
# HMAC(HWD_PRO_KEY, 'capper:' + id); the API hands a key to a signed in subscriber for one capper at a time.
# Without HWD_PRO_KEY nothing Pro is written at all.
PRO_KEY = os.environ.get('HWD_PRO_KEY', '').encode()
HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, '.cache', 'profiles')
SITE = os.path.join(HERE, '_site')
STATIC = ('index.html', 'capper.html', 'cappers.html', 'pricing.html', 'account.html', 'compare.html', 'terms.html', 'privacy.html',
          'style.css', 'app.js', 'capper.js', 'pro.js', 'compare.js', 'pricing.js', 'account.js', 'favicon.svg', 'CNAME', 'robots.txt', 'sitemap.xml')
PROFILE_TTL = int(os.environ.get('HWD_PROFILE_TTL', str(6 * 3600)))
MAX_FETCH = int(os.environ.get('HWD_MAX_FETCH', '400'))
PT = timezone(timedelta(hours=-7))  # display only; weekday buckets use Pacific time like the rest of TMR
DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']


def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'HandicapperWatchdog/1.0 (+https://handicapperwatchdog.com)',
                                               'Accept-Encoding': 'gzip'})
    with urllib.request.urlopen(req, timeout=60) as r:
        body = r.read()
        if r.headers.get('Content-Encoding') == 'gzip':
            body = gzip.decompress(body)
    return body.decode('utf-8')


def extract(html, var):
    m = re.search(r'window\.' + re.escape(var) + r'\s*=', html)
    if not m:
        return None
    return json.JSONDecoder().raw_decode(html[m.end():].lstrip())[0]


def pro_key(label):
    return hmac.new(PRO_KEY, label.encode(), hashlib.sha256).digest()


def seal(label, obj):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    iv = secrets.token_bytes(12)
    data = json.dumps(obj, separators=(',', ':')).encode()
    return base64.b64encode(iv + AESGCM(pro_key(label)).encrypt(iv, data, None)).decode()


def pro_payload(x, research):
    hist = [h for h in (research.get('history') or []) if h.get('result') in ('won', 'lost', 'push')]
    hist.sort(key=lambda h: h.get('game') or '', reverse=True)
    keep = ('game', 'posted', 'sport', 'matchup', 'pick', 'market', 'line', 'odds', 'result', 'pl', 'final', 'url', 'text')
    return {'handle': x.get('handle') or x.get('username'), 'source': x.get('source_label') or x['source'],
            'picks': [{k: h.get(k) for k in keep} for h in hist]}


def mask(slug):
    return hmac.new(KEY, slug.encode(), hashlib.sha256).hexdigest()[:10]


def rec(r):
    p = [int(x) for x in str(r).split('-')] + [0, 0, 0]
    return p[0], p[1], p[2]


# ---------- per sport breakdowns computed from the pick history ----------

def agg(rows):
    w = sum(1 for r in rows if r['result'] == 'won')
    l = sum(1 for r in rows if r['result'] == 'lost')
    p = sum(1 for r in rows if r['result'] == 'push')
    risked = sum(float(r.get('risk') or 0) for r in rows)
    net = sum(float(r.get('pl') or 0) for r in rows)
    priced = [r['odds'] for r in rows if r.get('odds') is not None]
    return {'picks': len(rows), 'w': w, 'l': l, 'p': p, 'net': round(net, 2), 'risked': round(risked, 2),
            'roi': round(100 * net / risked, 2) if risked else None,
            'win_pct': round(100 * w / (w + l), 1) if w + l else None,
            'avg_odds': round(sum(priced) / len(priced)) if priced else None}


def streaks(rows):
    """rows oldest first."""
    best_w = best_l = cur = 0
    kind = None
    for r in rows:
        if r['result'] == 'push':
            continue
        k = r['result']
        cur = cur + 1 if k == kind else 1
        kind = k
        if k == 'won':
            best_w = max(best_w, cur)
        else:
            best_l = max(best_l, cur)
    return {'longest_win': best_w, 'longest_loss': best_l,
            'current': ('W' if kind == 'won' else 'L') + str(cur) if kind else None}


def drawdown(rows):
    cum = peak = 0.0
    mdd = 0.0
    for r in rows:
        cum += float(r.get('pl') or 0)
        peak = max(peak, cum)
        mdd = min(mdd, cum - peak)
    return {'max_drawdown': round(mdd, 2), 'peak_units': round(peak, 2), 'final_units': round(cum, 2)}


def odds_bucket(o):
    if o is None:
        return None
    if o <= -200:
        return 'Heavy favorite (-200 or shorter)'
    if o <= -150:
        return 'Moderate favorite (-150 to -199)'
    if o < 100 and o < 0:
        return 'Small favorite (-101 to -149)'
    if o < 150:
        return 'Small dog (+100 to +149)'
    if o < 250:
        return 'Dog (+150 to +249)'
    return 'Long shot (+250 or longer)'


ODDS_ORDER = ['Heavy favorite (-200 or shorter)', 'Moderate favorite (-150 to -199)', 'Small favorite (-101 to -149)',
              'Small dog (+100 to +149)', 'Dog (+150 to +249)', 'Long shot (+250 or longer)']


def grouped(rows, keyf, order=None, min_picks=1):
    g = defaultdict(list)
    for r in rows:
        k = keyf(r)
        if k:
            g[k].append(r)
    out = [dict(agg(v), key=k) for k, v in g.items() if len(v) >= min_picks]
    if order:
        out.sort(key=lambda x: order.index(x['key']) if x['key'] in order else 99)
    else:
        out.sort(key=lambda x: -x['picks'])
    return out


def side(r):
    t = str(r.get('pick') or '').strip().lower()
    if t.startswith('over'):
        return 'Over'
    if t.startswith('under'):
        return 'Under'
    return None


def when(r):
    try:
        return datetime.fromisoformat(r['game'].replace('Z', '+00:00')).astimezone(PT)
    except Exception:
        return None


def sport_detail(rows):
    rows = sorted(rows, key=lambda r: r.get('game') or '')
    newest = rows[::-1]
    d = {'overall': agg(rows), 'streaks': streaks(rows), 'curve': curve(rows),
         'form': [dict(agg(newest[:n]), key='Last %d picks' % n) for n in (10, 25, 50, 100) if len(rows) >= n],
         'markets': grouped(rows, lambda r: r.get('market')),
         'fav_dog': grouped(rows, lambda r: None if r.get('odds') is None else ('Favorite' if r['odds'] < 0 else 'Underdog')),
         'odds': grouped(rows, lambda r: odds_bucket(r.get('odds')), ODDS_ORDER),
         'over_under': grouped(rows, side, ['Over', 'Under']),
         'weekday': grouped(rows, lambda r: when(r) and DAYS[when(r).weekday()], DAYS),
         'month': sorted(grouped(rows, lambda r: when(r) and when(r).strftime('%Y-%m')), key=lambda x: x['key'])}
    d['overall'].update(drawdown(rows))
    return d


def curve(rows, points=120):
    cum, out = 0.0, []
    for r in rows:
        cum += float(r.get('pl') or 0)
        out.append(round(cum, 2))
    if len(out) > points:
        step = len(out) / points
        out = [out[int(i * step)] for i in range(points)] + [out[-1]]
    return out


# ---------- the published profile ----------

KEEP = ('overview', 'form_picks', 'form_days', 'advanced', 'after', 'sports', 'markets', 'market_detail', 'fav_dog',
        'plus_money', 'odds_buckets', 'over_under', 'home_away', 'teams_backing', 'teams_fading', 'conference_backing',
        'division_backing', 'weekday', 'month', 'season', 'recent_vs_lifetime')


def strip_items(v):
    """Drop helper keys from TMR's research rows; keep only figures and labels."""
    if isinstance(v, list):
        return [strip_items(x) for x in v]
    if isinstance(v, dict):
        return {k: strip_items(x) for k, x in v.items() if k not in ('dim', 'ki', 'b')}
    return v


def build_profile(row, research):
    hist = [h for h in (research.get('history') or []) if h.get('result') in ('won', 'lost', 'push')]
    hist.sort(key=lambda h: h.get('game') or '')
    by_sport = defaultdict(list)
    for h in hist:
        by_sport[h.get('sport') or 'Other'].append(h)
    prof = {k: strip_items(research.get(k)) for k in KEEP if research.get(k) is not None}
    prof['curve'] = curve(hist, 200)
    prof['last_results'] = ['W' if h['result'] == 'won' else 'L' if h['result'] == 'lost' else 'P' for h in hist[::-1][:20]]
    prof['sport_detail'] = {s: sport_detail(v) for s, v in sorted(by_sport.items(), key=lambda kv: -len(kv[1]))}
    prof['generated_at'] = research.get('generated_at')
    fd = {r.get('key'): r for r in (research.get('form_days') or [])}
    months = research.get('month') or []
    first = min((h.get('posted') or h.get('game') or '' for h in hist), default='')[:10] or None
    prof['extra'] = {
        'r7': trim(fd.get('Last 7 days')), 'r30': trim(fd.get('Last 30 days')), 'first_pick': first,
        'spark': [round(v, 1) for v in curve(hist, 24)],
        'months': len(months), 'months_up': sum(1 for m in months if (m.get('net') or 0) > 0),
        'unpriced': (research.get('overview') or {}).get('unpriced') or 0,
        'clv_beat': ((research.get('advanced') or {}).get('clv') or {}).get('beat_pct'),
        'clv_n': ((research.get('advanced') or {}).get('clv') or {}).get('n') or 0,
        'z': ((research.get('advanced') or {}).get('z') or {}).get('z'),
        'mdd': (research.get('advanced') or {}).get('max_drawdown')}
    prof['extra']['monitored_since'] = first
    # Reconcile: the pick history must reproduce TMR's headline record, or the profile is not published.
    ov, a = research.get('overview') or {}, agg(hist)
    prof['reconciled'] = bool(ov) and (a['w'], a['l'], a['p']) == (ov.get('w'), ov.get('l'), ov.get('p')) and \
        abs(a['net'] - float(ov.get('net') or 0)) < 0.05
    return prof


def trim(r):
    if not r or not r.get('picks'):
        return None
    return {k: r.get(k) for k in ('picks', 'w', 'l', 'p', 'net', 'roi', 'win_pct')}


def tier(n):
    return 'established' if n >= 100 else 'developing' if n >= 20 else 'small'


def live_stats():
    """Platform wide counters TMR's Pro page reads live (same endpoint, fetched here because it is CORS locked)."""
    try:
        d = json.loads(get('https://trustmyrecord-api.onrender.com/api/pro/watchdog/stats'))
        keep = ('generated_at', 'last_capture_at', 'last_graded_at', 'accounts_discovered', 'accounts_monitored', 'graded_picks',
                'pending_picks', 'platforms', 'communities', 'posts_captured', 'new_accounts_today', 'picks_captured_today')
        out = {k: d.get(k) for k in keep}
        out['sources'] = [{k: x.get(k) for k in ('label', 'accounts_monitored', 'graded_picks', 'pending_picks')} for x in d.get('sources') or []]
        return out
    except Exception as e:
        print('live stats unavailable', type(e).__name__, file=sys.stderr)
        return None


def summary(x):
    w, l, p = rec(x['record'])
    sports = sorted((x.get('by_sport') or {}).items(), key=lambda kv: -int(kv[1].get('graded') or 0))
    lp = x.get('last_pick_at') or ''
    return {'id': mask(x['slug']), 'source': x.get('source_label') or x['source'], 'w': w, 'l': l, 'p': p,
            'picks': int(x['graded']), 'win_pct': x.get('win_rate'), 'units': None if x.get('units') is None else round(float(x['units']), 2),
            'roi': x.get('roi'), 'streak': int(x.get('streak') or 0), 'sports': [k for k, _ in sports],
            'by_sport': {k: {'record': v.get('record'), 'picks': v.get('graded'), 'units': v.get('units'), 'roi': v.get('roi'),
                             'win_pct': v.get('win_rate')} for k, v in sports},
            'last_pick': lp[:10] or None}


def main():
    raw = extract(get(BASE + '?cb=' + secrets.token_hex(4)), '__ATW_DATA')
    rows = [x for x in raw.get('handicappers', []) if x.get('source') in ALLOWED and int(x.get('graded') or 0) > 0]
    if len(rows) < 100:
        sys.exit('only %d rows: refusing to publish a short board' % len(rows))
    os.makedirs(CACHE, exist_ok=True)
    os.makedirs(SITE, exist_ok=True)
    for name in os.listdir(SITE):  # empty it in place: a preview server may be holding the folder open
        path = os.path.join(SITE, name)
        shutil.rmtree(path) if os.path.isdir(path) else os.remove(path)
    os.makedirs(os.path.join(SITE, 'data', 'p'))
    if PRO_KEY:
        os.makedirs(os.path.join(SITE, 'data', 'x'))
    for f in STATIC:
        if os.path.exists(os.path.join(HERE, f)):
            shutil.copy(os.path.join(HERE, f), SITE)

    now = time.time()
    fetched = failed = published = unreconciled = 0
    rows.sort(key=lambda x: -int(x['graded']))
    index = []
    for x in rows:
        s = summary(x)
        cpath = os.path.join(CACHE, hashlib.sha1(x['slug'].encode()).hexdigest() + '.json')
        cached = None
        if os.path.exists(cpath):
            with open(cpath, encoding='utf-8') as f:
                cached = json.load(f)
        stale = cached is None or (cached.get('last_pick_at') != x.get('last_pick_at') and now - cached.get('fetched', 0) > PROFILE_TTL)
        if stale and fetched < MAX_FETCH:
            try:
                research = extract(get(BASE + x['slug'] + '/'), '__WD_RESEARCH')
                if research:
                    cached = {'last_pick_at': x.get('last_pick_at'), 'fetched': now, 'research': research}
                    with open(cpath, 'w', encoding='utf-8') as f:
                        json.dump(cached, f, separators=(',', ':'))
                fetched += 1
                time.sleep(0.15)
            except Exception as e:
                failed += 1
                print('fetch failed', type(e).__name__, file=sys.stderr)
        if cached:
            prof = build_profile(x, cached['research'])
            if prof['reconciled']:
                prof['summary'] = {k: v for k, v in s.items() if k != 'by_sport'}
                prof['summary']['tier'] = tier(s['picks'])
                s.update({k: v for k, v in prof.pop('extra').items()})
                prof['summary'].update({k: s[k] for k in ('r7', 'r30', 'first_pick', 'months', 'months_up', 'unpriced')})
                with open(os.path.join(SITE, 'data', 'p', s['id'] + '.json'), 'w', encoding='utf-8') as f:
                    json.dump(prof, f, separators=(',', ':'))
                s['profile'] = True
                published += 1
                if PRO_KEY:
                    with open(os.path.join(SITE, 'data', 'x', s['id'] + '.bin'), 'w') as f:
                        f.write(seal('capper:' + s['id'], pro_payload(x, cached['research'])))
            else:
                unreconciled += 1
        s['tier'] = tier(s['picks'])
        s['bs'] = {k: [v['picks'], None if v['units'] is None else round(float(v['units']), 2), v['roi'], v['win_pct'], v['record']]
                   for k, v in s.pop('by_sport').items() if (v['picks'] or 0) >= 5}
        index.append(s)

    qual = [s for s in index if s['picks'] >= 20 and s['units'] is not None]
    meta = {'built_at': datetime.now(timezone.utc).isoformat(timespec='seconds'),
            'newest_pick': max((s['last_pick'] or '' for s in index), default=None),
            'tracked': len(index), 'graded_picks': sum(s['picks'] for s in index), 'qualified': len(qual),
            'profitable': sum(1 for s in qual if s['units'] > 0), 'min_graded': 20, 'profiles': published,
            'sources': sorted({s['source'] for s in index}),
            'established': sum(1 for s in index if s['picks'] >= 100 and s['units'] is not None),
            'established_up': sum(1 for s in index if s['picks'] >= 100 and (s['units'] or 0) > 0),
            'live': live_stats()}
    if PRO_KEY:
        names = [[mask(x['slug']), x.get('handle') or x.get('username'), x.get('source_label') or x['source']] for x in rows]
        with open(os.path.join(SITE, 'data', 'x', 'names.bin'), 'w') as f:
            f.write(seal('names', names))
        meta['pro_data'] = True
    with open(os.path.join(SITE, 'data', 'index.json'), 'w', encoding='utf-8') as f:
        json.dump({'meta': meta, 'cappers': index}, f, separators=(',', ':'))
    print('tracked %d, fetched %d, failed %d, profiles %d, unreconciled %d' % (len(index), fetched, failed, published, unreconciled))


if __name__ == '__main__':
    main()
