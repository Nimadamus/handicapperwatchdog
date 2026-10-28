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
            'id': '%010x' % n, 'source': 'Covers', 'w': 70, 'l': 49, 'p': 1, 'picks': 120,
            'win_pct': 58.8, 'units': units, 'roi': 8.5, 'streak': 3, 'last_pick': '2026-10-25',
            'profile': True, 'bs': {'NFL': [31, 8.0, 4.0, 58.0, '18-13']},
            'handle': handle, 'slug': SLUG if handle else '',
        }
    rows = [row(n, 50 - n) for n in range(1, 30)]
    rows.append(row(99, 100, SECRET))
    rows.append({'id': 'not-an-id', 'handle': SECRET, 'units': 999, 'picks': 100, 'source': 'X'})
    rows.append({
        'id': 'abc0000021', 'source': 'X', 'w': 18, 'l': 3, 'p': 0, 'picks': 21,
        'win_pct': 85.7, 'units': 9000, 'roi': 420, 'streak': 8, 'last_pick': '2026-10-25',
        'profile': True, 'handle': SECRET, 'slug': SLUG,
    })
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
        assert not any(x in sm for x in ('capper.html', 'account.html', 'compare.html'))
        for url in (
            'https://handicapperwatchdog.com/how-we-grade.html',
            'https://handicapperwatchdog.com/the-board.html',
            'https://handicapperwatchdog.com/pricing.html',
            'https://handicapperwatchdog.com/reviews/index.html',
            'https://handicapperwatchdog.com/reviews/how-we-rate.html',
            'https://handicapperwatchdog.com/reviews/docs-sports.html',
            'https://handicapperwatchdog.com/sportsbooks/justbet.html',
            'https://handicapperwatchdog.com/sports/nfl.html',
        ):
            assert url in found, url
        assert '+9000.00' not in home and ' on Covers' not in home
        review = open(os.path.join(tmp, 'reviews', 'docs-sports.html'), encoding='utf-8').read()
        book = open(os.path.join(tmp, 'sportsbooks', 'justbet.html'), encoding='utf-8').read()
        editorial = review + book + open(os.path.join(tmp, 'reviews', 'index.html'), encoding='utf-8').read()
        assert 'Not rated' in review and 'aff=' not in editorial and 'BETLEGEND' not in editorial
        assert 'justbet-logo' not in book and '<h1>JustBet</h1>' in book
        assert book.count('Registration link not enabled') == 2
        assert 'new account form' in book and 'be.justbet.co/front/signup' in book
        assert 'href="https://be.justbet.co' not in book and 'Registration is not turned on' not in book
        moved = open(os.path.join(tmp, 'sportsbooks', 'reviews', 'how-we-rate.html'), encoding='utf-8').read()
        real_rate = open(os.path.join(tmp, 'reviews', 'how-we-rate.html'), encoding='utf-8').read()
        assert 'name="robots" content="noindex"' in moved
        assert 'rel="canonical" href="https://handicapperwatchdog.com/reviews/how-we-rate.html"' in moved
        assert 'rel="canonical" href="https://handicapperwatchdog.com/reviews/how-we-rate.html"' in real_rate
        assert 'noindex' not in real_rate.lower()
        assert 'sportsbooks/reviews/' not in sm
        assert '<span class="btn disabled' in book and 'aria-disabled="true"' in book
        assert 'revshare.ag' not in book and 'href="https://www.justbet.co/?aff=' not in book
        assert 'aggregateRating' not in editorial and 'ratingValue' not in editorial
        assert '100 counties' in book and 'affiliates.justbet' not in book.lower()
        dk = open(os.path.join(tmp, 'sportsbooks', 'draftkings-review', 'index.html'), encoding='utf-8').read()
        fd = open(os.path.join(tmp, 'sportsbooks', 'fanduel-review', 'index.html'), encoding='utf-8').read()
        directory = open(os.path.join(tmp, 'sportsbooks', 'index.html'), encoding='utf-8').read()
        method = open(os.path.join(tmp, 'sportsbooks', 'how-we-score', 'index.html'), encoding='utf-8').read()
        compare = open(os.path.join(tmp, 'sportsbooks', 'comparison', 'index.html'), encoding='utf-8').read()
        espn = open(os.path.join(tmp, 'sportsbooks', 'espn-bet', 'index.html'), encoding='utf-8').read()
        for page in (dk, fd, directory, method, compare, espn):
            assert page.count('<h1') == 1 and 'aff=' not in page and 'ratingValue' not in page and 'aggregateRating' not in page
            assert 'noindex' not in page.lower()
        assert 'href="../../style.css"' in dk and 'href="../style.css"' in directory
        assert 'rel="canonical" href="https://handicapperwatchdog.com/sportsbooks/draftkings-review/"' in dk
        assert 'rel="canonical" href="https://handicapperwatchdog.com/sportsbooks/"' in directory
        assert 'Not scored' in dk and 'Documented research' in dk and 'Not scored' in directory
        assert 'Puerto Rico' in fd and 'FanDuel Predicts' in fd
        assert '23 Nov 2026' in open(os.path.join(tmp, 'sportsbooks', 'bet365-review', 'index.html'), encoding='utf-8').read()
        assert '1 Dec 2025' in espn and 'Not a live book' in espn
        for url in (
            'https://handicapperwatchdog.com/sportsbooks/',
            'https://handicapperwatchdog.com/sportsbooks/draftkings-review/',
            'https://handicapperwatchdog.com/sportsbooks/fanduel-review/',
            'https://handicapperwatchdog.com/sportsbooks/bet365-review/',
            'https://handicapperwatchdog.com/sportsbooks/fanatics-review/',
            'https://handicapperwatchdog.com/sportsbooks/betmgm-review/',
            'https://handicapperwatchdog.com/sportsbooks/espn-bet/',
            'https://handicapperwatchdog.com/sportsbooks/how-we-score/',
            'https://handicapperwatchdog.com/sportsbooks/comparison/',
        ):
            assert url in found, url
        assert 'https://handicapperwatchdog.com/sportsbooks/index.html' not in found
        assert 'draftkings-review.html' not in sm
        assert SECRET not in editorial and SLUG not in editorial
        bob = open(os.path.join(tmp, 'reviews', 'dr-bob-sports.html'), encoding='utf-8').read()
        feist = open(os.path.join(tmp, 'reviews', 'jim-feist.html'), encoding='utf-8').read()
        boyd = open(os.path.join(tmp, 'reviews', 'jimmy-boyd.html'), encoding='utf-8').read()
        pre = open(os.path.join(tmp, 'reviews', 'pregame.html'), encoding='utf-8').read()
        assert '522-386-13' in bob and 'Not rated' in bob and 'not a verified current offer' in bob.lower()
        assert '$495' not in bob and '$1,045' not in bob and '$1,495' not in bob
        assert '$174.95' not in feist and '$199.95' not in feist and '$399.95' not in feist and '$1,999.95' not in feist
        assert 'not a verified current offer' in feist.lower() and '30 years' in feist
        assert '$23.20' not in boyd and '$29' not in boyd and 'Invalid access' in boyd
        assert 'not a current offer' in boyd.lower()
        assert 'not an offer from handicapper watchdog' in book.lower()
        assert 'free $25' in pre.lower() and 'not a verified current offer' in pre.lower() and '$1,995' in pre
        ct = open(os.path.join(tmp, 'reviews', 'cappertek.html'), encoding='utf-8').read()
        assert 'CapperTek is a scam' in ct and '11,386' in ct and '11,384' in ct and '30 minutes' in ct and 'non-refundable' in ct
        assert 'Domains By Proxy' in ct and 'protect against' in ct and '750' in ct
        assert 'Loading picks' in ct and '232' in ct and '229' in ct and '11,387' in ct and '139' in ct
        assert '32,037' in ct and '15 days' in ct and '28 Oct 2026' in ct and 'id="corrections"' in ct and 'contact.html' in ct
        assert 'trustmyrecord' not in ct.lower() and 'ratingValue' not in ct and 'aggregateRating' not in ct
        for legal in ('about.html', 'privacy.html', 'terms.html', 'contact.html'):
            page = open(os.path.join(tmp, legal), encoding='utf-8').read()
            assert 'noindex' not in page.lower() and 'mailto:' not in page.lower(), legal
            assert 'trustmyrecord' not in page.lower()
            assert 'rel="canonical" href="https://handicapperwatchdog.com/%s"' % legal in page
        assert 'not a verified badge' in open(os.path.join(tmp, 'pricing.html'), encoding='utf-8').read().lower()
        sm_legal = open(os.path.join(tmp, 'sitemap.xml'), encoding='utf-8').read()
        for legal in ('about.html', 'privacy.html', 'terms.html', 'contact.html'):
            assert 'https://handicapperwatchdog.com/' + legal in sm_legal
        assert 'capper.html' not in sm_legal and 'account.html' not in sm_legal
        assert '22,990' in open(os.path.join(tmp, 'reviews', 'docs-sports-ai.html'), encoding='utf-8').read()
        assert '637-544' in open(os.path.join(tmp, 'reviews', 'big-al.html'), encoding='utf-8').read()
        for slug in (
            'docs-sports', 'dr-bob-sports', 'pregame', 'cappertek', 'jimmy-boyd', 'jim-feist',
            'scott-spreitzer', 'robert-ferringo', 'docs-sports-ai', 'big-al',
        ):
            page = open(os.path.join(tmp, 'reviews', slug + '.html'), encoding='utf-8').read()
            assert page.count('<h1') == 1 and 'Not rated' in page and 'aff=' not in page, slug
            assert 'noindex' not in page.lower()
        for name, digest in before.items():
            now = hashlib.sha256(open(os.path.join(tmp, name), 'rb').read()).hexdigest()
            assert now == digest, name
        print(label, 'PASS', 'urls', len(found), 'links', len(ids))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


PLATFORMS = {'Covers', 'TheRX', 'X', 'Predictem', 'Reddit', 'Sportsbook Review'}
FORBIDDEN_KEYS = ('handle', 'username', 'slug', 'email', 'screen_name', 'user_id', 'account_id')


def ranked(cappers, limit):
    """Same order the rankings page uses: 100+ picks, units descending, JSON order on ties."""
    rows = [r for r in cappers if isinstance(r, dict) and re.fullmatch(r'[0-9a-f]{10}', str(r.get('id') or ''))
            and int(r.get('picks') or 0) >= 100 and r.get('units') is not None]
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
        # Public rows drop source on purpose. A present source must be a real
        # platform and must stay out of the identity cell. An absent source
        # must not be invented back into that cell.
        if source:
            assert source in PLATFORMS and source not in cells[1], (source, cells[1])
        else:
            for platform in PLATFORMS:
                if len(platform) < 2:
                    continue
                assert platform not in cells[1], (platform, cells[1])
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
            'id': 'abcde12345', 'source': 'Reddit', 'w': 100, 'l': 50, 'p': 0, 'picks': 150,
            'win_pct': 66.7, 'units': 500, 'roi': 20, 'streak': 1, 'last_pick': '2026-10-26',
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
        for url in (
            'https://handicapperwatchdog.com/',
            'https://handicapperwatchdog.com/cappers.html',
            'https://handicapperwatchdog.com/how-we-grade.html',
            'https://handicapperwatchdog.com/the-board.html',
            'https://handicapperwatchdog.com/pricing.html',
            'https://handicapperwatchdog.com/reviews/index.html',
            'https://handicapperwatchdog.com/sportsbooks/justbet.html',
        ):
            assert url in found, url
        assert 'privacy.html' in sm and 'terms.html' in sm and 'about.html' in sm and 'contact.html' in sm
        assert 'capper.html' not in sm and 'account.html' not in sm
        print('live PASS', 'bytes', len(payload), 'home', len(top10), 'rank', len(top50),
              'leader_units', show_num(top10[0]['units'], 2), 'row50_units', show_num(top50[-1]['units'], 2))
        return tmp
    except Exception:
        shutil.rmtree(tmp, ignore_errors=True)
        raise


def check_menu():
    import threading
    from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
    from playwright.sync_api import sync_playwright

    tmp = tempfile.mkdtemp(prefix='hwd-menu-')
    try:
        for name in ('index.html', 'cappers.html', 'style.css', 'stadium.svg', 'favicon.svg'):
            shutil.copy(os.path.join(ROOT, name), tmp)

        class Quiet(SimpleHTTPRequestHandler):
            def __init__(self, *args, **kwargs):
                super().__init__(*args, directory=tmp, **kwargs)

            def log_message(self, fmt, *args):
                pass

        httpd = ThreadingHTTPServer(('127.0.0.1', 0), Quiet)
        port = httpd.server_address[1]
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        origin = 'http://127.0.0.1:%d' % port
        try:
            import urllib.request
            with urllib.request.urlopen(origin + '/stadium.svg', timeout=10) as stadium:
                stadium_body = stadium.read()
            assert stadium.status == 200 and stadium_body.startswith(b'<'), len(stadium_body)
            with sync_playwright() as pw:
                browser = pw.chromium.launch(headless=True)
                page = browser.new_page(viewport={'width': 390, 'height': 844})
                for path in ('/', '/cappers.html'):
                    page.goto(origin + path, wait_until='domcontentloaded', timeout=30000)
                    closed = page.evaluate("() => getComputedStyle(document.querySelector('.navlinks')).display")
                    assert closed == 'none', (path, closed)
                    page.locator('label.navbtn').click()
                    opened = page.evaluate("() => getComputedStyle(document.querySelector('.navlinks')).display")
                    assert opened == 'flex', (path, opened)
                    scroll = page.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
                    assert scroll <= 1, (path, scroll)
                page.goto(origin + '/', wait_until='domcontentloaded')
                contrast = page.evaluate('''() => {
                  function lin(c){c/=255;return c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4)}
                  function L(rgb){const m=rgb.match(/\\d+/g).map(Number);return 0.2126*lin(m[0])+0.7152*lin(m[1])+0.0722*lin(m[2])}
                  function ratio(a,b){const x=L(a),y=L(b);const hi=Math.max(x,y),lo=Math.min(x,y);return (hi+0.05)/(lo+0.05)}
                  const bg=getComputedStyle(document.body).backgroundColor;
                  const h1=document.querySelector('h1');
                  const sub=document.querySelector('.sub');
                  return {
                    h1: ratio(getComputedStyle(h1).color, bg),
                    sub: ratio(getComputedStyle(sub).color, bg),
                    bare: [...document.images].filter(i => i.getAttribute('alt') === null).length,
                    h1n: document.querySelectorAll('h1').length
                  };
                }''')
                assert contrast['h1'] >= 4.5 and contrast['sub'] >= 4.5, contrast
                assert contrast['h1n'] == 1 and contrast['bare'] == 0, contrast
                print('a11y PASS', round(contrast['h1'], 2), round(contrast['sub'], 2))
                browser.close()
        finally:
            httpd.shutdown()
        print('menu PASS')
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


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
    check_menu()
    if '--live' in sys.argv:
        site = check_live()
        try:
            if '--browser' in sys.argv:
                check_browser(site)
        finally:
            shutil.rmtree(site, ignore_errors=True)
