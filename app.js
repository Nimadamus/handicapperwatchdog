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

  function area(pts, label) {
    if (!pts || pts.length < 2) return '';
    var W = 420, H = 150, mn = Math.min.apply(null, pts.concat(0)), mx = Math.max.apply(null, pts.concat(0)), sp = (mx - mn) || 1;
    var y = function (v) { return 6 + (mx - v) * (H - 12) / sp; }, x = function (i) { return i * W / (pts.length - 1); };
    var d = pts.map(function (v, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1); }).join('');
    var c = pts[pts.length - 1] >= 0 ? 'var(--win)' : 'var(--loss)';
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="' + esc(label) + ', now ' + (+pts[pts.length - 1]).toFixed(1) + '">' +
      '<line x1="0" x2="' + W + '" y1="' + y(0) + '" y2="' + y(0) + '" stroke="var(--line2)" stroke-dasharray="3 4" vector-effect="non-scaling-stroke"/>' +
      '<path d="' + d + '" fill="none" stroke="' + c + '" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>';
  }

  // buyer tools: every figure computed from the published index, nothing typed in
  function buyerTools(all, est, M) {
    var act = all.filter(function (r) { return r.r30 && r.r30.picks >= 20 && r.r30.net != null; });
    var med = function (a) { var s = a.slice().sort(function (x, y) { return x - y; }); return s.length ? s[Math.floor(s.length / 2)] : null; };
    var nets = act.map(function (r) { return r.r30.net; }), mid = med(nets), price = 100, unit = 50, out = $('calcOut');
    function calc() {
      if (!out || !act.length) return;
      var need = price / unit, n = nets.filter(function (v) { return v >= need; }).length, p = Math.round(100 * n / act.length);
      out.innerHTML = '<div class="cneed"><b>+' + need.toFixed(1) + ' units</b><span>needed in a month to cover $' + price + ' at $' + unit + ' a pick</span></div>' +
        '<div class="cbig">' + fmt(n) + ' <small>of ' + fmt(act.length) + '</small></div><p class="cdesc">active accounts made that much in the last 30 days.</p>' +
        '<div class="cbar" role="img" aria-label="' + p + ' percent of active accounts"><i style="width:' + p + '%"></i></div>' +
        '<p class="cnote">The median active account finished at ' + (mid > 0 ? '+' : '') + mid.toFixed(2) + ' units. Active means 20 or more graded picks in 30 days. Knowing which accounts will do it next month is the hard part.</p>' +
        '<a class="herolink" href="cappers.html?t=r30&amp;min=20">See last 30 days <span aria-hidden="true">&rarr;</span></a>';
    }
    document.querySelectorAll('.pchip').forEach(function (b) {
      b.addEventListener('click', function () {
        var k = b.hasAttribute('data-price') ? 'price' : 'unit';
        if (k === 'price') price = +b.getAttribute('data-price'); else unit = +b.getAttribute('data-unit');
        document.querySelectorAll('.pchip[data-' + k + ']').forEach(function (c) { c.classList.toggle('on', c === b); c.setAttribute('aria-pressed', c === b ? 'true' : 'false'); });
        calc();
      });
    });
    calc();
    var hv = M.halves || [], hot = hv.filter(function (x) { return x[0] > 0; }), kept = hot.filter(function (x) { return x[1] > 0; }).length;
    var f = function (v) { return (v > 0 ? '+' : '') + v.toFixed(1) + '%'; }, upE = est.filter(function (r) { return r.units > 0; }).length;
    var card = function (q, big, line, href, cta) { return '<article><p class="cq">' + q + '</p><div class="cs">' + big + '</div><p>' + line + '</p><a href="' + href + '">' + cta + '</a></article>'; };
    set2('claims', (hot.length ? card('&ldquo;On a heater right now.&rdquo;', Math.round(100 * kept / hot.length) + '%', 'of established accounts that were up in their first half stayed up in their second. Median ROI went from ' + f(med(hot.map(function (x) { return x[0]; }))) + ' to ' + f(med(hot.map(function (x) { return x[1]; }))) + '.', 'research/do-hot-handicappers-stay-hot.html', 'Do hot handicappers stay hot?') : '') +
      card('&ldquo;Proven long term winner.&rdquo;', fmt(upE) + ' of ' + fmt(est.length), 'accounts with 100 or more graded picks are up money. Being up so far does not mean being up next week.', 'the-board.html', 'See the full board') +
      (act.length ? card('&ldquo;We crush it every month.&rdquo;', (mid > 0 ? '+' : '') + mid.toFixed(2) + 'u', 'was the median result for active accounts in the last 30 days, across ' + fmt(act.length) + ' accounts.', 'cappers.html?t=r30&amp;min=20', 'See last 30 days') : ''));
    function set2(id, html) { var el = $(id); if (el) el.innerHTML = html; }
  }

  // sample profile: one real account's published file, rendered tab by tab
  function sampleProfile(r) {
    var box = $('sdash');
    if (!box || !r) return;
    fetch('data/sample.json').then(function (x) { return x.json(); }).then(function (p) {
      r = Object.assign({}, r, p.summary || {});
      var o = p.overview || {}, a = p.advanced || {}, st = p.streaks || {}, z = a.z || {}, be = a.break_even || {}, W = p.windows || {}, c = code(r.id);
      var name = function (k) { return esc(String(k).replace('|', ' · ')); };
      var tbl = function (head, rows, n) {
        return '<div class="st"><h4>' + head + '</h4><table><thead><tr><th class="l"></th><th>Picks</th><th>Record</th><th>Win %</th><th>Units</th><th>ROI</th></tr></thead><tbody>' +
          (rows || []).slice(0, n || 8).map(function (x) { return '<tr><td class="l">' + name(x.key) + '</td><td>' + fmt(x.picks) + '</td><td>' + recTxt(x) + '</td><td>' + pct(x.win_pct) + '</td><td>' + sgn(x.net, 2) + '</td><td>' + sgn(x.roi, 1, '%') + '</td></tr>'; }).join('') + '</tbody></table></div>';
      };
      var byPicks = function (l) { return (l || []).slice().sort(function (x, y) { return y.picks - x.picks || y.net - x.net; }); };
      var fact = function (l, v) { return '<div><b>' + v + '</b><span>' + l + '</span></div>'; };
      var pts = p.curve || [], chart = '';
      if (pts.length > 1) {
        var mn = Math.min.apply(null, pts.concat(0)), mx = Math.max.apply(null, pts.concat(0)), sp = (mx - mn) || 1, w = 900, h = 220;
        var y = function (v) { return 8 + (mx - v) * (h - 16) / sp; };
        chart = '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" role="img" aria-label="Cumulative units for #' + c + '"><line x1="0" x2="' + w + '" y1="' + y(0) + '" y2="' + y(0) + '" stroke="var(--line2)" stroke-dasharray="3 4" vector-effect="non-scaling-stroke"/><path d="' +
          pts.map(function (v, i) { return (i ? 'L' : 'M') + (i * w / (pts.length - 1)).toFixed(1) + ' ' + y(v).toFixed(1); }).join('') + '" fill="none" stroke="' + (pts[pts.length - 1] >= 0 ? 'var(--win)' : 'var(--loss)') + '" stroke-width="2.2" vector-effect="non-scaling-stroke"/></svg>';
      }
      var wins = ['r7', 'r30', 'r90', 'all'].map(function (k) { return W[k]; }).filter(function (x) { return x && x.picks; });
      var tabs = [
        ['Overview', '<div class="schart">' + chart + '</div>' + tbl('Performance by period', wins)],
        ['Sports', tbl('Record by sport', p.sports) + tbl('Record by season', p.season)],
        ['Bet types', tbl('Market', p.markets) + tbl('Sport and market', p.market_detail, 8)],
        ['Prices and sides', tbl('Favorites and underdogs', p.fav_dog) + tbl('Odds ranges', p.odds_buckets) + tbl('Overs and unders', p.over_under) + tbl('Home and away', p.home_away)],
        ['Teams', tbl('Most backed teams', byPicks(p.teams_backing), 6) + tbl('Most faded teams', byPicks(p.teams_fading), 6)],
        ['Advanced metrics', '<div class="sfacts">' +
          fact('Z score vs break even', z.z == null ? 'n/a' : sgn(z.z, 2)) + fact('Win % needed at their prices', be.needed_pct == null ? 'n/a' : pct(be.needed_pct)) + fact('Win % actually hit', be.actual_pct == null ? 'n/a' : pct(be.actual_pct)) +
          fact('Max drawdown', sgn(a.max_drawdown, 2, 'u')) + fact('Peak units', sgn(a.peak_units, 2, 'u')) + fact('Volatility', a.volatility == null ? 'n/a' : (+a.volatility).toFixed(2)) +
          fact('Longest win streak', fmt(st.longest_win)) + fact('Longest losing streak', fmt(st.longest_loss)) + fact('Picks per week', p.per_week == null ? 'n/a' : (+p.per_week).toFixed(1)) + '</div>' +
          tbl('After a win or a loss', p.after, 6) + tbl('By weekday', p.weekday, 7)],
        ['Pro only', '<div class="slock"><div><span class="lock">Watchdog Pro</span><h4>Pending picks from #' + c + '</h4><p>Eligible picks before the game starts, with this whole file beside them.</p><div class="sl"><span class="blur">Away at Home</span><span class="blur">Side 3.5</span><span class="blur">Sun 1:05</span></div><div class="sl"><span class="blur">Away at Home</span><span class="blur">Total 44.5</span><span class="blur">Sun 4:25</span></div></div>' +
          '<div><span class="lock">Watchdog Pro</span><h4>The complete pick log</h4><p>All ' + fmt(o.picks || r.picks) + ' graded picks with game, pick, odds, result, units and post time. Free profiles show the latest 10.</p><a class="btn pro" href="pricing.html">View Watchdog Pro</a></div></div>']];
      box.innerHTML = '<div class="shead"><div><span class="eyebrow">Sample profile</span><b class="sid">#' + esc(c) + '</b></div>' +
        '<div class="skpi">' + fact('Record', recTxt(o)) + fact('Units', sgn(o.net, 2)) + fact('ROI', sgn(o.roi, 1, '%')) + fact('Win rate', pct(o.win_pct)) + fact('Avg odds', o.avg_odds == null ? 'n/a' : (o.avg_odds > 0 ? '+' : '') + o.avg_odds) + '</div></div>' +
        '<div class="stabs" role="tablist" aria-label="Profile sections">' + tabs.map(function (t, i) { return '<button type="button" role="tab" id="st' + i + '" aria-selected="' + (i ? 'false' : 'true') + '" aria-controls="sp">' + t[0] + '</button>'; }).join('') + '</div>' +
        '<div class="spanel" id="sp" role="tabpanel">' + tabs[0][1] + '</div>' +
        '<a class="herolink sgo" href="' + link(r) + '">Open this entire profile <span aria-hidden="true">&rarr;</span></a>';
      box.querySelector('.stabs').addEventListener('click', function (e) {
        var b = e.target.closest('button'); if (!b) return;
        var i = +b.id.slice(2);
        [].forEach.call(this.children, function (x, k) { x.setAttribute('aria-selected', k === i ? 'true' : 'false'); });
        $('sp').innerHTML = tabs[i][1];
      });
    }).catch(function () { box.innerHTML = '<p class="muted">The sample profile did not load. <a href="cappers.html">Open the rankings</a>.</p>'; });
  }

  // edit distance against the best matching stretch of a name, so small misspellings still find a review
  function near(a, b) {
    var best = 99;
    for (var st = 0; st <= Math.max(0, b.length - a.length); st++) {
      var w = b.substr(st, a.length + 1), prev = [], i, j;
      for (j = 0; j <= w.length; j++) prev[j] = j;
      for (i = 1; i <= a.length; i++) {
        var cur = [i];
        for (j = 1; j <= w.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === w[j - 1] ? 0 : 1));
        prev = cur;
      }
      best = Math.min(best, Math.min.apply(null, prev.slice(Math.max(0, a.length - 1))));
    }
    return best;
  }

  function verifySearch(all) {
    var input = $('vq'), box = $('vlist'), form = $('vsearch'), services = [], items = [], on = -1;
    if (!input) return;
    fetch('data/services.json').then(function (r) { return r.json(); }).then(function (d) { services = d; }).catch(function () {});
    var sports = sportsByDepth(all, 5);
    function find(q) {
      var s = q.trim().toLowerCase().replace(/^#/, ''), out = [];
      if (!s) return out;
      services.forEach(function (v) { if (v.name.toLowerCase().indexOf(s) >= 0) out.push({ href: v.page, a: v.name, b: 'Service review' }); });
      if (!out.length && s.length >= 4) services.map(function (v) { return { v: v, d: near(s, v.name.toLowerCase()) }; }).filter(function (x) { return x.d <= 2; }).sort(function (a, b) { return a.d - b.d; }).slice(0, 3)
        .forEach(function (x) { out.push({ href: x.v.page, a: x.v.name, b: 'Did you mean this review?' }); });
      if (/^[0-9a-f]{2,10}$/.test(s)) all.filter(function (r) { return r.id.indexOf(s) === 0; }).sort(function (a, b) { return b.picks - a.picks; }).slice(0, 5).forEach(function (r) {
        out.push({ href: link(r), a: '#' + code(r.id), b: r.picks ? recTxt(r) + ', ' + fmt(r.picks) + ' graded picks' : 'No graded picks yet' });
      });
      sports.forEach(function (v) { if (v.toLowerCase().indexOf(s) === 0) out.push({ href: 'cappers.html?sport=' + encodeURIComponent(v), a: v, b: 'Rankings' }); });
      return out.slice(0, 7);
    }
    function show() {
      items = find(input.value); on = -1;
      var q = input.value.trim();
      if (!q) { box.hidden = true; input.setAttribute('aria-expanded', 'false'); return; }
      box.innerHTML = items.length ? items.map(function (o, i) { return '<li role="option" id="vo' + i + '"><a href="' + esc(o.href) + '">' + esc(o.a) + '<span>' + esc(o.b) + '</span></a></li>'; }).join('') :
        '<li class="vnone-li"><span class="vnone">No match. Tracked accounts are listed by Watchdog ID, not by name, so a person or handle will not appear here. Try a <a href="reviews/index.html">named service review</a> or the <a href="cappers.html">rankings</a>.</span></li>';
      box.hidden = false; input.setAttribute('aria-expanded', 'true');
    }
    input.addEventListener('input', show);
    input.addEventListener('focus', show);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { box.hidden = true; input.setAttribute('aria-expanded', 'false'); return; }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' || !items.length) return;
      e.preventDefault(); on = (on + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      [].forEach.call(box.children, function (li, i) { li.classList.toggle('on', i === on); });
      input.setAttribute('aria-activedescendant', 'vo' + on);
    });
    document.addEventListener('click', function (e) { if (!form.contains(e.target)) box.hidden = true; });
    form.addEventListener('submit', function (e) {
      var hit = items[on >= 0 ? on : 0];
      e.preventDefault();
      items = find(input.value); hit = items[on >= 0 ? on : 0];
      if (hit) location.href = hit.href; else if (input.value.trim()) show(); else input.focus();
    });
    var cv = $('closeVerify');
    if (cv) cv.addEventListener('click', function (e) { e.preventDefault(); scrollTo({ top: 0, behavior: 'smooth' }); input.focus({ preventScroll: true }); });
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
    verifySearch(all);
    var set = function (id, html) { var el = $(id); if (el) el.innerHTML = html; };
    // tracker panel: every figure read from the Watchdog stats endpoint at build time
    if (L) {
      var kv = [[fmt(L.graded_picks), 'Picks graded', 'Every one checked against a final score. This is what a record is built from.'],
        [fmt(L.accounts_monitored), 'Accounts monitored', 'Public accounts the tracker is reading for picks.'],
        [fmt(L.posts_captured), 'Public posts scanned', 'Posts read to find picks, wins and losses alike.'],
        [fmt(L.accounts_discovered), 'Accounts discovered', 'Accounts found so far. Only those that post picks are monitored.'],
        [fmt(L.picks_captured_today), 'Picks captured today', 'Saved with their post time, in the tracker\'s current day.'],
        [fmt(L.pending_picks), 'Picks waiting on a result', 'Never counted in a record until graded.']];
      set('liveGrid', kv.map(function (k) { return '<div class="kv"><b>' + k[0] + '</b><span>' + k[1] + '</span><small>' + k[2] + '</small></div>'; }).join(''));
      var pt = function (s) { return new Date(s).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' PT'; };
      $('liveAt').textContent = 'Read from the Watchdog database. Tracking since is the first graded pick on the record. Last pick captured ' + pt(L.last_capture_at) + '.';
      var estAll = all.filter(function (r) { return r.picks >= 100 && r.units != null; });
      var firsts = all.map(function (r) { return r.first_pick; }).filter(Boolean).sort();
      var sinceTxt = firsts[0] ? new Date(firsts[0] + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '';
      if (sinceTxt) document.querySelectorAll('.tsince').forEach(function (el) { el.textContent = sinceTxt; });
      var tk = all.filter(function (r) { return r.picks >= 100 && r.units != null; }).sort(function (a, b) { return b.picks - a.picks; }).slice(0, 26).map(function (r) {
        return '<span><b>#' + esc(code(r.id)) + '</b> ' + recTxt(r) + ' <i class="' + (r.units >= 0 ? 'lu' : 'ld') + '">' + (r.units > 0 ? '+' : '') + r.units.toFixed(2) + 'u</i></span>';
      }).join('');
      set('ticker', tk + tk);
      set('mFind', fmt(L.accounts_discovered) + ' accounts discovered and ' + fmt(L.accounts_monitored) + ' monitored for picks across ' + fmt(L.platforms) + ' platforms. If a public account posts picks there, the system goes after it.');
      set('heroProof', [[sinceTxt ? new Date(firsts[0] + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'n/a', 'Tracking since'], [fmt(L.graded_picks), 'Picks graded'], [fmt(L.accounts_monitored), 'Accounts monitored'], [fmt(L.posts_captured), 'Public posts scanned']].map(function (k) { return '<div><dt>' + k[1] + '</dt><dd>' + k[0] + '</dd></div>'; }).join(''));
      set('featPending', fmt(L.pending_picks) + ' tracked picks are waiting on a result right now. A pick waiting on a result is never counted in a record.');
      set('stepDiscover', fmt(L.accounts_discovered) + ' accounts found so far, ' + fmt(L.accounts_monitored) + ' monitored for picks.');
      var mix = $('liveMix'), sources = (L.sources || []).filter(function (s) { return s && s.label && s.graded_picks > 0; })
        .slice().sort(function (a, b) { return b.graded_picks - a.graded_picks; });
      if (mix && sources.length) {
        var peak = sources[0].graded_picks;
        mix.hidden = false;
        mix.innerHTML = '<p class="mixlabel">Graded picks by source</p>' + sources.map(function (s) {
          var w = Math.max(4, Math.round(100 * s.graded_picks / peak));
          return '<div class="mixrow" title="' + esc(s.label) + ': ' + fmt(s.graded_picks) + ' graded picks"><span>' + esc(s.label) + '</span><span class="mixbar" role="presentation"><i style="width:' + w + '%"></i></span><b>' + fmt(s.graded_picks) + '</b></div>';
        }).join('');
      }
    } else {
      set('liveGrid', '<div class="kv"><b>' + fmt(M.tracked) + '</b><span>Handicappers with a record</span></div><div class="kv"><b>' + fmt(M.graded_picks) + '</b><span>Picks graded</span></div>');
    }

    // established records drive the anonymous ID card and the two worked examples
    var est = all.filter(function (r) { return r.picks >= 100 && r.units != null; }).sort(function (a, b) { return b.units - a.units; });
    var top = est[0], low = est.length > 1 ? est[est.length - 1] : null;
    var since = function (r) { var f = r.first_pick || r.monitored_since; return f ? new Date(f + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'n/a'; };
    buyerTools(all, est, M);
    sampleProfile(est.filter(function (r) { return !r.basic && r.profile; })[0]);
    if (top && $('idCode')) {
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
    if (big) {
      set('heroCard', '<div class="vchead"><span class="eyebrow">A real record from the board</span><span class="badge est">Established</span></div>' +
        '<div class="vcid">#' + esc(code(big.id)) + '</div><p class="vcsub">Most graded picks of any account. Tracked since ' + since(big) + '.</p>' +
        '<div class="vcchart">' + area(big.spark, 'Cumulative units for #' + code(big.id)) + '</div>' +
        '<div class="vck"><div><b>' + recTxt(big) + '</b><span>Record</span></div><div><b>' + sgn(big.units, 2) + '</b><span>Units</span></div><div><b>' + sgn(big.roi, 1, '%') + '</b><span>ROI</span></div>' +
        '<div><b>' + pct(big.win_pct) + '</b><span>Win rate</span></div><div><b>' + fmt(big.picks) + '</b><span>Graded picks</span></div><div><b>' + strk(big.streak) + '</b><span>Streak</span></div></div>' +
        '<p class="vcnote">' + explain(big) + '</p><a class="vcgo" href="' + link(big) + '">Open the full record &rarr;</a>');
    }
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
    var showcase = $('exChart') ? est.filter(function (r) { return !r.basic && r.profile; })[0] : null;
    if (showcase) {
      set('exHead', '<p class="bigrec">' + recTxt(showcase) + '</p><div class="wk"><div><b>' + pct(showcase.win_pct) + '</b><span>Win %</span></div><div><b>' + sgn(showcase.units, 2) + '</b><span>Units</span></div><div><b>' + sgn(showcase.roi, 1, '%') + '</b><span>ROI</span></div></div>' +
        '<p class="nt">Wins, losses and pushes from ' + fmt(showcase.picks) + ' graded picks.</p>');
      var sp2 = Object.keys(showcase.bs || {}).map(function (k) { return [k, showcase.bs[k][1]]; }).filter(function (x) { return x[1] != null; })
        .sort(function (a, b) { return Math.abs(b[1]) - Math.abs(a[1]); }).slice(0, 6);
      var smax = Math.max.apply(null, sp2.map(function (x) { return Math.abs(x[1]); }).concat(1));
      set('exSports', sp2.map(function (x) {
        var w = Math.max(1, 50 * Math.abs(x[1]) / smax);
        return '<div class="sbar" title="' + esc(x[0]) + ': ' + (+x[1]).toFixed(2) + ' units"><span>' + esc(x[0]) + '</span><i><u style="' + (x[1] >= 0 ? 'left:50%' : 'right:50%') + ';width:' + w.toFixed(1) + '%;background:' + (x[1] >= 0 ? 'var(--win)' : 'var(--loss)') + '"></u></i><b>' + (x[1] > 0 ? '+' : '') + (+x[1]).toFixed(1) + '</b></div>';
      }).join(''));
    }
    if (showcase) {
      $('exploreLink').href = link(showcase);
      fetch('data/p/' + showcase.id + '.json').then(function (r) { return r.json(); }).then(function (p) {
        var c = code(showcase.id);
        set('exSub', 'Account #' + c + '.');
        set('exDots', '<div class="dots">' + (p.last_results || []).map(function (x) { return '<span class="' + esc(x) + '">' + esc(x) + '</span>'; }).join('') + '</div>');
        var pts = p.curve || [];
        if (pts.length > 1) {
          var mn = Math.min.apply(null, pts.concat(0)), mx = Math.max.apply(null, pts.concat(0)), sp = (mx - mn) || 1, W = 900, H = 250;
          var y = function (v) { return 8 + (mx - v) * (H - 16) / sp; };
          var d = pts.map(function (v, i) { return (i ? 'L' : 'M') + (i * W / (pts.length - 1)).toFixed(1) + ' ' + y(v).toFixed(1); }).join('');
          var col = pts[pts.length - 1] >= 0 ? 'var(--win)' : 'var(--loss)';
          set('exChart', '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="Cumulative units for #' + c + ', now ' + (+pts[pts.length - 1]).toFixed(2) + '">' +
            '<line x1="0" x2="' + W + '" y1="' + y(0) + '" y2="' + y(0) + '" stroke="var(--line2)" stroke-dasharray="3 4" vector-effect="non-scaling-stroke"/>' +
            '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="2.2" vector-effect="non-scaling-stroke"/></svg>' +
            '<p class="note" style="margin:8px 0 0">Now ' + sgn(pts[pts.length - 1], 2, ' units') + '. The profile adds ROI over time, rolling win rate, weekly activity, and units by sport and month.</p>');
          var cb = $('exChart'), tip = document.createElement('div');
          tip.className = 'ctip'; tip.hidden = true; cb.appendChild(tip);
          cb.addEventListener('mousemove', function (e) {
            var b = cb.getBoundingClientRect(), i = Math.max(0, Math.min(pts.length - 1, Math.round((e.clientX - b.left) / b.width * (pts.length - 1))));
            tip.hidden = false; tip.style.left = Math.max(40, Math.min(b.width - 40, e.clientX - b.left)) + 'px'; tip.textContent = (pts[i] > 0 ? '+' : '') + (+pts[i]).toFixed(2) + ' units';
          });
          cb.addEventListener('mouseleave', function () { tip.hidden = true; });
        }
        var W2 = p.windows || {};
        set('exPeriods', '<div class="tw"><table class="mini"><thead><tr><th class="l">Window</th><th>Picks</th><th>Record</th><th>Units</th><th>ROI</th></tr></thead><tbody>' +
          ['r7', 'r30', 'r90', 'all'].map(function (k) { var x = W2[k]; return x && x.picks ? '<tr><td class="l">' + esc(x.key) + '</td><td>' + fmt(x.picks) + '</td><td>' + recTxt(x) + '</td><td>' + sgn(x.net, 2) + '</td><td>' + sgn(x.roi, 1, '%') + '</td></tr>' : ''; }).join('') + '</tbody></table></div>');
        var res = { W: '<span class="st pos">W</span>', L: '<span class="st neg">L</span>', P: '<span class="dim">P</span>' };
        set('exLedger', '<div class="tw"><table class="mini"><thead><tr><th class="l">Date</th><th class="l">Pick</th><th>Result</th><th>Units</th></tr></thead><tbody>' +
          (p.ledger || []).slice(0, 4).map(function (x) { return '<tr><td class="l">' + esc(x.d ? new Date(x.d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '') + '</td><td class="l">' + esc(x.pk) + ' <span class="dim small">' + esc(x.sp) + '</span></td><td>' + (res[x.r] || '') + '</td><td>' + (x.u ? sgn(x.pl, 2) : '<span class="dim">0</span>') + '</td></tr>'; }).join('') + '</tbody></table></div>');
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
      rows = rows.slice(0, 5);
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
        .sort(function (a, b) { return (b.bs[sp][1] || 0) - (a.bs[sp][1] || 0); }).slice(0, 1)
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
