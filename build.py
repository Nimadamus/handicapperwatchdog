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
HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, '.cache', 'profiles')
SITE = os.path.join(HERE, '_site')
STATIC = ('index.html', 'capper.html', 'cappers.html', 'style.css', 'app.js', 'capper.js', 'favicon.svg', 'CNAME', 'robots.txt', 'sitemap.xml')
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
        'unpriced': (research.get('overview') or {}).get('unpriced') or 0}
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
    ('privacy.html', 'https://handicapperwatchdog.com/privacy.html', 'yearly', '0.2'),
    ('terms.html', 'https://handicapperwatchdog.com/terms.html', 'yearly', '0.2'),
)
_MARKERS = {
    'index.html': ('live', 'board', 'sports', 'reality', 'pending', 'jsonld'),
    'cappers.html': ('fresh', 'rows', 'pending', 'jsonld'),
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
            blocks.append('<div class="sc"><h4><span>%s</span><a class="muted small" href="sports/%s.html">View all</a></h4><ol>%s</ol></div>' % (
                _esc(sport), _sport_slug(sport), ''.join(items)))
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
    for folder, freq, priority in (('reviews', 'weekly', '0.6'), ('sportsbooks', 'weekly', '0.6')):
        folder_dir = os.path.join(site, folder)
        if not os.path.isdir(folder_dir):
            continue
        for name in sorted(os.listdir(folder_dir)):
            if name.endswith('.html'):
                entries.append((folder + '/' + name, 'https://handicapperwatchdog.com/' + folder + '/' + name, freq, priority))
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
        ('sportsbooks/justbet.html', 'JustBet'),
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
        '<input name="q" placeholder="Search capper ID or sport" aria-label="Search cappers"></form>'
        '<a class="btn sm pro" href="%spricing.html">Watchdog Pro</a>'
        '</div></header>'
    ) % (home, prefix, _nav(depth, current), prefix, prefix)


def _footer(depth):
    prefix = '../' * depth
    links = (
        ('cappers.html', 'Rankings'),
        ('reviews/index.html', 'Reviews'),
        ('sportsbooks/justbet.html', 'JustBet'),
        ('the-board.html', 'The board'),
        ('how-we-grade.html', 'How we grade'),
        ('pricing.html', 'Watchdog Pro'),
    )
    return (
        '<footer class="foot"><div class="wrap"><div>'
        '<p><b>Handicapper Watchdog</b> grades picks captured from public posts on X, Covers, Reddit, TheRX, '
        'Sportsbook Review and Predictem. Records are past results, not predictions or guarantees. '
        'Held, duplicate and unreviewed picks are not counted.</p>'
        '<p>21+. Gambling problem? Call 1 800 GAMBLER.</p></div><div>%s</div></div></footer>'
    ) % ''.join('<p><a href="%s%s">%s</a></p>' % (prefix, href, label) for href, label in links)


def _document(depth, current, title, description, canonical, body):
    prefix = '../' * depth
    crumb = ''
    return '''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>%s</title>
<meta name="description" content="%s">
<link rel="canonical" href="%s">
<meta property="og:title" content="%s">
<meta property="og:description" content="%s">
<meta property="og:type" content="website">
<meta property="og:url" content="%s">
<meta property="og:site_name" content="Handicapper Watchdog">
<meta name="twitter:card" content="summary">
<meta name="theme-color" content="#070d17">
<link rel="icon" href="%sfavicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;650;700;750;800&family=JetBrains+Mono:wght@500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="%sstyle.css">
<script async src="https://www.googletagmanager.com/gtag/js?id=G-SC607ZYK1F"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-SC607ZYK1F');</script>
</head>
<body>
%s
<main class="wrap">
%s
</main>
%s
</body>
</html>
''' % (_esc(title), _esc(description), canonical, _esc(title), _esc(description), canonical,
       prefix, prefix, _header(depth, current), body, _footer(depth))


def _median_roi(cappers, minimum):
    vals = sorted(float(r['roi']) for r in _public(cappers)
                  if int(r.get('picks') or 0) >= minimum and _num(r.get('roi')) is not None)
    if not vals:
        return None
    return vals[len(vals) // 2]


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
<p>Pending picks are not mixed into a record. %s</p>
<p class="muted small">%s handicappers have a graded record. %s picks have been graded. Of the established records, %s of %s are up money.</p>
<p><a href="cappers.html">Established rankings</a> · <a href="the-board.html">The board</a> · <a href="pricing.html">Watchdog Pro</a></p>
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
<p>These are past results, not predictions. Names and posting sites stay off this page.</p>
<p><a class="btn" href="cappers.html">See the established rankings</a></p>
</div></section>
<section class="proband"><div><span class="lock">Watchdog Pro</span><h2>The names behind the records that are up</h2>
<p class="muted" style="margin:0">$59.99 a month, or $499 a year. Pro shows the handicapper, the posting site, and the picks posted before the game.</p></div>
<div class="feats"><div class="feat"><b>Why the name is locked</b><span>Publish the name and the posting site and anyone can follow that person without paying.</span></div>
<div class="feat"><b>What you are paying for</b><span>Who is still winning across the whole board, and which of their picks are up for games that have not started.</span></div></div>
</section>''' % (pending, f'{tracked:,}', f'{graded:,}', est_pct, f'{up:,}', f'{est:,}',
                 qual_pct, f'{prof:,}', f'{qual:,}', med_txt, pending))
    price = _document(0, 'pricing.html',
                      'Watchdog Pro Pricing | Handicapper Watchdog',
                      'Watchdog Pro is $59.99 a month or $499 a year. The name, the posting site, the graded pick log and the picks posted before the game.',
                      'https://handicapperwatchdog.com/pricing.html',
                      '''<nav class="crumbs" aria-label="Breadcrumb"><a href="./">Home</a><span aria-hidden="true">/</span><span aria-current="page">Pricing</span></nav>
<div class="pagehead"><div><div class="eyebrow">Watchdog Pro</div><h1>See who is winning, and what they are betting</h1>
<p class="muted">The free board shows the record. Pro shows the name, the posting site, and the picks posted before the game. Both plans include the same features.</p></div></div>
<section class="plans">
<div class="plan best"><div class="eyebrow">Annual</div><div class="amt"><b>$499</b><span>a year</span></div>
<p>Twelve months at $59.99 is $719.88. Annual is $499, so the year costs $220.88 less. That is $41.58 a month, billed once.</p></div>
<div class="plan"><div class="eyebrow">Monthly</div><div class="amt"><b>$59.99</b><span>a month</span></div>
<p>Same Pro access, billed every month. Cancel and access runs through the month already paid.</p></div>
</section>
<section class="panel" style="margin:0 0 18px"><div class="ph"><h3>Free and Pro</h3></div>
<div class="tw"><table class="mini"><thead><tr><th class="l">Feature</th><th>Free</th><th>Pro</th></tr></thead><tbody>
<tr><td class="l">Rank, record, units, ROI, win rate, streak</td><td>Yes</td><td>Yes</td></tr>
<tr><td class="l">Established board and sport records</td><td>Yes</td><td>Yes</td></tr>
<tr><td class="l">The handicapper's name and posting site</td><td>No</td><td>Yes</td></tr>
<tr><td class="l">Graded pick log and the original post</td><td>No</td><td>Yes</td></tr>
<tr><td class="l">Picks posted for games that have not started</td><td>No</td><td>Yes</td></tr>
<tr><td class="l">Search by handle, and compare up to four</td><td>No</td><td>Yes</td></tr>
</tbody></table></div></section>
<section class="panel" style="margin-bottom:28px"><div class="pb">
<p>%s</p>
<p class="muted small">Prices are in US dollars. Records are past results, not predictions or a guarantee. 21+. Gambling problem? Call 1 800 GAMBLER.</p>
<p><a href="cappers.html">Look at the free board first</a></p>
</div></section>''' % pending)
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
        body = '''<nav class="crumbs" aria-label="Breadcrumb"><a href="../">Home</a><span aria-hidden="true">/</span><span aria-current="page">%s</span></nav>
<div class="pagehead"><div><div class="eyebrow">%s records</div><h1>%s handicapper records</h1>
<p class="muted">%d handicappers with %d or more graded %s picks, ranked by units won in %s. Names and posting sites are hidden. A short sample can still swing, so the all sports board opens on records with 100 or more picks.</p></div>
<a class="btn sm pro" href="../pricing.html">Watchdog Pro</a></div>
<section class="panel"><div class="tw"><table><thead><tr><th class="l">#</th><th class="l">Handicapper</th><th>Picks</th><th>Record</th><th>Win %%</th><th>Units</th><th>ROI</th></tr></thead>
<tbody>%s</tbody></table></div></section>
<section class="proband" style="grid-template-columns:1fr auto"><div><span class="lock">Watchdog Pro</span><h2>Found a %s record worth following?</h2>
<p class="muted" style="margin:0">Pro shows the name, the posting site, and the picks posted before the game. $59.99 a month, or $499 a year.</p></div>
<a class="btn pro" href="../pricing.html">See pricing</a></section>''' % (
            _esc(sport), _esc(sport), _esc(sport), len(leaders), _SPORT_MIN, _esc(sport), _esc(sport),
            _sport_table(cappers, sport), _esc(sport))
        html = _document(1, '', title, desc, 'https://handicapperwatchdog.com/sports/%s.html' % slug, body)
        with open(os.path.join(dest, slug + '.html'), 'w', encoding='utf-8', newline='\n') as f:
            f.write(html)
    for name in os.listdir(dest):
        if name.endswith('.html') and name not in keep:
            os.remove(os.path.join(dest, name))


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

    def related(rev):
        bits = []
        for slug in rev.get('related') or []:
            if slug not in names:
                raise SystemExit('review %s links an unknown slug %s' % (rev['slug'], slug))
            bits.append((slug, _esc(names[slug])))
        if not bits:
            return ''
        return '<section class="edsec"><h2>Related reviews</h2><div class="relrow">%s</div></section>' % ''.join(
            '<a class="rel" href="%s.html"><span>Not rated</span><b>%s</b></a>' % pair for pair in bits)

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
                 'dateModified': reviews.get('checked_iso') or '',
                 'author': {'@type': 'Organization', 'name': 'Handicapper Watchdog'},
                 'publisher': {'@type': 'Organization', 'name': 'Handicapper Watchdog'},
                 'mainEntityOfPage': canonical},
            ],
        }
        cards.append(
            '<a class="rev" data-name="%s" href="%s.html">'
            '<span class="badge unrated">Not rated</span><span class="muted small">%s</span><b>%s</b>'
            '<span class="dekline">%s</span></a>' % (
                _esc(rev['name'].lower()), rev['slug'],
                _esc(rev['kind']), _esc(rev['name']), _esc(rev['dek'])))
        body = '''<nav class="crumbs" aria-label="Breadcrumb"><a href="../">Home</a><span aria-hidden="true">/</span><a href="index.html">Reviews</a><span aria-hidden="true">/</span><span aria-current="page">%s</span></nav>
<header class="edhero">
<div>
<div class="eyebrow">%s</div>
<h1>%s</h1>
<p class="lede">%s</p>
</div>
<aside class="plate">
<div class="seal" aria-hidden="true"><b>NR</b><span>Not rated</span></div>
<p class="plate-k">Watchdog status</p>
<p class="plate-v">Not rated</p>
<p class="muted small">Checked %s. The four items below are why this page has no number.</p>
<ul class="checks">
<li><span>Graded record</span><b>Not in the file</b></li>
<li><span>Advertised record</span><b>Quoted below</b></li>
<li><span>Opened price</span><b>Pricing section</b></li>
<li><span>Buyer sample</span><b>Not in the file</b></li>
</ul>
</aside>
</header>
<div class="disclosure"><b>How to read this page</b><p class="muted">%s</p></div>
<div class="edstack">
<section class="panel edcard"><h2>What they advertise</h2><div class="prose">%s</div></section>
<section class="panel edcard"><h2>What Watchdog has graded</h2><div class="prose"><p>%s</p></div></section>
<section class="panel edcard"><h2>Pricing</h2><div class="prose">%s</div></section>
<section class="panel edcard"><h2>Transparency</h2><div class="prose"><p>%s</p></div></section>
<section class="panel edcard"><h2>Customer experience</h2><div class="prose"><p>%s</p></div></section>
<div class="split">
<section class="panel edsec good"><h2>Strengths</h2><div class="prose">%s</div></section>
<section class="panel edsec bad"><h2>Weaknesses</h2><div class="prose">%s</div></section>
</div>
%s
%s
</div>
<section class="panel srcpanel"><div class="pb prose"><h2>Sources checked %s</h2>%s
<p class="muted small">A 100 point score is not shown. The rubric is on the <a href="how-we-rate.html">ratings page</a>. Past results are not predictions. 21+.</p>
</div></section>
<script type="application/ld+json">%s</script>''' % (
            _esc(rev['name']), _esc(rev['kind']), _esc(rev['name']), _esc(rev['dek']),
            _esc(reviews['checked']), _esc(reviews['unrated_note']),
            paras(rev['advertised']), _esc(rev['watchdog']), paras(rev['pricing']),
            _esc(rev['transparency']), _esc(rev['customers']),
            paras(rev['strengths']), paras(rev['weaknesses']),
            related(rev), missing,
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
<section class="panel" style="margin-bottom:28px"><div class="pb prose"><p>%s</p><p>Sportsbook pages are not given this score. A book is not a handicapper, and a commercial relationship cannot buy a rating.</p></div></section>''' % (
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
<p class="muted small revfoot">Ten public names. The free rankings stay anonymous.</p>
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
        cta_note = ('This button stays off until JustBet eligibility and marketing permission for this domain are confirmed. '
                    'Nothing on this page tracks a click. The quotations below are not a bonus from this site.')
    book_body = '''<nav class="crumbs" aria-label="Breadcrumb"><a href="../">Home</a><span aria-hidden="true">/</span><span aria-current="page">JustBet</span></nav>
<header class="bookhero">
<div class="bookintro">
<p class="eyebrow">Sportsbook review</p>
<h1>JustBet</h1>
<p class="lede">%s</p>
<div class="trustrow"><span>Checked 27 Oct 2026</span><span>21+</span><span>No signup link</span></div>
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
<h2>Registration is not turned on</h2>
<p>%s</p>
</div>
%s
</section>
<section class="panel srcpanel"><div class="pb prose"><h2>Sources</h2>%s
<p class="muted small">This page is not a handicapper rating and it is not legal advice. 21+. Gambling problem? Call 1 800 GAMBLER.</p></div></section>''' % (
        _esc(book['dek']), cta, _esc(cta_note), _esc(book['disclosure']), paras(book['overview']), feature_rows, offer_rows,
        paras(book['pros']), paras(book['cons']), _esc(book['jurisdictions']),
        ''.join('<details class="faq"><summary>%s</summary><p>%s</p></details>' % (_esc(q['q']), _esc(q['a'])) for q in book['faq']),
        _esc(book['responsible']), _esc(cta_note), cta, sources(book['sources']))
    book_html = _document(1, 'sportsbooks/justbet.html', book['title'], book['description'],
                          'https://handicapperwatchdog.com/sportsbooks/justbet.html', book_body)
    written.append(book_html)
    with open(os.path.join(out_books, 'justbet.html'), 'w', encoding='utf-8', newline='\n') as f:
        f.write(book_html)
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
    _write_sport_pages(site, cappers)
    _write_editorial(site)
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
    with open(os.path.join(SITE, 'data', 'index.json'), 'w', encoding='utf-8') as f:
        json.dump({'meta': meta, 'cappers': index}, f, separators=(',', ':'))
    stamp_public_pages(SITE)
    print('tracked %d, fetched %d, failed %d, profiles %d, unreconciled %d' % (len(index), fetched, failed, published, unreconciled))


if __name__ == '__main__':
    main()
