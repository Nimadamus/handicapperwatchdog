(function () {
  'use strict';
  var box = document.getElementById('acct');
  var P = new URLSearchParams(location.search);
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var day = function (t) { return t ? new Date(t * 1000).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'n/a'; };
  var clean = function () { history.replaceState(null, '', location.pathname); };

  function signedOut(msg) {
    box.innerHTML = '<div class="ph"><h1>Sign in to Watchdog Pro</h1></div><div class="pb">' + (msg ? '<div class="notice">' + esc(msg) + '</div>' : '') +
      '<p class="muted" style="margin:0 0 14px">Enter the email you subscribed with and we will send you a sign in link. New here? <a href="pricing.html" style="text-decoration:underline">See Watchdog Pro</a>.</p>' +
      '<form id="lf" class="row"><input id="em" type="email" required placeholder="you@example.com" autocomplete="email" aria-label="Email"><button class="btn" type="submit">Email me a link</button></form><p class="muted small" id="lm"></p></div>';
    document.getElementById('lf').addEventListener('submit', function (e) {
      e.preventDefault();
      var b = this.querySelector('button'); b.disabled = true;
      HWD.login(document.getElementById('em').value).then(function (d) {
        b.disabled = false;
        document.getElementById('lm').innerHTML = esc(d.message || d.error || 'Something went wrong.') + (d.dev_link ? ' <a href="' + esc(d.dev_link) + '" style="text-decoration:underline">Test link</a>' : '');
      });
    });
  }

  function nav(s) {
    var cta = document.querySelector('.top .btn.pro'), extra = cta && cta.previousElementSibling;
    if (extra && extra.classList.contains('ghost')) extra.textContent = s.signed_in ? 'Account' : 'Sign in';
    if (cta && s.pro) { cta.textContent = 'Pro account'; cta.href = 'account.html'; if (extra && extra.classList.contains('ghost')) extra.remove(); }
  }
  function signedIn(s, msg) {
    nav(s);
    var status = s.pro ? (s.cancel_at_period_end ? 'Active, ends ' + day(s.period_end) : s.payment_failed ? 'Payment failed, Stripe is retrying' : 'Active, renews ' + day(s.period_end)) :
      (s.status && s.status !== 'none' ? 'Not active (' + esc(s.status) + ')' : 'No subscription');
    box.innerHTML = '<div class="ph"><h1>Your account</h1><span class="lock">' + (s.pro ? 'Watchdog Pro' : 'Free') + '</span></div><div class="pb">' +
      (msg ? '<div class="notice ok">' + esc(msg) + '</div>' : '') +
      '<ul class="facts"><li><span>Email</span><b>' + esc(s.email) + '</b></li><li><span>Plan</span><b>' + (s.plan === 'annual' ? '$149 a year' : s.plan === 'monthly' ? '$19.99 a month' : 'None') + '</b></li>' +
      '<li><span>Status</span><b>' + status + '</b></li></ul>' +
      (s.payment_failed ? '<div class="notice">Your last payment did not go through. Update your card in billing to keep Pro.</div>' : '') +
      '<div class="row" style="margin-top:16px">' + (s.pro || s.status && s.status !== 'none' ? '<button class="btn" id="bill" type="button">Manage billing</button>' : '<a class="btn pro" href="pricing.html">Get Watchdog Pro</a>') +
      '<a class="btn ghost" href="cappers.html">Open rankings</a><button class="btn ghost" id="out" type="button">Sign out</button></div></div>';
    var bill = document.getElementById('bill');
    if (bill) bill.onclick = function () { bill.disabled = true; HWD.portal().then(function (d) { if (!d.url) { bill.disabled = false; alertBox(d.error); } }); };
    document.getElementById('out').onclick = function () { HWD.logout(); };
  }
  function alertBox(m) { var n = document.createElement('div'); n.className = 'notice'; n.textContent = m || 'Billing is not available right now.'; box.querySelector('.pb').prepend(n); }

  HWD.ready.then(function (s) {
    if (!s.api) { box.innerHTML = '<div class="ph"><h1>Watchdog Pro accounts</h1></div><div class="pb"><p class="muted" style="margin:0">Accounts open with Watchdog Pro. <a href="pricing.html" style="text-decoration:underline">See plans</a>.</p></div>'; return; }
    var sid = P.get('session_id'), tok = P.get('login');
    if (sid) {
      box.innerHTML = '<div class="ph"><h1>Confirming your subscription</h1></div><div class="pb"><p class="muted" style="margin:0">One moment.</p></div>';
      return HWD.complete(sid).then(function (d) {
        clean();
        if (d._status !== 200) return s.signed_in ? signedIn(s, d.error) : signedOut(d.error);
        return fetch('/api/me', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (me) { signedIn(me, 'Welcome to Watchdog Pro. Names and pick logs are now unlocked on every profile.'); });
      });
    }
    if (tok) {
      return HWD.verify(tok).then(function (d) {
        clean();
        if (d._status !== 200) return signedOut(d.error);
        return fetch('/api/me', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (me) { signedIn(me, 'You are signed in.'); });
      });
    }
    return s.signed_in ? signedIn(s) : signedOut();
  });
})();
