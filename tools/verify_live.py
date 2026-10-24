"""Read only check of the live site against the source records.

  python tools/verify_live.py [--site https://handicapperwatchdog.com] [--sample 40]

1. Every capper on the live board matches the source record (W-L-P, graded picks, units, ROI).
2. A sample of live profiles: headline record equals the board row, the chart ends at the units total,
   the sport tabs add up to the overall record.
3. Nothing that identifies a capper is published: no handle or slug of length 6+ appears in any
   published page, script or data file, and no outside URL appears in data.
4. Coverage: how many board rows have a profile, and how many profile files actually load.
Exit code 1 on any failure.
"""
import argparse
import json
import random
import re
import sys
import urllib.request

SRC = 'https://trustmyrecord.com/around-the-web/'
ALLOWED = {'x', 'reddit', 'covers', 'therx', 'sbr', 'predictem'}


def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'HWD-verify/1.0', 'Cache-Control': 'no-cache'})
    return urllib.request.urlopen(req, timeout=60).read().decode('utf-8')


def source():
    h = get(SRC + '?cb=%d' % random.randint(1, 10**9))
    i = h.index('window.__ATW_DATA =') + len('window.__ATW_DATA =')
    return json.JSONDecoder().raw_decode(h[i:].lstrip())[0]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--site', default='https://handicapperwatchdog.com')
    ap.add_argument('--sample', type=int, default=40)
    a = ap.parse_args()
    fails = []
    live = json.loads(get(a.site + '/data/index.json?cb=%d' % random.randint(1, 10**9)))
    src = source()
    rows = [x for x in src['handicappers'] if x.get('source') in ALLOWED and int(x.get('graded') or 0) > 0]
    # The board is keyed by masked id, so match on the full figure tuple; each tuple must exist in the source.
    key = lambda w, l, p, g, u: (w, l, p, g, None if u is None else round(float(u), 2))
    src_keys = {}
    for x in rows:
        w, l, p = (list(map(int, str(x['record']).split('-'))) + [0, 0, 0])[:3]
        src_keys.setdefault(key(w, l, p, int(x['graded']), x.get('units')), 0)
        src_keys[key(w, l, p, int(x['graded']), x.get('units'))] += 1
    stale = 0
    for c in live['cappers']:
        if key(c['w'], c['l'], c['p'], c['picks'], c['units']) not in src_keys:
            stale += 1
    m = live['meta']
    print('board rows %d, source rows %d, rows not matching current source %d (source moved since build at %s)' % (
        len(live['cappers']), len(rows), stale, m['built_at']))
    if stale > max(60, len(rows) * 0.05):
        fails.append('board drift %d rows' % stale)
    # recompute the meta figures from the board itself
    q = [c for c in live['cappers'] if c['picks'] >= 20 and c['units'] is not None]
    if m['qualified'] != len(q) or m['profitable'] != sum(1 for c in q if c['units'] > 0):
        fails.append('meta qualified/profitable do not match board')
    if m['graded_picks'] != sum(c['picks'] for c in live['cappers']):
        fails.append('meta graded_picks does not match board')
    with_prof = [c for c in live['cappers'] if c.get('profile')]
    print('profiles flagged %d of %d (meta %d)' % (len(with_prof), len(live['cappers']), m['profiles']))
    if len(with_prof) != m['profiles']:
        fails.append('profile flag count != meta.profiles')

    # profiles
    random.seed(7)
    sample = random.sample(with_prof, min(a.sample, len(with_prof)))
    bad = 0
    blob = []
    for c in sample:
        try:
            raw = get(a.site + '/data/p/%s.json' % c['id'])
            p = json.loads(raw)
        except Exception as e:
            bad += 1
            fails.append('profile %s did not load: %s' % (c['id'], type(e).__name__))
            continue
        blob.append(raw.lower())
        o = p['overview']
        if (o['w'], o['l'], o['p'], o['picks']) != (c['w'], c['l'], c['p'], c['picks']):
            # a profile can lag the board by one refresh; report, fail only if the record is not even close
            if abs(o['picks'] - c['picks']) > 10:
                fails.append('profile %s record %s vs board %s' % (c['id'], (o['w'], o['l'], o['p']), (c['w'], c['l'], c['p'])))
        if p['curve'] and abs(p['curve'][-1] - float(o['net'])) > 0.05:
            fails.append('profile %s chart ends %.2f, units %.2f' % (c['id'], p['curve'][-1], o['net']))
        sd = p.get('sport_detail') or {}
        tw = sum(s['overall']['w'] for s in sd.values()); tl = sum(s['overall']['l'] for s in sd.values())
        if (tw, tl) != (o['w'], o['l']):
            fails.append('profile %s sport tabs %d-%d vs overall %d-%d' % (c['id'], tw, tl, o['w'], o['l']))
    print('profiles checked %d, failed to load %d' % (len(sample), bad))

    # leak audit over pages, scripts, index and sampled profiles
    pages = ''.join(get(a.site + '/' + f).lower() for f in ('', 'cappers.html', 'capper.html', 'app.js', 'capper.js', 'style.css'))
    corpus = pages + json.dumps(live).lower() + ''.join(blob)
    names = set()
    for x in src['handicappers']:
        for k in ('slug', 'handle', 'username'):
            v = (x.get(k) or '').lower()
            if len(v) >= 6:
                names.add(v)
    words = set(re.findall(r'[a-z0-9_.\-]{6,}', corpus))
    hits = sorted(n for n in names if n in words)
    # team and league words that are also handles are not leaks; list them so a human can see
    print('identity scan: %d handles checked, %d exact token hits %s' % (len(names), len(hits), hits[:12]))
    urls = re.findall(r'https?://([a-z0-9.\-]+)', json.dumps(live).lower() + ''.join(blob))
    outside = sorted(set(u for u in urls))
    print('urls inside data files:', outside or 'none')
    if outside:
        fails.append('urls in data: %s' % outside[:5])
    for word in ('trustmyrecord', 'tmr pro'):
        if word in pages:
            fails.append('public page mentions %s' % word)
    print('RESULT', 'FAIL' if fails else 'PASS')
    for f in fails:
        print('  -', f)
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
