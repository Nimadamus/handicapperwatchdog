(function () {
  'use strict';
  var box = document.getElementById('cmp');
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var sgn = function (v, d, suf) { if (v == null) return '<span class="dim">n/a</span>'; var n = +v; return '<span class="' + (n > 0 ? 'pos' : n < 0 ? 'neg' : '') + '">' + (n > 0 ? '+' : '') + n.toFixed(d) + (suf || '') + '</span>'; };
  var pct = function (v) { return v == null ? '<span class="dim">n/a</span>' : (+v).toFixed(1) + '%'; };
  var ids = (new URLSearchParams(location.search).get('ids') || '').split(',').filter(function (x) { return /^[0-9a-f]{10}$/.test(x); }).slice(0, 4);

  HWD.ready.then(function (s) {
    if (!s.pro) {
      box.innerHTML = '<div class="pb center" style="padding:40px 20px"><span class="lock">Watchdog Pro</span><h2 style="margin:10px 0 6px">Side by side comparisons are part of Watchdog Pro</h2>' +
        '<p class="muted" style="margin:0 0 16px">Compare records, form, prices and consistency for up to four handicappers, with their names.</p><a class="btn pro" href="pricing.html">See Watchdog Pro</a></div>';
      return;
    }
    Promise.all([fetch('data/index.json', { cache: 'no-store' }).then(function (r) { return r.json(); }), HWD.names().catch(function () { return []; })]).then(function (x) {
      var idx = {}; x[0].cappers.forEach(function (c) { idx[c.id] = c; });
      var nm = {}; x[1].forEach(function (n) { nm[n[0]] = n; });
      render(idx, nm);
    });
  });

  function render(idx, nm) {
    var add = '<form class="row" id="af" style="padding:14px 16px;border-bottom:1px solid var(--line)"><input id="aq" placeholder="Add by handle or 4 character ID" aria-label="Add handicapper" style="flex:1;height:36px;background:var(--bg2);border:1px solid var(--line);border-radius:8px;padding:0 10px">' +
      '<button class="btn sm" type="submit"' + (ids.length >= 4 ? ' disabled' : '') + '>Add</button></form><p class="muted small" id="am" style="margin:8px 16px 0"></p>';
    if (!ids.length) { box.innerHTML = add + '<div class="empty">Add up to four handicappers to compare.</div>'; hook(idx, nm); return; }
    Promise.all(ids.map(function (id) { return idx[id] && idx[id].profile ? fetch('data/p/' + id + '.json').then(function (r) { return r.json(); }).catch(function () { return null; }) : null; })).then(function (ps) {
      var cols = ids.map(function (id, i) { return { id: id, c: idx[id], p: ps[i], n: nm[id] }; }).filter(function (o) { return o.c; });
      var row = function (label, f) { return '<tr><td class="l">' + label + '</td>' + cols.map(function (o) { return '<td>' + f(o) + '</td>'; }).join('') + '</tr>'; };
      var best = function (o) { var sd = o.p && o.p.sport_detail || {}; var k = Object.keys(sd).filter(function (s) { return sd[s].overall.picks >= 10; }).sort(function (a, b) { return sd[b].overall.net - sd[a].overall.net; })[0]; return k ? esc(k) + ' ' + sgn(sd[k].overall.net, 1, 'u') : '<span class="dim">n/a</span>'; };
      box.innerHTML = add + '<div class="tw"><table class="mini cmpt"><thead><tr><th class="l">Handicapper</th>' + cols.map(function (o) {
        return '<th><a href="capper.html?id=' + o.id + '" style="color:var(--ink)">' + esc(o.n ? o.n[1] : 'ID ' + o.id.slice(0, 4).toUpperCase()) + '</a><br><span class="dim small">' + esc(o.n && o.n[2] ? o.n[2] : '') + '</span> <a href="#" data-rm="' + o.id + '" class="dim small">remove</a></th>'; }).join('') + '</tr></thead><tbody>' +
        row('Record', function (o) { return o.c.w + '-' + o.c.l + (o.c.p ? '-' + o.c.p : ''); }) + row('Graded picks', function (o) { return o.c.picks; }) +
        row('Units', function (o) { return sgn(o.c.units, 2); }) + row('ROI', function (o) { return sgn(o.c.roi, 1, '%'); }) + row('Win %', function (o) { return pct(o.c.win_pct); }) +
        row('Last 30 days', function (o) { return o.c.r30 ? sgn(o.c.r30.net, 2) + ' <span class="dim small">' + o.c.r30.picks + ' picks</span>' : '<span class="dim">n/a</span>'; }) +
        row('Last 7 days', function (o) { return o.c.r7 ? sgn(o.c.r7.net, 2) + ' <span class="dim small">' + o.c.r7.picks + ' picks</span>' : '<span class="dim">n/a</span>'; }) +
        row('Current streak', function (o) { return o.c.streak > 0 ? '<span class="pos">W' + o.c.streak + '</span>' : o.c.streak < 0 ? '<span class="neg">L' + (-o.c.streak) + '</span>' : '0'; }) +
        row('Avg odds', function (o) { var a = o.p && o.p.overview && o.p.overview.avg_odds; return a == null ? '<span class="dim">n/a</span>' : (a > 0 ? '+' : '') + a; }) +
        row('Max drawdown', function (o) { return sgn(o.c.mdd, 2, 'u'); }) + row('Beat closing line', function (o) { return o.c.clv_beat == null ? '<span class="dim">n/a</span>' : pct(o.c.clv_beat) + ' <span class="dim small">of ' + o.c.clv_n + '</span>'; }) +
        row('Z score vs break even', function (o) { return sgn(o.c.z, 2); }) + row('Profitable months', function (o) { return o.c.months ? o.c.months_up + ' of ' + o.c.months : '<span class="dim">n/a</span>'; }) +
        row('Best sport', best) + row('Tracked since', function (o) { return esc(o.c.first_pick || 'n/a'); }) +
        '</tbody></table></div>';
      box.querySelectorAll('[data-rm]').forEach(function (a) { a.onclick = function (e) { e.preventDefault(); go(ids.filter(function (x) { return x !== a.getAttribute('data-rm'); })); }; });
      hook(idx, nm);
    });
  }
  function go(list) { location.search = list.length ? '?ids=' + list.join(',') : ''; }
  function hook(idx, nm) {
    var f = document.getElementById('af'); if (!f) return;
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var q = document.getElementById('aq').value.trim().toLowerCase(), hit = null;
      Object.keys(idx).some(function (id) { if (id.slice(0, 4) === q || id === q) { hit = id; return true; } return false; });
      if (!hit) Object.keys(nm).some(function (id) { if (String(nm[id][1]).toLowerCase() === q.replace(/^@/, '')) { hit = id; return true; } return false; });
      if (!hit) { document.getElementById('am').textContent = 'No tracked handicapper matches that.'; return; }
      if (ids.indexOf(hit) < 0 && ids.length < 4) go(ids.concat(hit));
    });
  }
})();
