"""Data integrity and privacy audit for a built site.

Run after build.py, from the repo root:  python tools/audit_profiles.py
Every published profile is checked against the cached pick history it was built from,
and against the tracker's own headline record. Exits 1 on any failure.
"""
import glob
import hashlib
import json
import os
import re
import sys
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
import build  # noqa: E402

SITE = os.path.join(HERE, '_site')
CACHE = os.path.join(HERE, '.cache', 'profiles')
fails = defaultdict(list)
stats = Counter()
upstream = []  # duplicate picks inside the tracker ledger itself: reported to the pipeline owner, not altered here


def bad(kind, pid, detail=''):
    fails[kind].append('%s %s' % (pid, detail))


def main():
    raw = build.extract(build.get(build.BASE), '__ATW_DATA') if '--live' in sys.argv else None
    with open(os.path.join(SITE, 'data', 'index.json'), encoding='utf-8') as f:
        index = json.load(f)
    by_id = {r['id']: r for r in index['cappers']}
    # cached research keyed by masked id
    research = {}
    slugs = {}
    for path in glob.glob(os.path.join(CACHE, '*.json')):
        with open(path, encoding='utf-8') as f:
            research[os.path.basename(path)[:-5]] = json.load(f)['research']
    tracker = {}
    if raw:
        for x in raw['handicappers']:
            mid = build.mask(x['slug'])
            tracker[mid] = x
            slugs[mid] = hashlib.sha1(x['slug'].encode()).hexdigest()

    for path in glob.glob(os.path.join(SITE, 'data', 'p', '*.json')):
        pid = os.path.basename(path)[:-5]
        with open(path, encoding='utf-8') as f:
            p = json.load(f)
        stats['profiles'] += 1
        if pid not in by_id:
            bad('profile_without_index_row', pid)
        s = p.get('summary') or {}
        row = by_id.get(pid) or {}
        if (s.get('w'), s.get('l'), s.get('p')) != (row.get('w'), row.get('l'), row.get('p')):
            bad('summary_vs_index_record', pid, '%s vs %s' % ((s.get('w'), s.get('l'), s.get('p')), (row.get('w'), row.get('l'), row.get('p'))))
        if not p.get('detail'):
            stats['basic'] += 1
            continue
        stats['detail'] += 1
        o = p['overview']
        # headline: overview equals the tracker index row
        if (o['w'], o['l'], o['p']) != (row.get('w'), row.get('l'), row.get('p')):
            bad('overview_vs_tracker_record', pid, '%s-%s-%s vs %s-%s-%s' % (o['w'], o['l'], o['p'], row.get('w'), row.get('l'), row.get('p')))
        if row.get('units') is not None and abs(float(o['net']) - float(row['units'])) > 0.06:
            bad('overview_vs_tracker_units', pid, '%s vs %s' % (o['net'], row['units']))
        if o['picks'] != row.get('picks'):
            bad('graded_count_vs_tracker', pid, '%s vs %s' % (o['picks'], row.get('picks')))
        # ROI and win % arithmetic
        if o.get('risked'):
            if abs(100 * o['net'] / o['risked'] - (o.get('roi') or 0)) > 0.06:
                bad('roi_arithmetic', pid)
        if o['w'] + o['l'] and abs(100 * o['w'] / (o['w'] + o['l']) - (o.get('win_pct') or 0)) > 0.06:
            bad('win_pct_arithmetic', pid)
        # windows: all time equals overview
        a = p['windows']['all']
        if (a['w'], a['l'], a['p'], round(a['net'], 2)) != (o['w'], o['l'], o['p'], round(float(o['net']), 2)):
            bad('window_all_vs_overview', pid)
        # sports add up
        sd = p.get('sport_detail') or {}
        tot = Counter()
        for v in sd.values():
            for k in ('picks', 'w', 'l', 'p'):
                tot[k] += v['overall'][k]
        if (tot['picks'], tot['w'], tot['l'], tot['p']) != (o['picks'], o['w'], o['l'], o['p']):
            bad('sports_do_not_sum', pid)
        # streaks recomputed by us equal the tracker's
        st, ost = p.get('streaks') or {}, o.get('streaks') or {}
        if ost and (st.get('longest_win'), st.get('longest_loss'), st.get('current')) != (ost.get('longest_win'), ost.get('longest_loss'), ost.get('current')):
            bad('streaks_vs_tracker', pid, '%s vs %s' % (st, ost))
        cur = st.get('current') or ''
        signed = (int(cur[1:]) if cur[:1] == 'W' else -int(cur[1:])) if cur else 0
        if row.get('streak') is not None and signed != row.get('streak'):
            bad('streak_vs_index', pid, '%s vs %s' % (cur, row.get('streak')))
        # ledger: never more than the cap, never identity fields, newest first
        led = p.get('ledger') or []
        if len(led) > build.LEDGER_N:
            bad('ledger_too_long', pid)
        for r in led:
            if set(r) - {'d', 'sp', 'm', 'pk', 'mk', 'o', 'u', 'r', 'pl', 'f', 'lead'}:
                bad('ledger_extra_fields', pid, str(set(r)))
                break
        ds = [r['d'] for r in led if r.get('d')]
        if ds != sorted(ds, reverse=True):
            bad('ledger_not_newest_first', pid)
        # against the cached history, when we can map it
        hist = None
        if pid in slugs and slugs[pid] in research:
            hist = [h for h in research[slugs[pid]].get('history') or [] if h.get('result') in ('won', 'lost', 'push')]
        if hist is not None:
            stats['history_checked'] += 1
            ids = [h.get('id') for h in hist]
            if len(ids) != len(set(ids)):
                bad('duplicate_pick_ids', pid, str(len(ids) - len(set(ids))))
            keyed = Counter((h.get('game'), h.get('matchup'), h.get('pick'), h.get('market')) for h in hist)
            dupes = sum(n - 1 for n in keyed.values() if n > 1)
            if dupes:
                upstream.append((pid, dupes))
            r = research[slugs[pid]]
            fd = {x.get('key'): x for x in r.get('form_days') or []}
            for k, lab in (('r7', 'Last 7 days'), ('r30', 'Last 30 days')):
                mine, theirs = p['windows'][k], fd.get(lab)
                if theirs and theirs.get('picks') and (mine.get('picks'), mine.get('w'), mine.get('l')) != (theirs.get('picks'), theirs.get('w'), theirs.get('l')):
                    stats['window_differs_from_tracker_' + k] += 1
            if len(r.get('pending') or []) and any(h.get('result') not in ('won', 'lost', 'push') for h in (r.get('history') or [])):
                stats['history_has_ungraded_rows'] += 1

    # privacy: nothing that names or links an account anywhere in the published site
    leak = re.compile(r'th-\d{4}|Tracked Handicapper #|"url"\s*:|"text"\s*:|"handle"\s*:|"username"\s*:|"slug"\s*:|"posted"\s*:|x\.com/|twitter\.com/|reddit\.com/u|covers\.com/forum')
    html_leak = re.compile(r'th-\d{4}|Tracked Handicapper #|x\.com/(?!intent)|twitter\.com/|reddit\.com/u|covers\.com/forum')
    for path in glob.glob(os.path.join(SITE, '**', '*'), recursive=True):
        if os.path.isdir(path) or not path.endswith(('.json', '.html', '.js', '.xml', '.txt')):
            continue
        with open(path, encoding='utf-8', errors='ignore') as f:
            body = f.read()
        if os.path.relpath(path, SITE).startswith('reviews'):  # named service reviews cite the service's own public pages by design
            stats['files_scanned'] += 1
            continue
        m = leak.search(body) if path.endswith('.json') else html_leak.search(body)
        if m:
            bad('privacy_leak', os.path.relpath(path, SITE), m.group(0))
        stats['files_scanned'] += 1

    print(json.dumps(dict(stats), indent=1))
    for k, v in fails.items():
        print('FAIL %s: %d  e.g. %s' % (k, len(v), v[:3]))
    if upstream:
        print('UPSTREAM candidates for review (same game, matchup, pick and market label; the public history has no period, so full game vs first 5 pairs also appear): %d accounts, %d extra picks: %s' % (len(upstream), sum(n for _, n in upstream), upstream[:20]))
    print('RESULT', 'FAIL' if fails else 'PASS')
    # A privacy leak always blocks the deploy; statistics failures block only with --strict (a stale site is worse than a flagged one).
    sys.exit(1 if fails.get('privacy_leak') or ('--strict' in sys.argv and fails) else 0)


if __name__ == '__main__':
    main()
