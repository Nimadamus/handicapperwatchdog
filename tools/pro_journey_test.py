"""Watchdog Pro journey test: anonymous visitor, static site (checkout closed), test subscriber, billing states.

  python tools/pro_journey_test.py [shots_dir]

Needs a built _site with HWD_PRO_KEY set (and, for the picks board, a pending export). Starts backend/dev.mjs
(real API handler, in memory KV, fake Stripe test mode; no real payment is possible) and a plain static server.
"""
import functools
import http.server
import json
import os
import re
import subprocess
import sys
import threading
import time
import urllib.request

from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = os.path.join(HERE, '_site')
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, '_shots')
os.makedirs(OUT, exist_ok=True)
PORT = 8157
API = 'http://localhost:%d/' % PORT
res = []


def check(name, ok, detail=''):
    res.append(ok)
    print('%s %s %s' % ('PASS' if ok else 'FAIL', name, '' if ok else detail))


def static_server():
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=SITE)
    h.log_message = lambda *a: None
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), h)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, 'http://127.0.0.1:%d/' % srv.server_address[1]


IDENTITY = re.compile(r'th-\d{4}|Tracked Handicapper #|x\.com/|twitter\.com/|reddit\.com/u|covers\.com/forum|sportsbookreview\.com/forum|therx\.com/')


def main():
    idx = json.load(open(os.path.join(SITE, 'data', 'index.json'), encoding='utf-8'))
    meta = idx['meta']
    check('build wrote Pro ledgers and the pending feed', (meta.get('pro') or {}).get('ledgers', 0) > 0 and meta['pro'].get('pending_feed'), meta.get('pro'))
    target = next(c for c in sorted(idx['cappers'], key=lambda c: -c['picks']) if c.get('profile') and not c.get('basic'))
    pub = json.load(open(os.path.join(SITE, 'data', 'p', target['id'] + '.json'), encoding='utf-8'))
    for f in ('pending.bin', target['id'] + '.bin'):
        blob = open(os.path.join(SITE, 'data', 'x', f), encoding='utf-8').read()
        check('published %s is ciphertext only' % f, not re.search(r'matchup|selection|ledger|"', blob))

    env = dict(os.environ, HWD_PRO_KEY=os.environ.get('HWD_PRO_KEY', 'localprokey1102'))
    dev = subprocess.Popen(['node', os.path.join(HERE, 'backend', 'dev.mjs'), str(PORT)], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                           creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    srv, STATIC = static_server()
    for _ in range(50):
        try:
            urllib.request.urlopen(API + 'api/health', timeout=2)
            break
        except Exception:
            time.sleep(0.2)
    try:
        with sync_playwright() as pw:
            br = pw.chromium.launch()

            # 1. static deploy (no API): checkout closed must be stated, nothing sold, no picks shown
            ctx = br.new_context(viewport={'width': 390, 'height': 844})
            pg = ctx.new_page()
            pg.route('**/googletagmanager.com/**', lambda r: r.abort())
            pg.goto(STATIC + 'index.html')
            pg.wait_for_selector('[data-cta-note]:not([hidden])', timeout=10000)
            check('static: home CTA goes to the picks page', pg.get_attribute('.ctarow a.pro', 'href') == 'picks.html')
            check('static: home says checkout is not open', 'not open yet' in pg.inner_text('[data-cta-note]'))
            pg.click('.ctarow a.pro')
            pg.wait_for_selector('.pcnote', timeout=10000)
            check('static: picks page says checkout is not open', 'Checkout is not open yet' in pg.inner_text('main'))
            check('static: picks page shows no real picks', pg.locator('#prows').count() == 0 and pg.locator('.locked').count() == 1)
            check('static: picks page phone no sideways scroll', pg.evaluate('document.documentElement.scrollWidth - innerWidth') <= 1)
            pg.screenshot(path=os.path.join(OUT, 'static_phone_picks.png'), full_page=True)
            pg.goto(STATIC + 'pricing.html')
            pg.wait_for_timeout(800)
            check('static: pricing buttons disabled and say opening soon', pg.is_disabled('[data-plan="annual"]') and 'Opening soon' in pg.inner_text('[data-plan="annual"]'))
            ctx.close()

            # 2. free visitor with the API up
            ctx = br.new_context(viewport={'width': 1366, 'height': 900})
            pg = ctx.new_page()
            pg.route('**/googletagmanager.com/**', lambda r: r.abort())
            pg.goto(API + 'picks.html')
            pg.wait_for_selector('main .locked', timeout=10000)
            check('free: picks locked', pg.locator('#prows').count() == 0)
            check('free: refused the pending key', pg.evaluate("fetch('/api/pro/key?id=pending').then(r => r.status)") == 401)
            check('free: refused a capper key', pg.evaluate("fetch('/api/pro/key?id=%s').then(r => r.status)" % target['id']) == 401)
            check('free: no names key exists', pg.evaluate("fetch('/api/pro/key?id=names').then(r => r.status)") in (400, 401))
            pg.goto(API + 'capper.html?id=' + target['id'])
            pg.wait_for_selector('#lrows tr', timeout=10000)
            check('free: ledger capped at 50', '50 most recent' in pg.inner_text('#lhead'))

            # 3. subscribe in Stripe test mode (fake Stripe; no real card)
            pg.goto(API + 'pricing.html')
            pg.wait_for_function("!document.querySelector('[data-plan=annual]').disabled", timeout=10000)
            pg.fill('#buyerEmail', 'qa-pro@example.com')
            pg.click('[data-plan="annual"]')
            pg.wait_for_url('**/__stripe/checkout**', timeout=10000)
            check('checkout is Stripe test mode at $499', 'stripe test mode' in pg.inner_text('body').lower() and '$499.00 per year' in pg.inner_text('body'))
            pg.click('button')
            pg.wait_for_url('**/account.html**', timeout=15000)
            pg.wait_for_function("document.body.innerText.indexOf('Welcome to Watchdog Pro') >= 0", timeout=15000)
            me = pg.evaluate("fetch('/api/me').then(r => r.json())")
            check('subscribed: account is Pro, annual', me.get('pro') is True and me.get('plan') == 'annual', me)

            # 4. Pro: picks board, full ledger, pending on the profile, no identities anywhere
            pg.goto(API + 'picks.html')
            pg.wait_for_selector('#prows tr', timeout=15000)
            n = pg.locator('#prows tr').count()
            check('Pro: picks board has rows', n > 0 and 'eligible picks' in pg.inner_text('#pcount'), pg.inner_text('#pcount'))
            first_league = pg.eval_on_selector('#pl', 'el => el.options.length > 1 ? el.options[1].value : ""')
            if first_league:
                pg.select_option('#pl', first_league)
                cells = pg.locator('#prows tr td:nth-child(2) .pg').all_inner_texts()
                check("Pro: league filter", all(first_league in c for c in cells), cells[:3])
                pg.select_option('#pl', '')
            pg.select_option('#pt', '100')
            check('Pro: established filter keeps only established IDs', all('Established' in t for t in pg.locator('#prows tr td:nth-child(4)').all_inner_texts()) or 'No eligible' in pg.inner_text('#prows'))
            pg.select_option('#pt', '')
            check('Pro: board has no handle or link', not IDENTITY.search(pg.content()))
            pg.screenshot(path=os.path.join(OUT, 'pro_desktop_picks.png'), full_page=True)
            href = pg.get_attribute('#prows tr a', 'href')
            pg.goto(API + href)
            pg.wait_for_selector('#ppend .sech', timeout=15000)
            check('Pro: profile shows eligible pending picks for the account', pg.locator('#ppend table tr').count() >= 2 or 'No eligible' in pg.inner_text('#ppend'))
            pg.goto(API + 'capper.html?id=' + target['id'])
            pg.wait_for_function("(document.getElementById('lhead')||{}).textContent && document.getElementById('lhead').textContent.indexOf('All ') === 0", timeout=15000)
            total = pg.inner_text('#lcount')
            check('Pro: full ledger equals graded picks', ('of %s listed' % format(pub['overview']['picks'], ',')) in total, total)
            check('Pro: profile has no handle or link', not IDENTITY.search(pg.content()))
            pg.screenshot(path=os.path.join(OUT, 'pro_desktop_profile.png'), full_page=False)
            pg.goto(API + 'compare.html?ids=' + ','.join(c['id'] for c in idx['cappers'][:2]))
            pg.wait_for_timeout(1200)
            check('Pro: compare uses anonymous IDs only', '#' in pg.inner_text('main') and not IDENTITY.search(pg.content()))

            # 5. billing states through the fake Stripe portal (each sends a signed webhook)
            def portal(act):
                cust = pg.evaluate("fetch('/api/portal',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}).then(r=>r.json())")['url']
                pg.goto(cust + '&act=' + act)
                pg.wait_for_url('**/account.html**', timeout=10000)
                return pg.evaluate("fetch('/api/me').then(r => r.json())")
            m = portal('cancel')
            check('cancel at period end keeps Pro until the end', m.get('pro') is True and m.get('cancel_at_period_end') is True, m)
            m = portal('resume')
            check('resume', m.get('pro') is True and not m.get('cancel_at_period_end'), m)
            m = portal('fail')
            check('failed renewal: Pro during the grace period', m.get('pro') is True and m.get('status') == 'past_due', m)
            m = portal('end')
            check('subscription ended: Pro removed', m.get('pro') is False, m)
            check('ended: pending key refused', pg.evaluate("fetch('/api/pro/key?id=pending').then(r => r.status)") == 402)
            pg.goto(API + 'picks.html')
            pg.wait_for_selector('main .locked', timeout=10000)
            check('ended: picks page locked again', pg.locator('#prows').count() == 0)
            ctx.close()

            # 6. phone layout as Pro
            ctx = br.new_context(viewport={'width': 390, 'height': 844})
            pg = ctx.new_page()
            pg.goto(API + 'pricing.html')
            pg.wait_for_function("!document.querySelector('[data-plan=monthly]').disabled", timeout=10000)
            pg.fill('#buyerEmail', 'qa-phone@example.com')
            pg.click('[data-plan="monthly"]')
            pg.wait_for_url('**/__stripe/checkout**', timeout=10000)
            pg.click('button')
            pg.wait_for_url('**/account.html**', timeout=15000)
            pg.goto(API + 'picks.html')
            pg.wait_for_selector('#prows tr', timeout=15000)
            check('Pro phone: picks page no sideways scroll', pg.evaluate('document.documentElement.scrollWidth - innerWidth') <= 1)
            pg.screenshot(path=os.path.join(OUT, 'pro_phone_picks.png'), full_page=True)
            ctx.close()
            br.close()
    finally:
        dev.terminate()
        srv.shutdown()
    print('RESULT', 'PASS' if all(res) else 'FAIL', '%d/%d' % (sum(res), len(res)))
    sys.exit(0 if all(res) else 1)


if __name__ == '__main__':
    main()
