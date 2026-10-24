(function () {
  'use strict';
  var note = document.getElementById('notice'), btns = document.querySelectorAll('[data-plan]');
  function show(msg) { note.hidden = false; note.textContent = msg; }
  if (/canceled=1/.test(location.search)) show('Checkout was canceled. You have not been charged.');
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
