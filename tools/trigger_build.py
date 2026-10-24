"""Starts the site's 'Build and deploy' workflow on GitHub (the same run the 30 minute schedule should start).

GitHub has not been firing this repo's cron schedule, so the scheduled task HWD Site Refresh runs this every
30 minutes instead. It skips when a run is already queued or in progress. Token: the GitHub credential git uses.
"""
import json
import subprocess
import sys
import urllib.request
from datetime import datetime

REPO = 'Nimadamus/handicapperwatchdog'


def token():
    out = subprocess.run(['git', 'credential', 'fill'], input='protocol=https\nhost=github.com\n\n', capture_output=True, text=True,
                         creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0)).stdout
    for line in out.splitlines():
        if line.startswith('password='):
            return line[9:]
    sys.exit('no GitHub credential')


def api(path, method='GET', body=None):
    req = urllib.request.Request('https://api.github.com/repos/%s/%s' % (REPO, path), method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={'Authorization': 'Bearer ' + T, 'Accept': 'application/vnd.github+json'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status, (json.loads(r.read() or b'null') if r.status != 204 else None)


T = token()
_, runs = api('actions/workflows/refresh.yml/runs?per_page=5')
busy = [r for r in runs['workflow_runs'] if r['status'] in ('queued', 'in_progress', 'waiting', 'pending')]
stamp = datetime.now().strftime('%Y-%m-%d %H:%M')
if busy:
    print(stamp, 'skip: run already', busy[0]['status'])
else:
    status, _ = api('actions/workflows/refresh.yml/dispatches', 'POST', {'ref': 'main'})
    print(stamp, 'dispatched', status)
