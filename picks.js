// Today's Pro picks: eligible pending picks from tracked accounts, each beside its anonymous Watchdog ID record.
// Pro accounts decrypt data/x/pending.bin in the browser. Everyone else sees what Pro includes, the launch prices,
// and an accurate checkout status. No pick, game or per game count is ever shown to a non subscriber.
(function () {
  'use strict';
  var root = document.getElementById('picksRoot');
  var fmt = function (n) { return n == null ? 'n/a' : Number(n).toLocaleString('en-US'); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var sgn = function (v, d, suf) { if (v == null) return '<span class="dim">n/a</span>'; var n = +v; return '<span class="' + (n > 0 ? 'pos' : n < 0 ? 'neg' : '') + '">' + (n > 0 ? '+' : '') + n.toFixed(d) + (suf || '') + '</span>'; };
  var odds = function (v) { return v == null ? '<span class="dim">n/a</span>' : (v > 0 ? '+' : '') + v; };
  var when = function (iso) { return new Date(iso).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', hour: 'numeric', minute: '2-digit' }); };
  var lead = function (m) { if (m == null) return 'n/a'; if (m < 60) return m + 'm'; if (m < 2880) return Math.floor(m / 60) + 'h ' + (m % 60) + 'm'; return Math.floor(m / 1440) + 'd'; };
  var TIER = { established: ['est', 'Established'], developing: ['dev', 'Developing'], small: ['sm', 'Small sample'] };
  var head = '<nav class="crumbs" aria-label="Breadcrumb"><a href="./">Home</a><span aria-hidden="true">/</span><span aria-current="page">Today&rsquo;s Pro picks</span></nav>';

  function intro(meta, s) {
    var n = meta && meta.pro && meta.pro.pending_count;
    var status = s.pro ? '' : (!s.api || !s.billing)
      ? '<p class="pcnote" style="margin:12px 0 0"><span class="statusdot"></span><span><b>Checkout is not open yet.</b> Watchdog Pro launches at $49.99 a month or $499 a year. Nothing can be bought on the site today, and no card is collected.</span></p>'
      : '<p style="margin:14px 0 0"><a class="btn pro" href="pricing.html">Subscribe to Watchdog Pro</a> <a class="btn ghost" href="account.html">' + (s.signed_in ? 'Account' : 'Sign in') + '</a></p>';
    return head + '<div class="pagehead"><div><div class="eyebrow">Watchdog Pro</div><h1>Today&rsquo;s eligible picks</h1>' +
      '<p class="muted">Picks captured from tracked public accounts before their games start, each shown beside that account&rsquo;s graded record. A pick appears once captured and leaves when its game starts; after the final score it moves into the record.' +
      (n != null ? ' <b>' + fmt(n) + '</b> eligible picks were waiting at the last update.' : '') + '</p>' + status + '</div></div>';
  }

  function locked() {
    var row = '<tr><td class="l"><span class="blur">#000000</span></td><td class="l"><span class="blur">000-000</span></td><td class="l"><span class="blur">League &middot; Away at Home</span></td><td class="l"><span class="blur">Side 3.5</span></td><td><span class="blur">-110</span></td><td class="hm"><span class="blur">Sun 1:05 PM</span></td></tr>';
    return '<section class="panel locked" style="margin-bottom:18px"><div class="ghost"><div class="tw"><table class="mini"><thead><tr><th class="l">Watchdog ID</th><th class="l">Record</th><th class="l">Game</th><th class="l">Pick</th><th>Odds</th><th class="hm">Starts</th></tr></thead><tbody>' +
      row + row + row + row + row + '</tbody></table></div></div><div class="over"><b style="font-size:16px">Picks are shown only inside Watchdog Pro</b>' +
      '<p class="muted small" style="margin:0;max-width:460px">Each pick carries the Watchdog ID, lifetime record, units, ROI and recent form of the account that posted it, with filters for sport and record. Names and account links are not included in any plan.</p>' +
      '<a class="btn pro" href="pricing.html">See Watchdog Pro</a></div></section>' +
      '<section class="panel" style="margin-bottom:28px"><div class="pb prose"><h2>What Pro adds</h2><ul>' +
      '<li><b>Eligible pending picks</b> before the start: straight bets, review cleared, posted before the game.</li>' +
      '<li><b>The complete graded pick ledger</b> on every profile, not only the 50 most recent picks.</li>' +
      '<li><b>Compare up to four records</b> side by side.</li></ul>' +
      '<p class="muted small">Records are past results, not predictions or a guarantee. 21+. Gambling problem? Call 1 800 GAMBLER.</p></div></section>';
  }

  function board(d) {
    var now = new Date(), all = (d.picks || []).filter(function (p) { return p.start && new Date(p.start) > now; });
    var leagues = {}; all.forEach(function (p) { leagues[p.league] = (leagues[p.league] || 0) + 1; });
    var opts = Object.keys(leagues).sort(function (a, b) { return leagues[b] - leagues[a]; }).map(function (l) { return '<option>' + esc(l) + '</option>'; }).join('');
    root.insertAdjacentHTML('beforeend', '<section class="panel" style="margin-bottom:28px"><div class="fbar f5"><div class="fld"><label for="pq">Search</label><input id="pq" placeholder="Team, pick or Watchdog ID"></div>' +
      '<div class="fld"><label for="pl">League</label><select id="pl"><option value="">All</option>' + opts + '</select></div>' +
      '<div class="fld"><label for="pt">Record</label><select id="pt"><option value="">Any sample</option><option value="100">Established (100+ picks)</option><option value="20">20+ picks</option></select></div>' +
      '<div class="fld"><label for="pf">Show</label><select id="pf"><option value="">All accounts</option><option value="f">Accounts I follow</option></select></div>' +
      '<div class="fld"><label for="pu">Units</label><select id="pu"><option value="">Any</option><option value="0">Up money</option><option value="10">+10 or more</option></select></div></div>' +
      '<div class="tw"><table class="mini pboard"><thead><tr><th class="l hs">Starts (PT)</th><th class="l">Pick</th><th>Odds</th><th class="l">Watchdog ID</th><th class="hr">Record</th><th>Units</th><th class="hm">ROI</th><th class="hm">Before start</th></tr></thead><tbody id="prows"></tbody></table></div>' +
      '<div class="tfoot"><span id="pcount"></span><span class="muted small">Feed baked ' + (d.baked_at ? new Date(d.baked_at).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' PT' : 'n/a') + '</span></div></section>');
    var $ = function (id) { return document.getElementById(id); };
    var follows = [];
    function draw() {
      var q = $('pq').value.trim().toLowerCase().replace(/^#/, ''), fo = $('pf').value === 'f', lg = $('pl').value, mn = +$('pt').value || 0, un = $('pu').value;
      var rows = all.filter(function (p) {
        return (!fo || follows.indexOf(p.id) >= 0) && (!lg || p.league === lg) && p.cpicks >= mn && (un === '' || (p.cu != null && p.cu > +un)) &&
          (!q || (p.matchup + ' ' + p.selection + ' ' + p.id.slice(0, 6)).toLowerCase().indexOf(q) >= 0);
      });
      $('prows').innerHTML = rows.length ? rows.map(function (p) {
        var t = TIER[p.tier] || TIER.small;
        return '<tr><td class="l nowrap hs">' + when(p.start) + '</td><td class="l"><span class="ps small">' + when(p.start) + ' PT</span><b>' + esc(p.selection) + '</b> <span class="dim small">' + esc(p.bet_type) + '</span><span class="pg dim small">' + esc(p.league) + ' &middot; ' + esc(p.matchup) + '</span></td><td>' + odds(p.odds) +
          '</td><td class="l"><a href="capper.html?id=' + esc(p.id) + '"><b class="idc">#' + esc(p.id.slice(0, 6).toUpperCase()) + '</b></a>' + (follows.indexOf(p.id) >= 0 ? ' <span class="pos" title="You follow this account">★</span>' : '') + '<span class="pt"><span class="badge ' + t[0] + '">' + t[1] + '</span></span></td><td class="hr">' + p.cw + '-' + p.cl + (p.cp ? '-' + p.cp : '') +
          '</td><td>' + sgn(p.cu, 2) + '</td><td class="hm">' + sgn(p.croi, 1, '%') + '</td><td class="hm">' + lead(p.lead_min) + '</td></tr>';
      }).join('') : '<tr><td colspan="8" class="empty">' + ($('pf').value === 'f' && !follows.length ? 'You are not following anyone yet. Open a profile and press Follow.' : 'No eligible picks match these filters right now.') + '</td></tr>';
      $('pcount').textContent = fmt(rows.length) + ' of ' + fmt(all.length) + ' eligible picks';
    }
    ['pf', 'pl', 'pt', 'pu'].forEach(function (id) { $(id).addEventListener('change', draw); });
    HWD.follows().then(function (ids) { follows = ids; draw(); });
    $('pq').addEventListener('input', draw);
    draw();
  }

  Promise.all([HWD.ready, fetch('data/index.json?v=' + Math.floor(Date.now() / 6e4)).then(function (r) { return r.json(); }).catch(function () { return {}; })]).then(function (x) {
    var s = x[0], meta = (x[1] || {}).meta || {};
    root.innerHTML = intro(meta, s);
    if (!s.pro) { root.insertAdjacentHTML('beforeend', locked()); return; }
    if (!meta.pro || !meta.pro.pending_feed) {
      root.insertAdjacentHTML('beforeend', '<div class="disclosure"><b>The pending pick feed is not available at this update</b><p class="muted">It returns at the next site update. Graded records and your full pick ledgers are unaffected.</p></div>');
      return;
    }
    HWD.pending().then(board).catch(function () {
      root.insertAdjacentHTML('beforeend', '<div class="disclosure"><b>Pro picks did not load</b><p class="muted">Refresh the page. If it keeps failing, sign in again from your account page.</p></div>');
    });
  });
})();
