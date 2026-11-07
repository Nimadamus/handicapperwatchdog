"""Headless UI check of the built site (_site): home, rankings, a detailed and a basic profile, desktop and phone.

python tools/ui_check_profiles.py [outdir]
Serves _site on a local port, runs Chromium headless, prints PASS/FAIL lines, writes screenshots to outdir.
"""
import functools
import http.server
import json
import os
import sys
import threading

from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = os.path.join(HERE, '_site')
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, '_shots')
os.makedirs(OUT, exist_ok=True)
results = []


def check(name, ok, detail=''):
    results.append(ok)
    print('%s %s %s' % ('PASS' if ok else 'FAIL', name, detail))


def serve():
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=SITE)
    h.log_message = lambda *a: None
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), h)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def main():
    with open(os.path.join(SITE, 'data', 'index.json'), encoding='utf-8') as f:
        idx = json.load(f)
    rows = idx['cappers']
    detail = next(r for r in sorted(rows, key=lambda r: -r['picks']) if r.get('profile') and not r.get('basic'))
    basic = next((r for r in rows if r.get('basic')), None)
    check('every index row links to a profile', all(r.get('profile') for r in rows), '%d rows' % len(rows))
    srv = serve()
    base = 'http://127.0.0.1:%d/' % srv.server_address[1]
    with sync_playwright() as pw:
        br = pw.chromium.launch()
        for label, vp in (('desktop', {'width': 1366, 'height': 900}), ('phone', {'width': 390, 'height': 844})):
            ctx = br.new_context(viewport=vp, device_scale_factor=1)
            page = ctx.new_page()
            errs = []
            page.on('pageerror', lambda e: errs.append(str(e)))
            page.route('**/googletagmanager.com/**', lambda r: r.abort())
            page.route('**/fonts.g*/**', lambda r: r.abort())

            def overflow():
                return page.evaluate('document.documentElement.scrollWidth - window.innerWidth')

            page.goto(base + 'index.html')
            page.wait_for_selector('#featGrid .fcard .idc', timeout=15000)
            page.wait_for_selector('#exLedger table', timeout=15000)
            check(label + ' home featured cards', page.locator('#featGrid a.fcard').count() >= 3, str(page.locator('#featGrid a.fcard').count()))
            check(label + ' home headline', 'We track the handicappers' in page.inner_text('h1'))
            check(label + ' home no horizontal scroll', overflow() <= 1, str(overflow()))
            page.screenshot(path=os.path.join(OUT, label + '_home.png'), full_page=True)
            href = page.get_attribute('#boardRows tr.go', 'data-href')
            check(label + ' home board rows clickable', bool(href), str(href))

            page.goto(base + 'cappers.html')
            page.wait_for_selector('#rows tr.go', timeout=15000)
            n_rows = page.locator('#rows tr').count()
            n_go = page.locator('#rows tr.go').count()
            check(label + ' rankings every row clickable', n_rows == n_go and n_rows > 0, '%d/%d' % (n_go, n_rows))
            page.select_option('#fMin', '1')
            page.select_option('#fTime', 'r90')
            page.select_option('#fAct', '7')
            page.select_option('#fSort', 'active')
            page.wait_for_timeout(300)
            check(label + ' rankings 90 day + activity filter', page.locator('#rows tr.go').count() > 0, page.inner_text('#count'))
            check(label + ' rankings no horizontal scroll', overflow() <= 1, str(overflow()))
            page.locator('#rows tr.go').first.click()
            page.wait_for_url('**/handicappers/*.html', timeout=10000)
            check(label + ' row click opens profile', '/handicappers/' in page.url)

            page.goto(base + 'capper.html?id=' + detail['id'])
            page.wait_for_selector('#lrows tr', timeout=15000)
            check(label + ' profile periods table', page.locator('#overview table').first.is_visible())
            check(label + ' profile charts', page.locator('#charts .chart').count() >= 1)
            n0 = page.locator('#lrows tr').count()
            check(label + ' ledger first page', 0 < n0 <= 10, str(n0))
            page.select_option('#lr', 'W')
            wins_only = all(t.strip() == 'Win' for t in page.locator('#lrows tr td:nth-child(7)').all_inner_texts())
            check(label + ' ledger result filter', wins_only)
            page.select_option('#lr', '')
            if page.locator('#lnext').is_enabled():
                page.click('#lnext')
                check(label + ' ledger pagination', page.inner_text('#lpg').startswith('2 /'))
            for i, nm in enumerate(['ROI over time', 'Rolling win %', 'Picks per week']):
                page.click('[data-tabs="ch"] button.tab[data-i="%d"]' % (i + 1))
            check(label + ' profile no horizontal scroll', overflow() <= 1, str(overflow()))
            html = page.content()
            check(label + ' profile has no handle or link', 'th-0' not in html and 'Tracked Handicapper #' not in html and 'covers.com/forum' not in html)
            page.goto(base + 'capper.html?id=' + detail['id'])
            page.wait_for_selector('#lrows tr', timeout=15000)
            page.screenshot(path=os.path.join(OUT, label + '_profile.png'), full_page=True)
            if basic:
                page.goto(base + 'capper.html?id=' + basic['id'])
                page.wait_for_selector('.disclosure', timeout=15000)
                check(label + ' basic profile renders', 'Detailed analytics not shown' in page.inner_text('main'))
                page.screenshot(path=os.path.join(OUT, label + '_basic.png'), full_page=True)
            check(label + ' no page errors', not errs, '; '.join(errs[:3]))
            ctx.close()
        br.close()
    srv.shutdown()
    print('RESULT', 'PASS' if all(results) else 'FAIL', '%d/%d' % (sum(results), len(results)))
    sys.exit(0 if all(results) else 1)


if __name__ == '__main__':
    main()
