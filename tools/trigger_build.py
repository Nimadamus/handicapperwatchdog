"""Backup trigger for the site's 'Build and deploy' workflow.

The workflow's own GitHub schedule (every 30 minutes) is the primary, cloud side refresh; it began firing at
17:31 UTC on 2026-10-24, two hours after the workflow was added. The laptop task HWD Site Refresh runs this every
30 minutes and only starts a build when GitHub has not started one in the last 50 minutes, so the site keeps
refreshing if the schedule stalls, without doubling builds when it works. Token: the GitHub credential git uses.
"""
import json
import subprocess
import sys
import urllib.request
from datetime import datetime, timezone

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
last = max((datetime.fromisoformat(r['created_at'].replace('Z', '+00:00')) for r in runs['workflow_runs']), default=None)
age = (datetime.now(timezone.utc) - last).total_seconds() / 60 if last else 1e9
if busy:
    print(stamp, 'skip: run already', busy[0]['status'])
elif age < 50:
    print(stamp, 'skip: last run %.0f min ago' % age)
else:
    status, _ = api('actions/workflows/refresh.yml/dispatches', 'POST', {'ref': 'main'})
    print(stamp, 'dispatched', status)
