/* Watchdog Pro offer analytics (GA4): which offer placements are seen and clicked. No personal data. */
(function () {
  if (!window.gtag) return;
  function slot(el) {
    var s = el.closest('section,[id],.unl,.lockfoot,.ctaband');
    var name = s ? (s.id || String(s.className || '').split(' ')[0] || s.tagName.toLowerCase()) : 'page';
    return (location.pathname.replace(/\.html$/, '').replace(/\/$/, '/index') || '/index') + '|' + name;
  }
  function isOffer(a) { return a && /pricing\.html/.test(a.getAttribute('href') || '') && !a.closest('header,footer,.navlinks,nav'); }
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a');
    if (isOffer(a)) gtag('event', 'select_promotion', { promotion_id: 'watchdog_pro', promotion_name: 'Watchdog Pro', creative_slot: slot(a) });
  }, true);
  if (!('IntersectionObserver' in window)) return;
  var seen = {};
  var io = new IntersectionObserver(function (es) {
    es.forEach(function (x) {
      if (!x.isIntersecting) return;
      io.unobserve(x.target);
      var k = slot(x.target);
      if (seen[k]) return;
      seen[k] = 1;
      gtag('event', 'view_promotion', { promotion_id: 'watchdog_pro', promotion_name: 'Watchdog Pro', creative_slot: k });
    });
  }, { threshold: 0.6 });
  var watched = [];
  function scan() {
    document.querySelectorAll('a[href*="pricing.html"]').forEach(function (a) {
      if (isOffer(a) && watched.indexOf(a) < 0) { watched.push(a); io.observe(a); }
    });
  }
  scan(); setTimeout(scan, 2500); setTimeout(scan, 6000);
})();
