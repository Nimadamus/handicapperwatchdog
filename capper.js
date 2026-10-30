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
  function chart(pts, first, last) {
    if (!pts || pts.length < 2) return '<div class="empty small">Not enough graded picks to chart yet.</div>';
    var i = charts.push(pts) - 1;
    var W = 900, H = 240, L = 44, R = 10, T = 12, B = 26;
    var mn = Math.min.apply(null, pts.concat(0)), mx = Math.max.apply(null, pts.concat(0)), pad = Math.max(1, (mx - mn) * 0.08); mn -= pad; mx += pad;
    var x = function (k) { return L + k * (W - L - R) / (pts.length - 1); }, y = function (v) { return T + (mx - v) * (H - T - B) / (mx - mn); };
    var ticks = [mx - pad, (mx + mn) / 2, mn + pad].map(function (v) { return Math.round(v); }).filter(function (v, k, a) { return a.indexOf(v) === k; });
    var d = pts.map(function (v, k) { return (k ? 'L' : 'M') + x(k).toFixed(1) + ' ' + y(v).toFixed(1); }).join('');
    var endv = pts[pts.length - 1], col = endv >= 0 ? 'var(--win)' : 'var(--loss)', hex = endv >= 0 ? '#34d399' : '#f87171', gid = 'g' + i;
    return '<div class="chart" data-c="' + i + '"><svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="Cumulative units, now ' + endv.toFixed(2) + '">' +
      '<defs><linearGradient id="' + gid + '" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="' + hex + '" stop-opacity=".22"/><stop offset="1" stop-color="' + hex + '" stop-opacity="0"/></linearGradient></defs>' +
      ticks.map(function (v) { return '<line class="gl" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '" vector-effect="non-scaling-stroke"/>'; }).join('') +
      '<line class="zl" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(0) + '" y2="' + y(0) + '" vector-effect="non-scaling-stroke"/>' +
      '<path d="' + d + 'L' + x(pts.length - 1) + ' ' + (H - B) + 'L' + L + ' ' + (H - B) + 'Z" fill="url(#' + gid + ')"/>' +
      '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="2.2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>' +
      '<line class="hx" x1="0" x2="0" y1="' + T + '" y2="' + (H - B) + '" stroke="var(--dim)" stroke-width="1" vector-effect="non-scaling-stroke" opacity="0"/></svg>' +
      ticks.map(function (v) { return '<span class="yl" style="top:' + (y(v) / H * 100).toFixed(2) + '%">' + (v > 0 ? '+' : '') + v + 'u</span>'; }).join('') +
      '<div class="xl"><span>' + esc(first || 'First graded pick') + '</span><span>' + esc(last || 'Latest') + '</span></div><div class="tip" hidden></div></div>';
  }
  function hookCharts() {
    root.querySelectorAll('.chart:not([data-h])').forEach(function (c) {
      c.setAttribute('data-h', '1');
      var pts = charts[+c.getAttribute('data-c')], svg = c.querySelector('svg'), tip = c.querySelector('.tip'), hx = c.querySelector('.hx');
      c.addEventListener('mousemove', function (e) {
        var b = svg.getBoundingClientRect(), fx = (e.clientX - b.left) / b.width;
        var k = Math.max(0, Math.min(pts.length - 1, Math.round((fx * 900 - 44) / (900 - 54) * (pts.length - 1))));
        var sx = 44 + k * (900 - 54) / (pts.length - 1);
        hx.setAttribute('x1', sx); hx.setAttribute('x2', sx); hx.setAttribute('opacity', '.6');
        tip.hidden = false; tip.style.left = (sx / 900 * b.width) + 'px'; tip.style.top = '40px'; tip.innerHTML = sgn(pts[k], 2, 'u');
      });
      c.addEventListener('mouseleave', function () { tip.hidden = true; hx.setAttribute('opacity', '0'); });
    });
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

  // Panes may be functions: only the first is built up front, the rest when their tab is opened (keeps the DOM small).
  var lazy = {};
  function tabs(name, items) {
    lazy[name] = items.map(function (t) { return t[1]; });
    return '<div class="tabs" data-tabs="' + name + '" style="margin-bottom:14px">' + items.map(function (t, i) { return '<button class="tab' + (i ? '' : ' on') + '" data-i="' + i + '">' + t[0] + '</button>'; }).join('') + '</div>' +
      items.map(function (t, i) { return '<div data-pane="' + name + '" data-i="' + i + '"' + (i ? ' hidden' : '') + '>' + (i ? '' : typeof t[1] === 'function' ? t[1]() : t[1]) + '</div>'; }).join('');
  }

  // ---------- Watchdog Pro: name and pick log, decrypted in the browser with a key only a subscriber can get ----------
  function unlock(s, o) {
    HWD.capper(s.id).then(function (d) {
      document.getElementById('pname').textContent = d.handle;
      document.title = d.handle + ' betting record: ' + rec(o) + ' | Handicapper Watchdog';
      var unl = root.querySelector('.unl');
      if (unl) unl.innerHTML = '<span class="lock">Watchdog Pro</span><b>' + esc(d.handle) + ' on ' + esc(d.source) + '</b><p>Every graded pick is below with a link to the original post.</p>' +
        '<a class="btn ghost" style="width:100%" href="compare.html?ids=' + s.id + '">Compare with others</a>';
      var sec = document.getElementById('picks'), picks = d.picks || [], sports = {}, page = 0, PER = 50, f = { sport: '', res: '' };
      picks.forEach(function (p) { sports[p.sport] = 1; });
      sec.innerHTML = '<div class="sech"><h2>Pick log</h2><span class="muted small">' + fmt(picks.length) + ' graded picks, newest first</span></div><div class="panel">' +
        '<div class="ph" style="gap:10px;justify-content:flex-start"><select id="plS" style="width:auto" aria-label="Filter picks by sport"><option value="">All sports</option>' + Object.keys(sports).sort().map(function (x) { return '<option>' + esc(x) + '</option>'; }).join('') + '</select>' +
        '<select id="plR" style="width:auto" aria-label="Filter picks by result"><option value="">All results</option><option value="won">Wins</option><option value="lost">Losses</option><option value="push">Pushes</option></select></div>' +
        '<div class="tw"><table class="mini plog"><thead><tr><th class="l">Game</th><th class="l">Pick</th><th>Price</th><th>Result</th><th>Units</th><th class="hm">Final</th><th class="hm">Posted</th><th class="l">Post</th></tr></thead><tbody id="plB"></tbody></table></div>' +
        '<div class="tfoot"><span id="plC"></span><div class="pager"><button class="btn sm ghost" id="plP" type="button">Newer</button><button class="btn sm ghost" id="plN" type="button">Older</button></div></div></div>';
      var when = function (iso) { return iso ? new Date(iso).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''; };
      function draw() {
        var rows = picks.filter(function (p) { return (!f.sport || p.sport === f.sport) && (!f.res || p.result === f.res); });
        var pages = Math.max(1, Math.ceil(rows.length / PER)); page = Math.min(page, pages - 1);
        document.getElementById('plB').innerHTML = rows.slice(page * PER, page * PER + PER).map(function (p) {
          var r = p.result === 'won' ? '<span class="pos">Won</span>' : p.result === 'lost' ? '<span class="neg">Lost</span>' : '<span class="dim">Push</span>';
          var safe = /^https:\/\/[^\s"<>]+$/.test(p.url || '') ? p.url : '';
          return '<tr><td class="l"><span class="dim small">' + esc(p.sport) + '</span> ' + esc(p.matchup) + '<br><span class="dim small">' + when(p.game) + '</span></td><td class="l"><b>' + esc(p.pick) + '</b><br><span class="dim small">' + esc(p.market) + '</span></td>' +
            '<td>' + (p.odds == null ? '<span class="dim">n/a</span>' : (p.odds > 0 ? '+' : '') + p.odds) + '</td><td>' + r + '</td><td>' + sgn(p.pl, 2) + '</td><td class="hm">' + esc(p.final || '') + '</td><td class="hm muted">' + when(p.posted) + '</td>' +
            '<td class="l">' + (safe ? '<a href="' + esc(safe) + '" target="_blank" rel="nofollow noopener noreferrer" title="' + esc((p.text || '').slice(0, 200)) + '" style="text-decoration:underline">Open</a>' : '<span class="dim">n/a</span>') + '</td></tr>';
        }).join('') || '<tr><td colspan="8" class="empty">No picks match.</td></tr>';
        document.getElementById('plC').textContent = fmt(rows.length) + ' picks · page ' + (page + 1) + ' of ' + pages;
        document.getElementById('plP').disabled = page === 0; document.getElementById('plN').disabled = page >= pages - 1;
      }
      document.getElementById('plS').onchange = function () { f.sport = this.value; page = 0; draw(); };
      document.getElementById('plR').onchange = function () { f.res = this.value; page = 0; draw(); };
      document.getElementById('plP').onclick = function () { page--; draw(); };
      document.getElementById('plN').onclick = function () { page++; draw(); };
      draw();
    }).catch(function () {
      var sec = document.getElementById('picks');
      if (sec) sec.insertAdjacentHTML('afterbegin', '<div class="notice">Pro data for this handicapper is not available yet. It is added on the next update.</div>');
    });
  }

  // ---------- page ----------
  function render(p) {
    var s = p.summary, o = p.overview || {}, a = p.advanced || {}, c = s.id.slice(0, 4).toUpperCase(), t = TIER[s.tier] || TIER.small;
    var z = a.z || {}, be = a.break_even || {}, clv = a.clv || {}, ost = o.streaks || {};
    document.title = 'Handicapper ' + c + ': ' + rec(o) + ', ' + (o.net > 0 ? '+' : '') + (+o.net).toFixed(2) + ' units | Handicapper Watchdog';
    var sportNames = Object.keys(p.sport_detail || {});
    var h = '';
    var sportHref = function (name) {
      var slug = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      var known = { nfl: 1, mlb: 1, nhl: 1, ncaaf: 1 };
      return known[slug] ? ('sports/' + slug + '.html') : ('cappers.html?q=' + encodeURIComponent(name));
    };

    h += '<nav class="crumbs" aria-label="Breadcrumb"><a href="./">Home</a><span aria-hidden="true">/</span><a href="cappers.html">Rankings</a><span aria-hidden="true">/</span><span aria-current="page">ID ' + esc(c) + '</span></nav>';
    h += '<section class="phero"><div><div class="pid"><div class="pav">' + esc(c.slice(0, 2)) + '</div><div><div class="eyebrow">Handicapper profile · ID ' + esc(c) + '</div>' +
      '<h1 id="pname"><span class="blur" aria-label="Name hidden">Hidden handle</span></h1>' +
      '<div class="pmeta"><span class="badge ' + t[0] + '" title="' + t[2] + '">' + t[1] + '</span>' +
      (s.sports || []).slice(0, 4).map(function (x) { return '<a class="badge" href="' + sportHref(x) + '">' + esc(x) + '</a>'; }).join('') + '</div>' +
      '<p class="muted small" style="margin:8px 0 0">Tracked since ' + day(s.first_pick) + ' · last pick ' + day(s.last_pick) + ' · verified through ' + day(p.generated_at) + '</p></div></div></div>' +
      '<div class="unl"><span class="lock">Watchdog Pro</span><b>See who this is and what they are betting</b><p>Watchdog Pro shows this handicapper&rsquo;s name and posting site, every graded pick with the original post, and side by side comparisons.</p><a class="btn pro" style="width:100%" href="' + PRO + '">$59.99 a month</a></div></section>';

    h += kpis([[rec(o), 'Record'], [sgn(o.net, 2), 'Units won'], [sgn(o.roi, 1, '%'), 'ROI'], [pct(o.win_pct), 'Win %'], [fmt(o.picks), 'Graded picks'],
      [odds(o.avg_odds), 'Avg odds'], [strk(ost.current), 'Current streak'], [s.r30 ? sgn(s.r30.net, 2) : '<span class="dim">n/a</span>', 'Last 30 days']]);

    var secs = [['overview', 'Overview'], ['sports', 'Sports'], ['markets', 'Markets'], ['situations', 'Sides and prices'], ['teams', 'Teams'], ['calendar', 'Calendar'], ['picks', 'Pick log']];
    h += '<nav class="snav"><div class="tabs" id="snav">' + secs.map(function (x, i) { return '<a class="tab' + (i ? '' : ' on') + '" href="#' + x[0] + '" style="display:inline-flex;align-items:center">' + x[1] + '</a>'; }).join('') + '</div></nav>';

    var months = s.months || 0;
    h += '<section class="sec" id="overview"><div class="pgrid">' +
      panel('Cumulative units', '<div class="pb">' + chart(p.curve, 'From ' + day(s.first_pick), day(p.generated_at)) + '</div>', '<span class="muted small">1 unit per pick</span>') +
      '<div class="stack">' + panel('Last 20 results', '<div class="pb">' + dots(p.last_results) + '<p class="note" style="margin:10px 0 0">Newest first. Pushes shown as P.</p></div>') +
      panel('Consistency', '<div class="pb">' + facts([['Profitable months', months ? (s.months_up || 0) + ' of ' + months : 'n/a'], ['Longest win run', fmt(ost.longest_win)], ['Longest losing run', fmt(ost.longest_loss)],
        ['Max drawdown', sgn(a.max_drawdown, 2, 'u')], ['Peak', sgn(a.peak_units, 2, 'u')]]) + '</div>') + '</div></div>' +
      '<div class="g2">' + panel('Advanced metrics', '<div class="pb">' + facts([['Z score vs break even', z.z == null ? 'n/a' : sgn(z.z, 2)], ['Win % needed at their prices', be.needed_pct == null ? 'n/a' : pct(be.needed_pct)],
        ['Gap to break even', be.gap_pts == null ? 'n/a' : sgn(be.gap_pts, 2, ' pts')], ['Avg closing line value', clv.avg_pts == null ? 'n/a' : sgn(clv.avg_pts, 2, ' pts')], ['Beat the closing line', clv.beat_pct == null ? 'n/a' : pct(clv.beat_pct)],
        ['Volatility per pick', a.volatility == null ? 'n/a' : (+a.volatility).toFixed(2)]]) +
        '<p class="note" style="margin:10px 0 0">Z score compares wins with what a break even bettor would win at the same prices. Closing line value is measured on ' + fmt(clv.n || 0) + ' picks with a closing price.</p></div>') +
      panel('Verification', '<div class="pb">' + facts([['Graded picks in this record', fmt(o.picks)], ['Picks without a price', fmt(o.unpriced || 0) + ' <span class="dim small">(in W-L, not units)</span>'], ['Pending picks', '<span class="dim">never counted</span>'],
        ['Sample size', '<span class="badge ' + t[0] + '">' + t[1] + '</span>'], ['Record verified through', day(p.generated_at)]]) +
        '<p class="note" style="margin:10px 0 0">' + t[2] + ' Every pick was captured from a public post made before the game started and graded on the final score.</p></div>') + '</div>' +
      '<div class="g2">' + panel('Form by recent picks', table(p.form_picks, 'Window')) + panel('Form by days', table(p.form_days, 'Window')) + '</div>' +
      panel('After a win or a loss', table(p.after, 'Situation')) + '</section>';

    h += '<section class="sec" id="sports"><div class="sech"><h2>Sport by sport</h2><span class="muted small">' + sportNames.length + ' sports</span></div>' +
      (sportNames.length ? tabs('sp', sportNames.map(function (n) { return [esc(n) + ' <span class="dim">' + p.sport_detail[n].overall.picks + '</span>', function () { return sportPane(n, p.sport_detail[n]); }]; })) : '<div class="empty">No sport data yet.</div>') + '</section>';

    h += '<section class="sec" id="markets"><div class="sech"><h2>Markets</h2></div><div class="g2">' + panel('By market', table(p.markets, 'Market', { sort: 1 })) + panel('By sport and market', table(p.market_detail, 'Sport · market', { sort: 1, limit: 14 })) + '</div></section>';
    h += '<section class="sec" id="situations"><div class="sech"><h2>Sides and prices</h2></div><div class="g2">' + panel('Favorites and underdogs', table(p.fav_dog, 'Side')) + panel('Plus money', table(p.plus_money, 'Price')) + '</div>' +
      '<div class="g2">' + panel('By odds range', table(p.odds_buckets, 'Price')) + '<div class="stack">' + panel('Overs and unders', table(p.over_under, 'Total')) + panel('Home and away', table(p.home_away, 'Side')) + '</div></div></section>';
    h += '<section class="sec" id="teams"><div class="sech"><h2>Teams</h2></div><div class="g2">' + panel('Teams backed most', table(p.teams_backing, 'Team', { sort: 1, limit: 12 })) + panel('Teams faded most', table(p.teams_fading, 'Team', { sort: 1, limit: 12 })) + '</div>' +
      '<div class="g2">' + panel('Conferences backed', table(p.conference_backing, 'Conference', { sort: 1, limit: 10 })) + panel('Divisions backed', table(p.division_backing, 'Division', { sort: 1, limit: 10 })) + '</div></section>';
    h += '<section class="sec" id="calendar"><div class="sech"><h2>Calendar</h2></div><div class="g2">' + panel('By day of the week', table(p.weekday, 'Day')) + '<div class="stack">' + panel('By month', table(p.month, 'Month')) + panel('By season', table(p.season, 'Season')) + '</div></div></section>';

    // pick log: locked; no pick rows are ever published on this site
    var sk = '<tr><td class="l"><div class="skel" style="width:180px"></div></td><td class="l"><div class="skel" style="width:110px"></div></td><td><div class="skel" style="width:40px;margin-left:auto"></div></td><td><div class="skel" style="width:36px;margin-left:auto"></div></td><td><div class="skel" style="width:44px;margin-left:auto"></div></td><td class="hm"><div class="skel" style="width:70px;margin-left:auto"></div></td></tr>';
    h += '<section class="sec" id="picks"><div class="sech"><h2>Pick log</h2><span class="lock">Watchdog Pro</span></div><div class="panel locked"><div class="ghost"><div class="tw"><table class="mini"><thead><tr><th class="l">Game</th><th class="l">Pick</th><th>Price</th><th>Result</th><th>Units</th><th class="hm">Posted</th></tr></thead><tbody>' +
      sk + sk + sk + sk + sk + '</tbody></table></div></div><div class="over"><b style="font-size:16px">' + fmt(o.picks) + ' graded picks, each with the original post</b><p class="muted small" style="margin:0;max-width:440px">See every game, pick, price, result and units, with a link to the post it came from.</p><a class="btn pro" href="' + PRO + '">$59.99 a month</a></div></div></section>';

    root.innerHTML = h;
    hookCharts();
    HWD.ready.then(function (st) { if (st.pro) unlock(s, o); });
    root.addEventListener('click', function (e) {
      var b = e.target.closest('button.tab'); if (!b) return;
      var box = b.parentNode, name = box.getAttribute('data-tabs'), i = b.getAttribute('data-i');
      box.querySelectorAll('.tab').forEach(function (x) { x.classList.toggle('on', x === b); });
      root.querySelectorAll('[data-pane="' + name + '"]').forEach(function (pn) {
        pn.hidden = pn.getAttribute('data-i') !== i;
        if (!pn.hidden && !pn.childElementCount && lazy[name]) { var c = lazy[name][+i]; pn.innerHTML = typeof c === 'function' ? c() : c; hookCharts(); }
      });
    });
    var links = [].slice.call(document.querySelectorAll('#snav a'));
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (en) {
        en.forEach(function (x) { if (x.isIntersecting) links.forEach(function (l) { l.classList.toggle('on', l.getAttribute('href') === '#' + x.target.id); }); });
      }, { rootMargin: '-130px 0px -65% 0px' });
      secs.forEach(function (x) { var el = document.getElementById(x[0]); if (el) io.observe(el); });
    }
  }
})();
