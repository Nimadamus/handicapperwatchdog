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
      document.getElementById('planNote').textContent = 'Checkout is not open yet. Nothing can be bought on the site today and no card is collected. Payments will be handled by Stripe at launch.';
      return;
    }
    var label = { annual: 'Subscribe yearly, $499', monthly: 'Subscribe monthly, $49.99' };
    btns.forEach(function (b) { b.disabled = false; b.textContent = label[b.getAttribute('data-plan')] || 'Subscribe'; });
    document.getElementById('planNote').textContent = 'Secure checkout by Stripe. Cancel any time from your account page.';
    var box = document.getElementById('buyerBox'), email = document.getElementById('buyerEmail');
    if (box && !s.signed_in) box.style.display = 'block';
    btns.forEach(function (b) {
      b.addEventListener('click', function () {
        var addr = email && box && box.style.display !== 'none' ? email.value.trim() : '';
        if (box && box.style.display !== 'none' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(addr)) { show('Enter your email to open secure checkout.'); email && email.focus(); return; }
        btns.forEach(function (x) { x.disabled = true; });
        b.textContent = 'Opening secure checkout';
        HWD.checkout(b.getAttribute('data-plan'), addr).then(function (d) {
          if (!d.url) { show(d.error || 'Checkout is not available right now.'); btns.forEach(function (x) { x.disabled = false; }); b.textContent = 'Try again'; }
        });
      });
    });
  });
})();
