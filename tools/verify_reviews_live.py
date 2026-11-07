"""Live check of v2 review pages: python tools/verify_reviews_live.py <slug> [<slug> ...]

Per page: HTTP 200, v2 template, title and description lengths, self canonical, og:url, JSON-LD parses,
one h1, no noindex, no Pro data references, every internal link resolves, no horizontal scroll at
390 and 1366 px.
"""
import json, re, sys, urllib.request
from urllib.parse import urljoin
from playwright.sync_api import sync_playwright

ROOT = 'https://handicapperwatchdog.com/reviews/'
UA = {'User-Agent': 'hwd-review-check/1.0'}


def status(u):
    try:
        return urllib.request.urlopen(urllib.request.Request(u, headers=UA, method='HEAD'), timeout=30).status
    except Exception as e:
        return getattr(e, 'code', 0)


def main(slugs):
    fails, link_cache = [], {}
    with sync_playwright() as p:
        b = p.chromium.launch()
        for slug in slugs:
            url = ROOT + slug + '.html'
            h = urllib.request.urlopen(urllib.request.Request(url + '?v=check', headers=UA), timeout=30).read().decode('utf-8')
            t = re.search(r'<title>([^<]*)', h).group(1)
            d = re.search(r'name="description" content="([^"]*)', h).group(1)
            can = re.search(r'rel="canonical" href="([^"]*)', h).group(1)
            ogu = re.search(r'property="og:url" content="([^"]*)', h).group(1)
            ld = [json.loads(x) for x in re.findall(r'<script type="application/ld\+json">(.*?)</script>', h, re.S)]
            errs = []
            if 'review2.css' not in h: errs.append('not v2')
            if not 20 <= len(t) <= 70: errs.append('title len %d' % len(t))
            if not 110 <= len(d) <= 165: errs.append('desc len %d' % len(d))
            if can != url or ogu != url: errs.append('canonical/og %s %s' % (can, ogu))
            if not ld: errs.append('no json-ld')
            if h.count('<h1') != 1: errs.append('h1 x%d' % h.count('<h1'))
            if 'noindex' in h.lower(): errs.append('noindex')
            if re.search(r'data/x/|pending\.bin|/api/pro', h): errs.append('pro data ref')
            if re.search('[–—]', re.sub(r'<[^>]+>', ' ', h)): errs.append('dash')
            links = {urljoin(url, x) for x in re.findall(r'href="([^"#]+)"', h)}
            internal = sorted(x for x in links if x.startswith('https://handicapperwatchdog.com/'))
            for x in internal:
                if x not in link_cache:
                    link_cache[x] = status(x)
                if link_cache[x] != 200: errs.append('link %s %s' % (link_cache[x], x))
            for w in (390, 1366):
                pg = b.new_page(viewport={'width': w, 'height': 900})
                pg.goto(url, wait_until='networkidle')
                sw = pg.evaluate('document.documentElement.scrollWidth')
                if sw > w: errs.append('scroll %d at %d' % (sw, w))
                pg.close()
            print('%-22s %s  title=%d desc=%d links=%d' % (slug, 'PASS' if not errs else 'FAIL ' + '; '.join(errs), len(t), len(d), len(internal)))
            fails += errs
        b.close()
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main(sys.argv[1:])
