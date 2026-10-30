"""Headless browser test of the site (Playwright, bundled Chromium, no visible window).

  python tools/ui_test.py [base_url] [--shots DIR]

Needs backend/dev.mjs running (site + API + fake Stripe). Covers desktop, tablet and phone layouts, filters,
profiles, the free versus Pro data boundary, the whole subscription journey, and basic accessibility.
Screenshots go to DIR (default docs/screens). Exit 1 on any failure.
"""
import json
import os
import re
import sys
from playwright.sync_api import sync_playwright

BASE = next((a for a in sys.argv[1:] if a.startswith('http')), 'http://localhost:8150')
SHOTS = sys.argv[sys.argv.index('--shots') + 1] if '--shots' in sys.argv else os.path.join(os.path.dirname(__file__), '..', 'docs', 'screens')
os.makedirs(SHOTS, exist_ok=True)
VIEWS = {'desktop': (1440, 900), 'tablet': (820, 1180), 'phone': (390, 844)}
results = []


def check(name, cond, detail=''):
    results.append(('PASS' if cond else 'FAIL', name + ('' if cond else ': ' + str(detail))))


def layout(page, label):
    """No sideways page scroll, nothing wider than the viewport, every image has alt text, buttons have names."""
    r = page.evaluate('''() => {
      const w = document.documentElement.clientWidth;
      const wide = [...document.querySelectorAll('body *')].filter(e => {
        const b = e.getBoundingClientRect(); if (!b.width || getComputedStyle(e).position === 'fixed') return false;
        let p = e.parentElement; while (p) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') return false; p = p.parentElement; }
        return b.right > w + 1; }).slice(0, 3).map(e => e.tagName + '.' + e.className);
      const noAlt = [...document.images].filter(i => !i.hasAttribute('alt')).length;
      const noName = [...document.querySelectorAll('button,a.btn')].filter(b => !(b.innerText || b.getAttribute('aria-label') || '').trim()).length;
      const unlabeled = [...document.querySelectorAll('input:not([type=hidden]):not([type=checkbox]),select')].filter(i => !(i.labels && i.labels.length) && !i.getAttribute('aria-label')).length;
      return { scroll: document.documentElement.scrollWidth - w, wide, noAlt, noName, unlabeled, h1: document.querySelectorAll('h1').length, lang: document.documentElement.lang };
    }''')
    check(label + ' no sideways scroll', r['scroll'] <= 1 and not r['wide'], r)
    check(label + ' accessibility basics', r['noAlt'] == 0 and r['noName'] == 0 and r['unlabeled'] == 0 and r['h1'] >= 1 and r['lang'] == 'en', r)


def shot(page, name, full=True):
    page.screenshot(path=os.path.join(SHOTS, name + '.png'), full_page=full)


with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True)
    idx = json.loads(browser.new_page().goto(BASE + '/data/index.json').text())
    prof_ids = [c['id'] for c in idx['cappers'] if c.get('profile')]
    target = '926ed395f4' if '926ed395f4' in prof_ids else prof_ids[0]

    # ---------- free experience at three sizes ----------
    for vname, (w, h) in VIEWS.items():
        ctx = browser.new_context(viewport={'width': w, 'height': h}, device_scale_factor=1)
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'favicon' not in m.text and 'googletagmanager' not in m.text else None)
        for name, path, ready in [('home', '/', '#boardRows tr td:nth-child(5)'), ('rankings', '/cappers.html', '#rows tr td:nth-child(5)'),
                                  ('profile', '/capper.html?id=' + target, '.kpis'), ('pricing', '/pricing.html', '.plans'),
                                  ('account', '/account.html', '#acct .ph'), ('compare', '/compare.html', '#cmp .lock'),
                                  ('terms', '/terms.html', '.legal'), ('privacy', '/privacy.html', '.legal')]:
            page.goto(BASE + path, wait_until='domcontentloaded')
            page.wait_for_selector(ready, timeout=15000)
            page.wait_for_timeout(400)
            layout(page, '%s %s' % (vname, name))
            if name in ('home', 'rankings', 'profile', 'pricing') or vname == 'desktop':
                shot(page, '%s_%s' % (vname, name), full=(name != 'profile' or vname != 'desktop'))
        check(vname + ' no script errors', not errors, errors[:3])
        ctx.close()

    # ---------- pricing content ----------
    ctx = browser.new_context(viewport={'width': 1440, 'height': 900}); page = ctx.new_page()
    page.goto(BASE + '/pricing.html'); page.wait_for_selector('#pvRows tr')
    txt = page.inner_text('main')
    check('pricing shows $59.99 a month and $499 a year', '$59.99' in txt and '$499' in txt and '$41.58' in txt and '$220.88' in txt, txt[:200])
    check('no canceled prices anywhere on pricing', '19.99' not in txt and '$149' not in txt and '12.42' not in txt)
    check('preview rows are real and nameless', page.locator('#pvRows tr').count() == 5 and page.locator('#pvRows .blur').count() == 5)
    ctx.close()

    # ---------- rankings filters ----------
    ctx = browser.new_context(viewport={'width': 1440, 'height': 900}); page = ctx.new_page()
    page.goto(BASE + '/cappers.html'); page.wait_for_selector('#rows tr td:nth-child(5)')
    n0 = page.inner_text('#count')
    page.select_option('#fSport', 'NFL'); page.wait_for_timeout(200)
    check('sport filter narrows and labels', 'NFL records only' in page.inner_text('#count') and page.is_disabled('#fTime'), page.inner_text('#count'))
    page.select_option('#fSport', ''); page.select_option('#fTime', 'r30'); page.wait_for_timeout(200)
    check('timeframe filter', 'Last 30 days' in page.inner_text('#count'), page.inner_text('#count'))
    page.select_option('#fTime', 'all'); page.select_option('#fRoi', '10'); page.wait_for_timeout(200)
    rois = [float(x.replace('%', '').replace('+', '')) for x in page.eval_on_selector_all('#rows tr td:nth-child(8)', 'els => els.map(e => e.innerText)') if '%' in x]
    check('ROI filter respected', rois and min(rois) >= 10, rois[:5])
    page.click('#reset'); page.fill('#q', target[:4]); page.wait_for_timeout(400)
    check('search by capper ID', page.locator('#rows tr').count() >= 1 and target[:4].upper() in page.inner_text('#rows'), page.inner_text('#count'))
    check('Pro filters locked for free users', page.is_disabled('#fClv') and page.is_disabled('#fZ'))
    ctx.close()

    # ---------- free data boundary ----------
    ctx = browser.new_context(viewport={'width': 1440, 'height': 900}); page = ctx.new_page()
    key_calls = []
    page.on('response', lambda r: key_calls.append(r.status) if '/api/pro/key' in r.url else None)
    page.goto(BASE + '/capper.html?id=' + target); page.wait_for_selector('.kpis'); page.wait_for_timeout(800)
    handle_probe = page.evaluate("fetch('/api/pro/key?id=%s').then(r => r.status)" % target)
    check('free visitor is refused a Pro key', handle_probe == 401, handle_probe)
    check('free profile shows hidden name and locked pick log', page.locator('#pname .blur').count() == 1 and page.locator('#picks .locked').count() == 1)
    blob = page.evaluate("fetch('data/x/%s.bin').then(r => r.text())" % target)
    check('Pro file is ciphertext', not re.search(r'handle|picks|https?:', blob))
    ctx.close()

    # ---------- subscription journey, Pro unlock, cancel ----------
    for vname in ('desktop', 'phone'):
        w, h = VIEWS[vname]
        ctx = browser.new_context(viewport={'width': w, 'height': h}); page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(BASE + '/pricing.html'); page.wait_for_selector('#buyerEmail', state='visible')
        page.fill('#buyerEmail', 'ui-%s@example.com' % vname)
        page.click('[data-plan=monthly]'); page.wait_for_url(re.compile(r'/__stripe/checkout'))
        page.fill('input[name=email]', 'ui-%s@example.com' % vname)
        page.click('button'); page.wait_for_url(re.compile(r'/account\.html$'), timeout=15000)
        page.wait_for_selector('#acct .notice.ok')
        check(vname + ' checkout lands on account as Pro', 'watchdog pro' in page.inner_text('#acct').lower() and '$59.99 a month' in page.inner_text('#acct'))
        shot(page, '%s_account_pro' % vname)
        page.goto(BASE + '/capper.html?id=' + target); page.wait_for_selector('#plB tr', timeout=15000)
        name = page.inner_text('#pname')
        check(vname + ' Pro profile shows the handle', name and name != 'Hidden handle' and page.locator('#pname .blur').count() == 0, name)
        rows = page.locator('#plB tr').count()
        check(vname + ' Pro pick log renders a page of picks', rows >= 1 and 'graded picks' in page.inner_text('#picks'), rows)
        layout(page, vname + ' Pro profile')
        page.locator('#picks').scroll_into_view_if_needed()
        shot(page, '%s_profile_pro' % vname, full=False)
        page.goto(BASE + '/cappers.html'); page.wait_for_function("document.querySelector('#rows .blur') === null", timeout=15000)
        check(vname + ' Pro rankings show handles and enable Pro filters', not page.is_disabled('#fClv'))
        if vname == 'desktop':
            boxes = page.locator('input.pick')
            boxes.nth(0).check(); boxes.nth(1).check()
            page.click('#cmpBtn'); page.wait_for_selector('.cmpt')
            check('compare shows two named columns', page.locator('.cmpt thead th').count() == 3)
            shot(page, 'desktop_compare_pro')
        # cancel through the (fake) Stripe portal; access stays until period end, ending removes it
        page.goto(BASE + '/account.html'); page.wait_for_selector('#bill'); page.click('#bill')
        page.wait_for_url(re.compile(r'/__stripe/portal')); page.click('text=End subscription now')
        page.wait_for_url(re.compile(r'/account\.html')); page.wait_for_selector('#acct .lock')
        check(vname + ' ended subscription shows Free', 'free' in page.inner_text('#acct .lock').lower())
        page.goto(BASE + '/capper.html?id=' + target); page.wait_for_selector('.kpis'); page.wait_for_timeout(800)
        check(vname + ' after cancel the name is hidden again', page.locator('#pname .blur').count() == 1)
        check(vname + ' no script errors in Pro journey', not errors, errors[:3])
        ctx.close()
    browser.close()

for s, n in results:
    print(s, n)
bad = [r for r in results if r[0] == 'FAIL']
print('%d passed, %d failed' % (len(results) - len(bad), len(bad)))
sys.exit(1 if bad else 0)
