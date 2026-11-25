// Watchdog Pro client: session state, checkout, sign in and decrypting Pro data (full pick ledgers).
// Loaded on every page before the page script. When the API is not reachable (a static only deploy),
// HWD.ready resolves with api:false and every Pro control shows that checkout is not open yet.
(function () {
  'use strict';
  // Production API lives on its own subdomain (static site is on GitHub Pages); staging and dev serve /api on the same host.
  var API = /^(www\.)?handicapperwatchdog\.com$/.test(location.hostname) ? 'https://api.handicapperwatchdog.com' : '';
  var state = { api: false, pro: false, signed_in: false, billing: false };
  var post = function (path, body) {
    return fetch(API + path, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) })
      .then(function (r) { return r.json().then(function (d) { d._status = r.status; return d; }); });
  };
  var ready = fetch(API + '/api/me', { credentials: 'include', cache: 'no-store' })
    .then(function (r) { if (!r.ok || !/json/.test(r.headers.get('content-type') || '')) throw 0; return r.json(); })
    .then(function (d) { state = Object.assign({ api: true }, d); return state; })
    .catch(function () { return state; });

  function b64bytes(s) { var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  var keys = {};
  function key(id) {
    if (!keys[id]) keys[id] = fetch(API + '/api/pro/key?id=' + encodeURIComponent(id), { credentials: 'include', cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('key ' + r.status); return r.json(); })
      .then(function (d) { return crypto.subtle.importKey('raw', b64bytes(d.key), 'AES-GCM', false, ['decrypt']); });
    return keys[id];
  }
  function open(file, id) {
    return Promise.all([fetch(file, { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('file ' + r.status); return r.text(); }), key(id)])
      .then(function (x) {
        var raw = b64bytes(x[0].trim());
        return crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, x[1], raw.slice(12));
      })
      .then(function (plain) { return JSON.parse(new TextDecoder().decode(plain)); });
  }

  // keyboard users can jump past the header on every page
  (function () {
    var m = document.querySelector('main'); if (!m) return;
    if (!m.id) m.id = 'main';
    m.setAttribute('tabindex', '-1');
    var a = document.createElement('a'); a.href = location.pathname + location.search + '#' + m.id; a.className = 'skip'; a.textContent = 'Skip to content';
    document.body.insertBefore(a, document.body.firstChild);
  })();

  // wide tables scroll by keyboard, and the main nav has a name
  function tidy() {
    var sn = document.getElementById('sitenav'); if (sn) sn.setAttribute('aria-label', 'Main');
    [].forEach.call(document.querySelectorAll('.tw:not([tabindex])'), function (el) { tidy.n = (tidy.n || 0) + 1; el.setAttribute('tabindex', '0'); el.setAttribute('role', 'region'); el.setAttribute('aria-label', 'Scrollable table ' + tidy.n); });
  }
  tidy();
  if (window.MutationObserver) new MutationObserver(tidy).observe(document.body, { childList: true, subtree: true });

  // remember the profile or board a visitor was on when they headed to pricing or sign in, for one day
  function store(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  function read(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href]'); if (!a) return;
    if (!/(^|\/)(pricing|account)\.html/.test(a.getAttribute('href') || '')) return;
    if (/\/(pricing|account)\.html$/.test(location.pathname)) return;
    store('hwd_return', JSON.stringify({ to: location.pathname + location.search, at: Date.now() }));
  });

  window.HWD = {
    ready: ready,
    returnTo: function () {
      try { var r = JSON.parse(read('hwd_return') || 'null'); if (r && Date.now() - r.at < 864e5 && /^\/[^/]/.test(r.to) && r.to.indexOf('//') < 0) return r.to; } catch (e) {}
      return null;
    },
    clearReturn: function () { store('hwd_return', null); },
    state: function () { return state; },
    checkout: function (plan, email, attr) {
      return post('/api/checkout', { plan: plan, email: email || undefined, attr: attr }).then(function (d) { if (d.url) location.href = d.url; return d; });
    },
    portal: function () { return post('/api/portal').then(function (d) { if (d.url) location.href = d.url; return d; }); },
    login: function (email) { return post('/api/login', { email: email }); },
    verify: function (token) { return post('/api/login/verify', { token: token }); },
    complete: function (sid) { return fetch(API + '/api/checkout/complete?session_id=' + encodeURIComponent(sid), { credentials: 'include' }).then(function (r) { return r.json().then(function (d) { d._status = r.status; return d; }); }); },
    api: API,
    logout: function () { return post('/api/logout').then(function () { location.href = './'; }); },
    capper: function (id) { var c = this._c || (this._c = {}); return c[id] || (c[id] = open('data/x/' + id + '.bin', id)); },
    follows: function () {
      if (!this._follows) this._follows = fetch(API + '/api/follows', { credentials: 'include', cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : { ids: [] }; })
        .then(function (d) { return d.ids || []; }).catch(function () { return []; });
      return this._follows;
    },
    follow: function (id, on) {
      var self = this;
      return post('/api/follows', { id: id, on: on }).then(function (d) { if (d.ids) self._follows = Promise.resolve(d.ids); if (window.gtag) gtag('event', on ? 'follow' : 'unfollow'); return d; });
    },
    // Free weekly email sign up (double opt in). Never pending picks, only graded results and new reviews.
    signup: function (email, follow, reviews, website) { return post('/api/signup', { email: email, follow: follow || undefined, reviews: !!reviews, website: website || '' }); },
    confirm: function (token) { return post('/api/signup/confirm', { token: token }); },
    digest: function (on, reviews) { return post('/api/digest', reviews == null ? { on: on } : { on: on, reviews: reviews }); },
    // Follow toggle for a profile header. Everyone can follow; signed out visitors get the free email sign up.
    followButton: function (id, pro) {
      var host = document.querySelector('.pid > div:last-child'); if (!host || document.getElementById('fbtn')) return;
      var u = document.querySelector('.phero .unl');
      if (pro && u) u.innerHTML = '<span class="lock">Watchdog Pro</span><b>You have Watchdog Pro</b><p>The complete pick log and every breakdown are open on this profile.</p>';
      var self = this, b = document.createElement('button');
      if (!state.signed_in) {
        b.id = 'fbtn'; b.type = 'button'; b.className = 'btn sm ghost'; b.style.marginTop = '10px'; b.textContent = '☆ Follow (free weekly email)';
        host.appendChild(b);
        b.onclick = function () {
          if (document.getElementById('fsign')) return;
          var f = document.createElement('form'); f.id = 'fsign'; f.className = 'row'; f.style.marginTop = '10px';
          f.innerHTML = '<input type="email" required placeholder="you@example.com" autocomplete="email" aria-label="Email"><input name="website" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true"><button class="btn sm" type="submit">Email me</button><p class="muted small" style="flex-basis:100%;margin:6px 0 0">Every Monday: this account’s graded results for the week. Never picks before a game. Free, stop any time.</p>';
          host.appendChild(f);
          f.addEventListener('submit', function (e) {
            e.preventDefault(); var sb = f.querySelector('button'); sb.disabled = true;
            self.signup(f.querySelector('input[type=email]').value, id, false, f.website.value).then(function (d) {
              f.querySelector('p').textContent = d.message || d.error || 'Something went wrong. Try again.'; sb.disabled = !!d.ok;
              if (d.ok && window.gtag) gtag('event', 'alerts_signup');
            }).catch(function () { sb.disabled = false; f.querySelector('p').textContent = 'Could not send. Try again.'; });
          });
          f.querySelector('input').focus();
        };
        return;
      }
      b.id = 'fbtn'; b.type = 'button'; b.className = 'btn sm ghost'; b.style.marginTop = '10px';
      var paint = function (on) { b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.textContent = on ? '★ Following' : '☆ Follow'; };
      host.appendChild(b);
      self.follows().then(function (ids) { var on = ids.indexOf(id) >= 0; paint(on);
        b.onclick = function () { b.disabled = true; on = !on; self.follow(id, on).then(function (d) {
          b.disabled = false; if (d.error) { on = !on; b.title = d.error; } paint(on);
          if (on && !d.error && !state.digest) self.digest(true).then(function (r) { if (r.digest) state.digest = true; });
        }); };
      });
    },
    pending: function () { if (!this._pending) this._pending = open('data/x/pending.bin', 'pending'); return this._pending; }
  };

  // every "unlock" call to action says plainly when checkout is not open
  ready.then(function (s) {
    document.querySelectorAll('[data-cta-note]').forEach(function (el) {
      if (s.pro) { el.textContent = 'You have Watchdog Pro. Full pick logs are open on every profile.'; el.hidden = false; }
      else if (!s.api || !s.billing) { el.textContent = 'Watchdog Pro checkout is not open yet. The picks page shows what Pro includes and the launch prices.'; el.hidden = false; }
    });
  });

  // header: account link and Pro badge
  ready.then(function (s) {
    var nav = document.querySelector('.top .wrap'), cta = nav && nav.querySelector('.btn.pro');
    if (!cta) return;
    if (s.pro) { cta.textContent = 'Pro account'; cta.href = 'account.html'; }
    else { cta.textContent = 'Watchdog Pro'; cta.href = 'pricing.html'; }
    var sig = nav.querySelector('.signin');
    if (sig) { if (s.pro) sig.hidden = true; else if (s.signed_in) sig.textContent = 'Account'; }
    else if (s.api && !s.pro) {
      var a = document.createElement('a'); a.href = 'account.html'; a.className = 'btn sm ghost'; a.textContent = s.signed_in ? 'Account' : 'Sign in';
      nav.insertBefore(a, cta);
    }
  });
})();
