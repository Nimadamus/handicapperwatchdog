"""Local preview of the homepage with real published data. Nothing is deployed.

    python tools/preview_home.py            build _preview/ from the working tree + the live public index
    python tools/preview_home.py --serve    build, then serve it on http://127.0.0.1:8791/

The working tree's static files are stamped by build.stamp_public_pages with the live data/index.json, exactly as the
real build does. Anything the working tree does not produce (profiles, home.json, pricing) is read from the live site.
"""
import json
import os
import shutil
import sys
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, '_preview')
LIVE = 'https://handicapperwatchdog.com/'
PORT = 8791
sys.path.insert(0, ROOT)


def fetch(path):
    base = 'https://api.handicapperwatchdog.com/' if path.startswith('/api/') else LIVE  # anonymous reads only
    req = urllib.request.Request(base + path.lstrip('/'), headers={'User-Agent': 'hwd-preview'})
    with urllib.request.urlopen(req, timeout=40) as r:
        return r.read(), r.headers.get('Content-Type') or 'application/octet-stream'


def write_options():
    """Two layout options from the same stamped page: a.html (compact) and b.html (editorial). Preview only."""
    with open(os.path.join(OUT, 'index.html'), encoding='utf-8') as f:
        page = f.read()
    a = page.replace('<body data-page="home">', '<body data-page="home" class="lay-a">', 1)
    # compact cards carry no footnote of their own: the three notes move into one line under the row
    import re
    x0 = a.index('<section class="xsec" id="explore"'); x1 = a.index('<p class="tagline">', x0)
    block = a[x0:x1]
    notes = re.findall(r'\s*<p class="xnote">(.*?)</p>', block, re.S)
    block = re.sub(r'\s*<p class="xnote">.*?</p>', '', block, flags=re.S)
    cut = block.rindex('</div>')
    block = block[:cut] + '  <p class="xnote xfoot">%s</p>\n    ' % ' '.join(notes) + block[cut:]
    assert len(notes) == 3
    a = a[:x0] + block + a[x1:]
    b = page.replace('<body data-page="home">', '<body data-page="home" class="lay-b">', 1)
    s0 = b.index('  <section class="band stats" id="records"'); s1 = b.index('  <section class="band claims"')
    stats = b[s0:s1]; b = b[:s0] + b[s1:]
    e0 = b.index('  <section class="xsec" id="explore"'); b = b[:e0] + stats + b[e0:]
    for name, html in (('a.html', a), ('b.html', b)):
        assert 'class="lay-' in html
        with open(os.path.join(OUT, name), 'w', encoding='utf-8') as f:
            f.write(html)


def build_preview():
    import build
    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    os.makedirs(os.path.join(OUT, 'data'))
    for name in build.STATIC:
        src = os.path.join(ROOT, name)
        if os.path.exists(src) and name not in ('CNAME', 'sitemap.xml', 'robots.txt'):
            shutil.copy(src, OUT)
    body, _ = fetch('data/index.json')
    with open(os.path.join(OUT, 'data', 'index.json'), 'wb') as f:
        f.write(body)
    build.stamp_public_pages(OUT)
    write_options()
    doc = json.loads(body)
    print('preview built from live index of', doc['meta'].get('built_at'), '->', OUT)


class Handler(SimpleHTTPRequestHandler):
    cache = {}

    def __init__(self, *a, **k):
        super().__init__(*a, directory=OUT, **k)

    def log_message(self, fmt, *args):
        pass

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_GET(self):
        path = self.path.split('?')[0].split('#')[0]
        local = self.translate_path(path)
        if os.path.isfile(local) or os.path.isfile(os.path.join(local, 'index.html')):
            return super().do_GET()
        try:
            if path not in self.cache:
                self.cache[path] = fetch(path)
            body, ctype = self.cache[path]
        except Exception:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == '__main__':
    build_preview()
    if '--serve' in sys.argv:
        print('serving http://127.0.0.1:%d/' % PORT, flush=True)
        ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
