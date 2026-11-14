"""Rewrites content/names.bin, the sealed account list build.py uses to show handicapper names (NAMES_20261114).

  python tools/hwd_secrets.py run -- python tools/refresh_names.py           writes the file when the list changed
  python tools/hwd_secrets.py run -- python tools/refresh_names.py --push    also commits and pushes it to main

Reads the tracker's account map with the admin helper from tmr-watchdog-repo (origin/main copy of ops/cloud.py), keeps
only public slug -> [platform, handle, profile link], and seals it with the key build.py derives from HWD_PRO_KEY.
The clear text never touches this repository. An account missing from the file keeps its Watchdog ID on the site.
"""
import json
import os
import subprocess
import sys
import types

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
import build  # noqa: E402

WD_REPO = os.path.join(os.path.expanduser('~'), 'tmr-watchdog-repo')
NO_WINDOW = getattr(subprocess, 'CREATE_NO_WINDOW', 0)


def git(*a, cwd=HERE):
    r = subprocess.run(('git',) + a, cwd=cwd, capture_output=True, text=True, encoding='utf-8', creationflags=NO_WINDOW)
    if r.returncode:
        sys.exit('git %s failed: %s' % (a[0], r.stderr.strip()[-300:]))
    return r.stdout


def tracker_map():
    git('fetch', '-q', 'origin', cwd=WD_REPO)
    cloud = types.ModuleType('cloud')
    cloud.__file__ = os.path.join(WD_REPO, 'ops', 'cloud.py')
    exec(compile(git('show', 'origin/main:ops/cloud.py', cwd=WD_REPO), cloud.__file__, 'exec'), cloud.__dict__)
    return json.loads(cloud.call('/api/file?path=app/raw/anon_map.json', timeout=180))


def main():
    if not build.PRO_KEY:
        sys.exit('HWD_PRO_KEY is not set: run through tools/hwd_secrets.py run --')
    records = tracker_map().get('records') or {}
    names = {}
    for n, rec in records.items():
        handle, plat = rec.get('handle') or rec.get('uname'), rec.get('platform')
        if handle and plat in build.PLATFORM_LABEL:
            names['th-%04d' % int(n)] = [plat, str(handle), rec.get('profile_url') or None]
    if len(names) < 1000:
        sys.exit('only %d names read: refusing to write a short list' % len(names))
    try:
        with open(build.NAMES_FILE, encoding='ascii') as f:
            old = build.unseal('names', f.read().strip())
    except Exception:
        old = None
    if old == names:
        print('names unchanged: %d accounts' % len(names))
        return
    with open(build.NAMES_FILE, 'w', encoding='ascii', newline='\n') as f:
        f.write(build.seal('names', names) + '\n')
    print('names written: %d accounts (%s before)' % (len(names), len(old) if old else 'none'))
    if '--push' in sys.argv:
        git('add', 'content/names.bin')
        git('commit', '-q', '-m', 'Names: refresh the sealed account list (%d accounts)' % len(names))
        git('push', '-q', 'origin', 'HEAD:main')
        print('pushed')


if __name__ == '__main__':
    main()
