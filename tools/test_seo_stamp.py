"""Checks the public HTML stamp. No site build and no network unless --live."""
import hashlib
import json
import os
import re
import shutil
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import build

SECRET = 'ZZZ_SECRET_HANDLE_SHOULD_NOT_LEAK'
SLUG = 'zzz-real-slug-should-not-leak'


def fixture():
    def row(n, units, handle=''):
        return {
            'id': '%010x' % n, 'source': 'Covers', 'w': 20, 'l': 10, 'p': 1, 'picks': 40,
            'win_pct': 66.6, 'units': units, 'roi': 8.5, 'streak': 3, 'last_pick': '2026-10-25',
            'profile': True, 'bs': {'NFL': [20, 12.0, 5.0, 60.0, '12-8']},
            'handle': handle, 'slug': SLUG if handle else '',
        }
    rows = [row(n, 50 - n) for n in range(1, 30)]
    rows.append(row(99, 100, SECRET))
    rows.append({'id': 'not-an-id', 'handle': SECRET, 'units': 999, 'picks': 100, 'source': 'X'})
    return {'meta': {
        'built_at': '2026-10-26T18:00:00+00:00', 'tracked': 2653, 'graded_picks': 100000,
        'profiles': 2500, 'qualified': 800, 'profitable': 300, 'established': 100, 'established_up': 40,
    }, 'cappers': rows}


def locs(text):
    return re.findall(r'<loc>([^<]+)</loc>', text)


def check(label, extra):
    tmp = tempfile.mkdtemp(prefix='hwd-seo-')
    try:
        os.makedirs(os.path.join(tmp, 'data'))
        kept = []
        for name in ('index.html', 'cappers.html', 'capper.html', 'account.html', 'compare.html'):
            src = os.path.join(ROOT, name)
            if os.path.isfile(src):
                shutil.copy(src, tmp)
                if name != 'index.html' and name != 'cappers.html':
                    kept.append(name)
        for name in extra:
            shutil.copy(os.path.join(ROOT, name), tmp)
        before = {name: hashlib.sha256(open(os.path.join(tmp, name), 'rb').read()).hexdigest() for name in kept}
        with open(os.path.join(tmp, 'data', 'index.json'), 'w', encoding='utf-8') as f:
            json.dump(fixture(), f)
        build.stamp_public_pages(tmp)
        home = open(os.path.join(tmp, 'index.html'), encoding='utf-8').read()
        rank = open(os.path.join(tmp, 'cappers.html'), encoding='utf-8').read()
        sm = open(os.path.join(tmp, 'sitemap.xml'), encoding='utf-8').read()
        blob = home + rank + sm
        assert SECRET not in blob and SLUG not in blob and 'not-an-id' not in blob
        assert home.count('<h1') == 1 and rank.count('<h1') == 1
        assert 'rel="canonical" href="https://handicapperwatchdog.com/"' in home
        assert 'rel="canonical" href="https://handicapperwatchdog.com/cappers.html"' in rank
        assert 'noindex' not in home.lower() and 'noindex' not in rank.lower()
        ids = re.findall(r'capper\.html\?id=([0-9a-zA-Z]+)', blob)
        assert ids and all(re.fullmatch(r'[0-9a-f]{10}', i) for i in ids)
        assert 'WebSite' in home and 'ItemList' in home and 'BreadcrumbList' in rank
        assert 'viewport' in home and 'viewport' in rank
        found = locs(sm)
        assert found[0] == 'https://handicapperwatchdog.com/'
        assert 'https://handicapperwatchdog.com/cappers.html' in found
        assert 'https://handicapperwatchdog.com/index.html' not in found
        assert all(u.startswith('https://handicapperwatchdog.com/') and 'www.' not in u for u in found)
        assert not any(x in sm for x in ('capper.html', 'account.html', 'compare.html', 'privacy.html', 'terms.html'))
        if 'pricing.html' in extra:
            assert 'https://handicapperwatchdog.com/pricing.html' in found
        else:
            assert all(u in (
                'https://handicapperwatchdog.com/',
                'https://handicapperwatchdog.com/cappers.html',
            ) for u in found)
        for name, digest in before.items():
            now = hashlib.sha256(open(os.path.join(tmp, name), 'rb').read()).hexdigest()
            assert now == digest, name
        print(label, 'PASS', 'urls', len(found), 'links', len(ids))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


PLATFORMS = {'Covers', 'TheRX', 'X', 'Predictem', 'Reddit', 'Sportsbook Review'}
FORBIDDEN_KEYS = ('handle', 'username', 'slug', 'email', 'screen_name', 'user_id', 'account_id')


def ranked(cappers, limit):
    """Same order the rankings page uses: 20+ picks, units descending, JSON order on ties."""
    rows = [r for r in cappers if isinstance(r, dict) and re.fullmatch(r'[0-9a-f]{10}', str(r.get('id') or ''))
            and int(r.get('picks') or 0) >= 20 and r.get('units') is not None]
    rows.sort(key=lambda r: float(r['units']), reverse=True)
    return rows[:limit]


def record_ok(r):
    w, l, p = int(r.get('w') or 0), int(r.get('l') or 0), int(r.get('p') or 0)
    if w + l + p != int(r.get('picks') or 0):
        return False
    if w + l and r.get('win_pct') is not None:
        # One stored rate in the live top 50 is 0.1 off half-even rounding (63.75 -> 63.7).
        # The page shows the published rate. Anything past a tenth is a real mismatch.
        if abs(round(100.0 * w / (w + l), 1) - float(r['win_pct'])) > 0.11:
            return False
    return True


def show_num(v, digits):
    n = float(v)
    body = '%.*f' % (digits, n)
    return ('+' + body) if n > 0 else body


def tbody(html, element_id):
    m = re.search(r'<tbody id="%s">(.*?)</tbody>' % element_id, html, re.S)
    assert m, element_id
    rows = []
    for tr in re.findall(r'<tr>(.*?)</tr>', m.group(1), re.S):
        cells = [re.sub(r'<[^>]+>', '', c) for c in re.findall(r'<td\b[^>]*>(.*?)</td>', tr, re.S)]
        hrefs = re.findall(r'capper\.html\?id=([0-9a-f]{10})', tr)
        rows.append((cells, hrefs))
    return rows


def assert_table(html, element_id, expect):
    got = tbody(html, element_id)
    assert len(got) == len(expect), (element_id, len(got), len(expect))
    prev = None
    for n, ((cells, hrefs), r) in enumerate(zip(got, expect), 1):
        assert record_ok(r), n
        assert len(cells) == 10, n
        assert cells[0] == str(n), (n, cells[0])
        code = r['id'][:4].upper()
        assert ('ID ' + code) in cells[1], (n, cells[1])
        assert 'Hidden name' in cells[1]
        source = r.get('source') or ''
        assert source in PLATFORMS and source in cells[1], source
        assert cells[3].replace(',', '') == str(int(r['picks']))
        pushes = int(r.get('p') or 0)
        rec = '%d-%d' % (int(r['w']), int(r['l'])) + ('-%d' % pushes if pushes else '')
        assert cells[4] == rec, (n, cells[4], rec)
        assert cells[5] == ('n/a' if r.get('win_pct') is None else '%.1f%%' % float(r['win_pct']))
        assert show_num(r['units'], 2) in cells[6], (n, cells[6], r['units'])
        assert (show_num(r['roi'], 1) + '%') in cells[7], (n, cells[7], r['roi'])
        assert hrefs == ([r['id']] if r.get('profile') else [])
        units = float(r['units'])
        if prev is not None:
            assert units <= prev
        prev = units
        for key in FORBIDDEN_KEYS:
            secret = r.get(key)
            if secret:
                assert str(secret) not in ''.join(cells)


def assert_clean(html):
    handles = re.findall(r'@([A-Za-z][\w]{1,30})', html)
    assert [h for h in handles if h not in ('context', 'type', 'graph', 'id')] == []
    assert not re.search(r'capper\.html\?id=(?![0-9a-f]{10}(?:["\'&\s#]|$))', html)
    for key in FORBIDDEN_KEYS:
        assert key not in html.lower()


def check_refresh():
    """A second build with new numbers replaces the table. Stale rows must not survive a refresh."""
    tmp = tempfile.mkdtemp(prefix='hwd-seo-refresh-')
    try:
        os.makedirs(os.path.join(tmp, 'data'))
        for name in ('index.html', 'cappers.html'):
            shutil.copy(os.path.join(ROOT, name), tmp)
        doc = fixture()
        with open(os.path.join(tmp, 'data', 'index.json'), 'w', encoding='utf-8') as f:
            json.dump(doc, f)
        build.stamp_public_pages(tmp)
        first = tbody(open(os.path.join(tmp, 'index.html'), encoding='utf-8').read(), 'boardRows')[0][1][0]
        doc['cappers'].append({
            'id': 'abcde12345', 'source': 'Reddit', 'w': 30, 'l': 10, 'p': 0, 'picks': 40,
            'win_pct': 75.0, 'units': 500, 'roi': 20, 'streak': 1, 'last_pick': '2026-10-26',
            'profile': True, 'handle': SECRET, 'slug': SLUG, 'bs': {'NBA': [20, 9, 4, 60, '12-8']},
        })
        doc['meta']['built_at'] = '2026-10-26T20:00:00+00:00'
        doc['meta']['tracked'] = 2654
        with open(os.path.join(tmp, 'data', 'index.json'), 'w', encoding='utf-8') as f:
            json.dump(doc, f)
        build.stamp_public_pages(tmp)
        home = open(os.path.join(tmp, 'index.html'), encoding='utf-8').read()
        assert SECRET not in home and SLUG not in home
        leader = tbody(home, 'boardRows')[0]
        assert leader[1] == ['abcde12345']
        assert leader[0][0] == '1'
        assert show_num(500, 2) in leader[0][6]
        assert first != 'abcde12345'
        print('refresh PASS')
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def check_pipeline():
    src = open(os.path.join(ROOT, 'build.py'), encoding='utf-8').read()
    assert src.count('stamp_public_pages(SITE)') == 1
    write_at = src.find("json.dump({'meta': meta, 'cappers': index}")
    call_at = src.find('stamp_public_pages(SITE)')
    assert 0 < write_at < call_at
    wf = open(os.path.join(ROOT, '.github', 'workflows', 'refresh.yml'), encoding='utf-8').read()
    assert 'python build.py' in wf and 'branches: [main]' in wf
    assert open(os.path.join(ROOT, 'CNAME'), encoding='utf-8').read().strip() == 'handicapperwatchdog.com'
    print('pipeline PASS')


def check_live():
    import urllib.request
    tmp = tempfile.mkdtemp(prefix='hwd-seo-live-')
    try:
        os.makedirs(os.path.join(tmp, 'data'))
        for name in ('index.html', 'cappers.html', 'style.css', 'app.js', 'favicon.svg'):
            src = os.path.join(ROOT, name)
            if os.path.isfile(src):
                shutil.copy(src, tmp)
        req = urllib.request.Request('https://handicapperwatchdog.com/data/index.json', headers={'User-Agent': 'HWD-SEO-Audit/1.0'})
        with urllib.request.urlopen(req, timeout=60) as r:
            payload = r.read()
        doc = json.loads(payload)
        with open(os.path.join(tmp, 'data', 'index.json'), 'wb') as f:
            f.write(payload)
        keys = set()
        for row in doc['cappers']:
            keys |= set(row)
        assert not (keys & set(FORBIDDEN_KEYS))
        top10 = ranked(doc['cappers'], 10)
        top50 = ranked(doc['cappers'], 50)
        assert [r['id'] for r in top10] == [r['id'] for r in top50[:10]]
        assert all(record_ok(r) for r in top50)
        build.stamp_public_pages(tmp)
        home = open(os.path.join(tmp, 'index.html'), encoding='utf-8').read()
        rank = open(os.path.join(tmp, 'cappers.html'), encoding='utf-8').read()
        sm = open(os.path.join(tmp, 'sitemap.xml'), encoding='utf-8').read()
        assert_clean(home)
        assert_clean(rank)
        assert_table(home, 'boardRows', top10)
        assert_table(rank, 'rows', top50)
        found = locs(sm)
        base = ['https://handicapperwatchdog.com/', 'https://handicapperwatchdog.com/cappers.html']
        if os.path.isfile(os.path.join(ROOT, 'pricing.html')):
            assert found[:2] == base and 'https://handicapperwatchdog.com/pricing.html' in found
            assert 'privacy.html' not in sm and 'terms.html' not in sm
        else:
            assert found == base
        print('live PASS', 'bytes', len(payload), 'home', len(top10), 'rank', len(top50),
              'leader_units', show_num(top10[0]['units'], 2), 'row50_units', show_num(top50[-1]['units'], 2))
        return tmp
    except Exception:
        shutil.rmtree(tmp, ignore_errors=True)
        raise


def check_browser(tmp):
    import threading
    from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
    from playwright.sync_api import sync_playwright

    class Quiet(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=tmp, **kwargs)

        def log_message(self, fmt, *args):
            pass

    httpd = ThreadingHTTPServer(('127.0.0.1', 0), Quiet)
    port = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    origin = 'http://127.0.0.1:%d' % port
    views = {'desktop': (1440, 900), 'phone': (390, 844)}
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            for label, size in views.items():
                for path, rows, tbody_id, js in (
                    ('/', 10, '#boardRows tr', False),
                    ('/cappers.html', 50, '#rows tr', False),
                    ('/', 10, '#boardRows tr', True),
                    ('/cappers.html', 50, '#rows tr', True),
                ):
                    context = browser.new_context(viewport={'width': size[0], 'height': size[1]}, java_script_enabled=js)
                    page = context.new_page()
                    errors = []
                    css = []
                    page.on('pageerror', lambda e: errors.append(str(e)))
                    page.on('response', lambda r: css.append((r.status, r.url)) if r.url.endswith('style.css') else None)
                    page.goto(origin + path, wait_until='domcontentloaded', timeout=30000)
                    try:
                        page.wait_for_function(
                            "() => { const t = document.querySelector('.tw'); return !!t && getComputedStyle(t).overflowX === 'auto'; }",
                            timeout=10000)
                    except Exception:
                        diag = page.evaluate('''() => ({
                          tw: !!document.querySelector('.tw'),
                          ox: (document.querySelector('.tw') && getComputedStyle(document.querySelector('.tw')).overflowX) || '',
                          sheets: [...document.styleSheets].map(s => { let n = 0; try { n = s.cssRules.length; } catch (e) { n = -1; } return (s.href || 'inline') + ':' + n; })
                        })''')
                        print('CSS WAIT FAIL', label, path, 'js' if js else 'html', css, diag)
                        raise
                    if js and path == '/':
                        page.wait_for_selector('#boardRows tr.fade', timeout=15000)
                    elif js:
                        page.wait_for_function("() => (document.querySelector('#count') || {}).textContent.indexOf('handicapper') >= 0", timeout=15000)
                    info = page.evaluate('''() => {
                      const n = performance.getEntriesByType('navigation')[0] || {};
                      const w = document.documentElement.clientWidth;
                      const wide = [...document.querySelectorAll('body *')].filter(e => {
                        const b = e.getBoundingClientRect();
                        if (!b.width || getComputedStyle(e).position === 'fixed') return false;
                        let p = e.parentElement;
                        while (p) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') return false; p = p.parentElement; }
                        return b.right > w + 1;
                      }).slice(0, 8).map(e => ({ tag: e.tagName, cls: e.className, id: e.id,
                        right: Math.round(e.getBoundingClientRect().right), width: Math.round(e.getBoundingClientRect().width) }));
                      const nav = document.querySelector('.navlinks');
                      return { dcl: n.domContentLoadedEventEnd || 0, scroll: document.documentElement.scrollWidth - w, wide,
                               h1: document.querySelectorAll('h1').length,
                               nav: nav ? getComputedStyle(nav).display : '' };
                    }''')
                    count = page.locator(tbody_id).count()
                    assert count == rows, (label, path, js, count, css)
                    if label == 'phone':
                        assert info['nav'] == 'none', (label, path, info['nav'], css)
                    assert info['scroll'] <= 1 and info['wide'] == [], (label, path, info, css)
                    assert info['h1'] == 1 and not errors, (label, path, errors, info)
                    print('browser PASS', label, path, 'js' if js else 'html', 'dcl_ms', round(info['dcl']), 'rows', count)
                    context.close()
            browser.close()
    finally:
        httpd.shutdown()


if __name__ == '__main__':
    extra = [n for n in ('pricing.html', 'privacy.html', 'terms.html') if os.path.isfile(os.path.join(ROOT, n))]
    check('fixture', extra)
    check_refresh()
    check_pipeline()
    if '--live' in sys.argv:
        site = check_live()
        try:
            if '--browser' in sys.argv:
                check_browser(site)
        finally:
            shutil.rmtree(site, ignore_errors=True)
