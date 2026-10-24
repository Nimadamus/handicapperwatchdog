(function () {
  'use strict';
  var note = document.getElementById('notice'), btns = document.querySelectorAll('[data-plan]');
  function show(msg) { note.hidden = false; note.textContent = msg; }
  if (/canceled=1/.test(location.search)) show('Checkout was canceled. You have not been charged.');
  // Live preview built from the same rankings data the site shows: real counts, real records, names hidden.
  var fmt = function (n) { return Number(n).toLocaleString('en-US'); };
  var sgn = function (v, d, suf) { if (v == null) return '<span class="dim">n/a</span>'; var n = +v; return '<span class="' + (n > 0 ? 'pos' : n < 0 ? 'neg' : '') + '">' + (n > 0 ? '+' : '') + n.toFixed(d) + (suf || '') + '</span>'; };
  fetch('data/index.json?v=' + Math.floor(Date.now() / 6e4)).then(function (r) { return r.json(); }).then(function (d) {
    var M = d.meta, all = d.cappers;
    var picks = all.filter(function (c) { return c.profile; }).reduce(function (a, c) { return a + c.picks; }, 0);
    document.getElementById('pvStats').innerHTML = [[fmt(M.profiles), 'handicapper profiles you can put a name to'], [fmt(picks), 'graded picks in their pick histories'],
      [fmt(M.qualified), 'with 20 or more graded picks'], [fmt(M.sources.length), 'platforms tracked']].map(function (k) { return '<div><b>' + k[0] + '</b><span>' + k[1] + '</span></div>'; }).join('');
    document.getElementById('pvAt').textContent = 'Updated ' + new Date(M.built_at).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' PT';
    var top = all.filter(function (c) { return c.picks >= 50 && c.units != null; }).sort(function (a, b) { return b.units - a.units; }).slice(0, 5);
    document.getElementById('pvRows').innerHTML = top.map(function (c) {
      return '<tr><td class="l"><span class="blur" aria-label="Name hidden">Hidden name</span> <span class="dim small">' + c.source + '</span></td><td class="hp">' + fmt(c.picks) + '</td><td>' + c.w + '-' + c.l + (c.p ? '-' + c.p : '') +
        '</td><td>' + sgn(c.units, 2) + '</td><td class="hp">' + sgn(c.roi, 1, '%') + '</td><td class="l small muted hp">Name, ' + fmt(c.picks) + ' picks with posts</td></tr>';
    }).join('');
  }).catch(function () { document.getElementById('preview').hidden = true; });
  HWD.ready.then(function (s) {
    if (s.pro) {
      btns.forEach(function (b) { b.textContent = 'You have Watchdog Pro'; b.disabled = true; });
      show('Your account already has Watchdog Pro. Manage billing from your account page.');
      return;
    }
    if (!s.api || !s.billing) {
      btns.forEach(function (b) { b.textContent = 'Opening soon'; b.disabled = true; });
      document.getElementById('planNote').textContent = 'Checkout opens shortly. Payments will be handled by Stripe.';
      return;
    }
    btns.forEach(function (b) {
      b.addEventListener('click', function () {
        btns.forEach(function (x) { x.disabled = true; });
        b.textContent = 'Opening secure checkout';
        HWD.checkout(b.getAttribute('data-plan')).then(function (d) {
          if (!d.url) { show(d.error || 'Checkout is not available right now.'); btns.forEach(function (x) { x.disabled = false; }); b.textContent = 'Try again'; }
        });
      });
    });
  });
})();
