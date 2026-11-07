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
  var code = function (id) { return id.slice(0, 6).toUpperCase(); };
  var TIER = { established: ['est', 'Established'], developing: ['dev', 'Developing'], small: ['sm', 'Small sample'] };
  var DAY = 864e5;

  function spark(pts, W, H) {
    if (!pts || pts.length < 2) return '<span class="dim small">building</span>';
    W = W || 84; H = H || 24; var mn = Math.min.apply(null, pts.concat(0)), mx = Math.max.apply(null, pts.concat(0)), sp = (mx - mn) || 1;
    var d = pts.map(function (v, i) { return (i ? 'L' : 'M') + (i * W / (pts.length - 1)).toFixed(1) + ' ' + (2 + (mx - v) * (H - 4) / sp).toFixed(1); }).join('');
    var c = pts[pts.length - 1] >= 0 ? 'var(--win)' : 'var(--loss)', z = (2 + mx * (H - 4) / sp).toFixed(1);
    return '<svg class="spark" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" aria-hidden="true"><line x1="0" x2="' + W + '" y1="' + z + '" y2="' + z + '" stroke="var(--line2)" stroke-dasharray="2 3"/><path d="' + d + '" fill="none" stroke="' + c + '" stroke-width="1.6"/></svg>';
  }

  function capCell(r) {
    var t = TIER[r.tier] || TIER.small;
    return '<div class="cap"><span class="av">' + esc(code(r.id).slice(0, 2)) + '</span><span class="nm"><b class="idc">#' + esc(code(r.id)) + '</b>' +
      '<small><span class="badge ' + t[0] + '">' + t[1] + '</span></small></span></div>';
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
  var link = function (r) { return r.profile ? 'handicappers/' + encodeURIComponent(r.id) + '.html' : ''; };

  document.addEventListener('click', function (e) {
    var tr = e.target.closest && e.target.closest('tr.go');
    if (tr && !e.target.closest('a')) location.href = tr.getAttribute('data-href');
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
  function sportSlug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''); }
  function sportPages(all) {
    var c = {};
    all.forEach(function (r) { Object.keys(r.bs || {}).forEach(function (s) { if (r.bs[s][0] >= 30) c[s] = (c[s] || 0) + 1; }); });
    return Object.keys(c).filter(function (s) { return c[s] >= 5; }).sort(function (a, b) { return c[b] - c[a]; });
  }

  // ---------------- home ----------------
  function home(d) {
    var M = d.meta, all = d.cappers, L = M.live, built = new Date(M.built_at);
    var set = function (id, html) { var el = $(id); if (el) el.innerHTML = html; };
    // tracker panel: every figure read from the Watchdog stats endpoint at build time
    if (L) {
      var kv = [[fmt(L.accounts_monitored), 'Accounts monitored'], [fmt(L.graded_picks), 'Picks graded'], [fmt(L.posts_captured), 'Public posts scanned'],
        [fmt(L.pending_picks), 'Picks waiting on a result', 1], [fmt(L.accounts_discovered), 'Accounts discovered'], [fmt(L.picks_captured_today), 'Picks captured today']];
      set('liveGrid', kv.map(function (k) { return '<div class="kv' + (k[2] ? ' hl' : '') + '"><b>' + k[0] + '</b><span>' + k[1] + '</span></div>'; }).join(''));
      $('liveAt').textContent = 'Last capture ' + new Date(L.last_capture_at).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' }) + ' PT';
      set('featPending', fmt(L.pending_picks) + ' tracked picks are waiting on a result right now. A pick waiting on a result is never counted in a record.');
      set('stepDiscover', fmt(L.accounts_discovered) + ' accounts found so far, ' + fmt(L.accounts_monitored) + ' monitored for picks.');
      var mix = $('liveMix'), sources = (L.sources || []).filter(function (s) { return s && s.label && s.graded_picks > 0; })
        .slice().sort(function (a, b) { return b.graded_picks - a.graded_picks; });
      if (mix && sources.length) {
        var peak = sources[0].graded_picks;
        mix.hidden = false;
        mix.innerHTML = '<p class="mixlabel">Graded picks by source</p>' + sources.map(function (s) {
          var w = Math.max(4, Math.round(100 * s.graded_picks / peak));
          return '<div class="mixrow"><span>' + esc(s.label) + '</span><span class="mixbar" role="presentation"><i style="width:' + w + '%"></i></span><b>' + fmt(s.graded_picks) + '</b></div>';
        }).join('');
      }
    } else {
      set('liveGrid', '<div class="kv"><b>' + fmt(M.tracked) + '</b><span>Handicappers with a record</span></div><div class="kv"><b>' + fmt(M.graded_picks) + '</b><span>Picks graded</span></div>');
    }

    // established records drive the anonymous ID card and the two worked examples
    var est = all.filter(function (r) { return r.picks >= 100 && r.units != null; }).sort(function (a, b) { return b.units - a.units; });
    var top = est[0], low = est.length > 1 ? est[est.length - 1] : null;
    var since = function (r) { var f = r.first_pick || r.monitored_since; return f ? new Date(f + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'n/a'; };
    if (top) {
      $('idCode').textContent = '#' + code(top.id);
      set('idPicks', fmt(top.picks)); set('idRec', recTxt(top)); set('idUnits', sgn(top.units, 2)); set('idSince', since(top));
      if (link(top)) $('idLink').href = link(top);
    }

    function explain(r) {
      var s = 'Risking 1 unit on each of its ' + fmt(r.picks) + ' graded picks, this account is ' + (r.units >= 0 ? 'up ' : 'down ') + Math.abs(r.units).toFixed(2) +
        ' units' + (r.roi >= 0 ? ', a profit of ' : ', a loss of ') + Math.abs(+r.roi).toFixed(1) + ' cents per dollar risked.';
      if (r.units > 0 && r.win_pct != null && r.win_pct < 52.4) s += ' It won only ' + pct(r.win_pct) + ' of decided picks, so the profit came from plus money odds, not a high win rate.';
      else if (r.units < 0 && r.win_pct != null && r.win_pct >= 50) s += ' It won ' + pct(r.win_pct) + ' of decided picks and still lost money, because the odds it took cost more than those wins paid.';
      else if (r.units < 0) s += ' A loss this size over this many picks is hard to call bad luck.';
      else s += ' Over a sample this size, that is a record worth a closer look.';
      return s;
    }
    function exCard(r, label, cls) {
      var h = link(r);
      return '<article class="panel excard ' + cls + '"><div class="exhead"><span class="eyebrow">' + label + '</span><span class="badge est">Established</span></div>' +
        '<div class="exid"><span class="av">' + esc(code(r.id).slice(0, 2)) + '</span><b class="idc">#' + esc(code(r.id)) + '</b><span class="dim small">tracked since ' + since(r) + '</span></div>' +
        '<div class="exspark">' + spark(r.spark, 320, 64) + '</div>' +
        '<div class="exk"><div><b>' + recTxt(r) + '</b><span>Record</span></div><div><b>' + sgn(r.units, 2) + '</b><span>Units</span></div><div><b>' + sgn(r.roi, 1, '%') + '</b><span>ROI</span></div><div><b>' + pct(r.win_pct) + '</b><span>Win rate</span></div><div><b>' + strk(r.streak) + '</b><span>Streak</span></div></div>' +
        '<p class="exp">' + explain(r) + '</p>' + (h ? '<a class="btn sm ghost" href="' + h + '">Open the full profile</a>' : '') + '</article>';
    }
    var big = est.slice().sort(function (a, b) { return b.picks - a.picks; })[0];
    if (top) {
      set('exGrid', exCard(big, 'Most graded picks', big.units >= 0 ? 'up' : 'down') + (low && low.units < 0 ? exCard(low, 'Most units lost', 'down') : ''));
      set('gUnits', 'The most traded record above at ' + sgn(big.units, 2) + ' units ' + (big.units >= 0 ? 'won ' : 'lost ') + Math.abs(big.units).toFixed(1) + ' times its standard stake overall.');
      set('gRoi', 'Its ' + sgn(big.roi, 1, '%') + ' ROI means about ' + Math.abs(big.roi).toFixed(0) + ' cents of ' + (big.roi >= 0 ? 'profit' : 'loss') + ' per dollar risked.');
    }

    // featured: four fixed rules, each card links to its profile
    var weekCut = new Date(built - 7 * DAY).toISOString().slice(0, 10);
    var best = function (arr, f) { return arr.slice().sort(f)[0] || null; };
    var feat = [
      ['Best established performer', 'Most units won, 100 or more graded picks.', est[0], function (r) { return [sgn(r.units, 2), 'units']; }],
      ['Best recent ROI', 'Highest ROI in the last 30 days, 20 or more picks in that window.',
        best(all.filter(function (r) { return r.r30 && r.r30.picks >= 20 && r.r30.roi != null; }), function (a, b) { return b.r30.roi - a.r30.roi; }),
        function (r) { return [sgn(r.r30.roi, 1, '%'), 'ROI, last 30 days (' + recTxt(r.r30) + ')']; }],
      ['Longest active win streak', 'Longest current run of wins, 20 or more graded picks, a pick in the last 7 days.',
        best(all.filter(function (r) { return r.streak > 0 && r.picks >= 20 && r.last_pick && r.last_pick >= weekCut; }), function (a, b) { return b.streak - a.streak || b.picks - a.picks; }),
        function (r) { return ['W' + r.streak, 'straight wins right now']; }],
      ['Most consistent', 'Highest share of profitable months, 3 or more months, 100 or more picks, up overall.',
        best(all.filter(function (r) { return r.months >= 3 && r.picks >= 100 && r.units > 0; }), function (a, b) { return (b.months_up / b.months) - (a.months_up / a.months) || b.months - a.months || b.units - a.units; }),
        function (r) { return [r.months_up + ' of ' + r.months, 'months up money']; }]];
    set('featGrid', feat.map(function (f) {
      var r = f[2];
      if (!r) return '<article class="panel fcard"><span class="eyebrow">' + f[0] + '</span><p class="muted small">No account qualifies today. Rule: ' + f[1] + '</p></article>';
      var k = f[3](r), h = link(r), t = TIER[r.tier] || TIER.small;
      return '<a class="panel fcard" href="' + (h || 'cappers.html') + '"><span class="eyebrow">' + f[0] + '</span>' +
        '<div class="exid"><span class="av">' + esc(code(r.id).slice(0, 2)) + '</span><b class="idc">#' + esc(code(r.id)) + '</b><span class="badge ' + t[0] + '">' + t[1] + '</span></div>' +
        '<div class="fck"><b>' + k[0] + '</b><span>' + k[1] + '</span></div>' + spark(r.spark, 240, 44) +
        '<div class="fcrow"><span>' + recTxt(r) + '</span><span>' + sgn(r.units, 2, 'u') + '</span><span>' + sgn(r.roi, 1, '%') + ' ROI</span><span>' + fmt(r.picks) + ' picks</span></div>' +
        '<p class="dim small">' + f[1] + '</p><span class="fcgo">Open full profile &rarr;</span></a>';
    }).join(''));

    // explore the data: one real profile, fetched as is
    var showcase = est.filter(function (r) { return !r.basic && r.profile; })[0];
    if (showcase) {
      $('exploreLink').href = link(showcase);
      fetch('data/p/' + showcase.id + '.json').then(function (r) { return r.json(); }).then(function (p) {
        var c = code(showcase.id);
        set('exSub', '#' + c + ', ' + fmt(p.overview ? p.overview.picks : showcase.picks) + ' graded picks');
        var pts = p.curve || [];
        if (pts.length > 1) {
          var mn = Math.min.apply(null, pts.concat(0)), mx = Math.max.apply(null, pts.concat(0)), sp = (mx - mn) || 1, W = 600, H = 200;
          var y = function (v) { return 8 + (mx - v) * (H - 16) / sp; };
          var d = pts.map(function (v, i) { return (i ? 'L' : 'M') + (i * W / (pts.length - 1)).toFixed(1) + ' ' + y(v).toFixed(1); }).join('');
          var col = pts[pts.length - 1] >= 0 ? 'var(--win)' : 'var(--loss)';
          set('exChart', '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" style="width:100%;height:200px" role="img" aria-label="Cumulative units for #' + c + ', now ' + (+pts[pts.length - 1]).toFixed(2) + '">' +
            '<line x1="0" x2="' + W + '" y1="' + y(0) + '" y2="' + y(0) + '" stroke="var(--line2)" stroke-dasharray="3 4" vector-effect="non-scaling-stroke"/>' +
            '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="2.2" vector-effect="non-scaling-stroke"/></svg>' +
            '<p class="note" style="margin:8px 0 0">Now ' + sgn(pts[pts.length - 1], 2, ' units') + '. The profile adds ROI over time, rolling win rate, weekly activity, and units by sport and month.</p>');
        }
        var W2 = p.windows || {};
        set('exPeriods', '<div class="tw"><table class="mini"><thead><tr><th class="l">Window</th><th>Picks</th><th>Record</th><th>Units</th><th>ROI</th></tr></thead><tbody>' +
          ['r7', 'r30', 'r90', 'all'].map(function (k) { var x = W2[k]; return x && x.picks ? '<tr><td class="l">' + esc(x.key) + '</td><td>' + fmt(x.picks) + '</td><td>' + recTxt(x) + '</td><td>' + sgn(x.net, 2) + '</td><td>' + sgn(x.roi, 1, '%') + '</td></tr>' : ''; }).join('') + '</tbody></table></div>');
        var res = { W: '<span class="st pos">W</span>', L: '<span class="st neg">L</span>', P: '<span class="dim">P</span>' };
        set('exLedger', '<div class="tw"><table class="mini"><thead><tr><th class="l">Date</th><th class="l">Pick</th><th>Result</th><th>Units</th></tr></thead><tbody>' +
          (p.ledger || []).slice(0, 5).map(function (x) { return '<tr><td class="l">' + esc(x.d ? new Date(x.d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '') + '</td><td class="l">' + esc(x.pk) + ' <span class="dim small">' + esc(x.sp) + '</span></td><td>' + (res[x.r] || '') + '</td><td>' + (x.u ? sgn(x.pl, 2) : '<span class="dim">0</span>') + '</td></tr>'; }).join('') + '</tbody></table></div>');
      }).catch(function () {});
    }

    // leaderboard tabs
    var cut = new Date(built - 21 * DAY).toISOString().slice(0, 10);
    var TABS = [
      ['overall', 'Established', 'all', function (r) { return r.picks >= 100 && r.units != null; }, 'units', 'Established: 100 or more graded picks, ranked by units won. The steadiest list on the site.'],
      ['r30', 'Last 30 days', 'r30', function (r) { return r.r30 && r.r30.picks >= 10; }, 'units', 'Last 30 days: units won in that window, with at least 10 graded picks in it. Recent form, not a career.'],
      ['r7', 'Last 7 days', 'r7', function (r) { return r.r7 && r.r7.picks >= 5; }, 'units', 'Last 7 days: units won in that window, with at least 5 graded picks in it. One long shot can top this list.'],
      ['roi', 'Best ROI', 'all', function (r) { return r.picks >= 50 && r.roi != null; }, 'roi', 'Best ROI: profit per unit risked, at least 50 graded picks.'],
      ['emerging', 'Emerging', 'all', function (r) { return r.first_pick && r.first_pick >= cut && r.picks >= 10 && r.units > 0; }, 'units', 'Emerging: first graded pick in the last 21 days, 10 or more picks, up money so far. Small samples: treat as early signals.'],
      ['active', 'Most active', 'r30', function (r) { return r.r30 && r.r30.picks > 0; }, 'picks', 'Most active: most graded picks in the last 30 days.']];
    var state = { tab: 0, sport: '' };
    $('boardTabs').innerHTML = TABS.map(function (t, i) { return '<button class="tab' + (i ? '' : ' on') + '" data-i="' + i + '">' + t[1] + '</button>'; }).join('');
    sportsByDepth(all, 10).forEach(function (s) { $('boardSport').insertAdjacentHTML('beforeend', '<option>' + esc(s) + '</option>'); });
    $('boardTabs').addEventListener('click', function (e) { var b = e.target.closest('.tab'); if (!b) return; state.tab = +b.getAttribute('data-i'); state.sport = ''; $('boardSport').value = ''; draw(); });
    $('boardSport').addEventListener('change', function () { state.sport = this.value; draw(); });
    $('boardHead').innerHTML = '<tr><th class="l">#</th><th class="l">Watchdog ID</th><th class="hm l">Trend</th><th class="hm"><span class="tip2" tabindex="0" data-tip="Graded picks in this view">Picks</span></th><th><span class="tip2" tabindex="0" data-tip="Wins, losses, pushes">Record</span></th><th class="hm"><span class="tip2" tabindex="0" data-tip="Wins divided by wins plus losses">Win %</span></th><th><span class="tip2" tabindex="0" data-tip="Profit risking 1 unit per pick">Units</span></th><th class="hm"><span class="tip2" tabindex="0" data-tip="Units won per unit risked">ROI</span></th><th class="hm"><span class="tip2" tabindex="0" data-tip="Current run of wins or losses">Streak</span></th><th class="hm">Last pick</th></tr>';

    function draw() {
      var t = TABS[state.tab], rows;
      document.querySelectorAll('#boardTabs .tab').forEach(function (b, i) { b.classList.toggle('on', !state.sport && i === state.tab); });
      if (state.sport) {
        rows = all.map(function (r) { return { r: r, x: m(r, null, state.sport) }; }).filter(function (o) { return o.x && o.x.picks >= 10 && o.x.units != null; });
        rows.sort(function (a, b) { return b.x.units - a.x.units; });
        $('boardNote').textContent = state.sport + ' only: units won on graded ' + state.sport + ' picks, 10 or more picks. The badge shows the lifetime sample.';
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
    set('sportGrid', sportPages(all).slice(0, 6).map(function (s) {
      var lead = all.map(function (r) { return { r: r, x: m(r, null, s) }; }).filter(function (o) { return o.x && o.x.picks >= 30 && o.x.units > 0; })
        .sort(function (a, b) { return b.x.units - a.x.units; }).slice(0, 3);
      return !lead.length ? '' : '<div class="sc s-' + sportSlug(s) + '"><p class="sptitle"><span>' + esc(s) + '</span><a class="muted small" href="sports/' + sportSlug(s) + '.html">View all</a></p><ol>' + lead.map(function (o) {
        var h = link(o.r);
        return '<li><a ' + (h ? 'href="' + h + '"' : '') + '><span class="badge">#' + esc(code(o.r.id)) + '</span><span class="muted">' + recTxt(o.x) + '</span></a>' + sgn(o.x.units, 1, 'u') + '</li>';
      }).join('') + '</ol></div>';
    }).join(''));

    // reality check: shares computed from the same index the tables use
    var q = all.filter(function (r) { return r.picks >= 20 && r.units != null; }), e = est;
    var up = function (a) { return a.filter(function (r) { return r.units > 0; }).length; };
    var roiSorted = q.map(function (r) { return r.roi; }).filter(function (v) { return v != null; }).sort(function (a, b) { return a - b; });
    var med = roiSorted.length ? roiSorted[Math.floor(roiSorted.length / 2)] : null;
    var bars = (M.by_platform || []).map(function (s) {
      var p = s.n ? Math.round(100 * s.up / s.n) : 0;
      return '<div class="srcrow"><span>' + esc(s.name) + ' <span class="dim small">' + fmt(s.n) + '</span></span><span class="bar" style="width:90px"><i style="width:' + p + '%"></i></span><b class="num">' + p + '%</b></div>';
    }).join('');
    set('reality', '<div class="eyebrow">Established records, 100 or more picks</div><div class="big">' + (e.length ? Math.round(100 * up(e) / e.length) : 0) + '%</div>' +
      '<p class="muted small" style="margin:2px 0 14px">are up money: ' + fmt(up(e)) + ' of ' + fmt(e.length) + ' handicappers. With 20 or more picks it is ' + fmt(up(q)) + ' of ' + fmt(q.length) +
      ', and the median ROI is ' + (med == null ? 'n/a' : (med > 0 ? '+' : '') + med.toFixed(1) + '%') + '. Being up so far does not mean being up next week.</p>' +
      (bars ? '<div class="eyebrow" style="margin-bottom:4px">Up money by source, 20 or more picks</div>' + bars : ''));

    // pending picks preview: real public records, placeholder games and picks, nothing from the pending feed
    var MOCK = ['NFL', 'NCAAF', 'NBA', 'NHL'], mrows = [];
    MOCK.forEach(function (sp) {
      all.filter(function (r) { return r.picks >= 100 && r.bs && r.bs[sp] && r.bs[sp][0] >= 20; })
        .sort(function (a, b) { return (b.bs[sp][1] || 0) - (a.bs[sp][1] || 0); }).slice(0, 2)
        .forEach(function (r) { mrows.push({ r: r, sp: sp, b: r.bs[sp] }); });
    });
    var lockCell = '<span class="lockcell"><svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" fill="currentColor"/><path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="2"/></svg><span class="blur">Away at Home</span></span>';
    function mock(f) {
      var rows = mrows.filter(function (o) { return !f || o.sp === f; });
      set('mockRows', rows.map(function (o) {
        var h = link(o.r);
        return '<tr><td class="l"><a href="' + (h || 'cappers.html') + '"><b class="idc">#' + esc(code(o.r.id)) + '</b></a></td><td class="l"><span class="idc small">' + recTxt(o.r) + '</span> <span class="dim small">' + esc(o.sp) + ' ' + sgn(o.b[1], 1, 'u') + '</span></td>' +
          '<td class="l">' + lockCell + '</td><td class="l"><span class="blur">Side 3.5</span></td><td class="hp"><span class="blur">Sun 1:05</span></td></tr>';
      }).join('') || '<tr><td colspan="5" class="empty">No established records in this sport yet.</td></tr>');
    }
    var mf = $('mockF');
    if (mf) mf.addEventListener('click', function (ev) {
      var b = ev.target.closest('.chip'); if (!b) return;
      mf.querySelectorAll('.chip').forEach(function (c) { c.classList.toggle('on', c === b); });
      mock(b.getAttribute('data-s'));
    });
    mock('');
  }

  // ---------------- rankings ----------------
  function rankings(d) {
    var M = d.meta, all = d.cappers, PER = 50, pageNo = 1, view = [];
    var P = new URLSearchParams(location.search);
    $('fresh').textContent = fmt(M.tracked) + ' handicappers with graded picks' + (M.monitored > M.tracked ? ', ' + fmt(M.monitored - M.tracked) + ' more monitored with none graded yet' : '') + '. Updated ' + new Date(M.built_at).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' PT.';
    if (M.live && $('pendNote')) $('pendNote').textContent = fmt(M.live.pending_picks) + ' tracked picks are waiting on a result right now.';
    sportsByDepth(all, 5).forEach(function (s) { $('fSport').insertAdjacentHTML('beforeend', '<option>' + esc(s) + '</option>'); });
    var map = { q: 'q', sport: 'fSport', t: 'fTime', sort: 'fSort', min: 'fMin', roi: 'fRoi', win: 'fWin', u: 'fUnits', act: 'fAct' };
    Object.keys(map).forEach(function (k) { if (P.has(k)) $(map[k]).value = P.get(k); });
    var cols = [['l', '#', ''], ['l', 'Handicapper', ''], ['hm l', 'Trend', ''], ['', 'Picks', 'picks'], ['', 'Record', ''], ['hm', 'Win %', 'win_pct'], ['', 'Units', 'units'], ['', 'ROI', 'roi'], ['hm', 'Streak', 'streak'], ['hm', 'Last pick', 'last_pick']];

    function head() {
      var s = $('fSort').value;
      $('head').innerHTML = '<tr>' + cols.map(function (c) { return '<th class="' + c[0] + (c[2] ? ' sortable' + (s === c[2] ? ' sorted' : '') : '') + '"' + (c[2] ? ' data-k="' + c[2] + '"' : '') + '>' + c[1] + '</th>'; }).join('') + '</tr>';
    }
    $('head').addEventListener('click', function (e) { var th = e.target.closest('th.sortable'); if (!th) return; $('fSort').value = th.getAttribute('data-k'); apply(); });

    function apply() {
      var q = $('q').value.trim().toLowerCase().replace(/^#/, ''), sp = $('fSport').value, t = sp ? 'all' : $('fTime').value;
      $('fTime').disabled = !!sp;
      var act = +$('fAct').value || 0, actCut = act ? new Date(new Date(M.built_at) - act * DAY).toISOString().slice(0, 10) : '';
      var min = $('fMin').value === '' ? 1 : +$('fMin').value, roi = $('fRoi').value, win = $('fWin').value, un = $('fUnits').value, sort = $('fSort').value;
      view = [];
      all.forEach(function (r) {
        if (q && !(r.id.indexOf(q) === 0 || code(r.id).toLowerCase() === q || r.id.slice(0, 4) === q ||
          (r.sports || []).some(function (s) { return s.toLowerCase().indexOf(q) >= 0; }))) return;
        if (actCut && !(r.last_pick && r.last_pick >= actCut)) return;
        var x = m(r, t, sp); if (!x) return;
        if (sp) { if (r.picks < min || x.picks < 30) return; }
        else if (x.picks < min && !(q && r.id.indexOf(q) === 0)) return;
        if (roi !== '' && !(x.roi != null && x.roi >= +roi && (+roi > 0 || x.roi > 0))) return;
        if (win !== '' && !(x.win_pct != null && x.win_pct >= +win)) return;
        if (un !== '' && !(x.units != null && x.units >= +un && (+un > 0 || x.units > 0))) return;
        view.push({ r: r, x: x });
      });
      var key = sort === 'worst' ? 'units' : sort, dir = sort === 'worst' ? 1 : -1;
      var val = function (o) { return key === 'streak' ? o.r.streak : key === 'last_pick' ? (o.r.last_pick || '') : key === 'active' ? (o.r.r30 ? o.r.r30.picks : 0) : o.x[key]; };
      view.sort(function (a, b) { var x = val(a), y = val(b); if (x == null) return 1; if (y == null) return -1; return (x < y ? -1 : x > y ? 1 : 0) * dir; });
      var qs = new URLSearchParams();
      Object.keys(map).forEach(function (k) { var v = $(map[k]).value; if (v && !(k === 'min' && v === '100') && !(k === 't' && v === 'all') && !(k === 'sort' && v === 'units')) qs.set(k, v); });
      history.replaceState(null, '', location.pathname + (qs.toString() ? '?' + qs : ''));
      pageNo = 1; head(); draw();
    }

    function draw() {
      var start = (pageNo - 1) * PER, rows = view.slice(start, start + PER), lifetime = !$('fSport').value && $('fTime').value === 'all';
      $('rows').innerHTML = rows.length ? rows.map(function (o, i) {
        var r = o.r, x = o.x, h = link(r);
        return '<tr' + (h ? ' class="go" data-href="' + h + '"' : '') + '><td class="l rk">' + (start + i + 1) + '</td><td class="l">' + capCell(r) + '</td><td class="hm l">' + (lifetime ? spark(r.spark) : '<span class="dim small">all sports only</span>') + '</td><td>' + fmt(x.picks) +
          '</td><td>' + recTxt(x) + '</td><td class="hm">' + pct(x.win_pct) + '</td><td>' + sgn(x.units, 2) + '</td><td>' + sgn(x.roi, 1, '%') + '</td><td class="hm">' + strk(r.streak) + '</td><td class="hm muted">' + ago(r.last_pick) + '</td></tr>';
      }).join('') : '<tr><td colspan="10" class="empty">No handicappers match these filters. Try a smaller minimum or another timeframe.</td></tr>';
      var pages = Math.max(1, Math.ceil(view.length / PER));
      $('count').textContent = fmt(view.length) + ' handicappers' + ($('fSport').value ? ' · ' + $('fSport').value + ' records only' : $('fTime').value !== 'all' ? ' · ' + $('fTime').selectedOptions[0].text : '');
      $('pg').textContent = pageNo + ' / ' + pages;
      $('prev').disabled = pageNo <= 1; $('next').disabled = pageNo >= pages;
    }

    ['fSport', 'fTime', 'fSort', 'fMin', 'fRoi', 'fWin', 'fUnits', 'fAct'].forEach(function (id) { $(id).addEventListener('change', apply); });
    var tmr; $('q').addEventListener('input', function () { clearTimeout(tmr); tmr = setTimeout(apply, 150); });
    $('reset').onclick = function () { ['q', 'fSport', 'fRoi', 'fWin', 'fUnits', 'fAct'].forEach(function (id) { $(id).value = ''; }); $('fTime').value = 'all'; $('fSort').value = 'units'; $('fMin').value = '100'; apply(); };
    $('prev').onclick = function () { if (pageNo > 1) { pageNo--; draw(); scrollTo({ top: 0, behavior: 'smooth' }); } };
    $('next').onclick = function () { if (pageNo * PER < view.length) { pageNo++; draw(); scrollTo({ top: 0, behavior: 'smooth' }); } };
    apply();
  }
})();
