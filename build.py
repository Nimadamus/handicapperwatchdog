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
from urllib.parse import quote
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
# pricing.html, terms.html and privacy.html are written by the page generators below, not copied.
STATIC = ('index.html', 'capper.html', 'cappers.html', 'account.html', 'compare.html', 'style.css', 'app.js', 'capper.js',
          'pro.js', 'compare.js', 'pricing.js', 'account.js', 'favicon.svg', 'stadium.svg', 'CNAME', 'robots.txt', 'sitemap.xml')
PROFILE_TTL = int(os.environ.get('HWD_PROFILE_TTL', str(6 * 3600)))
MAX_FETCH = int(os.environ.get('HWD_MAX_FETCH', '400'))
PT = timezone(timedelta(hours=-7))  # display only; weekday buckets use Pacific time like the rest of TMR
DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']


def get(url, tries=3):
    for i in range(tries):
        try:
            return _get(url)
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(2 * (i + 1))


def _get(url):
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


def public_row(row):
    """Drop anything that tells a reader who the capper is or where they post."""
    hidden = ('source', 'handle', 'slug', 'username', 'email', 'screen_name', 'user_id', 'account_id')
    return {k: v for k, v in row.items() if k not in hidden}


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


_ID = re.compile(r'^[0-9a-f]{10}$')
_REC = re.compile(r'^\d+-\d+(?:-\d+)?$')
# Only pages that return 200 on the apex host. http, www, and github.io 301
# to these URLs and must stay out of the sitemap. noindex files are skipped.
_SITEMAP = (
    ('index.html', 'https://handicapperwatchdog.com/', 'daily', '1.0'),
    ('cappers.html', 'https://handicapperwatchdog.com/cappers.html', 'daily', '0.8'),
    ('the-board.html', 'https://handicapperwatchdog.com/the-board.html', 'daily', '0.8'),
    ('how-we-grade.html', 'https://handicapperwatchdog.com/how-we-grade.html', 'monthly', '0.6'),
    ('pricing.html', 'https://handicapperwatchdog.com/pricing.html', 'monthly', '0.5'),
    ('about.html', 'https://handicapperwatchdog.com/about.html', 'yearly', '0.3'),
    ('privacy.html', 'https://handicapperwatchdog.com/privacy.html', 'yearly', '0.2'),
    ('terms.html', 'https://handicapperwatchdog.com/terms.html', 'yearly', '0.2'),
    ('contact.html', 'https://handicapperwatchdog.com/contact.html', 'yearly', '0.3'),
)
_MARKERS = {
    'index.html': ('live', 'board', 'sports', 'reality', 'pending', 'jsonld'),
    'cappers.html': ('fresh', 'rows', 'pending', 'jsonld', 'sportnav'),
}
# Sport pages need a real sample. A 21 pick hot streak never leads a sport page.
_SPORT_MIN = 30
_SPORT_PAGE_MIN = 5


def _esc(s):
    return str(s).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;')


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _public(rows):
    return [r for r in rows if isinstance(r, dict) and _ID.fullmatch(str(r.get('id') or ''))]


def _signed(v, digits, suffix=''):
    n = _num(v)
    if n is None:
        return '<span class="dim">n/a</span>'
    body = '%.*f' % (digits, n)
    if n > 0:
        body = '+' + body
        return '<span class="pos">%s%s</span>' % (body, suffix)
    if n < 0:
        return '<span class="neg">%s%s</span>' % (body, suffix)
    return body + suffix


def _record(r):
    pushes = int(r.get('p') or 0)
    text = '%d-%d' % (int(r.get('w') or 0), int(r.get('l') or 0))
    return text + ('-%d' % pushes if pushes else '')


def _tier(picks):
    if picks >= 100:
        return 'est', 'Established'
    if picks >= 20:
        return 'dev', 'Developing'
    return 'sm', 'Small sample'


def _cap_cell(r, href_prefix=''):
    code = r['id'][:4].upper()
    kind, label = _tier(int(r.get('picks') or 0))
    inner = ('<div class="cap"><span class="av">%s</span><span class="nm"><b>'
             '<span class="blur" aria-label="Name hidden">Hidden name</span></b>'
             '<small>ID %s · <span class="badge %s">%s</span></small></span></div>') % (
                 _esc(code[:2]), _esc(code), kind, label)
    if r.get('profile'):
        return '<a href="%scapper.html?id=%s">%s</a>' % (href_prefix, r['id'], inner)
    return inner


def _row(r, n):
    picks = int(r.get('picks') or 0)
    streak = int(r.get('streak') or 0)
    if streak > 0:
        streak_html = '<span class="st pos">W%d</span>' % streak
    elif streak < 0:
        streak_html = '<span class="st neg">L%d</span>' % -streak
    else:
        streak_html = '<span class="dim">0</span>'
    last = r.get('last_pick') if isinstance(r.get('last_pick'), str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}', r.get('last_pick') or '') else 'n/a'
    win = r.get('win_pct')
    win_html = 'n/a' if _num(win) is None else '%.1f%%' % float(win)
    cells = (
        '<td class="l rk">%d</td>' % n,
        '<td class="l">%s</td>' % _cap_cell(r),
        '<td class="hm l"><span class="dim small">lifetime</span></td>',
        '<td class="hm">%s</td>' % f'{picks:,}',
        '<td>%s</td>' % _record(r),
        '<td class="hm">%s</td>' % win_html,
        '<td>%s</td>' % _signed(r.get('units'), 2),
        '<td class="hm">%s</td>' % _signed(r.get('roi'), 1, '%'),
        '<td class="hm">%s</td>' % streak_html,
        '<td class="hm muted">%s</td>' % _esc(last),
    )
    return '<tr>%s</tr>' % ''.join(cells)


def _established(cappers):
    rows = [r for r in _public(cappers) if int(r.get('picks') or 0) >= 100 and _num(r.get('units')) is not None]
    rows.sort(key=lambda r: float(r['units']), reverse=True)
    return rows


def _ranked(cappers, limit):
    rows = _established(cappers)
    body = ''.join(_row(r, i) for i, r in enumerate(rows[:limit], 1))
    return body or '<tr><td colspan="10" class="empty">No established records with 100 or more graded picks yet.</td></tr>'


def _live(meta):
    est = int(meta.get('established') or 0)
    up = int(meta.get('established_up') or 0)
    share = '%d%%' % round(100 * up / est) if est else 'n/a'
    cells = (
        (f'{int(meta.get("tracked") or 0):,}', 'Handicappers with a record'),
        (f'{int(meta.get("graded_picks") or 0):,}', 'Picks graded'),
        (f'{int(meta.get("profiles") or 0):,}', 'Profiles published'),
        (share, 'Of established records are up money'),
    )
    return ''.join('<div class="kv"><b>%s</b><span>%s</span></div>' % (_esc(n), _esc(label)) for n, label in cells)


def _reality(meta, cappers):
    est = int(meta.get('established') or 0)
    up = int(meta.get('established_up') or 0)
    qual = int(meta.get('qualified') or 0)
    prof = int(meta.get('profitable') or 0)
    pct = round(100 * up / est) if est else 0
    bars = _platform_bars(meta, cappers)
    return ('<div class="eyebrow">Established records, 100 or more picks</div><div class="big">%d%%</div>'
            '<p class="muted small">are up money: %s of %s handicappers. Among records with 20 or more picks, %s of %s are up money. '
            'Names and posting sites are not published. These are past results, not predictions.</p>%s') % (
                pct, f'{up:,}', f'{est:,}', f'{prof:,}', f'{qual:,}', bars)


def _platform_bars(meta, cappers):
    rows = meta.get('by_platform') if isinstance(meta.get('by_platform'), list) else None
    if not rows:
        roll = {}
        for r in _public(cappers):
            if int(r.get('picks') or 0) < 20 or _num(r.get('units')) is None:
                continue
            name = r.get('source') if isinstance(r.get('source'), str) else ''
            if not name:
                continue
            bucket = roll.setdefault(name, [0, 0])
            bucket[0] += 1
            if float(r['units']) > 0:
                bucket[1] += 1
        rows = [{'name': k, 'n': v[0], 'up': v[1]} for k, v in sorted(roll.items(), key=lambda kv: -kv[1][0])]
    parts = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        name, n, up = row.get('name'), int(row.get('n') or 0), int(row.get('up') or 0)
        if not isinstance(name, str) or not name or n <= 0:
            continue
        pct = round(100 * up / n)
        parts.append('<div class="srcrow"><span>%s <span class="dim small">%s</span></span>'
                     '<span class="bar" style="width:90px"><i style="width:%d%%"></i></span><b class="num">%d%%</b></div>' % (
                         _esc(name), f'{n:,}', pct, pct))
    if not parts:
        return ''
    return '<div class="eyebrow" style="margin:14px 0 4px">Up money by posting site, 20 or more picks</div>' + ''.join(parts)


def _sport_slug(sport):
    slug = re.sub(r'[^a-z0-9]+', '-', sport.lower()).strip('-')
    return slug or 'sport'


def _sport_depth(cappers):
    depth = {}
    for r in _public(cappers):
        bs = r.get('bs') if isinstance(r.get('bs'), dict) else {}
        for sport, raw in bs.items():
            if isinstance(sport, str) and isinstance(raw, list) and raw and int(raw[0] or 0) >= _SPORT_MIN:
                depth[sport] = depth.get(sport, 0) + 1
    return depth


def _sport_pages(cappers):
    depth = _sport_depth(cappers)
    return [s for s in sorted(depth, key=lambda s: depth[s], reverse=True) if depth[s] >= _SPORT_PAGE_MIN]


def _sport_leaders(cappers, sport):
    top = []
    for r in _public(cappers):
        raw = (r.get('bs') or {}).get(sport)
        if not isinstance(raw, list) or len(raw) < 2 or int(raw[0] or 0) < _SPORT_MIN or _num(raw[1]) is None:
            continue
        top.append((float(raw[1]), r, raw))
    top.sort(key=lambda item: item[0], reverse=True)
    return top


def _sport_nav(cappers):
    return ''.join('<a href="sports/%s.html">%s</a>' % (_sport_slug(sport), _esc(sport)) for sport in _sport_pages(cappers))


def _sports(cappers):
    blocks = []
    for sport in _sport_pages(cappers)[:6]:
        items = []
        for units, r, raw in _sport_leaders(cappers, sport):
            if units <= 0:
                continue
            rec = raw[4] if len(raw) > 4 and isinstance(raw[4], str) and _REC.fullmatch(raw[4]) else ''
            label = '<span class="badge">%s</span><span class="muted">%s</span>' % (_esc(r['id'][:4].upper()), _esc(rec))
            linked = '<a href="capper.html?id=%s">%s</a>' % (r['id'], label) if r.get('profile') else label
            items.append('<li>%s%s</li>' % (linked, _signed(units, 1, 'u')))
            if len(items) == 3:
                break
        if items:
            blocks.append('<div class="sc s-%s"><p class="sptitle"><span>%s</span><a class="muted small" href="sports/%s.html">View all</a></p><ol>%s</ol></div>' % (
                _sport_slug(sport), _esc(sport), _sport_slug(sport), ''.join(items)))
    return ''.join(blocks)


def _fresh(meta):
    when = 'recently'
    raw = meta.get('built_at') or ''
    try:
        dt = datetime.fromisoformat(str(raw).replace('Z', '+00:00')).astimezone(PT)
        when = '%s %d, %d PT' % ('Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split()[dt.month - 1], dt.day, dt.year)
    except (TypeError, ValueError):
        pass
    return '%s handicappers with graded picks. Names and posting sites are hidden. Updated %s.' % (f'{int(meta.get("tracked") or 0):,}', when)


def _pending(meta):
    live = meta.get('live') if isinstance(meta.get('live'), dict) else {}
    n = _num(live.get('pending_picks')) if live else None
    if n is None:
        return 'Picks posted for games that have not started stay locked. The names stay locked too.'
    count = f'{int(n):,}'
    noun = 'pick is' if int(n) == 1 else 'picks are'
    return '%s %s up for games that have not started. Names are locked.' % (count, noun)


def _itemlist(cappers, page_url, name):
    rows = _established(cappers)
    items = []
    for i, r in enumerate(rows[:10], 1):
        items.append({'@type': 'ListItem', 'position': i, 'name': 'Handicapper %s, %+.2f units, %d graded picks' % (
            r['id'][:4].upper(), float(r['units']), int(r.get('picks') or 0))})
    data = {'@context': 'https://schema.org', '@type': 'ItemList', 'name': name, 'url': page_url, 'itemListElement': items}
    return '<script type="application/ld+json">%s</script>' % json.dumps(data, ensure_ascii=True).replace('<', '\\u003c')


def _fill(page, html, name, inner, required):
    start, end = '<!--seo:%s-->' % name, '<!--/seo:%s-->' % name
    if start not in html or end not in html or html.find(end, html.find(start)) < 0:
        if name in required:
            raise SystemExit('seo marker %s missing in %s' % (name, page))
        return html
    pre, rest = html.split(start, 1)
    _, post = rest.split(end, 1)
    return pre + start + inner + end + post


def _write_retired_rating(site):
    """The old sportsbook-relative rating address was never a page. Send readers
    to the real guide without adding a sitemap URL or a second canonical target."""
    folder = os.path.join(site, 'sportsbooks', 'reviews')
    os.makedirs(folder, exist_ok=True)
    html = '''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>How we rate</title>
<meta name="robots" content="noindex">
<link rel="canonical" href="https://handicapperwatchdog.com/reviews/how-we-rate.html">
<meta http-equiv="refresh" content="0; url=/reviews/how-we-rate.html">
</head>
<body>
<p>This address is not a page. The rating guide is <a href="/reviews/how-we-rate.html">how we rate</a>.</p>
</body>
</html>
'''
    with open(os.path.join(folder, 'how-we-rate.html'), 'w', encoding='utf-8', newline='\n') as f:
        f.write(html)


def _noindex(path):
    with open(path, encoding='utf-8') as f:
        head = f.read(8000).lower()
    return 'name="robots"' in head and 'noindex' in head


def _write_sitemap(site, lastmod):
    lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    entries = list(_SITEMAP)
    sport_dir = os.path.join(site, 'sports')
    if os.path.isdir(sport_dir):
        for name in sorted(os.listdir(sport_dir)):
            if name.endswith('.html'):
                entries.append(('sports/' + name, 'https://handicapperwatchdog.com/sports/' + name, 'daily', '0.7'))
    for folder, freq, priority in (('reviews', 'weekly', '0.6'), ('sportsbooks', 'weekly', '0.6'), ('learn', 'weekly', '0.7')):
        folder_dir = os.path.join(site, folder)
        if not os.path.isdir(folder_dir):
            continue
        for name in sorted(os.listdir(folder_dir)):
            path = os.path.join(folder_dir, name)
            if name.endswith('.html') and os.path.isfile(path):
                loc = 'https://handicapperwatchdog.com/' + folder + '/' + name
                if folder in ('sportsbooks', 'learn') and name == 'index.html':
                    loc = 'https://handicapperwatchdog.com/%s/' % folder
                entries.append((folder + '/' + name, loc, freq, priority))
            elif folder == 'sportsbooks' and os.path.isdir(path) and os.path.isfile(os.path.join(path, 'index.html')):
                entries.append((folder + '/' + name + '/index.html',
                                'https://handicapperwatchdog.com/sportsbooks/' + name + '/', freq, priority))
    for filename, loc, freq, priority in entries:
        path = os.path.join(site, filename.replace('/', os.sep))
        if not os.path.isfile(path) or _noindex(path):
            continue
        lines.append('  <url><loc>%s</loc><lastmod>%s</lastmod><changefreq>%s</changefreq><priority>%s</priority></url>' % (loc, lastmod, freq, priority))
    lines.append('</urlset>')
    with open(os.path.join(site, 'sitemap.xml'), 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n'.join(lines) + '\n')


def _name_parts(name):
    return [p for p in re.findall(r'[A-Za-z0-9]+', name) if len(p) > 1 or p.isupper()]


def _base_mark(name):
    compact = re.sub(r'[^A-Za-z0-9]', '', name)
    caps = [c for c in compact if c.isupper()]
    if ' ' not in name and len(caps) >= 2:
        return caps[0] + caps[1]
    parts = _name_parts(name)
    if len(parts) >= 2:
        return (parts[0][0] + parts[1][0]).upper()
    if parts:
        return parts[0][:2].upper()
    return 'NR'


def _marks(names):
    bases = {name: _base_mark(name) for name in names}
    used = {}
    for mark in bases.values():
        used[mark] = used.get(mark, 0) + 1
    out = {}
    for name, mark in bases.items():
        parts = _name_parts(name)
        if used[mark] > 1 and len(parts) >= 3:
            mark = (parts[0][0] + parts[1][0] + parts[2][0]).upper()
        out[name] = mark
    return out


def _mark(initials):
    return (
        '<svg class="mono" viewBox="0 0 88 88" role="img" aria-label="%s">'
        '<rect width="88" height="88" rx="18" fill="#122033" stroke="#f5c451" stroke-opacity=".7"/>'
        '<text x="44" y="56" text-anchor="middle" fill="#f5c451" font-family="Inter,Arial,sans-serif" '
        'font-size="28" font-weight="800">%s</text></svg>'
    ) % (_esc(initials), _esc(initials))


def _rel(depth, href):
    if href.startswith('http') or href.startswith('#'):
        return href
    return ('../' * depth) + href


def _nav(depth, current):
    items = (
        ('cappers.html', 'Rankings'),
        ('reviews/index.html', 'Reviews'),
        ('sportsbooks/', 'Sportsbooks'),
        ('learn/', 'Guides'),
        ('pricing.html', 'Pricing'),
    )
    return '<nav class="navlinks" id="sitenav">%s</nav>' % ''.join(
        '<a href="%s"%s>%s</a>' % (_rel(depth, href), ' class="on"' if href == current else '', label)
        for href, label in items)


def _header(depth, current):
    home = '../' * depth if depth else './'
    prefix = '../' * depth
    return (
        '<header class="top"><div class="wrap">'
        '<a class="brand" href="%s"><img src="%sfavicon.svg" alt="" width="24" height="24"><span>Handicapper <b>Watchdog</b></span></a>'
        '<input id="navtoggle" class="navtoggle" type="checkbox">'
        '<label class="navbtn" for="navtoggle">Menu</label>'
        '%s'
        '<form class="navsearch" action="%scappers.html" role="search">'
        '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>'
        '<input name="q" placeholder="Search capper ID or sport" aria-label="Search cappers"></form>'
        '<a class="btn sm pro" href="%spricing.html">Watchdog Pro</a>'
        '</div></header>'
    ) % (home, prefix, _nav(depth, current), prefix, prefix)


def _footer(depth):
    prefix = '../' * depth
    links = (
        ('cappers.html', 'Rankings'),
        ('reviews/index.html', 'Reviews'),
        ('sportsbooks/', 'Sportsbooks'),
        ('sportsbooks/justbet.html', 'JustBet'),
        ('learn/', 'Betting guides'),
        ('the-board.html', 'The board'),
        ('how-we-grade.html', 'How we grade'),
        ('pricing.html', 'Watchdog Pro'),
        ('account.html', 'Account'),
        ('about.html', 'About'),
        ('privacy.html', 'Privacy'),
        ('terms.html', 'Terms'),
        ('contact.html', 'Contact'),
    )
    return (
        '<footer class="foot"><div class="wrap"><div>'
        '<p><b>Handicapper Watchdog</b> grades picks captured from public posts on X, Covers, Reddit, TheRX, '
        'Sportsbook Review and Predictem. Records are past results, not predictions or guarantees. '
        'Held, duplicate and unreviewed picks are not counted.</p>'
        '<p>21+. Gambling problem? Call 1 800 GAMBLER.</p></div><div>%s</div></div></footer>'
    ) % ''.join('<p><a href="%s%s">%s</a></p>' % (prefix, href, label) for href, label in links)


def _document(depth, current, title, description, canonical, body, robots='', scripts=(), page=''):
    prefix = '../' * depth
    tail = ''.join('<script src="%s%s"></script>\n' % (prefix, src) for src in scripts)
    crumb = ''
    robots_meta = ('<meta name="robots" content="%s">\n' % _esc(robots)) if robots else ''
    return ('''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>%s</title>
<meta name="description" content="%s">
<link rel="canonical" href="%s">
''' + robots_meta + '''
<meta property="og:title" content="%s">
<meta property="og:description" content="%s">
<meta property="og:type" content="website">
<meta property="og:url" content="%s">
<meta property="og:site_name" content="Handicapper Watchdog">
<meta name="twitter:card" content="summary">
<meta name="theme-color" content="#070d17">
<link rel="icon" href="%sfavicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,560;9..144,680&family=Manrope:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="%sstyle.css">
<script async src="https://www.googletagmanager.com/gtag/js?id=G-SC607ZYK1F"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-SC607ZYK1F');</script>
</head>
<body%s>
%s
<main class="wrap">
%s
</main>
%s
%s</body>
</html>
''') % (_esc(title), _esc(description), canonical, _esc(title), _esc(description), canonical,
       prefix, prefix, (' data-page="%s"' % _esc(page)) if page else '', _header(depth, current), body, _footer(depth), tail)


def _median_roi(cappers, minimum):
    vals = sorted(float(r['roi']) for r in _public(cappers)
                  if int(r.get('picks') or 0) >= minimum and _num(r.get('roi')) is not None)
    if not vals:
        return None
    return vals[len(vals) // 2]


def _pricing_body(pending):
    """Watchdog Pro checkout page. pricing.js turns the plan buttons into Stripe checkout once /api/me reports billing,
    and shows the plans as not open yet on a static only deploy. Prices: $59.99 a month or $499 a year, nothing else."""
    rows = (
        ('Rank, record, units, ROI, win rate and streak', 'Yes', 'Yes'),
        ('Established board, sport records and profile breakdowns', 'Yes', 'Yes'),
        ('Advanced metrics on every profile: closing line value, z score, drawdown', 'Yes', 'Yes'),
        ('The handicapper behind every record, and the posting site', 'No', 'Yes'),
        ('Complete graded pick log: game, pick, price, result, units, post time', 'No', 'Yes'),
        ('A link to the original post for every graded pick', 'No', 'Yes'),
        ('Search by handle across every tracked handicapper', 'No', 'Yes'),
        ('Advanced filters: closing line value, z score, drawdown, profitable months', 'No', 'Yes'),
        ('Side by side comparison of up to four handicappers', 'No', 'Yes'),
    )
    faq = (
        ('Where do the records come from?', 'Picks posted in public on X, Covers, Reddit, TheRX, Sportsbook Review and Predictem, graded against the final score. Watchdog tracks thousands of handicappers, not every one on the internet.'),
        ('Does Pro include picks for games that have not started?', 'No. Pro is the name, the posting site and the graded history. Pending picks are not part of Watchdog Pro.'),
        ('How do I cancel?', 'From your account page, open billing and cancel. Pro stays on until the end of the period you already paid for, and you are not charged again.'),
        ('Can I switch from monthly to annual?', 'Yes. Open billing from your account page and change the plan there.'),
        ('Is my payment secure?', 'Checkout and billing run on Stripe. Card details go straight to Stripe and never touch Watchdog servers.'),
        ('Do past results predict future results?', 'No. Records are past results, not predictions or guarantees. Bet only what you can afford to lose. 21+.'),
    )
    table = ''.join('<tr><td class="l">%s</td><td>%s</td><td>%s</td></tr>' % (_esc(a), b, c) for a, b, c in rows)
    faqs = ''.join('<details class="faq"><summary>%s</summary><p>%s</p></details>' % (_esc(q), _esc(a)) for q, a in faq)
    return '''<nav class="crumbs" aria-label="Breadcrumb"><a href="./">Home</a><span aria-hidden="true">/</span><span aria-current="page">Pricing</span></nav>
<div class="pagehead"><div><div class="eyebrow">Watchdog Pro</div><h1>Know who you are following, and every pick behind the record</h1>
<p class="muted">The free board shows the record. Pro shows the name, the posting site, and every graded pick with the original post. Both plans include the same features.</p>
<div class="notice" id="notice" hidden></div></div></div>
<div class="panel" id="buyerBox" style="margin:0 0 18px;display:none"><div class="pb">
<label for="buyerEmail"><b>Email for this subscription</b></label>
<p class="muted small" style="margin:4px 0 10px">Used for your receipt, sign in, and to stop a second subscription on the same email.</p>
<div class="row"><input id="buyerEmail" type="email" autocomplete="email" placeholder="you@example.com"></div>
</div></div>
<section class="plans">
<div class="plan best" id="planAnnual"><div class="eyebrow">Annual <span class="save">Best value</span></div><div class="amt"><b>$499</b><span>a year</span></div>
<p class="per"><b>$41.58</b> a month, billed once a year. Twelve months at $59.99 is $719.88, so annual saves <b>$220.88</b>.</p>
<button class="btn pro full" data-plan="annual" type="button">Start annual</button>
<p class="muted small">Cancel any time. Pro stays on to the end of the year you paid for.</p></div>
<div class="plan"><div class="eyebrow">Monthly</div><div class="amt"><b>$59.99</b><span>a month</span></div>
<p class="per">Billed every month. The same Pro access as annual.</p>
<button class="btn ghost full" data-plan="monthly" type="button">Start monthly</button>
<p class="muted small">Cancel any time. Pro stays on to the end of the month you paid for.</p></div>
</section>
<p class="muted small" id="planNote" style="margin:0 0 18px">Monthly and annual include the same Watchdog Pro features. Secure checkout by Stripe. Watchdog never sees your card. Prices in US dollars.</p>
<section class="panel" id="preview" style="margin:0 0 18px"><div class="ph"><h3>What Pro unlocks right now</h3><span class="muted small" id="pvAt"></span></div>
<div class="pb"><div class="pvstats" id="pvStats"></div>
<div class="eyebrow" style="margin:18px 0 8px">Top 5 by units won, 50+ graded picks</div>
<div class="tw"><table class="mini"><thead><tr><th class="l">Handicapper</th><th class="hp">Picks</th><th>Record</th><th>Units</th><th class="hp">ROI</th><th class="l hp">With Pro</th></tr></thead><tbody id="pvRows"></tbody></table></div>
<p class="muted small" style="margin:10px 0 0">Real records from the current rankings. Names and pick logs stay hidden until you subscribe.</p></div></section>
<section class="panel" style="margin:0 0 18px"><div class="ph"><h3>Free and Pro</h3><span class="muted small">Every figure comes from graded public picks</span></div>
<div class="tw"><table class="mini"><thead><tr><th class="l">Feature</th><th>Free</th><th>Pro</th></tr></thead><tbody>
%s
</tbody></table></div></section>
<section class="panel" style="margin:0 0 18px"><div class="pb">
<p>Watchdog Pro is not a verified badge. A handicapper cannot pay to be ranked higher, to be featured, or to receive a label that the record is legitimate. Pro is access to the name, the posting site, and the pick log on records this site already grades from public posts.</p>
<p>Pending picks are not mixed into a record. %s</p>
<p class="muted small">Subscribing is covered by the <a href="pro-terms.html">Watchdog Pro subscription terms</a> and the <a href="pro-privacy.html">Watchdog Pro privacy notice</a>. Records are past results, not predictions or a guarantee. 21+. Gambling problem? Call 1 800 GAMBLER.</p>
<p><a href="cappers.html">Look at the free board first</a> · <a href="how-we-grade.html">How a record is graded</a> · <a href="reviews/index.html">Handicapper reviews</a></p>
</div></section>
<section class="edsec"><h2>Questions</h2><div class="faqs">%s</div></section>
<section class="proband slim"><div><span class="lock">Watchdog Pro</span><h2>Research the handicapper before you follow the pick.</h2><p class="muted" style="margin:0">$499 a year or $59.99 a month. Cancel any time.</p></div>
<button class="btn pro" data-plan="annual" type="button">Start annual</button></section>''' % (table, pending, faqs)


def _write_guides(site, meta, cappers):
    est = int(meta.get('established') or 0)
    up = int(meta.get('established_up') or 0)
    qual = int(meta.get('qualified') or 0)
    prof = int(meta.get('profitable') or 0)
    tracked = int(meta.get('tracked') or 0)
    graded = int(meta.get('graded_picks') or 0)
    est_pct = round(100 * up / est) if est else 0
    qual_pct = round(100 * prof / qual) if qual else 0
    med_est = _median_roi(cappers, 100)
    med_txt = 'n/a' if med_est is None else '%+.1f%%' % med_est
    pending = _esc(_pending(meta))
    grade = _document(0, 'how-we-grade.html',
                      'How Handicapper Watchdog Grades a Record',
                      'How public handicapper picks are captured, graded on the final score, and ranked. Names and posting sites stay off the free board.',
                      'https://handicapperwatchdog.com/how-we-grade.html',
                      '''<nav class="crumbs" aria-label="Breadcrumb"><a href="./">Home</a><span aria-hidden="true">/</span><span aria-current="page">How we grade</span></nav>
<div class="pagehead"><div><div class="eyebrow">Methodology</div><h1>How a record gets graded</h1>
<p class="muted">Every number on this site comes from a pick that was posted in public before the game started. A handicapper does not send us a record. We grade the posts ourselves.</p></div></div>
<div class="how">
<div class="panel pb"><span class="n">01</span><b>Captured from public posts</b><p>Picks are read from public posts on X, Covers, Reddit, TheRX, Sportsbook Review and Predictem, with the time each one was posted. A pick posted after the game starts is not counted.</p></div>
<div class="panel pb"><span class="n">02</span><b>Graded on the final score</b><p>Straight bets are graded against the final score. One unit is risked on each pick at the posted price. When a post has no price, a reference price is used. Pushes are pushes. Held, duplicate and unreviewed posts are left out.</p></div>
<div class="panel pb"><span class="n">03</span><b>Sample size is part of the record</b><p>Under 20 picks is a small sample. From 20 to 99 is developing. 100 or more is established. The free homepage and the rankings open on established records, because a short hot streak is not a career.</p></div>
</div>
<section class="panel" style="margin-bottom:18px"><div class="pb">
<h2>What the free board shows</h2>
<p>Rank, record, units, ROI, win rate and sample size are public. The name, the handle and the posting site are not. A record next to a posting site is often enough to go find that person and follow them for free, so that pairing stays inside Watchdog Pro.</p>
<p>A handicapper cannot pay for a higher rank, a feature, or a verified label. Rank is the graded record. Watchdog Pro is access to the name and the log, not a badge that the record is legitimate.</p>
<p>People looking for a verified handicapper record are looking for a timestamp and a sample, not a badge. On this site a pick counts only when it was posted in public before the start, and the free board opens at 100 graded picks. A directory can still print the word verified and show the pick after the start. The <a href="reviews/cappertek.html">CapperTek review</a> is that case. CapperTek says the public reveal is 30 minutes after the event starts.</p>
<p>Pending picks are not mixed into a record. %s</p>
<p class="muted small">%s handicappers have a graded record. %s picks have been graded. Of the established records, %s of %s are up money.</p>
<p><a href="cappers.html">Established rankings</a> · <a href="the-board.html">The board</a> · <a href="pricing.html">Watchdog Pro</a> · <a href="reviews/index.html">Handicapper reviews</a> · <a href="sportsbooks/">Sportsbook research</a></p>
</div></section>''' % (pending, f'{tracked:,}', f'{graded:,}', f'{up:,}', f'{est:,}'))
    board = _document(0, 'the-board.html',
                      'How Many Handicappers Are Actually Up | Handicapper Watchdog',
                      'The share of tracked handicappers who are up money, split by sample size. Names and posting sites stay hidden.',
                      'https://handicapperwatchdog.com/the-board.html',
                      '''<nav class="crumbs" aria-label="Breadcrumb"><a href="./">Home</a><span aria-hidden="true">/</span><span aria-current="page">The board</span></nav>
<div class="pagehead"><div><div class="eyebrow">The board</div><h1>How many handicappers are actually up</h1>
<p class="muted">%s</p></div></div>
<div class="kvgrid" style="margin-bottom:18px">
<div class="kv"><b>%s</b><span>Handicappers with a graded record</span></div>
<div class="kv"><b>%s</b><span>Picks graded</span></div>
<div class="kv"><b>%d%%</b><span>Of established records are up money (%s of %s)</span></div>
<div class="kv"><b>%d%%</b><span>Of records with 20 or more picks are up money (%s of %s)</span></div>
</div>
<section class="panel" style="margin-bottom:18px"><div class="pb">
<p>Established means 100 or more graded picks. The median ROI on those records is %s. A record with 20 picks can still be a hot streak, which is why the free rankings open on the established list.</p>
<p>%s</p>
<p>These are past results, not predictions. Names and posting sites stay off this page. <a href="how-we-grade.html">How a record is graded</a>. Named services are reviewed apart from this board: <a href="reviews/index.html">handicapper reviews</a>.</p>
<p><a class="btn" href="cappers.html">See the established rankings</a></p>
</div></section>
<section class="proband"><div><span class="lock">Watchdog Pro</span><h2>The names behind the records that are up</h2>
<p class="muted" style="margin:0">$59.99 a month, or $499 a year. Pro shows the handicapper, the posting site, and every graded pick with the original post.</p>
<p style="margin:14px 0 0"><a class="btn pro" href="pricing.html">See Watchdog Pro</a></p></div>
<div class="feats"><div class="feat"><b>Why the name is locked</b><span>Publish the name and the posting site and anyone can follow that person without paying.</span></div>
<div class="feat"><b>What you are paying for</b><span>Who is still winning across the whole board, the full graded pick log behind each record, and side by side comparisons.</span></div></div>
</section>''' % (pending, f'{tracked:,}', f'{graded:,}', est_pct, f'{up:,}', f'{est:,}',
                 qual_pct, f'{prof:,}', f'{qual:,}', med_txt, pending))
    price = _document(0, 'pricing.html',
                      'Watchdog Pro Pricing | Handicapper Watchdog',
                      'Watchdog Pro is $59.99 a month or $499 a year. The name and posting site behind every record, the graded pick log with the original posts, advanced filters and side by side comparisons.',
                      'https://handicapperwatchdog.com/pricing.html',
                      _pricing_body(pending), scripts=('pro.js', 'pricing.js'), page='pricing')
    for name, html in (('how-we-grade.html', grade), ('the-board.html', board), ('pricing.html', price)):
        with open(os.path.join(site, name), 'w', encoding='utf-8', newline='\n') as f:
            f.write(html)


def _sport_table(cappers, sport):
    rows = []
    for n, (units, r, raw) in enumerate(_sport_leaders(cappers, sport)[:25], 1):
        picks = int(raw[0] or 0)
        roi = raw[2] if len(raw) > 2 else None
        win = raw[3] if len(raw) > 3 else None
        rec = raw[4] if len(raw) > 4 and isinstance(raw[4], str) and _REC.fullmatch(raw[4]) else ''
        win_html = 'n/a' if _num(win) is None else '%.1f%%' % float(win)
        rows.append('<tr><td class="l rk">%d</td><td class="l">%s</td><td>%s</td><td>%s</td><td>%s</td><td>%s</td><td>%s</td></tr>' % (
            n, _cap_cell(r, '../'), f'{picks:,}', _esc(rec), win_html, _signed(units, 2), _signed(roi, 1, '%')))
    return ''.join(rows)


def _write_sport_pages(site, cappers):
    dest = os.path.join(site, 'sports')
    os.makedirs(dest, exist_ok=True)
    keep = set()
    for sport in _sport_pages(cappers):
        slug = _sport_slug(sport)
        keep.add(slug + '.html')
        leaders = _sport_leaders(cappers, sport)
        title = '%s Handicapper Records | Handicapper Watchdog' % sport
        desc = 'Graded %s records for public handicappers. Names and posting sites are hidden. Ranked by units, %d or more %s picks.' % (
            sport, _SPORT_MIN, sport)
        body = '''<div class="sportband s-%s" aria-hidden="true"></div>
<nav class="crumbs" aria-label="Breadcrumb"><a href="../">Home</a><span aria-hidden="true">/</span><a href="../cappers.html">Rankings</a><span aria-hidden="true">/</span><span aria-current="page">%s</span></nav>
<div class="pagehead"><div><div class="eyebrow">%s records</div><h1>%s handicapper records</h1>
<p class="muted">%d handicappers with %d or more graded %s picks, ranked by units won in %s. Names and posting sites are hidden. A short sample can still swing, so the all sports board opens on records with 100 or more picks. <a href="../how-we-grade.html">How records are graded</a>. Named services are a different file: <a href="../reviews/index.html">handicapper reviews</a>.</p></div>
<a class="btn sm pro" href="../pricing.html">Watchdog Pro</a></div>
<section class="panel"><div class="tw"><table><thead><tr><th class="l">#</th><th class="l">Handicapper</th><th>Picks</th><th>Record</th><th>Win %%</th><th>Units</th><th>ROI</th></tr></thead>
<tbody>%s</tbody></table></div></section>
<section class="proband" style="grid-template-columns:1fr auto"><div><span class="lock">Watchdog Pro</span><h2>Found a %s record worth following?</h2>
<p class="muted" style="margin:0">Pro shows the name, the posting site, and the picks posted before the game. $59.99 a month, or $499 a year.</p></div>
<a class="btn pro" href="../pricing.html">See pricing</a></section>''' % (
            _sport_slug(sport), _esc(sport), _esc(sport), _esc(sport), len(leaders), _SPORT_MIN, _esc(sport), _esc(sport),
            _sport_table(cappers, sport), _esc(sport))
        html = _document(1, '', title, desc, 'https://handicapperwatchdog.com/sports/%s.html' % slug, body)
        with open(os.path.join(dest, slug + '.html'), 'w', encoding='utf-8', newline='\n') as f:
            f.write(html)
    for name in os.listdir(dest):
        if name.endswith('.html') and name not in keep:
            os.remove(os.path.join(dest, name))


def _write_learn(site, meta, cappers):
    """Evergreen guides from content/learn.json. {{key}} placeholders take the live board numbers."""
    path = os.path.join(HERE, 'content', 'learn.json')
    if not os.path.isfile(path):
        return
    with open(path, encoding='utf-8') as f:
        learn = json.load(f)
    est = int(meta.get('established') or 0)
    up = int(meta.get('established_up') or 0)
    qual = int(meta.get('qualified') or 0)
    prof = int(meta.get('profitable') or 0)
    med = _median_roi(cappers, 100)
    stats = {
        'tracked': f"{int(meta.get('tracked') or 0):,}", 'graded': f"{int(meta.get('graded_picks') or 0):,}",
        'est': f'{est:,}', 'up': f'{up:,}', 'qual': f'{qual:,}', 'prof': f'{prof:,}',
        'est_pct': str(round(100 * up / est) if est else 0), 'qual_pct': str(round(100 * prof / qual) if qual else 0),
        'med_est': 'n/a' if med is None else '%+.1f%%' % med,
    }

    def fill(s):
        return re.sub(r'\{\{(\w+)\}\}', lambda m: stats[m.group(1)], s)

    def ld(data):
        return '<script type="application/ld+json">%s</script>' % json.dumps(data, ensure_ascii=True).replace('<', '\\u003c')

    base = 'https://handicapperwatchdog.com/learn/'
    org = {'@type': 'Organization', 'name': 'Handicapper Watchdog', 'url': 'https://handicapperwatchdog.com/'}
    arts = learn['articles']
    by_slug = {a['slug']: a for a in arts}
    folder = os.path.join(site, 'learn')
    os.makedirs(folder, exist_ok=True)
    for a in arts:
        url = base + a['slug'] + '.html'
        h1, answer = fill(a['h1']), fill(a['answer'])
        faq = [(fill(x['q']), fill(x['a'])) for x in a.get('faq') or []]
        sections = ''.join('<section class="panel edcard essay"><h2>%s</h2><div class="prose">%s</div></section>' % (
            _esc(fill(s['h'])), fill(s['html'])) for s in a['sections'])
        faq_html = ('<section class="panel edcard"><h2>Common questions</h2><div class="faqs">%s</div></section>' % ''.join(
            '<details class="faq"><summary>%s</summary><p>%s</p></details>' % (_esc(q), _esc(ans)) for q, ans in faq)) if faq else ''
        rel = [by_slug[s] for s in a.get('related') or [] if s in by_slug]
        rel_html = ('<section class="edsec"><h2>Related guides</h2><div class="relrow">%s</div></section>' % ''.join(
            '<a class="rel" href="%s.html"><span>%s</span><b>%s</b></a>' % (r['slug'], _esc(r['eyebrow']), _esc(fill(r['h1'])))
            for r in rel)) if rel else ''
        graph = [
            {'@type': 'Article', 'headline': h1, 'description': fill(a['description']), 'mainEntityOfPage': url,
             'dateModified': learn['updated'], 'author': org, 'publisher': org},
            {'@type': 'BreadcrumbList', 'itemListElement': [
                {'@type': 'ListItem', 'position': 1, 'name': 'Home', 'item': 'https://handicapperwatchdog.com/'},
                {'@type': 'ListItem', 'position': 2, 'name': 'Guides', 'item': base},
                {'@type': 'ListItem', 'position': 3, 'name': h1, 'item': url}]},
        ]
        if faq:
            graph.append({'@type': 'FAQPage', 'mainEntity': [
                {'@type': 'Question', 'name': q, 'acceptedAnswer': {'@type': 'Answer', 'text': ans}} for q, ans in faq]})
        body = '''<nav class="crumbs" aria-label="Breadcrumb"><a href="../">Home</a><span aria-hidden="true">/</span><a href="./">Guides</a><span aria-hidden="true">/</span><span aria-current="page">%s</span></nav>
<div class="pagehead"><div><div class="eyebrow">%s</div><h1>%s</h1>
<p class="muted">%s</p></div></div>
<div class="edstack">
<section class="panel edcard answer"><h2>The short answer</h2><div class="prose"><p>%s</p></div></section>
%s
%s
<section class="ctaband"><div><h2>See the graded records</h2><p class="muted">%s handicappers, %s picks graded from public posts made before the game.</p></div><p><a class="btn" href="../cappers.html">Open the free rankings</a> <a class="btn sm pro" href="../pricing.html">Watchdog Pro</a></p></section>
%s
</div>
<p class="muted small">Updated %s. Past results are not predictions. 21+. Gambling problem? Call 1 800 GAMBLER.</p>
%s''' % (_esc(h1), _esc(a['eyebrow']), _esc(h1), _esc(fill(a['dek'])), _esc(answer), sections, faq_html,
         stats['tracked'], stats['graded'], rel_html, time.strftime('%B %d, %Y', time.strptime(learn['updated'], '%Y-%m-%d')).replace(' 0', ' '), ld({'@context': 'https://schema.org', '@graph': graph}))
        html = _document(1, 'learn/', fill(a['title']), fill(a['description']), url, body)
        with open(os.path.join(folder, a['slug'] + '.html'), 'w', encoding='utf-8', newline='\n') as f:
            f.write(html)
    hub = learn['hub']
    cards = ''.join('<a class="featcard" href="%s.html" style="text-decoration:none;color:inherit"><span>%02d</span><p><b>%s</b><br>%s</p></a>' % (
        a['slug'], i, _esc(fill(a['h1'])), _esc(fill(a['description']))) for i, a in enumerate(arts, 1))
    body = '''<nav class="crumbs" aria-label="Breadcrumb"><a href="../">Home</a><span aria-hidden="true">/</span><span aria-current="page">Guides</span></nav>
<div class="pagehead"><div><div class="eyebrow">Guides</div><h1>%s</h1>
<p class="muted">%s</p></div></div>
<section class="featgrid" style="margin-bottom:18px">%s</section>
<p class="muted small">Also read: <a href="../how-we-grade.html">How we grade</a> · <a href="../the-board.html">How many handicappers are up</a> · <a href="../reviews/index.html">Handicapper reviews</a> · <a href="../sportsbooks/">Sportsbook research</a></p>
%s''' % (_esc(hub['h1']), _esc(fill(hub['dek'])), cards, ld({
        '@context': 'https://schema.org', '@type': 'CollectionPage', 'name': 'Handicapper Watchdog guides', 'url': base,
        'hasPart': [{'@type': 'Article', 'headline': fill(a['h1']), 'url': base + a['slug'] + '.html'} for a in arts]}))
    html = _document(1, 'learn/', hub['title'], fill(hub['description']), base, body)
    with open(os.path.join(folder, 'index.html'), 'w', encoding='utf-8', newline='\n') as f:
        f.write(html)


def _write_editorial(site):
    """Reviews and the JustBet page. Facts come from content/*.json. No score without evidence. No affiliate URL."""
    import pathlib
    root = pathlib.Path(HERE) / 'content'
    reviews_path = root / 'reviews.json'
    book_path = root / 'justbet.json'
    if not reviews_path.is_file() or not book_path.is_file():
        return
    reviews = json.loads(reviews_path.read_text(encoding='utf-8'))
    book = json.loads(book_path.read_text(encoding='utf-8'))
    out_reviews = os.path.join(site, 'reviews')
    out_books = os.path.join(site, 'sportsbooks')
    os.makedirs(out_reviews, exist_ok=True)
    os.makedirs(out_books, exist_ok=True)

    def paras(items):
        return ''.join('<p>%s</p>' % _esc(x) for x in items)

    def sources(rows):
        lis = []
        for row in rows:
            lis.append('<li><a href="%s" rel="noopener noreferrer">%s</a></li>' % (_esc(row['url']), _esc(row['title'])))
        return '<ul class="src">%s</ul>' % ''.join(lis)

    names = {r['slug']: r['name'] for r in reviews['reviews']}
    marks = _marks(names.values())

    by_slug = {r['slug']: r for r in reviews['reviews']}

    def related(rev):
        bits = []
        for slug in rev.get('related') or []:
            if slug not in names:
                raise SystemExit('review %s links an unknown slug %s' % (rev['slug'], slug))
            label = by_slug[slug].get('verdict') or 'Not rated'
            bits.append((slug, _esc(label), _esc(names[slug])))
        if not bits:
            return ''
        return '<section class="edsec"><h2>Related reviews</h2><div class="relrow">%s</div></section>' % ''.join(
            '<a class="rel" href="%s.html"><span>%s</span><b>%s</b></a>' % pair for pair in bits)

    missing = '''<section class="edsec miss"><h2>What is still missing</h2>
<ul><li>No Watchdog graded record is attached, so the verified record points stay empty.</li>
<li>Figures in the advertise section are quotes from the pages named below.</li>
<li>A price is included only when a page opened on the check date showed it. A reseller price is labeled as one.</li>
<li>There is no independent sample of buyers, so this page stays Not rated.</li></ul></section>'''

    cards = []
    written = []
    for rev in reviews['reviews']:
        if rev.get('rating') is not None:
            raise SystemExit('review %s has a score; this edition does not rate without a full evidence file' % rev['slug'])
        canonical = 'https://handicapperwatchdog.com/reviews/%s.html' % rev['slug']
        ld = {
            '@context': 'https://schema.org',
            '@graph': [
                {'@type': 'BreadcrumbList', 'itemListElement': [
                    {'@type': 'ListItem', 'position': 1, 'name': 'Home', 'item': 'https://handicapperwatchdog.com/'},
                    {'@type': 'ListItem', 'position': 2, 'name': 'Reviews', 'item': 'https://handicapperwatchdog.com/reviews/index.html'},
                    {'@type': 'ListItem', 'position': 3, 'name': rev['name'], 'item': canonical},
                ]},
                {'@type': 'Article', 'headline': rev['title'], 'description': rev['description'],
                 'dateModified': rev.get('checked_iso') or reviews.get('checked_iso') or '',
                 'author': {'@type': 'Organization', 'name': 'Handicapper Watchdog'},
                 'publisher': {'@type': 'Organization', 'name': 'Handicapper Watchdog'},
                 'mainEntityOfPage': canonical},
            ],
        }
        verdict = rev.get('verdict') or 'Not rated'
        badge_class = 'scam' if verdict == 'Scam' else 'unrated'
        cards.append(
            '<a class="rev" data-name="%s" href="%s.html">'
            '<span class="badge %s">%s</span><span class="muted small">%s</span><b>%s</b>'
            '<span class="dekline">%s</span></a>' % (
                _esc(rev['name'].lower()), rev['slug'], badge_class, _esc(verdict),
                _esc(rev['kind']), _esc(rev['name']), _esc(rev['dek'])))
        if verdict == 'Scam':
            plate = (
                '<aside class="plate scam"><div class="seal" aria-hidden="true"><b>!</b><span>Scam</span></div>'
                '<p class="plate-k">Watchdog verdict</p><p class="plate-v">Scam</p>'
                '<p class="muted small">Checked %s. A verdict on this directory. Not a star rating.</p></aside>'
            ) % _esc(rev.get('checked') or reviews['checked'])
            note = rev.get('disclosure') or reviews['unrated_note']
            tail = (
                '<section class="panel edcard essay" id="corrections"><h2>Corrections</h2><div class="prose">'
                '<p>Three kinds of sentence appear on this page. A documented sentence is what a CapperTek page says, and the page is named. An observed sentence is a count or a label from a page that opened, such as the default leaderboard span. An allegation is another person\'s post. An allegation is not a finding, and a dollar figure or an owner story from those posts is not repeated as fact.</p>'
                '<p>The word scam is Watchdog\'s reading of the documented pages. It is not a statement that a named person committed a crime, and it is not a finding about one seller in the directory.</p>'
                '<p>If a number, a date, or a description of a CapperTek page is wrong, send the correction through the <a href="../contact.html">contact page</a> and point at the CapperTek page that shows otherwise. The article should change when the page it describes has changed.</p>'
                '</div></section>'
            )
            good_h, bad_h = 'What their pages admit', 'Why it is a scam'
        else:
            plate = (
                '<aside class="plate"><div class="seal" aria-hidden="true"><b>NR</b><span>Not rated</span></div>'
                '<p class="plate-k">Watchdog status</p><p class="plate-v">Not rated</p>'
                '<p class="muted small">Checked %s. The four items below are why this page has no number.</p>'
                '<ul class="checks"><li><span>Graded record</span><b>Not in the file</b></li>'
                '<li><span>Advertised record</span><b>Quoted below</b></li>'
                '<li><span>Opened price</span><b>Pricing section</b></li>'
                '<li><span>Buyer sample</span><b>Not in the file</b></li></ul></aside>'
            ) % _esc(reviews['checked'])
            note = reviews['unrated_note']
            tail = missing
            good_h, bad_h = 'Strengths', 'Weaknesses'
        if verdict == 'Scam':
            answer = (
                '<section class="panel edcard essay answer" id="short-answer"><h2>Is CapperTek a scam?</h2>'
                '<div class="prose"><p>Yes. CapperTek is a scam. This review is of the directory, not of one seller in it. '
                'The green check at the top is a paid advertisement. CapperTek says a public pick is revealed 30 minutes after the event starts, '
                'and the board a new reader sees is the last 30 days. Checked 28 Oct 2026. Watchdog did not buy a pass.</p></div></section>'
            )
        else:
            answer = ''
        bridge = (
            '<section class="panel edcard"><h2>Where this sits</h2><div class="prose">'
            '<p>A named service review is not a Watchdog grade. A pick counts here only when it was posted in public before the start, '
            'and the free board opens at 100 graded picks. <a href="../how-we-grade.html">How a record is graded</a>.</p>'
            '<p><a href="index.html">All handicapper reviews</a> · <a href="how-we-rate.html">How a rating would be built</a> · '
            '<a href="../cappers.html">Established rankings</a> · <a href="../the-board.html">How many are up</a> · '
            '<a href="../sportsbooks/">Sportsbook research</a></p></div></section>'
        )
        essay = ''.join(
            '<section class="panel edcard essay"><h2>%s</h2><div class="prose">%s</div></section>' % (
                _esc(sec['h']), paras(sec['p']))
            for sec in (rev.get('sections') or []))
        body = '''<nav class="crumbs" aria-label="Breadcrumb"><a href="../">Home</a><span aria-hidden="true">/</span><a href="index.html">Reviews</a><span aria-hidden="true">/</span><span aria-current="page">%s</span></nav>
<header class="edhero">
<div>
<div class="eyebrow">%s</div>
<h1>%s</h1>
<p class="lede">%s</p>
</div>
%s
</header>
<div class="disclosure"><b>How to read this page</b><p class="muted">%s</p></div>
<div class="edstack">
%s
%s
<section class="panel edcard"><h2>What they advertise</h2><div class="prose">%s</div></section>
<section class="panel edcard"><h2>What Watchdog has graded</h2><div class="prose"><p>%s</p></div></section>
<section class="panel edcard"><h2>Pricing</h2><div class="prose">%s</div></section>
<section class="panel edcard"><h2>Transparency</h2><div class="prose"><p>%s</p></div></section>
<section class="panel edcard"><h2>Customer experience</h2><div class="prose"><p>%s</p></div></section>
<div class="split">
<section class="panel edsec good"><h2>%s</h2><div class="prose">%s</div></section>
<section class="panel edsec bad"><h2>%s</h2><div class="prose">%s</div></section>
</div>
%s
%s
%s
</div>
<section class="panel srcpanel"><div class="pb prose"><h2>Sources checked %s</h2>%s
<p class="muted small">A 100 point score is not shown. The rubric is on the <a href="how-we-rate.html">ratings page</a>. Past results are not predictions. 21+.</p>
</div></section>
<script type="application/ld+json">%s</script>''' % (
            _esc(rev['name']), _esc(rev['kind']), _esc(rev.get('h1') or rev['name']), _esc(rev['dek']),
            plate, note, answer, essay,
            paras(rev['advertised']), _esc(rev['watchdog']), paras(rev['pricing']),
            _esc(rev['transparency']), _esc(rev['customers']),
            good_h, paras(rev['strengths']), bad_h, paras(rev['weaknesses']),
            related(rev), tail, bridge,
            _esc(reviews['checked']), sources(rev['sources']),
            json.dumps(ld, ensure_ascii=True).replace('<', '\\u003c'))
        html = _document(1, 'reviews/index.html', rev['title'], rev['description'],
                         'https://handicapperwatchdog.com/reviews/%s.html' % rev['slug'], body)
        written.append(html)
        with open(os.path.join(out_reviews, rev['slug'] + '.html'), 'w', encoding='utf-8', newline='\n') as f:
            f.write(html)

    rubric_rows = ''.join(
        '<tr><td class="l">%s</td><td>%d</td><td class="l">%s</td></tr>' % (_esc(r['label']), r['max'], _esc(r['needs']))
        for r in reviews['rubric'])
    rate_body = '''<nav class="crumbs" aria-label="Breadcrumb"><a href="../">Home</a><span aria-hidden="true">/</span><a href="index.html">Reviews</a><span aria-hidden="true">/</span><span aria-current="page">How we rate</span></nav>
<div class="pagehead"><div><div class="eyebrow">Ratings</div><h1>The 100 point Watchdog rating</h1>
<p class="muted">%s</p></div></div>
<section class="panel" style="margin-bottom:18px"><div class="tw"><table class="mini"><thead><tr><th class="l">Part</th><th>Points</th><th class="l">What has to be in the file first</th></tr></thead><tbody>%s</tbody></table></div></section>
<section class="panel" style="margin-bottom:28px"><div class="pb prose"><p>%s</p><p>Sportsbook pages are not given this score. A book is not a handicapper. The sportsbook file has its own method, and a commercial relationship cannot buy a rating. <a href="../sportsbooks/how-we-score/">How a sportsbook score would be built</a>. Records on the free board are graded separately. <a href="../how-we-grade.html">How a record is graded</a>. <a href="../cappers.html">Established rankings</a>.</p></div></section>''' % (
        _esc(reviews['unrated_note']), rubric_rows, _esc(reviews['independence']))
    rate_html = _document(1, 'reviews/how-we-rate.html',
                          'How Handicapper Watchdog Rates a Service',
                          'The 100 point Watchdog rating, and why a review stays unrated until the evidence file is complete.',
                          'https://handicapperwatchdog.com/reviews/how-we-rate.html', rate_body)
    written.append(rate_html)
    with open(os.path.join(out_reviews, 'how-we-rate.html'), 'w', encoding='utf-8', newline='\n') as f:
        f.write(rate_html)

    index_body = '''<nav class="crumbs" aria-label="Breadcrumb"><a href="../">Home</a><span aria-hidden="true">/</span><span aria-current="page">Reviews</span></nav>
<header class="edhero">
<div>
<div class="eyebrow">Investigations</div>
<h1>Handicapper reviews</h1>
<p class="lede">%s</p>
</div>
<aside class="plate">
<div class="seal" aria-hidden="true"><b>NR</b><span>Not rated</span></div>
<p class="plate-k">This edition</p>
<p class="plate-v">No scores</p>
<p class="muted small">Checked %s. <a href="how-we-rate.html">How the 100 point rating works</a>.</p>
</aside>
</header>
<div class="disclosure"><b>No score on this edition</b><p class="muted">%s</p></div>
<div class="fld revsearch"><label for="revq">Search reviews</label><input id="revq" placeholder="Search a name or a site" aria-label="Search reviews"></div>
<div class="revgrid" id="revgrid">%s</div>
<p class="muted small revfoot">Ten public names. The free rankings stay anonymous. <a href="../how-we-grade.html">How a record is graded</a> · <a href="../cappers.html">Established rankings</a> · <a href="../the-board.html">The board</a> · <a href="../sportsbooks/">Sportsbook research</a>.</p>
<script>
document.getElementById('revq').addEventListener('input', function () {
  var q = this.value.trim().toLowerCase();
  document.querySelectorAll('#revgrid .rev').forEach(function (el) {
    el.style.display = !q || el.getAttribute('data-name').indexOf(q) >= 0 || el.textContent.toLowerCase().indexOf(q) >= 0 ? '' : 'none';
  });
});
</script>''' % (_esc(reviews['intro']), _esc(reviews['checked']), _esc(reviews['unrated_note']), ''.join(cards))
    index_html = _document(1, 'reviews/index.html',
                           'Handicapper Reviews and Investigations | Handicapper Watchdog',
                           reviews['description'],
                           'https://handicapperwatchdog.com/reviews/index.html', index_body)
    written.append(index_html)
    with open(os.path.join(out_reviews, 'index.html'), 'w', encoding='utf-8', newline='\n') as f:
        f.write(index_html)

    offer_rows = ''.join(
        '<tr><td class="l">%s</td><td class="l">%s</td><td class="l">%s</td></tr>' % (
            _esc(o['name']), _esc(o['terms']), _esc(o['status']))
        for o in book['offers'])
    feature_rows = ''.join(
        '<article class="featcard"><span>%02d</span><p>%s</p></article>' % (i, _esc(x))
        for i, x in enumerate(book['features'], 1))
    ready = book.get('affiliate_url') or ''
    if book.get('affiliate_enabled'):
        if ready != 'https://www.justbet.co/?aff=BETLEGEND':
            raise SystemExit('refusing an unapproved JustBet URL')
        cta = ('<a class="btn lg pro" href="%s" target="_blank" rel="sponsored nofollow noopener">Join JustBet</a>'
               % ready)
        cta_note = ('This button uses the confirmed JustBet affiliate link. 21+. '
                    'It does not check your age or your location. The quotations below are not a bonus from this site.')
    else:
        cta = '<span class="btn disabled lg" aria-disabled="true">Registration link not enabled</span>'
        cta_note = ('This page does not publish a registration link. JustBet\'s own site still has a new account form, '
                    'checked 28 Oct 2026. Nothing here tracks a click. The quotations below are not a bonus from this site.')
    book_body = '''<nav class="crumbs" aria-label="Breadcrumb"><a href="../">Home</a><span aria-hidden="true">/</span><span aria-current="page">JustBet</span></nav>
<header class="bookhero">
<div class="bookintro">
<p class="eyebrow">Sportsbook review</p>
<h1>JustBet</h1>
<p class="lede">%s</p>
<div class="trustrow"><span>Offers checked 27 Oct 2026</span><span>Signup path checked 28 Oct 2026</span><span>21+</span><span>No signup link</span></div>
<div class="ctaslot">
%s
<p>%s</p>
</div>
</div>
</header>
<div class="disclosure"><b>Affiliate disclosure</b><p class="muted">%s</p></div>
<section class="edsec"><h2>Overview</h2><div class="prose">%s</div></section>
<section class="edsec"><h2>What JustBet publishes</h2><div class="featgrid">%s</div></section>
<section class="edsec"><h2>Quotations from JustBet on 27 Oct 2026</h2>
<p class="lede tight">None of these is an offer from Handicapper Watchdog. None is confirmed still available.</p>
<div class="tw"><table class="mini offers"><thead><tr><th class="l">Offer</th><th class="l">Terms we could read</th><th class="l">Status</th></tr></thead><tbody>%s</tbody></table></div>
</section>
<div class="split">
<section class="panel edsec good"><h2>Pros</h2><div class="prose">%s</div></section>
<section class="panel edsec bad"><h2>Cons</h2><div class="prose">%s</div></section>
</div>
<section class="panel edsec"><h2>Jurisdictions</h2><div class="prose"><p>%s</p></div></section>
<section class="edsec"><h2>Questions</h2><div class="faqs">%s</div></section>
<section class="panel care"><h2>Responsible gambling</h2><p>%s</p></section>
<section class="ctaband">
<div>
<p class="eyebrow">Account link</p>
<h2>No registration link on this page</h2>
<p>%s</p>
</div>
%s
</section>
<section class="panel srcpanel"><div class="pb prose"><h2>Sources</h2>%s
<p><a href="index.html">Sportsbook research</a> is the wider section. This page does not link a signup. JustBet's own new account form was still up on 28 Oct 2026.</p>
<p class="muted small">This page is not a handicapper rating and it is not legal advice. 21+. Gambling problem? Call 1 800 GAMBLER.</p></div></section>''' % (
        _esc(book['dek']), cta, _esc(cta_note), _esc(book['disclosure']), paras(book['overview']), feature_rows, offer_rows,
        paras(book['pros']), paras(book['cons']), _esc(book['jurisdictions']),
        ''.join('<details class="faq"><summary>%s</summary><p>%s</p></details>' % (_esc(q['q']), _esc(q['a'])) for q in book['faq']),
        _esc(book['responsible']), _esc(cta_note), cta, sources(book['sources']))
    book_html = _document(1, 'sportsbooks/', book['title'], book['description'],
                          'https://handicapperwatchdog.com/sportsbooks/justbet.html', book_body)
    written.append(book_html)
    with open(os.path.join(out_books, 'justbet.html'), 'w', encoding='utf-8', newline='\n') as f:
        f.write(book_html)
    _write_sportsbook_pages(site, written)
    blob = ''.join(written)
    justbet_join = 'https://www.justbet.co/?aff=BETLEGEND'
    if book.get('affiliate_enabled'):
        cleaned = blob.replace(justbet_join, '')
        if blob.count(justbet_join) != 2:
            raise SystemExit('JustBet join link must be the two approved buttons')
    else:
        cleaned = blob
        if justbet_join in blob:
            raise SystemExit('JustBet join link was written while the button is off')
    if 'aff=' in cleaned or 'BETLEGEND' in cleaned or 'revshare.ag' in cleaned or 'affiliates.justbet' in cleaned.lower():
        raise SystemExit('affiliate tracking URL leaked into the editorial pages')
    if 'aggregateRating' in blob or 'ratingValue' in blob:
        raise SystemExit('a review page carried a numeric rating')


def _write_sportsbook_pages(site, written):
    """Sportsbook research pages. Facts come from content/sportsbooks.json. No numeric score."""
    import pathlib
    path = pathlib.Path(HERE) / 'content' / 'sportsbooks.json'
    if not path.is_file():
        return
    doc = json.loads(path.read_text(encoding='utf-8'))
    out = os.path.join(site, 'sportsbooks')
    os.makedirs(out, exist_ok=True)
    books = doc['books']
    by_slug = {b['slug']: b for b in books}
    checked = doc['checked']

    def paras(items):
        return ''.join('<p>%s</p>' % _esc(x) for x in items or [])

    def source_list(rows):
        return '<ul class="src">%s</ul>' % ''.join(
            '<li><a href="%s" rel="noopener noreferrer">%s</a></li>' % (_esc(r['url']), _esc(r['title']))
            for r in rows)

    def schema(title, description, canonical, crumb):
        data = {
            '@context': 'https://schema.org',
            '@graph': [
                {'@type': 'BreadcrumbList', 'itemListElement': [
                    {'@type': 'ListItem', 'position': 1, 'name': 'Home', 'item': 'https://handicapperwatchdog.com/'},
                    {'@type': 'ListItem', 'position': 2, 'name': 'Sportsbooks', 'item': 'https://handicapperwatchdog.com/sportsbooks/'},
                    {'@type': 'ListItem', 'position': 3, 'name': crumb, 'item': canonical},
                ]},
                {'@type': 'Article', 'headline': title, 'description': description,
                 'dateModified': doc.get('checked_iso') or '',
                 'author': {'@type': 'Organization', 'name': 'Handicapper Watchdog'},
                 'publisher': {'@type': 'Organization', 'name': 'Handicapper Watchdog'},
                 'mainEntityOfPage': canonical},
            ],
        }
        return '<script type="application/ld+json">%s</script>' % json.dumps(data, ensure_ascii=True).replace('<', '\\u003c')

    def save(folder, title, description, body):
        """folder is empty for /sportsbooks/, or a slug for /sportsbooks/<slug>/index.html."""
        if folder:
            canonical = 'https://handicapperwatchdog.com/sportsbooks/%s/' % folder
            dest_dir = os.path.join(out, folder)
            os.makedirs(dest_dir, exist_ok=True)
            dest = os.path.join(dest_dir, 'index.html')
            depth = 2
        else:
            canonical = 'https://handicapperwatchdog.com/sportsbooks/'
            dest = os.path.join(out, 'index.html')
            depth = 1
        html = _document(depth, 'sportsbooks/', title, description, canonical, body)
        written.append(html)
        with open(dest, 'w', encoding='utf-8', newline='\n') as f:
            f.write(html)

    weight_rows = ''.join(
        '<tr><td class="l">%s</td><td>%d%%</td><td class="l">%s</td></tr>' % (_esc(w['label']), w['weight'], _esc(w['needs']))
        for w in doc['weights'])
    for book in books:
        if book['kind'] == 'review' and sum(w['weight'] for w in doc['weights']) != 100:
            raise SystemExit('sportsbook weights must add to 100')
        sections = ''.join(
            '<section class="edsec"><h2>%s</h2><div class="prose">%s</div></section>' % (_esc(sec['title']), paras(sec['body']))
            for sec in book['sections'])
        split = ''
        if book.get('pros') or book.get('cons'):
            split = (
                '<div class="split"><section class="panel edsec good"><h2>What the record supports</h2><div class="prose">%s</div></section>'
                '<section class="panel edsec bad"><h2>What it does not</h2><div class="prose">%s</div></section></div>'
            ) % (paras(book.get('pros')), paras(book.get('cons')))
        rels = []
        for slug in book.get('related') or []:
            other = by_slug.get(slug)
            if not other:
                raise SystemExit('sportsbook %s links an unknown slug %s' % (book['slug'], slug))
            label = 'Status' if other['kind'] == 'status' else 'Not scored'
            rels.append('<a class="rel" href="../%s/"><span>%s</span><b>%s</b></a>' % (slug, label, _esc(other['name'])))
        related = '<section class="edsec"><h2>Related</h2><div class="relrow">%s</div></section>' % ''.join(rels) if rels else ''
        plate = 'Not scored' if book['kind'] == 'review' else 'Not a live book'
        canonical = 'https://handicapperwatchdog.com/sportsbooks/%s/' % book['slug']
        body = (
            '<nav class="crumbs" aria-label="Breadcrumb"><a href="../../">Home</a><span aria-hidden="true">/</span>'
            '<a href="../">Sportsbooks</a><span aria-hidden="true">/</span><span aria-current="page">%s</span></nav>'
            '<header class="edhero"><div><div class="eyebrow">%s</div><h1>%s</h1><p class="lede">%s</p>'
            '<div class="trustrow"><span>Checked %s</span><span>21+</span><span>No signup link</span><span>Documented research</span></div></div>'
            '<aside class="plate">%s<p class="plate-k">Editorial score</p><p class="plate-v">%s</p>'
            '<p class="muted small">%s <a href="../how-we-score/">How a score would be built</a>.</p></aside></header>'
            '<div class="disclosure"><b>Independent research</b><p class="muted">No operator paid for this page. There is no referral link. '
            'The reading is from the sources at the bottom, checked %s. It is not a hands-on test, and a bet is not a plan to make money.</p></div>'
            '%s%s'
            '<section class="panel srcpanel"><div class="pb prose"><h2>Sources checked %s</h2>%s'
            '<p class="muted small">Operator names belong to the operators. Watchdog did not copy logo artwork. '
            '<a href="../">All sportsbook research</a> · <a href="../comparison/">Compare</a> · <a href="../how-we-score/">Scoring method</a> · '
            '<a href="../justbet.html">JustBet</a> · <a href="../../reviews/index.html">Handicapper reviews</a> · '
            '<a href="../../how-we-grade.html">How records are graded</a>. 21+. Gambling problem? Call 1 800 GAMBLER.</p></div></section>%s%s'
        ) % (
            _esc(book['name']),
            'Status' if book['kind'] == 'status' else 'Sportsbook research',
            _esc(book['name']), _esc(book['dek']), _esc(checked), _mark(book['mark']), plate, _esc(book['status']),
            _esc(checked), split, sections, _esc(checked), source_list(book['sources']), related,
            schema(book['title'], book['description'], canonical, book['name']))
        save(book['slug'], book['title'], book['description'], body)

    method = (
        '<nav class="crumbs" aria-label="Breadcrumb"><a href="../../">Home</a><span aria-hidden="true">/</span>'
        '<a href="../">Sportsbooks</a><span aria-hidden="true">/</span><span aria-current="page">How we score</span></nav>'
        '<div class="pagehead"><div><div class="eyebrow">Method</div><h1>How a sportsbook score would be built</h1>'
        '<p class="muted">The weights below are the proposed split. They are not scores. A category stays Not scored until the file contains the evidence in the last column. Checked %s.</p></div></div>'
        '<section class="panel" style="margin-bottom:18px"><div class="tw"><table class="cmp"><thead><tr><th class="l">Category</th><th>Weight</th><th class="l">Evidence required before any number</th></tr></thead><tbody>%s</tbody></table></div></section>'
        '<section class="panel" style="margin-bottom:18px"><div class="pb prose">'
        '<p>Odds and pricing are a quarter of the weight, and that category was not measured for any book in this edition. Mobile usability and support speed were not measured either. An overall number would hide those blanks, so no overall number is published.</p>'
        '<p>A documented fact is not converted into points. A license mentioned by the operator, a state on the operator\'s own list, or a help-center article about limits can be reported as a finding. It does not become an 8 out of 10.</p>'
        '<p>Hands-on testing is labeled as hands-on testing. This edition has none. If a page says the reading is documented research, that is the whole test.</p>'
        '<p>No operator pays for a higher score. A later sponsorship would be labeled on the page and would not move these weights. There is no referral link in this edition. Promotions are quoted only when the operator\'s own terms were read on the check date, and they are the operator\'s offer, not Watchdog\'s.</p>'
        '<p>This is separate from the <a href="../../reviews/how-we-rate.html">handicapper rating</a>, and from <a href="../../how-we-grade.html">how a handicapper record is graded</a>. A book is not a handicapper. The handicapper pages stay unrated for their own reasons.</p>'
        '<p><a href="../">Sportsbook research</a> · <a href="../comparison/">Compare the books</a> · <a href="../../reviews/index.html">Handicapper reviews</a> · <a href="../../cappers.html">Rankings</a></p>'
        '</div></section>'
    ) % (_esc(checked), weight_rows)
    save('how-we-score',
         'How Handicapper Watchdog Scores a Sportsbook',
         'The proposed sportsbook weights, and why this edition publishes findings instead of an overall number.',
         method)

    reviews = [b for b in books if b['kind'] == 'review']
    head = '<tr><th class="l">Factor</th>' + ''.join('<th>%s</th>' % _esc(b['name']) for b in reviews) + '</tr>'
    body_rows = []
    for key in doc['compare_keys']:
        cells = ''.join('<td>%s</td>' % _esc((b.get('compare') or {}).get(key) or 'Not documented') for b in reviews)
        body_rows.append('<tr><th class="l">%s</th>%s</tr>' % (_esc(key), cells))
    picks = ''.join(
        '<label><input type="checkbox" checked data-col="%d"> %s</label>' % (i, _esc(b['name']))
        for i, b in enumerate(reviews, 1))
    compare = (
        '<nav class="crumbs" aria-label="Breadcrumb"><a href="../../">Home</a><span aria-hidden="true">/</span>'
        '<a href="../">Sportsbooks</a><span aria-hidden="true">/</span><span aria-current="page">Compare</span></nav>'
        '<div class="pagehead"><div><div class="eyebrow">Comparison</div><h1>Side by side, from the same check</h1>'
        '<p class="muted">Every cell is a finding from the operator pages cited on the review. Last checked %s. Uncheck a book to hide its column. The full table is in the page either way.</p></div></div>'
        '<div class="cmpicks" id="cmpicks">%s</div>'
        '<section class="panel"><div class="tw"><table class="cmp" id="cmptable"><thead>%s</thead><tbody>%s</tbody></table></div></section>'
        '<p class="muted small" style="margin:14px 0 28px">No overall score is shown because the weighted categories that need a measurement are still Not scored. '
        '<a href="../how-we-score/">The method</a> · <a href="../">Directory</a>. 21+. Gambling problem? Call 1 800 GAMBLER.</p>'
        '<script>'
        'document.querySelectorAll("#cmpicks input").forEach(function (box) {'
        '  box.addEventListener("change", function () {'
        '    var col = box.getAttribute("data-col");'
        '    document.querySelectorAll("#cmptable tr").forEach(function (row) {'
        '      var cell = row.children[Number(col)];'
        '      if (cell) cell.hidden = !box.checked;'
        '    });'
        '  });'
        '});'
        '</script>'
    ) % (_esc(checked), picks, head, ''.join(body_rows))
    save('comparison',
         'Sportsbook Comparison | Handicapper Watchdog',
         'Compare DraftKings, FanDuel, bet365, Fanatics, and BetMGM on the facts Watchdog could verify. Last checked 27 Oct 2026. No numeric scores.',
         compare)

    cards = []
    for book in books:
        states = '|'.join(book.get('states') or [])
        promo = '1' if 'promo' in (book.get('filters') or []) else '0'
        partial = '0' if book.get('states_complete') else '1'
        kind = book['kind']
        cards.append(
            '<a class="sbcard panel" href="%s/" data-kind="%s" data-partial="%s" data-promo="%s" data-states="%s" data-name="%s">'
            '%s<div><b>%s</b><span class="muted small">%s</span><p>%s</p></div></a>' % (
                book['slug'], kind, partial, promo, _esc(states), _esc(book['name'].lower()),
                _mark(book['mark']), _esc(book['name']), _esc(book['status']), _esc(book['dek'])))
    state_names = []
    seen = set()
    for book in books:
        for name in book.get('states') or []:
            if name not in seen:
                seen.add(name)
                state_names.append(name)
    options = ''.join('<option>%s</option>' % _esc(n) for n in sorted(state_names))
    withheld = ''.join('<li><b>%s.</b> %s</li>' % (_esc(w['name']), _esc(w['reason'])) for w in doc['withheld'])
    index = (
        '<nav class="crumbs" aria-label="Breadcrumb"><a href="../">Home</a><span aria-hidden="true">/</span>'
        '<span aria-current="page">Sportsbooks</span></nav>'
        '<header class="edhero"><div><div class="eyebrow">Sportsbook research</div><h1>What the books actually publish</h1>'
        '<p class="lede">%s</p>'
        '<div class="trustrow"><span>Checked %s</span><span>No scores</span><span>No signup links</span><span>21+</span></div></div>'
        '<aside class="plate">%s<p class="plate-k">This edition</p><p class="plate-v">Not scored</p>'
        '<p class="muted small"><a href="how-we-score/">Why there is no overall number</a></p></aside></header>'
        '<div class="disclosure"><b>Editorial, not an ad</b><p class="muted">These pages are research. They are not placements. A later paid placement would be labeled, and it would not change a score. There are no scores to change. '
        'JustBet remains a separate page, and its registration button is still off.</p></div>'
        '<div class="sbfilters" role="group" aria-label="Filter sportsbooks">'
        '<button type="button" class="on" data-filter="all">All</button>'
        '<button type="button" data-filter="mapped">Operator list read</button>'
        '<button type="button" data-filter="partial">List incomplete</button>'
        '<button type="button" data-filter="promo">Promotion quoted</button>'
        '<button type="button" data-filter="status">Status notes</button>'
        '</div>'
        '<div class="fld" style="max-width:320px;margin:0 0 14px"><label for="sbstate">State on a verified list</label>'
        '<select id="sbstate"><option value="">Any state</option>%s</select>'
        '<p class="muted small" id="sbstatehelp">A partial list stays on screen. Missing from that list is not a finding that the book is absent.</p></div>'
        '<div class="sbgrid" id="sbgrid">%s</div>'
        '<section class="panel" style="margin-bottom:18px"><div class="pb prose"><h2>Checked, and not given a review</h2><ul>%s</ul>'
        '<p><a href="comparison/">Compare the five reviews</a> · <a href="how-we-score/">Scoring method</a> · <a href="justbet.html">JustBet</a> · <a href="../reviews/index.html">Handicapper reviews</a> · <a href="../how-we-grade.html">How handicapper records are graded</a> · <a href="../cappers.html">Rankings</a></p>'
        '</div></section>'
        '<script>'
        '(function () {'
        '  var filter = "all";'
        '  var state = "";'
        '  function apply() {'
        '    document.querySelectorAll("#sbgrid .sbcard").forEach(function (card) {'
        '      var kind = card.getAttribute("data-kind");'
        '      var partial = card.getAttribute("data-partial") === "1";'
        '      var promo = card.getAttribute("data-promo") === "1";'
        '      var states = (card.getAttribute("data-states") || "").split("|");'
        '      var ok = filter === "all"'
        '        || (filter === "mapped" && kind === "review" && !partial)'
        '        || (filter === "partial" && partial && kind === "review")'
        '        || (filter === "promo" && promo)'
        '        || (filter === "status" && kind === "status");'
        '      if (state && kind === "review" && !partial && states.indexOf(state) < 0) ok = false;'
        '      card.hidden = !ok;'
        '    });'
        '  }'
        '  document.querySelectorAll(".sbfilters button").forEach(function (btn) {'
        '    btn.addEventListener("click", function () {'
        '      filter = btn.getAttribute("data-filter");'
        '      document.querySelectorAll(".sbfilters button").forEach(function (b) { b.classList.toggle("on", b === btn); b.setAttribute("aria-pressed", b === btn ? "true" : "false"); });'
        '      apply();'
        '    });'
        '  });'
        '  document.getElementById("sbstate").addEventListener("change", function () { state = this.value; apply(); });'
        '})();'
        '</script>'
    ) % (_esc(doc['intro']), _esc(checked), _mark('SB'), options, ''.join(cards), withheld)
    save('',
         'Sportsbook Research and Comparison | Handicapper Watchdog',
         'Original sportsbook research for DraftKings, FanDuel, bet365, Fanatics, and BetMGM. Findings only where a source was checked. No numeric scores and no signup links.',
         index)


def _write_legal(site):
    """About, privacy, terms, and contact. Indexable. Profiles stay noindex."""
    robots = ''
    pages = (
        ('about.html',
         'About Handicapper Watchdog',
         'Handicapper Watchdog grades public picks. It does not sell picks, and it does not sell a verified badge.',
         '''<nav class="crumbs" aria-label="Breadcrumb"><a href="./">Home</a><span aria-hidden="true">/</span><span aria-current="page">About</span></nav>
<div class="pagehead"><div><div class="eyebrow">About</div><h1>A record site, not a tout directory</h1>
<p class="muted">Handicapper Watchdog grades picks that were posted in public before the game started. A handicapper does not send a record, and a handicapper cannot pay for a rank.</p></div></div>
<section class="panel" style="margin-bottom:18px"><div class="pb prose">
<h2>What this site is</h2>
<p>The free board shows rank, record, units, ROI, win rate, and sample size. The name, the handle, and the posting site stay off that board. Watchdog Pro, at the price on the pricing page, is access to those names and to the pick log. It is not a badge that a record is legitimate, and it is not a placement a seller can buy.</p>
<p>Reviews quote what a service publishes about itself. A numeric score stays off until a full evidence file exists. A text verdict is used only when the service's own pages support it, and the page says which sentences are documented, which were observed, and which are someone else's allegation.</p>
<p>Sportsbook pages are research notes. They are not signup offers. JustBet registration on this site stays off.</p>
<h2>What this site is not</h2>
<p>Handicapper Watchdog is not a sportsbook and does not take bets. It does not sell picks. It does not sell a green check, a featured row, or protection from a bad review. Past results are not predictions. 21+.</p>
<p><a href="how-we-grade.html">How a record is graded</a> · <a href="reviews/index.html">Handicapper reviews</a> · <a href="reviews/cappertek.html">CapperTek review</a> · <a href="cappers.html">Rankings</a> · <a href="pricing.html">Watchdog Pro</a> · <a href="contact.html">Corrections</a></p>
</div></section>'''),
        ('privacy.html',
         'Privacy Policy | Handicapper Watchdog',
         'What Handicapper Watchdog collects on this static site, including the analytics tag, and what it does not collect.',
         '''<nav class="crumbs" aria-label="Breadcrumb"><a href="./">Home</a><span aria-hidden="true">/</span><span aria-current="page">Privacy</span></nav>
<div class="pagehead"><div><div class="eyebrow">Privacy</div><h1>Privacy policy</h1>
<p class="muted">What the public pages collect. Watchdog Pro subscriptions have their own notice.</p></div></div>
<section class="panel" style="margin-bottom:18px"><div class="pb prose">
<p>The public pages are files. Reading them does not need an account, and they do not ask for a name, an email, or a payment card. Watchdog Pro checkout and billing run on Stripe, so card details go to Stripe and not to this site. What a Pro subscription collects, the sign in cookie, and the providers involved are in the <a href="pro-privacy.html">Watchdog Pro privacy notice</a>.</p>
<p>Each page loads Google Analytics with the measurement id G-SC607ZYK1F. Google can receive the usual analytics fields for that tag, including the page address, a rough location, and the device. That tag is how visits are counted. Google's own policy is at <a href="https://policies.google.com/privacy" rel="noopener noreferrer">policies.google.com/privacy</a>.</p>
<p>The public domain registration uses a privacy service. It does not list a personal name. This policy does not publish a home address.</p>
<p>Handicapper Watchdog does not sell personal information. There is no marketing email list.</p>
<p>Questions and corrections go through the <a href="contact.html">contact page</a>. A public inbox is not listed yet.</p>
<p class="muted small">Domain registration checked 28 Oct 2026. 21+.</p>
</div></section>'''),
        ('terms.html',
         'Terms of Use | Handicapper Watchdog',
         'Handicapper Watchdog publishes past results. It is not a sportsbook, not betting advice, and not a guarantee.',
         '''<nav class="crumbs" aria-label="Breadcrumb"><a href="./">Home</a><span aria-hidden="true">/</span><span aria-current="page">Terms</span></nav>
<div class="pagehead"><div><div class="eyebrow">Terms</div><h1>Terms of use</h1>
<p class="muted">Records on this site are past results. They are not a promise about the next game.</p></div></div>
<section class="panel" style="margin-bottom:18px"><div class="pb prose">
<p>You may read the public pages. You may not scrape them in a way that knocks the site over, and you may not present a Watchdog record as your own grade.</p>
<p>Handicapper Watchdog is not a sportsbook, not a pick seller, and not a financial adviser. Nothing on the site is an instruction to bet. Gambling has a cost. 21+. If gambling is a problem, call 1 800 GAMBLER.</p>
<p>Watchdog Pro prices are the prices on the pricing page. Billing, renewal, cancellation and refunds for a subscription are covered by the <a href="pro-terms.html">Watchdog Pro subscription terms</a>.</p>
<p>Reviews are opinions grounded in the sources named on each page. A correction path is on the <a href="contact.html">contact page</a>.</p>
</div></section>'''),
        ('contact.html',
         'Contact and Corrections | Handicapper Watchdog',
         'How to send a correction to Handicapper Watchdog. A public inbox is not listed on this edition.',
         '''<nav class="crumbs" aria-label="Breadcrumb"><a href="./">Home</a><span aria-hidden="true">/</span><span aria-current="page">Contact</span></nav>
<div class="pagehead"><div><div class="eyebrow">Contact</div><h1>Corrections</h1>
<p class="muted">A public email address is not on this edition. One will be added when it is a site address, not a personal mailbox.</p></div></div>
<section class="panel" style="margin-bottom:18px"><div class="pb prose">
<p>If a page states a number, a date, or a description of someone else's site, and that description is wrong, the correction needs three things: the Watchdog page, the sentence, and the source page that shows otherwise.</p>
<p>An allegation from a forum stays labeled as that person's post. A correction can ask for a clearer label. It does not turn the post into a finding, and it does not turn a denial into a finding either, unless a document is attached.</p>
<p>The CapperTek page separates documented sentences, observed sentences, and allegations. That split is the standard for the other reviews as well.</p>
<p>There is no form on this page that sends a message. Publishing an inbox is waiting on an address. Until then, this page is the corrections policy, and the article should not pretend a reader can already reach a desk.</p>
<p><a href="reviews/cappertek.html#corrections">CapperTek corrections</a> · <a href="about.html">About</a> · <a href="privacy.html">Privacy</a></p>
</div></section>'''),
    )
    for name, title, desc, body in pages:
        html = _document(0, name, title, desc, 'https://handicapperwatchdog.com/' + name, body, robots)
        with open(os.path.join(site, name), 'w', encoding='utf-8', newline='\n') as f:
            f.write(html)
    _write_pro_legal(site)


def _write_pro_legal(site):
    """Watchdog Pro subscription terms and privacy notice. Drafts for owner review (docs/LEGAL_REVIEW.md):
    noindex and out of the sitemap until approved. The public terms.html and privacy.html stay indexable."""
    drafts = (
        ('pro-terms.html', 'Subscription terms', 'Watchdog Pro Subscription Terms | Handicapper Watchdog',
         'The terms for a Watchdog Pro subscription: billing, renewal, cancellation, refunds and acceptable use.'),
        ('pro-privacy.html', 'Privacy notice', 'Watchdog Pro Privacy Notice | Handicapper Watchdog',
         'What a Watchdog Pro subscription collects, the sign in cookie, and the providers that run the service.'),
    )
    for name, crumb, title, desc in drafts:
        src = os.path.join(HERE, 'content', name)
        if not os.path.isfile(src):
            continue
        with open(src, encoding='utf-8') as f:
            article = f.read().strip()
        body = ('<nav class="crumbs" aria-label="Breadcrumb"><a href="./">Home</a><span aria-hidden="true">/</span>'
                '<a href="pricing.html">Watchdog Pro</a><span aria-hidden="true">/</span><span aria-current="page">%s</span></nav>\n%s') % (crumb, article)
        html = _document(0, name, title, desc, 'https://handicapperwatchdog.com/' + name, body, 'noindex', scripts=('pro.js',))
        with open(os.path.join(site, name), 'w', encoding='utf-8', newline='\n') as f:
            f.write(html)


def stamp_public_pages(site):
    """Fill the public pages with masked rankings so Google can read them without JavaScript.

    Profile, account, and compare pages stay noindex and out of the sitemap.
    Handles, slugs, and post text are never written.
    """
    with open(os.path.join(site, 'data', 'index.json'), encoding='utf-8') as f:
        doc = json.load(f)
    meta, cappers = doc.get('meta') or {}, doc.get('cappers') or []
    lastmod = str(meta.get('built_at') or '')[:10]
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', lastmod):
        lastmod = datetime.now(timezone.utc).date().isoformat()
    pages = {
        'index.html': {
            'live': _live(meta), 'board': _ranked(cappers, 10), 'sports': _sports(cappers),
            'reality': _reality(meta, cappers), 'pending': _esc(_pending(meta)),
            'jsonld': _itemlist(cappers, 'https://handicapperwatchdog.com/', 'Top established handicappers by units'),
        },
        'cappers.html': {
            'fresh': _fresh(meta), 'rows': _ranked(cappers, 50), 'pending': _esc(_pending(meta)),
            'sportnav': _sport_nav(cappers),
            'jsonld': _itemlist(cappers, 'https://handicapperwatchdog.com/cappers.html', 'Established handicapper rankings'),
        },
    }
    for filename, slots in pages.items():
        path = os.path.join(site, filename)
        if not os.path.isfile(path):
            continue
        with open(path, encoding='utf-8', newline='') as f:
            html = f.read()
        for name, inner in slots.items():
            html = _fill(filename, html, name, inner, _MARKERS[filename])
        with open(path, 'w', encoding='utf-8', newline='') as f:
            f.write(html)
    _write_guides(site, meta, cappers)
    _write_learn(site, meta, cappers)
    _write_sport_pages(site, cappers)
    _write_editorial(site)
    _write_legal(site)
    _write_retired_rating(site)
    _write_sitemap(site, lastmod)


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
                prof['summary'] = {k: v for k, v in s.items() if k not in ('by_sport', 'source', 'handle', 'slug')}
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
    roll = {}
    for s in index:
        if s['picks'] >= 20 and s['units'] is not None and s.get('source'):
            bucket = roll.setdefault(s['source'], [0, 0])
            bucket[0] += 1
            if s['units'] > 0:
                bucket[1] += 1
    by_platform = [{'name': k, 'n': v[0], 'up': v[1]} for k, v in sorted(roll.items(), key=lambda kv: -kv[1][0])]
    index = [public_row(s) for s in index]
    meta = {'built_at': datetime.now(timezone.utc).isoformat(timespec='seconds'),
            'newest_pick': max((s['last_pick'] or '' for s in index), default=None),
            'tracked': len(index), 'graded_picks': sum(s['picks'] for s in index), 'qualified': len(qual),
            'profitable': sum(1 for s in qual if s['units'] > 0), 'min_graded': 100, 'profiles': published,
            'by_platform': by_platform,
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
    stamp_public_pages(SITE)
    # Build health, published for monitoring: a profile only counts once it reconciles with the source record.
    status = {'built_at': meta['built_at'], 'tracked': len(index), 'profiles_published': published,
              'profiles_missing': len(index) - published, 'complete': published == len(index),
              'fetched_this_run': fetched, 'fetch_failures_this_run': failed, 'unreconciled': unreconciled,
              'fetch_cap_per_run': MAX_FETCH, 'live_counters': bool(meta.get('live')), 'newest_pick': meta['newest_pick']}
    with open(os.path.join(SITE, 'data', 'status.json'), 'w', encoding='utf-8') as f:
        json.dump(status, f, indent=1)
    print('tracked %d, fetched %d, failed %d, profiles %d, unreconciled %d' % (len(index), fetched, failed, published, unreconciled))
    if failed > max(25, fetched // 2):
        sys.exit('too many profile fetch failures this run: %d' % failed)


if __name__ == '__main__':
    main()
