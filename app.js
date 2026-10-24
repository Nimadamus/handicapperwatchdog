(function () {
  var page = document.body.getAttribute('data-page');
  var fmt = function (n) { return Number(n).toLocaleString('en-US'); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var signed = function (v, d, suf) { if (v == null) return '<span class="muted">n/a</span>'; var n = Number(v); return '<span class="' + (n > 0 ? 'win' : n < 0 ? 'loss' : '') + '">' + (n > 0 ? '+' : '') + n.toFixed(d) + (suf || '') + '</span>'; };
  var streak = function (s) { return s > 0 ? '<span class="win">W' + s + '</span>' : s < 0 ? '<span class="loss">L' + (-s) + '</span>' : '<span class="muted">0</span>'; };
  var PER = 50, pageNo = 1, all = [], view = [];

  function row(r, i) {
    var link = r.profile ? 'capper.html?id=' + encodeURIComponent(r.id) : null;
    return '<tr' + (link ? ' class="go" data-href="' + link + '"' : '') + '><td class="l rank">' + i + '</td>' +
      '<td class="l"><div class="who"><span class="masked" aria-label="Name hidden">Capper ' + esc(r.id.slice(0, 4).toUpperCase()) + '</span>' +
      '<small>' + esc(r.source) + ' · ' + r.sports.slice(0, 3).map(esc).join(', ') + '</small></div></td>' +
      '<td class="hm">' + fmt(r.picks) + '</td><td>' + r.w + '-' + r.l + (r.p ? '-' + r.p : '') + '</td>' +
      '<td class="hm">' + (r.win_pct == null ? 'n/a' : Number(r.win_pct).toFixed(1) + '%') + '</td><td>' + signed(r.units, 2) + '</td>' +
      '<td class="hm">' + signed(r.roi, 1, '%') + '</td><td class="hm">' + streak(r.streak) + '</td></tr>';
  }

  function draw() {
    var start = (pageNo - 1) * PER, rows = view.slice(start, start + PER);
    document.getElementById('rows').innerHTML = rows.length ? rows.map(function (r, i) { return row(r, start + i + 1); }).join('') :
      '<tr><td colspan="8" class="muted">No cappers match these filters.</td></tr>';
    var c = document.getElementById('count'); if (c) c.textContent = fmt(view.length) + ' cappers';
    var pg = document.getElementById('pg'); if (pg) pg.textContent = 'Page ' + pageNo + ' of ' + Math.max(1, Math.ceil(view.length / PER));
  }

  function apply() {
    var sp = val('fSport'), so = val('fSource'), min = +val('fMin') || 1, sort = val('fSort') || 'units';
    view = all.filter(function (r) { return r.picks >= min && (!sp || r.sports.indexOf(sp) >= 0) && (!so || r.source === so); });
    var key = sort === 'worst' ? 'units' : sort, dir = sort === 'worst' ? 1 : -1;
    view.sort(function (a, b) {
      var x = a[key], y = b[key];
      if (x == null) return 1; if (y == null) return -1;
      return (x < y ? -1 : x > y ? 1 : 0) * dir;
    });
    pageNo = 1; draw();
  }
  function val(id) { var e = document.getElementById(id); return e ? e.value : ''; }

  document.addEventListener('click', function (e) {
    var tr = e.target.closest && e.target.closest('tr.go'); if (tr) location.href = tr.getAttribute('data-href');
  });

  fetch('data/index.json?v=' + Date.now()).then(function (r) { return r.json(); }).then(function (d) {
    var m = d.meta; all = d.cappers;
    var vals = { tracked: fmt(m.tracked), graded_picks: fmt(m.graded_picks), profiles: fmt(m.profiles),
      pct: m.qualified ? Math.round(100 * m.profitable / m.qualified) + '%' : 'n/a',
      fresh: fmt(m.tracked) + ' cappers. Updated ' + new Date(m.built_at).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' PT.' };
    document.querySelectorAll('[data-k]').forEach(function (el) { var k = el.getAttribute('data-k'); if (k in vals) el.textContent = vals[k]; });
    if (page === 'home') {
      view = all.filter(function (r) { return r.picks >= m.min_graded && r.units != null; }).sort(function (a, b) { return b.units - a.units; });
      PER = 15; draw();
      return;
    }
    var sports = {}; all.forEach(function (r) { r.sports.forEach(function (s) { sports[s] = (sports[s] || 0) + 1; }); });
    Object.keys(sports).filter(function (s) { return sports[s] >= 5; }).sort(function (a, b) { return sports[b] - sports[a]; }).forEach(function (s) {
      document.getElementById('fSport').insertAdjacentHTML('beforeend', '<option>' + esc(s) + '</option>'); });
    m.sources.forEach(function (s) { document.getElementById('fSource').insertAdjacentHTML('beforeend', '<option>' + esc(s) + '</option>'); });
    ['fSport', 'fSource', 'fMin', 'fSort'].forEach(function (id) { document.getElementById(id).addEventListener('change', apply); });
    document.getElementById('prev').onclick = function () { if (pageNo > 1) { pageNo--; draw(); scrollTo(0, 0); } };
    document.getElementById('next').onclick = function () { if (pageNo * PER < view.length) { pageNo++; draw(); scrollTo(0, 0); } };
    apply();
  }).catch(function () { document.getElementById('rows').innerHTML = '<tr><td colspan="8" class="muted">Records are refreshing. Try again in a minute.</td></tr>'; });
})();
