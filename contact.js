// Contact form: posts to the Watchdog API, which emails support with the sender as reply-to.
(function () {
  'use strict';
  var f = document.getElementById('cf'); if (!f) return;
  var out = document.getElementById('cfout'), btn = f.querySelector('button[type=submit]');
  var api = (window.HWD && window.HWD.api) || '';
  if (window.HWD && HWD.ready) HWD.ready.then(function (s) { if (s && s.email && !f.email.value) f.email.value = s.email; });
  f.addEventListener('submit', function (e) {
    e.preventDefault();
    btn.disabled = true; out.className = 'cfout'; out.textContent = 'Sending...';
    fetch(api + '/api/contact', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: f.email.value, topic: f.topic.value, message: f.message.value, website: f.website.value }) })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (x) {
        if (x.ok) { out.className = 'cfout ok'; out.textContent = 'Sent. We reply by email, usually within one business day. A copy is on its way to your inbox.' + (x.d.ref ? ' Reference ' + x.d.ref + '.' : ''); f.reset(); if (window.gtag) gtag('event', 'contact_submit', { topic: f.topic.value }); }
        else { out.className = 'cfout err'; out.textContent = (x.d && x.d.error) || 'The message did not send. Please try again.'; }
      })
      .catch(function () { out.className = 'cfout err'; out.textContent = 'The message did not send. Check your connection and try again.'; })
      .then(function () { btn.disabled = false; });
  });
})();
