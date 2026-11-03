/* Watchdog Pro offer analytics. GA4 events when GA is present, plus first party aggregate counters (event, traffic source
   host, landing path, offer slot) sent to our own API. No personal data, no cookies, no identifiers. */
(function () {
  var API = /^(www\.)?handicapperwatchdog\.com$/.test(location.hostname) ? 'https://api.handicapperwatchdog.com' : '';
  var page = (location.pathname.replace(/\.html$/, '').replace(/\/$/, '/index') || '/index');
  function store(kind) { try { return window[kind]; } catch (e) { return null; } }
  function get(kind, k) { try { var s = store(kind); return s ? JSON.parse(s.getItem(k) || 'null') : null; } catch (e) { return null; } }
  function put(kind, k, v) { try { var s = store(kind); if (s) s.setItem(k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } }
  function source() {
    var q = new URLSearchParams(location.search), u = q.get('utm_source') || q.get('src') || q.get('ref');
    if (u) return u;
    var r = '';
    try { r = document.referrer ? new URL(document.referrer).hostname.replace(/^www\./, '') : ''; } catch (e) { r = ''; }
    return !r ? 'direct' : /handicapperwatchdog\.com$/.test(r) ? 'internal' : r;
  }
  var visit = get('sessionStorage', 'hwd_v');
  if (!visit) {   // first page of this visit: where it came from and where it landed
    visit = { s: source(), l: page };
    put('sessionStorage', 'hwd_v', visit);
    if (!get('localStorage', 'hwd_ft')) put('localStorage', 'hwd_ft', visit);
    send('land', { s: visit.s, l: visit.l });
  }
  function send(e, extra) {
    if (!API) return;
    var b = JSON.stringify(Object.assign({ e: e }, extra || {}));
    try { if (navigator.sendBeacon && navigator.sendBeacon(API + '/api/ev', b)) return; } catch (x) { /* fall through */ }
    try { fetch(API + '/api/ev', { method: 'POST', body: b, keepalive: true, credentials: 'omit' }); } catch (x) { /* never block the page */ }
  }
  // what checkout records with the order: the first visit's source and landing page, and the offer that was clicked last
  function attr() {
    var ft = get('localStorage', 'hwd_ft') || visit, slot = get('sessionStorage', 'hwd_slot');
    return { s: ft.s, l: ft.l, slot: slot || 'none' };
  }
  window.HWDT = { ev: function (e) { var v = get('sessionStorage', 'hwd_v') || visit; send(e, { s: v.s, l: v.l }); }, attr: attr };

  function slot(el) {
    var s = el.closest('section,[id],.unl,.lockfoot,.ctaband');
    var name = s ? (s.id || String(s.className || '').split(' ')[0] || s.tagName.toLowerCase()) : 'page';
    return page + '|' + name;
  }
  function isOffer(a) { return a && /pricing\.html/.test(a.getAttribute('href') || '') && !a.closest('header,footer,.navlinks,nav'); }
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a');
    if (!isOffer(a)) return;
    var k = slot(a);
    put('sessionStorage', 'hwd_slot', k);
    send('offer_click', { s: visit.s, slot: k });
    if (window.gtag) gtag('event', 'select_promotion', { promotion_id: 'watchdog_pro', promotion_name: 'Watchdog Pro', creative_slot: k });
  }, true);
  if (!window.gtag || !('IntersectionObserver' in window)) return;
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
