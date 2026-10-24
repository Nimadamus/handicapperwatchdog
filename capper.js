(function () {
  var root = document.getElementById('prof');
  var id = new URLSearchParams(location.search).get('id') || '';
  var PRO = 'https://trustmyrecord.com/premium/';
  var fmt = function (n) { return n == null ? 'n/a' : Number(n).toLocaleString('en-US'); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var cls = function (n) { return n > 0 ? 'win' : n < 0 ? 'loss' : ''; };
  var signed = function (v, d, suf) { if (v == null) return '<span class="muted">n/a</span>'; var n = Number(v); return '<span class="' + cls(n) + '">' + (n > 0 ? '+' : '') + n.toFixed(d) + (suf || '') + '</span>'; };
  var pct = function (v) { return v == null ? '<span class="muted">n/a</span>' : Number(v).toFixed(1) + '%'; };
  var odds = function (v) { return v == null ? '<span class="muted">n/a</span>' : (v > 0 ? '+' : '') + v; };
  var record = function (r) { return r.w + '-' + r.l + (r.p ? '-' + r.p : ''); };
  var streakTxt = function (s) { return !s ? 'n/a' : '<span class="' + (s[0] === 'W' ? 'win' : 'loss') + '">' + esc(s) + '</span>'; };
  var label = function (k) { return esc(String(k).replace('|', ' · ')); };

  if (!/^[0-9a-f]{10}$/.test(id)) { root.innerHTML = notFound(); return; }

  fetch('data/p/' + id + '.json?v=' + Date.now()).then(function (r) { if (!r.ok) throw 0; return r.json(); }).then(render).catch(function () { root.innerHTML = notFound(); });

  function notFound() {
    return '<section class="pt"><h1 class="h1s">Profile not found</h1><p class="lead">This capper has no full profile yet. Profiles are built as records come in.</p><a class="btn" href="cappers.html">Browse every capper</a></section>';
  }

  // ---------- building blocks ----------
  function kpi(v, l) { return '<div class="kpi"><b>' + v + '</b><span>' + l + '</span></div>'; }

  function table(rows, first, opts) {
    opts = opts || {};
    rows = (rows || []).filter(function (r) { return r && r.picks; });
    if (opts.limit) rows = rows.slice(0, opts.limit);
    if (!rows.length) return '<p class="muted small">Not enough picks yet.</p>';
    return '<div class="tablewrap"><table class="st"><thead><tr><th class="l">' + first + '</th><th>Picks</th><th>Record</th><th class="hm">Win %</th><th>Units</th><th>ROI</th><th class="hm ao">Avg odds</th></tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr><td class="l">' + label(r.key) + '</td><td>' + fmt(r.picks) + '</td><td>' + record(r) + '</td><td class="hm">' + pct(r.win_pct) + '</td><td>' + signed(r.net, 2) +
          '</td><td>' + signed(r.roi, 1, '%') + '</td><td class="hm ao">' + odds(r.avg_odds) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function block(title, inner, sub) { return '<div class="block"><h3>' + title + '</h3>' + (sub ? '<p class="muted small">' + sub + '</p>' : '') + inner + '</div>'; }

  function chart(pts) {
    if (!pts || pts.length < 2) return '<p class="muted small">Not enough picks to chart yet.</p>';
    var W = 800, H = 220, P = 8, min = Math.min(0, Math.min.apply(null, pts)), max = Math.max(0, Math.max.apply(null, pts)), span = (max - min) || 1;
    var x = function (i) { return P + i * (W - 2 * P) / (pts.length - 1); }, y = function (v) { return P + (max - v) * (H - 2 * P) / span; };
    var d = pts.map(function (v, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1); }).join(' ');
    var last = pts[pts.length - 1], col = last >= 0 ? 'var(--win)' : 'var(--loss)';
    return '<svg class="curve" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="Units won over time, now ' + last.toFixed(2) + '">' +
      '<line x1="0" x2="' + W + '" y1="' + y(0) + '" y2="' + y(0) + '" class="zero"/>' +
      '<path d="' + d + ' L' + x(pts.length - 1) + ' ' + H + ' L' + x(0) + ' ' + H + 'Z" fill="' + col + '" opacity=".08"/>' +
      '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="2.5" vector-effect="non-scaling-stroke"/></svg>' +
      '<div class="axis"><span>First graded pick</span><span>Units: ' + signed(last, 2) + '</span><span>Latest</span></div>';
  }

  function dots(list) {
    return '<div class="dots" aria-label="Last results, newest first">' + (list || []).map(function (r) {
      return '<span class="d ' + (r === 'W' ? 'dw' : r === 'L' ? 'dl' : 'dp') + '" title="' + (r === 'W' ? 'Win' : r === 'L' ? 'Loss' : 'Push') + '">' + r + '</span>'; }).join('') + '</div>';
  }

  function tabs(name, items) {
    return '<div class="tabs" data-tabs="' + name + '">' + items.map(function (t, i) { return '<button class="tab' + (i ? '' : ' on') + '" data-i="' + i + '">' + esc(t[0]) + '</button>'; }).join('') + '</div>' +
      items.map(function (t, i) { return '<div class="pane"' + (i ? ' hidden' : '') + ' data-pane="' + name + '" data-i="' + i + '">' + t[1] + '</div>'; }).join('');
  }

  function sportPane(name, s) {
    var o = s.overall;
    return '<div class="kpis sm">' + kpi(record(o), 'Record') + kpi(signed(o.net, 2), 'Units') + kpi(signed(o.roi, 1, '%'), 'ROI') + kpi(pct(o.win_pct), 'Win %') +
      kpi(odds(o.avg_odds), 'Avg odds') + kpi(streakTxt(s.streaks.current), 'Current streak') + kpi(signed(o.max_drawdown, 2), 'Max drawdown') +
      kpi(s.streaks.longest_win + ' / ' + s.streaks.longest_loss, 'Longest W / L run') + '</div>' +
      block(esc(name) + ' units over time', chart(s.curve)) +
      '<div class="two">' + block('Recent form', table(s.form, 'Window')) + block('Markets', table(s.markets, 'Market')) + '</div>' +
      '<div class="two">' + block('Favorites and dogs', table(s.fav_dog, 'Side')) + block('Overs and unders', table(s.over_under, 'Total')) + '</div>' +
      block('By odds range', table(s.odds, 'Price')) +
      '<div class="two">' + block('By day of the week', table(s.weekday, 'Day'), 'Game day, Pacific time') + block('By month', table(s.month, 'Month')) + '</div>';
  }

  // ---------- the page ----------
  function render(p) {
    var s = p.summary, o = p.overview || {}, a = p.advanced || {}, code = s.id.slice(0, 4).toUpperCase();
    document.title = 'Capper ' + code + ' Record, ROI and Advanced Stats | Handicapper Watchdog';
    var z = a.z || {}, be = a.break_even || {}, clv = a.clv || {};
    var sportNames = Object.keys(p.sport_detail || {});
    var html = '';

    html += '<section class="phead"><div class="pid"><div class="avatar" aria-hidden="true">?</div><div><h1 class="masked big" aria-label="Name hidden">Capper ' + esc(code) + '</h1>' +
      '<p class="muted">' + esc(s.source) + ' · ' + s.sports.slice(0, 5).map(esc).join(', ') + (s.last_pick ? ' · last pick ' + esc(s.last_pick) : '') + '</p></div></div>' +
      '<a class="btn" href="' + PRO + '">Reveal this capper</a></section>';

    html += '<div class="kpis">' + kpi(record(o), 'Record') + kpi(signed(o.net, 2), 'Units won') + kpi(signed(o.roi, 1, '%'), 'ROI') + kpi(pct(o.win_pct), 'Win %') +
      kpi(fmt(o.picks), 'Graded picks') + kpi(odds(o.avg_odds), 'Avg odds') + kpi(streakTxt(o.streaks && o.streaks.current), 'Current streak') +
      kpi((o.streaks ? o.streaks.longest_win + ' / ' + o.streaks.longest_loss : 'n/a'), 'Longest W / L run') + '</div>';

    html += block('Last 20 results', dots(p.last_results), 'Newest first');
    html += block('Units over time', chart(p.curve));

    html += '<h2 class="sec">Advanced metrics</h2><div class="kpis">' +
      kpi(signed(a.max_drawdown, 2), 'Max drawdown') + kpi(signed(a.peak_units, 2), 'Peak units') +
      kpi(a.volatility == null ? 'n/a' : Number(a.volatility).toFixed(2), 'Volatility per pick') +
      kpi(z.z == null ? 'n/a' : signed(z.z, 2), 'Z score vs break even') +
      kpi(be.needed_pct == null ? 'n/a' : pct(be.needed_pct), 'Win % needed at their prices') +
      kpi(be.gap_pts == null ? 'n/a' : signed(be.gap_pts, 2, ' pts'), 'Gap to break even') +
      kpi(clv.avg_pts == null ? 'n/a' : signed(clv.avg_pts, 2, ' pts'), 'Avg closing line value') +
      kpi(clv.beat_pct == null ? 'n/a' : pct(clv.beat_pct), 'Beat the closing line') + '</div>' +
      '<p class="muted small">Z score compares wins to what their prices imply a break even bettor would win. Closing line value is measured on ' + fmt(clv.n || 0) + ' picks with a closing price.</p>';

    html += '<h2 class="sec">Form</h2><div class="two">' + block('By last N picks', table(p.form_picks, 'Window')) + block('By days', table(p.form_days, 'Window')) + '</div>';
    html += block('After a win or a loss', table(p.after, 'Situation'));

    if (sportNames.length) {
      html += '<h2 class="sec">Sport by sport</h2>' + tabs('sp', sportNames.map(function (n) { return [n + ' (' + p.sport_detail[n].overall.picks + ')', sportPane(n, p.sport_detail[n])]; }));
    }

    html += '<h2 class="sec">Every breakdown</h2>' + tabs('bd', [
      ['Markets', block('By market', table(p.markets, 'Market')) + block('By sport and market', table(p.market_detail, 'Sport · market'))],
      ['Sides and prices', '<div class="two">' + block('Favorites and dogs', table(p.fav_dog, 'Side')) + block('Plus money', table(p.plus_money, 'Price')) + '</div>' +
        block('By odds range', table(p.odds_buckets, 'Price')) + '<div class="two">' + block('Overs and unders', table(p.over_under, 'Total')) + block('Home and away', table(p.home_away, 'Side')) + '</div>'],
      ['Teams', '<div class="two">' + block('Teams they back', table(p.teams_backing, 'Team', { limit: 15 })) + block('Teams they fade', table(p.teams_fading, 'Team', { limit: 15 })) + '</div>' +
        '<div class="two">' + block('Conferences backed', table(p.conference_backing, 'Conference', { limit: 12 })) + block('Divisions backed', table(p.division_backing, 'Division', { limit: 12 })) + '</div>'],
      ['Calendar', '<div class="two">' + block('By day of the week', table(p.weekday, 'Day')) + block('By month', table(p.month, 'Month')) + '</div>' + block('By season', table(p.season, 'Season'))]
    ]);

    html += '<section class="unlock"><div><h3>See who Capper ' + esc(code) + ' is</h3><p>TMR Pro reveals the name, links to every original post, the complete pick log with every game, line and price, and lets you compare cappers side by side.</p></div><a class="btn" href="' + PRO + '">Unlock with TMR Pro</a></section>';
    html += '<p class="muted small">Profile built from TrustMyRecord graded picks' + (p.generated_at ? ', data as of ' + new Date(p.generated_at).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' PT' : '') + '. Units assume 1 unit risked per priced pick.</p>';

    root.innerHTML = html;
    root.addEventListener('click', function (e) {
      var b = e.target.closest('.tab'); if (!b) return;
      var box = b.parentNode, name = box.getAttribute('data-tabs'), i = b.getAttribute('data-i');
      box.querySelectorAll('.tab').forEach(function (t) { t.classList.toggle('on', t === b); });
      root.querySelectorAll('[data-pane="' + name + '"]').forEach(function (pn) { pn.hidden = pn.getAttribute('data-i') !== i; });
    });
  }
})();
