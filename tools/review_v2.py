"""Local preview of a v2 review: python tools/review_v2.py content/reviews_v2/<slug>.json <out_dir>"""
import json, os, re, shutil, sys, urllib.request

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
import build as B  # noqa: E402
import reviewv2 as R  # noqa: E402


def main():
    rev = json.load(open(sys.argv[1], encoding='utf-8'))
    out = sys.argv[2]
    names = {r['slug']: r['name'] for r in json.load(open(os.path.join(HERE, 'content', 'reviews.json'), encoding='utf-8'))['reviews']}
    os.makedirs(os.path.join(out, 'reviews'), exist_ok=True)
    for f in ('style.css', 'review2.css', 'favicon.svg', 'stadium.svg', 'track.js'):
        shutil.copy(os.path.join(HERE, f), os.path.join(out, f))
    cappers = json.load(urllib.request.urlopen('https://handicapperwatchdog.com/data/index.json', timeout=60))['cappers']
    html = R.render(rev, R.board_stats(cappers), names, B._document)
    assert not re.search('[–—]', html), 'dash in output'
    with open(os.path.join(out, 'reviews', rev['slug'] + '.html'), 'w', encoding='utf-8', newline='
') as f:
        f.write(html)
    print(os.path.join(out, 'reviews', rev['slug'] + '.html'))


if __name__ == '__main__':
    main()
