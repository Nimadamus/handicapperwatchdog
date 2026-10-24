(function () {
  'use strict';
  var page = document.body.getAttribute('data-page');
  var PRO = './#pro';
  var $ = function (id) { return document.getElementById(id); };
  var fmt = function (n) { return n == null ? 'n/a' : Number(n).toLocaleString('en-US'); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var sgn = function (v, d, suf) { if (v == null) return '<span class="dim">n/a</span>'; var n = +v; return '<span class="' + (n > 0 ? 'pos' : n < 0 ? 'neg' : '') + '">' + (n > 0 ? '+' : '') + n.toFixed(d) + (suf || '') + '</span>'; };
  var pct = function (v) { return v == null ? '<span class="dim">n/a</span>' : (+v).toFixed(1) + '%'; };
  var strk = function (s) { return s > 0 ? '<span class="st pos">W' + s + '</span>' : s < 0 ? '<span class="st neg">L' + (-s) + '</span>' : '<span class="dim">0</span>'; };
  var code = function (id) { return id.slice(0, 4).toUpperCase(); };
  var TIER = { established: ['est', 'Established'], developing: ['dev', 'Developing'], small: ['sm', 'Small sample'] };
  var DAY = 864e5;

  function spark(pts) {
    if (!pts || pts.length < 2) return '<span class="dim small">building</span>';
    var W = 84, H = 24, mn = Math.min.apply(null, pts.concat(0)), mx = Math.max.apply(null, pts.concat(0)), sp = (mx - mn) || 1;
    var d = pts.map(function (v, i) { return (i ? 'L' : 'M') + (i * W / (pts.length - 1)).toFixed(1) + ' ' + (2 + (mx - v) * (H - 4) / sp).toFixed(1); }).join('');
    var c = pts[pts.length - 1] >= 0 ? 'var(--win)' : 'var(--loss)', z = (2 + mx * (H - 4) / sp).toFixed(1);
    return '<svg class="spark" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" aria-hidden="true"><line x1="0" x2="' + W + '" y1="' + z + '" y2="' + z + '" stroke="var(--line2)" stroke-dasharray="2 3"/><path d="' + d + '" fill="none" stroke="' + c + '" stroke-width="1.6"/></svg>';
  }

  var NAMES = null; // id -> [id, handle, source] once a Pro member's names file is decrypted
  function capCell(r) {
    var t = TIER[r.tier] || TIER.small, n = NAMES && NAMES[r.id];
    return '<div class="cap"><span class="av">' + esc(code(r.id).slice(0, 2)) + '</span><span class="nm"><b>' + (n ? esc(n[1]) : '<span class="blur" aria-label="Name hidden">Hidden name</span>') + '</b>' +
      '<small>ID ' + esc(code(r.id)) + ' · ' + esc(r.source) + ' <span class="badge ' + t[0] + '">' + t[1] + '</span></small></span></div>';
  }

  // metrics for a capper in a view: lifetime, a timeframe (r7/r30) or one sport
  function m(r, time, sport) {
    if (sport) {
      var b = r.bs && r.bs[sport]; if (!b) return null;
      var rec = String(b[4] || '').split('-').map(Number);
      return { picks: b[0], units: b[1], roi: b[2], win_pct: b[3], w: rec[0] || 0, l: rec[1] || 0, p: rec[2] || 0 };
    }
    if (time && time !== 'all') {
      var x = r[time]; if (!x) return null;
      return { picks: x.picks, units: x.net, roi: x.roi, win_pct: x.win_pct, w: x.w, l: x.l, p: x.p };
    }
    return { picks: r.picks, units: r.units, roi: r.roi, win_pct: r.win_pct, w: r.w, l: r.l, p: r.p };
  }
  var recTxt = function (x) { return x.w + '-' + x.l + (x.p ? '-' + x.p : ''); };
  var ago = function (d) { if (!d) return 'n/a'; var n = Math.round((Date.now() - new Date(d + 'T12:00:00Z')) / DAY); return n <= 0 ? 'Today' : n === 1 ? 'Yesterday' : n + 'd ago'; };
  var link = function (r) { return r.profile ? 'capper.html?id=' + encodeURIComponent(r.id) : ''; };

  document.addEventListener('click', function (e) {
    var tr = e.target.closest && e.target.closest('tr.go');
    if (tr && !e.target.closest('a') && !e.target.closest('input')) location.href = tr.getAttribute('data-href');
  });

  fetch('data/index.json?v=' + Math.floor(Date.now() / 6e4)).then(function (r) { return r.json(); }).then(function (d) {
    if (page === 'home') home(d); else if (page === 'rank') rankings(d);
  }).catch(function () {
    var t = $('boardRows') || $('rows'); if (t) t.innerHTML = '<tr><td colspan="11" class="empty">Records are refreshing. Try again in a minute.</td></tr>';
  });

  function sportsByDepth(all, min) {
    var c = {};
    all.forEach(function (r) { Object.keys(r.bs || {}).forEach(function (s) { if (r.bs[s][0] >= min) c[s] = (c[s] || 0) + 1; }); });
    return Object.keys(c).sort(function (a, b) { return c[b] - c[a]; });
  }

  // ---------------- home ----------------
  function home(d) {
    var M = d.meta, all = d.cappers, L = M.live, built = new Date(M.built_at);
    HWD.ready.then(function (s) { if (s.pro) HWD.names().then(function (list) { NAMES = {}; list.forEach(function (n) { NAMES[n[0]] = n; }); draw(); }).catch(function () {}); });
    // live panel: every figure read from the Watchdog stats endpoint at build time
    if (L) {
      var kv = [[fmt(L.accounts_discovered), 'Accounts discovered'], [fmt(L.accounts_monitored), 'Accounts monitored'], [fmt(L.posts_captured), 'Posts scanned'],
        [fmt(L.picks_captured_today), 'Picks captured today'], [fmt(L.graded_picks), 'Picks graded'], [fmt(L.pending_picks), 'Pending picks awaiting games']];
      $('liveGrid').innerHTML = kv.map(function (k) { return '<div class="kv' + (k[2] ? ' hl' : '') + '"><b>' + k[0] + '</b><span>' + k[1] + '' + '</span></div>'; }).join('');
      $('liveAt').textContent = 'Last capture ' + new Date(L.last_capture_at).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' }) + ' PT';
    } else {
      $('liveGrid').innerHTML = '<div class="kv"><b>' + fmt(M.tracked) + '</b><span>Handicappers with a record</span></div><div class="kv"><b>' + fmt(M.graded_picks) + '</b><span>Picks graded</span></div>';
    }

    // quick chips
    var sports = sportsByDepth(all, 10).slice(0, 6);
    $('quick').innerHTML = sports.map(function (s) { return '<a class="chip" href="cappers.html?sport=' + encodeURIComponent(s) + '">' + esc(s) + '</a>'; }).join('') +
      ['X', 'Covers', 'Reddit'].map(function (s) { return '<a class="chip" href="cappers.html?src=' + encodeURIComponent(s) + '">' + s + '</a>'; }).join('');

    // hero highlights: three real leaders, each linked to its profile
    var best = function (f, key) { var c = all.filter(f).map(function (r) { return { r: r, v: key(r) }; }).filter(function (o) { return o.v != null; }); c.sort(function (a, b) { return b.v - a.v; }); return c[0]; };
    var H = [
      ['Best last 7 days', best(function (r) { return r.r7 && r.r7.picks >= 5; }, function (r) { return r.r7.net; }), function (o) { return sgn(o.v, 2, 'u'); }, function (o) { return o.r.r7.w + '-' + o.r.r7.l + ' in ' + o.r.r7.picks + ' picks'; }],
      ['Hottest current streak', best(function (r) { return r.picks >= 20; }, function (r) { return r.streak > 0 ? r.streak : null; }), function (o) { return '<span class="pos">W' + o.v + '</span>'; }, function (o) { return o.r.w + '-' + o.r.l + ' overall'; }],
      ['Best ROI, 100+ picks', best(function (r) { return r.picks >= 100; }, function (r) { return r.roi; }), function (o) { return sgn(o.v, 1, '%'); }, function (o) { return fmt(o.r.picks) + ' graded picks'; }]];
    $('highlights').innerHTML = H.filter(function (x) { return x[1]; }).map(function (x) {
      var o = x[1], h = link(o.r);
      return '<a class="hl" ' + (h ? 'href="' + h + '"' : '') + '><div class="eyebrow">' + x[0] + '</div><b>' + x[2](o) + '</b><span>ID ' + esc(code(o.r.id)) + ' · ' + esc(o.r.source) + ' · ' + x[3](o) + '</span></a>';
    }).join('');

    // leaderboard tabs
    var cut = new Date(built - 21 * DAY).toISOString().slice(0, 10);
    var TABS = [
      ['overall', 'Overall', 'all', function (r) { return r.picks >= 20 && r.units != null; }, 'units', 'Handicappers with 20+ graded picks, ranked by units won since tracking began.'],
      ['r30', 'Last 30 days', 'r30', function (r) { return r.r30 && r.r30.picks >= 10; }, 'units', 'Units won over the last 30 days, 10+ graded picks in that window.'],
      ['r7', 'Last 7 days', 'r7', function (r) { return r.r7 && r.r7.picks >= 5; }, 'units', 'Units won over the last 7 days, 5+ graded picks in that window.'],
      ['roi', 'Best ROI', 'all', function (r) { return r.picks >= 50 && r.roi != null; }, 'roi', 'Highest return on units risked, 50+ graded picks.'],
      ['emerging', 'Emerging', 'all', function (r) { return r.first_pick && r.first_pick >= cut && r.picks >= 10 && r.units > 0; }, 'units', 'First graded pick in the last 21 days, 10+ picks and up money so far. Small samples: treat as early signals.'],
      ['active', 'Most active', 'r30', function (r) { return r.r30 && r.r30.picks > 0; }, 'picks', 'Most graded picks over the last 30 days.']];
    var state = { tab: 0, sport: '' };
    $('boardTabs').innerHTML = TABS.map(function (t, i) { return '<button class="tab' + (i ? '' : ' on') + '" data-i="' + i + '">' + t[1] + '</button>'; }).join('');
    sportsByDepth(all, 10).forEach(function (s) { $('boardSport').insertAdjacentHTML('beforeend', '<option>' + esc(s) + '</option>'); });
    $('boardTabs').addEventListener('click', function (e) { var b = e.target.closest('.tab'); if (!b) return; state.tab = +b.getAttribute('data-i'); state.sport = ''; $('boardSport').value = ''; draw(); });
    $('boardSport').addEventListener('change', function () { state.sport = this.value; draw(); });
    $('boardHead').innerHTML = '<tr><th class="l">#</th><th class="l">Handicapper</th><th class="hm l">Trend</th><th class="hm">Picks</th><th>Record</th><th class="hm">Win %</th><th>Units</th><th class="hm">ROI</th><th class="hm">Streak</th><th class="hm">Last pick</th></tr>';

    function draw() {
      var t = TABS[state.tab], rows;
      document.querySelectorAll('#boardTabs .tab').forEach(function (b, i) { b.classList.toggle('on', !state.sport && i === state.tab); });
      if (state.sport) {
        rows = all.map(function (r) { return { r: r, x: m(r, null, state.sport) }; }).filter(function (o) { return o.x && o.x.picks >= 10 && o.x.units != null; });
        rows.sort(function (a, b) { return b.x.units - a.x.units; });
        $('boardNote').textContent = state.sport + ' only: units won on graded ' + state.sport + ' picks, 10+ picks.';
      } else {
        rows = all.filter(t[3]).map(function (r) { return { r: r, x: m(r, t[2]) }; }).filter(function (o) { return o.x; });
        rows.sort(function (a, b) { return (b.x[t[4]] == null ? -1e9 : b.x[t[4]]) - (a.x[t[4]] == null ? -1e9 : a.x[t[4]]); });
        $('boardNote').textContent = t[5];
      }
      rows = rows.slice(0, 10);
      $('boardRows').innerHTML = rows.length ? rows.map(function (o, i) {
        var r = o.r, x = o.x, h = link(r);
        return '<tr class="fade' + (h ? ' go" data-href="' + h : '') + '"><td class="l rk">' + (i + 1) + '</td><td class="l">' + capCell(r) + '</td><td class="hm l">' + (!state.sport && t[2] === 'all' ? spark(r.spark) : '<span class="dim small">all sports only</span>') + '</td><td class="hm">' + fmt(x.picks) +
          '</td><td>' + recTxt(x) + '</td><td class="hm">' + pct(x.win_pct) + '</td><td>' + sgn(x.units, 2) + '</td><td class="hm">' + sgn(x.roi, 1, '%') + '</td><td class="hm">' + strk(r.streak) + '</td><td class="hm muted">' + ago(r.last_pick) + '</td></tr>';
      }).join('') : '<tr><td colspan="10" class="empty">No handicappers qualify for this view yet.</td></tr>';
    }
    draw();

    // top performers by sport
    $('sportGrid').innerHTML = sportsByDepth(all, 15).slice(0, 6).map(function (s) {
      var top = all.map(function (r) { return { r: r, x: m(r, null, s) }; }).filter(function (o) { return o.x && o.x.picks >= 15 && o.x.units > 0; })
        .sort(function (a, b) { return b.x.units - a.x.units; }).slice(0, 3);
      return !top.length ? '' : '<div class="sc"><h4><span>' + esc(s) + '</span><a class="muted small" href="cappers.html?sport=' + encodeURIComponent(s) + '">View all</a></h4><ol>' + top.map(function (o) {
        var h = link(o.r);
        return '<li><a ' + (h ? 'href="' + h + '"' : '') + '><span class="badge">' + esc(code(o.r.id)) + '</span><span class="muted">' + recTxt(o.x) + '</span></a>' + sgn(o.x.units, 1, 'u') + '</li>';
      }).join('') + '</ol></div>';
    }).join('');

    // reality check: shares computed from the same index the tables use
    var q = all.filter(function (r) { return r.picks >= 20 && r.units != null; }), e = all.filter(function (r) { return r.picks >= 100 && r.units != null; });
    var up = function (a) { return a.filter(function (r) { return r.units > 0; }).length; };
    var roiSorted = q.map(function (r) { return r.roi; }).filter(function (v) { return v != null; }).sort(function (a, b) { return a - b; });
    var med = roiSorted.length ? roiSorted[Math.floor(roiSorted.length / 2)] : null;
    var bySrc = {}; q.forEach(function (r) { var b = bySrc[r.source] = bySrc[r.source] || [0, 0]; b[0]++; if (r.units > 0) b[1]++; });
    $('reality').innerHTML = '<div class="eyebrow">Established records, 100+ picks</div><div class="big">' + (e.length ? Math.round(100 * up(e) / e.length) : 0) + '%</div>' +
      '<p class="muted small" style="margin:2px 0 14px">are up money: ' + fmt(up(e)) + ' of ' + fmt(e.length) + ' handicappers. With 20+ picks it is ' + fmt(up(q)) + ' of ' + fmt(q.length) +
      ', and the median ROI is ' + (med == null ? 'n/a' : (med > 0 ? '+' : '') + med.toFixed(1) + '%') + '.</p>' +
      '<div class="eyebrow" style="margin-bottom:4px">Up money by platform, 20+ picks</div>' +
      Object.keys(bySrc).sort(function (a, b) { return bySrc[b][0] - bySrc[a][0]; }).map(function (s) {
        var b = bySrc[s], p = Math.round(100 * b[1] / b[0]);
        return '<div class="srcrow"><span>' + esc(s) + ' <span class="dim small">' + fmt(b[0]) + '</span></span><span class="bar" style="width:90px"><i style="width:' + p + '%"></i></span><b class="num">' + p + '%</b></div>';
      }).join('');
  }

  // ---------------- rankings ----------------
  var PRO = false;
  function rankings(d) {
    var M = d.meta, all = d.cappers, PER = 50, pageNo = 1, view = [], picked = [];
    var P = new URLSearchParams(location.search);
    $('fresh').textContent = fmt(M.tracked) + ' handicappers with graded picks. Updated ' + new Date(M.built_at).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' PT.';
    sportsByDepth(all, 5).forEach(function (s) { $('fSport').insertAdjacentHTML('beforeend', '<option>' + esc(s) + '</option>'); });
    M.sources.forEach(function (s) { $('fSource').insertAdjacentHTML('beforeend', '<option>' + esc(s) + '</option>'); });
    var map = { q: 'q', sport: 'fSport', src: 'fSource', t: 'fTime', sort: 'fSort', min: 'fMin', roi: 'fRoi', win: 'fWin', u: 'fUnits' };
    Object.keys(map).forEach(function (k) { if (P.has(k)) $(map[k]).value = P.get(k); });
    var cols = [['l', '#', ''], ['l', 'Handicapper', ''], ['hm l', 'Trend', ''], ['', 'Picks', 'picks'], ['', 'Record', ''], ['hm', 'Win %', 'win_pct'], ['', 'Units', 'units'], ['', 'ROI', 'roi'], ['hm', 'Streak', 'streak'], ['hm', 'Last pick', 'last_pick']];

    function head() {
      var s = $('fSort').value;
      $('head').innerHTML = '<tr>' + cols.map(function (c) { return '<th class="' + c[0] + (c[2] ? ' sortable' + (s === c[2] ? ' sorted' : '') : '') + '"' + (c[2] ? ' data-k="' + c[2] + '"' : '') + '>' + c[1] + '</th>'; }).join('') + '</tr>';
    }
    $('head').addEventListener('click', function (e) { var th = e.target.closest('th.sortable'); if (!th) return; $('fSort').value = th.getAttribute('data-k'); apply(); });

    function apply() {
      var q = $('q').value.trim().toLowerCase(), sp = $('fSport').value, so = $('fSource').value, t = sp ? 'all' : $('fTime').value;
      $('fTime').disabled = !!sp;
      var min = +$('fMin').value || 1, roi = $('fRoi').value, win = $('fWin').value, un = $('fUnits').value, sort = $('fSort').value;
      view = [];
      all.forEach(function (r) {
        if (so && r.source !== so) return;
        if (q && !(r.id.indexOf(q) === 0 || code(r.id).toLowerCase() === q || r.source.toLowerCase().indexOf(q) >= 0 ||
          (NAMES && NAMES[r.id] && String(NAMES[r.id][1]).toLowerCase().indexOf(q.replace(/^@/, '')) >= 0) ||
          r.sports.some(function (s) { return s.toLowerCase().indexOf(q) >= 0; }))) return;
        var x = m(r, t, sp); if (!x || x.picks < min) return;
        if (PRO) {
          var clv = $('fClv').value, z = $('fZ').value, dd = $('fDd').value, mo = $('fMo').value;
          if (clv !== '' && !(r.clv_beat != null && r.clv_n >= 10 && r.clv_beat >= +clv)) return;
          if (z !== '' && !(r.z != null && (+z === 0 ? r.z > 0 : r.z >= +z))) return;
          if (dd !== '' && !(r.mdd != null && r.mdd > +dd)) return;
          if (mo !== '' && !(r.months && (mo === 'all' ? r.months_up === r.months : r.months_up * 2 >= r.months))) return;
        }
        if (roi !== '' && !(x.roi != null && x.roi >= +roi && (+roi > 0 || x.roi > 0))) return;
        if (win !== '' && !(x.win_pct != null && x.win_pct >= +win)) return;
        if (un !== '' && !(x.units != null && x.units >= +un && (+un > 0 || x.units > 0))) return;
        view.push({ r: r, x: x });
      });
      var key = sort === 'worst' ? 'units' : sort, dir = sort === 'worst' ? 1 : -1;
      var val = function (o) { return key === 'streak' ? o.r.streak : key === 'last_pick' ? (o.r.last_pick || '') : o.x[key]; };
      view.sort(function (a, b) { var x = val(a), y = val(b); if (x == null) return 1; if (y == null) return -1; return (x < y ? -1 : x > y ? 1 : 0) * dir; });
      var qs = new URLSearchParams();
      Object.keys(map).forEach(function (k) { var v = $(map[k]).value; if (v && !(k === 'min' && v === '20') && !(k === 't' && v === 'all') && !(k === 'sort' && v === 'units')) qs.set(k, v); });
      history.replaceState(null, '', location.pathname + (qs.toString() ? '?' + qs : ''));
      pageNo = 1; head(); draw();
    }

    function draw() {
      var start = (pageNo - 1) * PER, rows = view.slice(start, start + PER), lifetime = !$('fSport').value && $('fTime').value === 'all';
      $('rows').innerHTML = rows.length ? rows.map(function (o, i) {
        var r = o.r, x = o.x, h = link(r);
        return '<tr' + (h ? ' class="go" data-href="' + h + '"' : '') + '><td class="l rk">' + (PRO ? '<input type="checkbox" class="pick" data-id="' + r.id + '"' + (picked.indexOf(r.id) >= 0 ? ' checked' : '') + ' aria-label="Compare">' : start + i + 1) + '</td><td class="l">' + capCell(r) + '</td><td class="hm l">' + (lifetime ? spark(r.spark) : '<span class="dim small">all sports only</span>') + '</td><td>' + fmt(x.picks) +
          '</td><td>' + recTxt(x) + '</td><td class="hm">' + pct(x.win_pct) + '</td><td>' + sgn(x.units, 2) + '</td><td>' + sgn(x.roi, 1, '%') + '</td><td class="hm">' + strk(r.streak) + '</td><td class="hm muted">' + ago(r.last_pick) + '</td></tr>';
      }).join('') : '<tr><td colspan="10" class="empty">No handicappers match these filters. Try a smaller minimum or another timeframe.</td></tr>';
      var pages = Math.max(1, Math.ceil(view.length / PER));
      $('count').textContent = fmt(view.length) + ' handicappers' + ($('fSport').value ? ' · ' + $('fSport').value + ' records only' : $('fTime').value !== 'all' ? ' · ' + $('fTime').selectedOptions[0].text : '');
      $('pg').textContent = pageNo + ' / ' + pages;
      $('prev').disabled = pageNo <= 1; $('next').disabled = pageNo >= pages;
    }

    ['fSport', 'fSource', 'fTime', 'fSort', 'fMin', 'fRoi', 'fWin', 'fUnits', 'fClv', 'fZ', 'fDd', 'fMo'].forEach(function (id) { $(id).addEventListener('change', apply); });
    $('rows').addEventListener('click', function (e) {
      var c = e.target.closest('input.pick'); if (!c) return;
      e.stopPropagation();
      var id = c.getAttribute('data-id'), i = picked.indexOf(id);
      if (c.checked && i < 0) { if (picked.length >= 4) { c.checked = false; return; } picked.push(id); } else if (!c.checked && i >= 0) picked.splice(i, 1);
      $('cmpBtn').textContent = 'Compare' + (picked.length ? ' (' + picked.length + ')' : '');
      $('cmpBtn').href = 'compare.html' + (picked.length ? '?ids=' + picked.join(',') : '');
    });
    HWD.ready.then(function (s) {
      if (!s.pro) return;
      PRO = true;
      ['fClv', 'fZ', 'fDd', 'fMo'].forEach(function (id) { $(id).disabled = false; });
      document.querySelectorAll('#proF .lock').forEach(function (l) { l.remove(); });
      $('cmpBtn').className = 'btn sm ghost'; $('cmpBtn').href = 'compare.html';
      HWD.names().then(function (list) { NAMES = {}; list.forEach(function (n) { NAMES[n[0]] = n; }); apply(); }).catch(apply);
    });
    var tmr; $('q').addEventListener('input', function () { clearTimeout(tmr); tmr = setTimeout(apply, 150); });
    $('reset').onclick = function () { ['q', 'fSport', 'fSource', 'fRoi', 'fWin', 'fUnits'].forEach(function (id) { $(id).value = ''; }); $('fTime').value = 'all'; $('fSort').value = 'units'; $('fMin').value = '20'; apply(); };
    $('prev').onclick = function () { if (pageNo > 1) { pageNo--; draw(); scrollTo({ top: 0, behavior: 'smooth' }); } };
    $('next').onclick = function () { if (pageNo * PER < view.length) { pageNo++; draw(); scrollTo({ top: 0, behavior: 'smooth' }); } };
    apply();
  }
})();
