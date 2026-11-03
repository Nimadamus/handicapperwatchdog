(function () {
  'use strict';
  var root = document.getElementById('prof');
  var id = new URLSearchParams(location.search).get('id') || '';
  var PRO = 'pricing.html';
  var fmt = function (n) { return n == null ? 'n/a' : Number(n).toLocaleString('en-US'); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var sgn = function (v, d, suf) { if (v == null) return '<span class="dim">n/a</span>'; var n = +v; return '<span class="' + (n > 0 ? 'pos' : n < 0 ? 'neg' : '') + '">' + (n > 0 ? '+' : '') + n.toFixed(d) + (suf || '') + '</span>'; };
  var pct = function (v) { return v == null ? '<span class="dim">n/a</span>' : (+v).toFixed(1) + '%'; };
  var odds = function (v) { return v == null ? '<span class="dim">n/a</span>' : (v > 0 ? '+' : '') + v; };
  var rec = function (r) { return r.w + '-' + r.l + (r.p ? '-' + r.p : ''); };
  var strk = function (s) { return !s ? '<span class="dim">n/a</span>' : '<span class="' + (s[0] === 'W' ? 'pos' : 'neg') + '">' + esc(s) + '</span>'; };
  var label = function (k) { return esc(String(k).replace('|', ' · ')); };
  var day = function (iso) { return iso ? new Date(iso.length === 10 ? iso + 'T12:00:00Z' : iso).toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', year: 'numeric' }) : 'n/a'; };
  var TIER = { established: ['est', 'Established record', '100 or more graded picks.'], developing: ['dev', 'Developing record', '20 to 99 graded picks. Results can still swing a lot.'], small: ['sm', 'Small sample', 'Under 20 graded picks. Too few to judge skill.'] };

  if (!/^[0-9a-f]{10}$/.test(id)) { root.innerHTML = missing(); return; }
  fetch('data/p/' + id + '.json?v=' + Math.floor(Date.now() / 6e4)).then(function (r) { if (!r.ok) throw 0; return r.json(); }).then(render).catch(function () { root.innerHTML = missing(); });

  function missing() {
    return '<div class="empty" style="padding:70px 20px"><h1 style="font-size:22px;margin-bottom:8px">Profile not available yet</h1><p class="muted">Profiles are built as records come in. This capper may still be in the queue.</p><a class="btn" href="cappers.html">Browse the rankings</a></div>';
  }

  // ---------- blocks ----------
  function panel(title, body, right) { return '<div class="panel"><div class="ph"><h3>' + title + '</h3>' + (right || '') + '</div>' + body + '</div>'; }
  function roiBar(v) {
    if (v == null) return '';
    var w = Math.min(50, Math.abs(v) / 2), c = v >= 0 ? 'var(--win)' : 'var(--loss)';
    return '<span class="rbar" aria-hidden="true"><i style="background:' + c + ';left:' + (v >= 0 ? 50 : 50 - w) + '%;width:' + w + '%"></i></span>';
  }
  function table(rows, first, opts) {
    opts = opts || {};
    rows = (rows || []).filter(function (r) { return r && r.picks; });
    if (opts.sort) rows = rows.slice().sort(function (a, b) { return b.picks - a.picks; });
    if (opts.limit) rows = rows.slice(0, opts.limit);
    if (!rows.length) return '<div class="empty small">Not enough graded picks yet.</div>';
    return '<div class="tw"><table class="mini"><thead><tr><th class="l">' + first + '</th><th>Picks</th><th>Record</th><th class="hm">Win %</th><th>Units</th><th>ROI</th><th class="hm bc"></th><th class="hm ao">Avg odds</th></tr></thead><tbody>' +
      rows.map(function (r) {
        var small = r.picks < 10;
        return '<tr' + (small ? ' style="opacity:.62"' : '') + '><td class="l">' + label(r.key) + (small ? ' <span class="badge sm" title="Fewer than 10 picks">small</span>' : '') + '</td><td>' + fmt(r.picks) + '</td><td>' + rec(r) +
          '</td><td class="hm">' + pct(r.win_pct) + '</td><td>' + sgn(r.net, 2) + '</td><td>' + sgn(r.roi, 1, '%') + '</td><td class="hm bc" style="padding-left:0">' + roiBar(r.roi) + '</td><td class="hm ao">' + odds(r.avg_odds) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  function facts(list) { return '<ul class="facts">' + list.map(function (f) { return '<li><span>' + f[0] + '</span><b class="num">' + f[1] + '</b></li>'; }).join('') + '</ul>'; }
  function dots(list) { return '<div class="dots">' + (list || []).map(function (r) { return '<span class="d ' + (r === 'W' ? 'dw' : r === 'L' ? 'dl' : 'dp') + '">' + r + '</span>'; }).join('') + '</div>'; }

  var charts = [];
  // pts: numbers (nulls dropped from the front); o: {suf, dates, label, zero, digits}
  function chart(pts, first, last, o) {
    o = o || {};
    var dates = o.dates || null;
    if (pts) { var k0 = 0; while (k0 < pts.length && pts[k0] == null) k0++; pts = pts.slice(k0); if (dates) dates = dates.slice(k0); }
    if (!pts || pts.length < 2) return '<div class="empty small">Not enough graded picks to chart yet.</div>';
    var suf = o.suf == null ? 'u' : o.suf, dg = o.digits == null ? 2 : o.digits;
    var i = charts.push({ pts: pts, dates: dates, suf: suf, dg: dg, plain: !!o.plain }) - 1;
    var W = 900, H = 240, L = 44, R = 10, T = 12, B = 26, base = o.zero == null ? 0 : o.zero;
    var mn = Math.min.apply(null, pts.concat(base)), mx = Math.max.apply(null, pts.concat(base)), pad = Math.max(1, (mx - mn) * 0.08); mn -= pad; mx += pad;
    var x = function (k) { return L + k * (W - L - R) / (pts.length - 1); }, y = function (v) { return T + (mx - v) * (H - T - B) / (mx - mn); };
    var ticks = [mx - pad, (mx + mn) / 2, mn + pad].map(function (v) { return Math.round(v); }).filter(function (v, k, a) { return a.indexOf(v) === k; });
    var d = pts.map(function (v, k) { return (k ? 'L' : 'M') + x(k).toFixed(1) + ' ' + y(v).toFixed(1); }).join('');
    var endv = pts[pts.length - 1], up = endv >= base, col = o.plain ? 'var(--pro)' : up ? 'var(--win)' : 'var(--loss)', hex = o.plain ? '#e4c37a' : up ? '#34d399' : '#f87171', gid = 'g' + i;
    var aria = (o.label || 'Cumulative units') + ', now ' + (+endv).toFixed(dg) + suf;
    return '<div class="chart" data-c="' + i + '"><svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="' + esc(aria) + '">' +
      '<defs><linearGradient id="' + gid + '" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="' + hex + '" stop-opacity=".22"/><stop offset="1" stop-color="' + hex + '" stop-opacity="0"/></linearGradient></defs>' +
      ticks.map(function (v) { return '<line class="gl" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '" vector-effect="non-scaling-stroke"/>'; }).join('') +
      '<line class="zl" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(base) + '" y2="' + y(base) + '" vector-effect="non-scaling-stroke"/>' +
      '<path d="' + d + 'L' + x(pts.length - 1) + ' ' + (H - B) + 'L' + L + ' ' + (H - B) + 'Z" fill="url(#' + gid + ')"/>' +
      '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="2.2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>' +
      '<line class="hx" x1="0" x2="0" y1="' + T + '" y2="' + (H - B) + '" stroke="var(--dim)" stroke-width="1" vector-effect="non-scaling-stroke" opacity="0"/></svg>' +
      ticks.map(function (v) { return '<span class="yl" style="top:' + (y(v) / H * 100).toFixed(2) + '%">' + (v > 0 && !o.plain ? '+' : '') + v + esc(suf) + '</span>'; }).join('') +
      '<div class="xl"><span>' + esc(first || (dates && dates[0] ? day(dates[0]) : 'First graded pick')) + '</span><span>' + esc(last || (dates && dates[dates.length - 1] ? day(dates[dates.length - 1]) : 'Latest')) + '</span></div><div class="tip" hidden></div></div>';
  }
  function hookCharts() {
    root.querySelectorAll('.chart').forEach(function (c) {
      if (c.getAttribute('data-hooked')) return; c.setAttribute('data-hooked', '1');
      var m = charts[+c.getAttribute('data-c')], pts = m.pts, svg = c.querySelector('svg'), tip = c.querySelector('.tip'), hx = c.querySelector('.hx');
      function show(clientX) {
        var b = svg.getBoundingClientRect(), fx = (clientX - b.left) / b.width;
        var k = Math.max(0, Math.min(pts.length - 1, Math.round((fx * 900 - 44) / (900 - 54) * (pts.length - 1))));
        var sx = 44 + k * (900 - 54) / (pts.length - 1);
        hx.setAttribute('x1', sx); hx.setAttribute('x2', sx); hx.setAttribute('opacity', '.6');
        tip.hidden = false; tip.style.left = Math.max(40, Math.min(b.width - 40, sx / 900 * b.width)) + 'px'; tip.style.top = '40px';
        tip.innerHTML = (m.plain ? (+pts[k]).toFixed(m.dg) + esc(m.suf) : sgn(pts[k], m.dg, m.suf)) + (m.dates && m.dates[k] ? '<br><span class="dim small">' + day(m.dates[k]) + '</span>' : '');
      }
      c.addEventListener('mousemove', function (e) { show(e.clientX); });
      c.addEventListener('touchmove', function (e) { if (e.touches[0]) show(e.touches[0].clientX); }, { passive: true });
      c.addEventListener('mouseleave', function () { tip.hidden = true; hx.setAttribute('opacity', '0'); });
    });
  }
  // horizontal bars: items [{k, v, sub}], value in units unless suf given
  function hbars(items, o) {
    o = o || {};
    items = (items || []).filter(function (it) { return it && it.v != null; });
    if (!items.length) return '<div class="empty small">Not enough graded picks yet.</div>';
    var peak = Math.max.apply(null, items.map(function (it) { return Math.abs(it.v); }).concat(0.01));
    return '<div class="hbars" role="list">' + items.map(function (it) {
      var w = Math.max(1, Math.round(50 * Math.abs(it.v) / peak)), pos = it.v >= 0;
      return '<div class="hbr' + (it.small ? ' hsm' : '') + '" role="listitem"' + (it.small ? ' title="Fewer than 10 picks"' : '') + '><span class="hbk">' + label(it.k) + (it.sub ? ' <span class="dim small">' + it.sub + '</span>' : '') + '</span>' +
        '<span class="hbt" aria-hidden="true"><i class="' + (pos ? 'up' : 'dn') + '" style="' + (pos ? 'left:50%' : 'right:50%') + ';width:' + w + '%"></i></span>' +
        '<b class="num">' + sgn(it.v, o.digits == null ? 2 : o.digits, o.suf == null ? 'u' : o.suf) + '</b></div>';
    }).join('') + '</div>';
  }
  // weekly pick counts as small vertical bars
  function activity(series) {
    if (!series || series.length < 2) return '<div class="empty small">Not enough weeks of activity yet.</div>';
    var W = 900, H = 160, n = series.length, peak = Math.max.apply(null, series.map(function (x) { return x[1]; }).concat(1)), bw = W / n;
    return '<div class="chart act"><svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="Graded picks per week, ' + n + ' weeks, peak ' + peak + '">' +
      series.map(function (x, k) { var h = Math.round((H - 6) * x[1] / peak); return '<rect x="' + (k * bw + bw * 0.15).toFixed(1) + '" y="' + (H - h) + '" width="' + (bw * 0.7).toFixed(1) + '" height="' + h + '" rx="1.5" fill="var(--ink2)" opacity=".55"><title>Week of ' + day(x[0]) + ': ' + x[1] + ' picks</title></rect>'; }).join('') +
      '</svg><div class="xl"><span>Week of ' + day(series[0][0]) + '</span><span>Peak ' + peak + ' picks a week</span><span>Week of ' + day(series[n - 1][0]) + '</span></div></div>';
  }

  function kpis(list) { return '<div class="kpis">' + list.map(function (k) { return '<div class="kpi"><b>' + k[0] + '</b><span>' + k[1] + '</span></div>'; }).join('') + '</div>'; }

  function sportPane(name, s) {
    var o = s.overall, st = s.streaks || {};
    return '<div style="margin-bottom:16px">' + kpis([[rec(o), 'Record'], [sgn(o.net, 2), 'Units'], [sgn(o.roi, 1, '%'), 'ROI'], [pct(o.win_pct), 'Win %'], [fmt(o.picks), 'Graded picks'],
      [odds(o.avg_odds), 'Avg odds'], [strk(st.current), 'Current streak'], [sgn(o.max_drawdown, 2), 'Max drawdown']]) + '</div>' +
      '<div class="pgrid">' + panel(esc(name) + ' cumulative units', '<div class="pb">' + chart(s.curve) + '</div>') + panel('Recent form', table(s.form, 'Window')) + '</div>' +
      '<div class="g2">' + panel('Markets', table(s.markets, 'Market')) + panel('Favorites and underdogs', table(s.fav_dog, 'Side')) + '</div>' +
      '<div class="g2">' + panel('By odds range', table(s.odds, 'Price')) + panel('Overs and unders', table(s.over_under, 'Total')) + '</div>' +
      '<div class="g2">' + panel('By day of the week', table(s.weekday, 'Day'), '<span class="muted small">Game day, Pacific</span>') + panel('By month', table(s.month, 'Month')) + '</div>';
  }

  function tabs(name, items) {
    return '<div class="tabs" data-tabs="' + name + '" style="margin-bottom:14px">' + items.map(function (t, i) { return '<button class="tab' + (i ? '' : ' on') + '" data-i="' + i + '">' + t[0] + '</button>'; }).join('') + '</div>' +
      items.map(function (t, i) { return '<div data-pane="' + name + '" data-i="' + i + '"' + (i ? ' hidden' : '') + '>' + t[1] + '</div>'; }).join('');
  }

  // ---------- page ----------
  function render(p) {
    if (p.detail === false) return renderBasic(p);
    var s = p.summary, o = p.overview || {}, a = p.advanced || {}, c = s.id.slice(0, 6).toUpperCase(), t = TIER[s.tier] || TIER.small;
    var z = a.z || {}, be = a.break_even || {}, clv = a.clv || {}, ost = o.streaks || {};
    document.title = 'Handicapper #' + c + ': ' + rec(o) + ', ' + (o.net > 0 ? '+' : '') + (+o.net).toFixed(2) + ' units | Handicapper Watchdog';
    var sportNames = Object.keys(p.sport_detail || {});
    var h = '';
    var sportHref = function (name) {
      var slug = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      var known = { nfl: 1, mlb: 1, nhl: 1, ncaaf: 1 };
      return known[slug] ? ('sports/' + slug + '.html') : ('cappers.html?q=' + encodeURIComponent(name));
    };

    h += '<nav class="crumbs" aria-label="Breadcrumb"><a href="./">Home</a><span aria-hidden="true">/</span><a href="cappers.html">Rankings</a><span aria-hidden="true">/</span><span aria-current="page">#' + esc(c) + '</span></nav>';
    h += '<section class="phero"><div><div class="pid"><div class="pav">' + esc(c.slice(0, 2)) + '</div><div><div class="eyebrow">Anonymous Watchdog ID</div>' +
      '<h1 class="idc">#' + esc(c) + '</h1>' +
      '<div class="pmeta"><span class="badge ' + t[0] + '" title="' + t[2] + '">' + t[1] + '</span>' +
      (s.sports || []).slice(0, 4).map(function (x) { return '<a class="badge" href="' + sportHref(x) + '">' + esc(x) + '</a>'; }).join('') + '</div>' +
      '<p class="muted small" style="margin:8px 0 0">' + statusTag(p.status) + ' Tracked since ' + day(s.first_pick) + ' · last graded game ' + day(p.last_game || s.last_pick) + ' · verified through ' + day(p.generated_at) + '</p></div></div></div>' +
      '<div class="unl"><span class="lock">Watchdog Pro</span><b>See what this account bets next</b><p>Watchdog Pro adds this account&rsquo;s eligible pending picks before their games start and its complete graded pick log. The name is not published in any plan.</p><a class="btn pro" style="width:100%" href="' + PRO + '">View Watchdog Pro</a></div></section>';

    h += kpis([[rec(o), 'Record'], [sgn(o.net, 2), 'Units won'], [sgn(o.roi, 1, '%'), 'ROI'], [pct(o.win_pct), 'Win %'], [fmt(o.picks), 'Graded picks'],
      [odds(o.avg_odds), 'Avg odds'], [strk(ost.current), 'Current streak'], [s.r30 ? sgn(s.r30.net, 2) : '<span class="dim">n/a</span>', 'Last 30 days']]);

    var secs = [['overview', 'Overview'], ['charts', 'Charts'], ['sports', 'Sports'], ['markets', 'Markets'], ['situations', 'Sides and prices'], ['teams', 'Teams'], ['calendar', 'Calendar'], ['picks', 'Pick ledger']];
    h += '<nav class="snav"><div class="tabs" id="snav">' + secs.map(function (x, i) { return '<a class="tab' + (i ? '' : ' on') + '" href="#' + x[0] + '" style="display:inline-flex;align-items:center">' + x[1] + '</a>'; }).join('') + '</div></nav>';

    var months = s.months || 0;
    h += '<section class="sec" id="overview"><div class="pgrid">' +
      panel('Cumulative units', '<div class="pb">' + chart(p.curve, 'From ' + day(s.first_pick), day(p.generated_at)) + '</div>', '<span class="muted small">1 unit per pick</span>') +
      '<div class="stack">' + panel('Last 20 results', '<div class="pb">' + dots(p.last_results) + '<p class="note" style="margin:10px 0 0">Newest first. Pushes shown as P.</p></div>') +
      panel('Consistency', '<div class="pb">' + facts([['Profitable months', months ? (s.months_up || 0) + ' of ' + months : 'n/a'], ['Longest win run', fmt(ost.longest_win)], ['Longest losing run', fmt(ost.longest_loss)],
        ['Max drawdown', sgn(a.max_drawdown, 2, 'u')], ['Peak', sgn(a.peak_units, 2, 'u')]]) + '</div>') + '</div></div>' +
      '<div class="g2">' + panel('Performance by period', table(p.form_days, 'Window'), '<span class="muted small">By game date</span>') +
        panel('Tracking', '<div class="pb">' + facts([['Watchdog ID', '#' + esc(c)], ['First tracked pick', day(s.first_pick)], ['Most recent graded game', day(p.last_game || s.last_pick)], ['Monitoring status', statusTag(p.status, 1)],
          ['Graded picks', fmt(o.picks)], ['Picks per week', p.per_week == null ? 'n/a' : (+p.per_week).toFixed(1)], ['Avg units risked', p.avg_risk == null ? 'n/a' : (+p.avg_risk).toFixed(2)], ['Pending picks', '<span class="dim">Watchdog Pro</span>']]) +
          '<p class="note" style="margin:10px 0 0">The account name, link and posting site are never published. The ID is permanent.</p></div>') + '</div>' +
      strengths(p) +
      '<div class="g2">' + panel('Advanced metrics', '<div class="pb">' + facts([['Z score vs break even', z.z == null ? 'n/a' : sgn(z.z, 2)], ['Win % needed at their prices', be.needed_pct == null ? 'n/a' : pct(be.needed_pct)],
        ['Gap to break even', be.gap_pts == null ? 'n/a' : sgn(be.gap_pts, 2, ' pts')], ['Avg closing line value', clv.avg_pts == null ? 'n/a' : sgn(clv.avg_pts, 2, ' pts')], ['Beat the closing line', clv.beat_pct == null ? 'n/a' : pct(clv.beat_pct)],
        ['Volatility per pick', a.volatility == null ? 'n/a' : (+a.volatility).toFixed(2)]]) +
        '<p class="note" style="margin:10px 0 0">Z score compares wins with what a break even bettor would win at the same prices. Closing line value is measured on ' + fmt(clv.n || 0) + ' picks with a closing price.</p></div>') +
      panel('Verification', '<div class="pb">' + facts([['Graded picks in this record', fmt(o.picks)], ['Picks without a price', fmt(o.unpriced || 0) + ' <span class="dim small">(in W-L, not units)</span>'], ['Pending picks', '<span class="dim">never counted</span>'],
        ['Sample size', '<span class="badge ' + t[0] + '">' + t[1] + '</span>'], ['Record verified through', day(p.generated_at)]]) +
        '<p class="note" style="margin:10px 0 0">' + t[2] + ' Every pick was captured from a public post made before the game started and graded on the final score.</p></div>') + '</div>' +
      '<div class="g2">' + panel('Form by recent picks', table(p.form_picks, 'Window')) + panel('After a win or a loss', table(p.after, 'Situation')) + '</div>' + '</section>';

    var sportBars = sportNames.map(function (n) { var x = p.sport_detail[n].overall; return { k: n, v: x.net, sub: rec(x) + ', ' + fmt(x.picks) + ' picks', small: x.picks < 10 }; });
    var monthBars = (p.month || []).slice().sort(function (a, b) { return String(a.key) < String(b.key) ? -1 : 1; }).slice(-12).map(function (x) { return { k: x.key, v: x.net, sub: rec(x) }; });
    var rn = p.rolling_n || 50;
    h += '<section class="sec" id="charts"><div class="sech"><h2>Charts</h2><span class="muted small">Every point is computed from graded picks</span></div>' + panel('Performance over time', '<div class="pb">' + tabs('ch', [
      ['Cumulative units', chart(p.curve, null, null, { dates: p.curve_dates, label: 'Cumulative units' }) + '<p class="note">Profit if 1 unit had been risked on every priced pick.</p>'],
      ['ROI over time', chart(p.roi_curve, null, null, { dates: p.curve_dates, suf: '%', digits: 1, label: 'Lifetime ROI' }) + '<p class="note">Lifetime ROI after each graded pick. Starts once 10 units have been risked.</p>'],
      ['Rolling win %', chart(p.rolling_win, null, null, { suf: '%', digits: 1, zero: 50, plain: 1, label: 'Rolling win rate' }) + '<p class="note">Win rate over each run of ' + rn + ' decided picks. The center line is 50%. Break even at -110 is 52.4%.</p>'],
      ['Picks per week', activity(p.activity) + '<p class="note">Graded picks by game week, Pacific time.</p>']]) + '</div>') +
      '<div class="g2">' + panel('Units by sport', '<div class="pb">' + hbars(sportBars) + '</div>') + panel('Units by month', '<div class="pb">' + hbars(monthBars) + '</div>', '<span class="muted small">Last 12 months</span>') + '</div></section>';

    h += '<section class="sec" id="sports"><div class="sech"><h2>Sport by sport</h2><span class="muted small">' + sportNames.length + ' sports</span></div>' +
      (sportNames.length ? tabs('sp', sportNames.map(function (n) { return [esc(n) + ' <span class="dim">' + p.sport_detail[n].overall.picks + '</span>', sportPane(n, p.sport_detail[n])]; })) : '<div class="empty">No sport data yet.</div>') + '</section>';

    h += '<section class="sec" id="markets"><div class="sech"><h2>Markets</h2></div><div class="g2">' + panel('By market', table(p.markets, 'Market', { sort: 1 })) + panel('By sport and market', table(p.market_detail, 'Sport · market', { sort: 1, limit: 14 })) + '</div></section>';
    h += '<section class="sec" id="situations"><div class="sech"><h2>Sides and prices</h2></div><div class="g2">' + panel('Favorites and underdogs', table(p.fav_dog, 'Side')) + panel('Plus money', table(p.plus_money, 'Price')) + '</div>' +
      '<div class="g2">' + panel('By odds range', table(p.odds_buckets, 'Price')) + '<div class="stack">' + panel('Overs and unders', table(p.over_under, 'Total')) + panel('Home and away', table(p.home_away, 'Side')) + '</div></div></section>';
    h += '<section class="sec" id="teams"><div class="sech"><h2>Teams</h2></div><div class="g2">' + panel('Teams backed most', table(p.teams_backing, 'Team', { sort: 1, limit: 12 })) + panel('Teams faded most', table(p.teams_fading, 'Team', { sort: 1, limit: 12 })) + '</div>' +
      '<div class="g2">' + panel('Conferences backed', table(p.conference_backing, 'Conference', { sort: 1, limit: 10 })) + panel('Divisions backed', table(p.division_backing, 'Division', { sort: 1, limit: 10 })) + '</div></section>';
    h += '<section class="sec" id="calendar"><div class="sech"><h2>Calendar</h2></div><div class="g2">' + panel('By day of the week', table(p.weekday, 'Day')) + '<div class="stack">' + panel('By month', table(p.month, 'Month')) + panel('By season', table(p.season, 'Season')) + '</div></div></section>';

    // pick ledger: the most recent graded picks. Never the post text, post link or account.
    var L = p.ledger || [];
    var opt = function (arr) { var seen = {}; return arr.filter(function (v) { if (!v || seen[v]) return false; seen[v] = 1; return true; }).sort().map(function (v) { return '<option>' + esc(v) + '</option>'; }).join(''); };
    h += '<section class="sec" id="picks"><div id="ppend"></div><div class="sech"><h2>Pick ledger</h2><span class="muted small" id="lhead">' + fmt(L.length) + ' most recent of ' + fmt(o.picks) + ' graded picks</span></div><div class="panel">' +
      (L.length ? '<div class="fbar lfbar"><div class="fld"><label for="lq">Search</label><input id="lq" placeholder="Team or pick"></div>' +
        '<div class="fld"><label for="lsp">Sport</label><select id="lsp"><option value="">All</option>' + opt(L.map(function (r) { return r.sp; })) + '</select></div>' +
        '<div class="fld"><label for="lmk">Bet type</label><select id="lmk"><option value="">All</option>' + opt(L.map(function (r) { return r.mk; })) + '</select></div>' +
        '<div class="fld"><label for="lr">Result</label><select id="lr"><option value="">All</option><option value="W">Wins</option><option value="L">Losses</option><option value="P">Pushes</option></select></div>' +
        '<div class="fld"><label for="lfrom">From</label><input id="lfrom" type="date"></div><div class="fld"><label for="lto">To</label><input id="lto" type="date"></div></div>' +
        '<div class="tw"><table class="mini ledger"><thead><tr><th class="l">Date</th><th class="l hg">Sport</th><th class="l hg">Game</th><th class="l">Pick</th><th>Odds</th><th class="hm">Risk</th><th>Result</th><th class="hm">Final</th><th>Units</th><th class="hm">Before start</th></tr></thead><tbody id="lrows"></tbody></table></div>' +
        '<div class="tfoot"><span id="lcount" class="muted small"></span><div class="pager"><button class="btn sm ghost" id="lprev" type="button">Previous</button><span id="lpg"></span><button class="btn sm ghost" id="lnext" type="button">Next</button></div></div>'
        : '<div class="empty small">No graded picks to list yet.</div>') +
      '<div class="lockfoot" id="lockfoot"><span class="lock">Watchdog Pro</span><span>The complete log of all ' + fmt(o.picks) + ' graded picks and this account&rsquo;s eligible pending picks before the start are in Watchdog Pro.</span><a class="btn sm pro" href="' + PRO + '">View Watchdog Pro</a></div></div>' +
      '<p class="note">Posted shows how long before the start the pick was captured. Odds are the posted price when the post had one; picks without a price count in the record but not in units.</p></section>';

    root.innerHTML = h;
    hookCharts();
    ledger(L);
    if (window.HWD) HWD.ready.then(function (st) { if (st.pro) unlock(s, o); });
    root.addEventListener('click', function (e) {
      var b = e.target.closest('button.tab'); if (!b) return;
      var box = b.parentNode, name = box.getAttribute('data-tabs'), i = b.getAttribute('data-i');
      box.querySelectorAll('.tab').forEach(function (x) { x.classList.toggle('on', x === b); });
      root.querySelectorAll('[data-pane="' + name + '"]').forEach(function (pn) { pn.hidden = pn.getAttribute('data-i') !== i; });
    });
    var links = [].slice.call(document.querySelectorAll('#snav a'));
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (en) {
        en.forEach(function (x) { if (x.isIntersecting) links.forEach(function (l) { l.classList.toggle('on', l.getAttribute('href') === '#' + x.target.id); }); });
      }, { rootMargin: '-130px 0px -65% 0px' });
      secs.forEach(function (x) { var el = document.getElementById(x[0]); if (el) io.observe(el); });
    }
  }
  function statusTag(st, long) {
    if (st === 'active') return '<span class="badge est">Active</span>' + (long ? ' <span class="dim small">graded game in the last 14 days</span>' : '');
    if (st === 'quiet') return '<span class="badge sm">Quiet</span>' + (long ? ' <span class="dim small">no graded game in 14 days</span>' : '');
    return '';
  }
  function strengths(p) {
    function card(t, x, min) {
      if (!x) return panel(t, '<div class="pb"><p class="muted small" style="margin:0">Not enough data: this needs at least two groups with ' + (min || 20) + ' or more graded picks each.</p></div>');
      var row = function (lab, r) { return '<li><span>' + lab + ': <b>' + label(r.key) + '</b> <span class="dim small">' + rec(r) + ', ' + fmt(r.picks) + ' picks</span></span><b class="num">' + sgn(r.roi, 1, '%') + '</b></li>'; };
      return panel(t, '<div class="pb"><ul class="facts">' + row('Best', x.best) + row('Worst', x.worst) + '</ul><p class="note" style="margin:10px 0 0">By ROI, groups with ' + x.min + ' or more graded picks. Past results only.</p></div>');
    }
    return '<div class="g2">' + card('Best and worst sports', p.best_sport) + card('Best and worst bet types', p.best_market) + '</div>';
  }
  var ledgerSet = null;
  function ledger(L) {
    if (ledgerSet) return ledgerSet(L);
    var tb = document.getElementById('lrows'); if (!tb) return;
    var PER = 10, pg = 1, view = L;
    var g = function (id) { return document.getElementById(id); };
    var lead = function (m) { if (m == null) return '<span class="dim">n/a</span>'; if (m < 60) return m + 'm'; if (m < 2880) return Math.floor(m / 60) + 'h ' + (m % 60) + 'm'; return Math.floor(m / 1440) + 'd'; };
    var yr = new Date().getFullYear();
    var sday = function (d) { if (!d) return 'n/a'; var t = new Date(d + 'T12:00:00Z'); return t.toLocaleDateString('en-US', t.getUTCFullYear() === yr ? { month: 'short', day: 'numeric', timeZone: 'UTC' } : { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }); };
    var res = { W: '<span class="st pos">Win</span>', L: '<span class="st neg">Loss</span>', P: '<span class="dim">Push</span>' };
    function apply() {
      var q = g('lq').value.trim().toLowerCase(), sp = g('lsp').value, mk = g('lmk').value, r = g('lr').value, f = g('lfrom').value, t = g('lto').value;
      view = L.filter(function (x) {
        return (!sp || x.sp === sp) && (!mk || x.mk === mk) && (!r || x.r === r) && (!f || (x.d && x.d >= f)) && (!t || (x.d && x.d <= t)) &&
          (!q || (String(x.m || '') + ' ' + String(x.pk || '')).toLowerCase().indexOf(q) >= 0);
      });
      pg = 1; draw();
    }
    function draw() {
      var pages = Math.max(1, Math.ceil(view.length / PER)), rows = view.slice((pg - 1) * PER, pg * PER);
      tb.innerHTML = rows.length ? rows.map(function (x) {
        return '<tr><td class="l nowrap">' + sday(x.d) + '</td><td class="l hg">' + esc(x.sp) + '</td><td class="l hg">' + esc(x.m) + '</td><td class="l"><b>' + esc(x.pk) + '</b> <span class="dim small">' + esc(x.mk) + '</span><span class="sg dim small">' + esc(x.sp) + ' &middot; ' + esc(x.m) + '</span></td>' +
          '<td>' + odds(x.o) + '</td><td class="hm">' + (x.u ? (+x.u).toFixed(2) : '<span class="dim">unpriced</span>') + '</td><td>' + (res[x.r] || esc(x.r)) + '</td><td class="hm">' + esc(x.f || '') + '</td><td>' + (x.u ? sgn(x.pl, 2) : '<span class="dim">0</span>') + '</td><td class="hm">' + lead(x.lead) + '</td></tr>';
      }).join('') : '<tr><td colspan="10" class="empty">No picks match these filters.</td></tr>';
      g('lcount').textContent = fmt(view.length) + ' of ' + fmt(L.length) + ' listed picks';
      g('lpg').textContent = pg + ' / ' + pages; g('lprev').disabled = pg <= 1; g('lnext').disabled = pg >= pages;
    }
    ['lsp', 'lmk', 'lr', 'lfrom', 'lto'].forEach(function (id) { g(id).addEventListener('change', apply); });
    g('lq').addEventListener('input', apply);
    g('lprev').onclick = function () { if (pg > 1) { pg--; draw(); } };
    g('lnext').onclick = function () { if (pg * PER < view.length) { pg++; draw(); } };
    ledgerSet = function (next) {
      L = next;
      var fill = function (id, vals) { var el = g(id), cur = el.value, seen = {}; el.innerHTML = '<option value="">All</option>' + vals.filter(function (v) { if (!v || seen[v]) return false; seen[v] = 1; return true; }).sort().map(function (v) { return '<option>' + esc(v) + '</option>'; }).join(''); el.value = cur; };
      fill('lsp', L.map(function (r) { return r.sp; })); fill('lmk', L.map(function (r) { return r.mk; }));
      apply();
    };
    draw();
  }
  // Watchdog Pro: this account's eligible pending picks, from the one encrypted pending feed
  function pendingFor(id) {
    if (window.HWD && HWD.followButton) HWD.followButton(id);
    var box = document.getElementById('ppend'); if (!box) return;
    var when = function (iso) { return iso ? new Date(iso).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' PT' : 'n/a'; };
    var draw = function (body) { box.innerHTML = '<div class="sech"><h2>Eligible pending picks</h2><span class="lock">Watchdog Pro</span></div><div class="panel" style="margin-bottom:18px">' + body + '</div>'; };
    HWD.pending().then(function (d) {
      var live = (d.picks || []).filter(function (p) { return p.id === id && p.start && new Date(p.start) > new Date(); });
      draw(!live.length ? '<div class="empty small">No eligible pending picks from this account right now. Picks appear here after capture and leave when the game starts.</div>'
        : '<div class="tw"><table class="mini"><thead><tr><th class="l">Starts</th><th class="l">Game</th><th class="l">Pick</th><th>Odds</th><th class="hm">Units</th></tr></thead><tbody>' +
          live.map(function (p) { return '<tr><td class="l nowrap">' + when(p.start) + '</td><td class="l">' + esc(p.league) + ' &middot; ' + esc(p.matchup) + '</td><td class="l"><b>' + esc(p.selection) + '</b> <span class="dim small">' + esc(p.bet_type) + '</span></td><td>' + odds(p.odds) + '</td><td class="hm">' + (p.units == null ? '<span class="dim">n/a</span>' : esc(p.units)) + '</td></tr>'; }).join('') +
          '</tbody></table></div>');
    }).catch(function () { draw('<div class="empty small">The pending pick feed is not available at this update. Graded records are unaffected.</div>'); });
  }
  // Watchdog Pro: the full anonymous ledger and this account's eligible pending picks, decrypted in the browser
  function unlock(s, o) {
    pendingFor(s.id);
    HWD.capper(s.id).then(function (d) {
      ledger(d.ledger || []);
      var hd = document.getElementById('lhead'); if (hd) hd.textContent = 'All ' + fmt((d.ledger || []).length) + ' graded picks';
      var lf = document.getElementById('lockfoot'); if (lf) lf.innerHTML = '<span class="lock">Watchdog Pro</span><span>Full graded log unlocked for your account.</span>';
    }).catch(function () {
      var lf = document.getElementById('lockfoot');
      if (lf) lf.innerHTML = '<span class="lock">Watchdog Pro</span><span>The full log did not load. Refresh the page; if it keeps failing, sign in again from your account page.</span>';
    });
  }
  function renderBasic(p) {
    var s = p.summary, c = s.id.slice(0, 6).toUpperCase(), t = TIER[s.tier] || TIER.small;
    document.title = 'Handicapper #' + c + ': ' + rec(s) + ' | Handicapper Watchdog';
    var why = p.reason === 'unreconciled'
      ? 'The detailed breakdown is held back because the pick history did not reproduce this record exactly at the last update. Watchdog does not publish analytics it cannot reconcile. The headline record below comes straight from the grading ledger.'
      : p.reason === 'updating' ? 'New grades arrived for this account since its detailed breakdown was built, so the breakdown is being rebuilt. It returns at a coming update. The headline record below is current.'
      : 'The detailed breakdown for this account is still being built. The headline record below comes straight from the grading ledger.';
    var bs = (p.by_sport || []).map(function (b) { var r = String(b.record || '').split('-').map(Number); return { key: b.key, picks: b.picks, w: r[0] || 0, l: r[1] || 0, p: r[2] || 0, net: b.units, roi: b.roi, win_pct: b.win_pct }; });
    root.innerHTML = '<nav class="crumbs" aria-label="Breadcrumb"><a href="./">Home</a><span aria-hidden="true">/</span><a href="cappers.html">Rankings</a><span aria-hidden="true">/</span><span aria-current="page">#' + esc(c) + '</span></nav>' +
      '<section class="phero"><div><div class="pid"><div class="pav">' + esc(c.slice(0, 2)) + '</div><div><div class="eyebrow">Anonymous Watchdog ID</div><h1 class="idc">#' + esc(c) + '</h1>' +
      '<div class="pmeta"><span class="badge ' + t[0] + '" title="' + t[2] + '">' + t[1] + '</span></div><p class="muted small" style="margin:8px 0 0">Last pick ' + day(s.last_pick) + '</p></div></div></div>' +
      '<div class="unl"><span class="lock">Watchdog Pro</span><b>See what this account bets next</b><p>Watchdog Pro adds eligible pending picks before their games start. The name is not published in any plan.</p><a class="btn pro" style="width:100%" href="' + PRO + '">View Watchdog Pro</a></div></section>' +
      kpis([[rec(s), 'Record'], [sgn(s.units, 2), 'Units won'], [sgn(s.roi, 1, '%'), 'ROI'], [pct(s.win_pct), 'Win %'], [fmt(s.picks), 'Graded picks'], [s.streak > 0 ? '<span class="pos">W' + s.streak + '</span>' : s.streak < 0 ? '<span class="neg">L' + (-s.streak) + '</span>' : '<span class="dim">n/a</span>', 'Current streak']]) +
      '<div class="disclosure" style="margin:16px 0"><b>Detailed analytics not shown</b><p class="muted">' + why + '</p></div>' +
      panel('By sport', table(bs, 'Sport', { sort: 1 })) + '<div id="ppend" style="margin-top:18px"></div>';
    if (window.HWD) HWD.ready.then(function (st) { if (st.pro) pendingFor(s.id); });
  }
})();
