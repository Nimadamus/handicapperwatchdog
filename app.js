(function () {
  var fmt = function (n) { return Number(n).toLocaleString('en-US'); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var signed = function (v, d, suf) { if (v == null) return '<span class="muted">n/a</span>'; var n = Number(v); return '<span class="' + (n > 0 ? 'win' : n < 0 ? 'loss' : '') + '">' + (n > 0 ? '+' : '') + n.toFixed(d) + (suf || '') + '</span>'; };
  var streak = function (s) { return s > 0 ? '<span class="win">W' + s + '</span>' : s < 0 ? '<span class="loss">L' + (-s) + '</span>' : '<span class="muted">0</span>'; };
  fetch('data.json?v=' + Date.now()).then(function (r) { return r.json(); }).then(function (d) {
    var vals = { tracked: fmt(d.tracked), graded_picks: fmt(d.graded_picks), qualified: fmt(d.qualified), min_graded: d.min_graded,
      pct: d.qualified ? Math.round(100 * d.profitable / d.qualified) + '%' : 'n/a' };
    document.querySelectorAll('[data-k]').forEach(function (el) { el.textContent = vals[el.getAttribute('data-k')]; });
    var built = new Date(d.built_at);
    document.getElementById('fresh').textContent = 'Handicappers with ' + d.min_graded + '+ graded picks. Updated ' +
      built.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' PT.';
    document.getElementById('rows').innerHTML = d.top.map(function (r, i) {
      return '<tr><td class="l rank">' + (i + 1) + '</td><td class="l"><div class="who"><span class="masked" aria-label="Name hidden">Capper ' + esc(r.id) + '</span>' +
        '<small>' + esc(r.source) + ' · ' + r.sports.map(esc).join(', ') + '</small></div></td>' +
        '<td class="hm">' + fmt(r.graded) + '</td><td>' + r.wins + '-' + r.losses + (r.pushes ? '-' + r.pushes : '') + '</td>' +
        '<td class="hm">' + (r.win_rate == null ? 'n/a' : Number(r.win_rate).toFixed(1) + '%') + '</td><td>' + signed(r.units, 2) + '</td><td class="hm">' + signed(r.roi, 1, '%') + '</td>' +
        '<td class="hm">' + streak(r.streak) + '</td></tr>';
    }).join('');
  }).catch(function () { document.getElementById('rows').innerHTML = '<tr><td colspan="8" class="muted">Records are refreshing. Try again in a minute.</td></tr>'; });
})();
