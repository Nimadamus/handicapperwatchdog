"""Live, no-charge lifecycle check for Watchdog Pro on the production API.

Creates a one-use 100%-off coupon limited to the Watchdog Pro product, a $0 checkout session that collects no card
(payment_method_collection=if_required) with the same metadata the API uses, completes it in headless Chromium, then
checks: provisioning, Pro key access, webhook delivery, cancel at period end, billing portal, immediate end, access
removed. Deletes the coupon and the QA subscription at the end. No money moves.

    python tools/live_lifecycle_check.py qa-hwd-probe+N@handicapperwatchdog.com [monthly|annual]
"""
import json, os, sys, time, urllib.parse, urllib.request
sys.path.insert(0, os.path.dirname(__file__))
import hwd_secrets as H
from playwright.sync_api import sync_playwright

S = H.load(); KEY = S['STRIPE_SECRET_KEY']
PLAN = sys.argv[2] if len(sys.argv) > 2 else 'monthly'
PRICE = S['STRIPE_PRICE_ANNUAL'] if PLAN == 'annual' else S['STRIPE_PRICE_MONTHLY']
# Cloudflare KV is eventually consistent (edge reads cached up to 60 s), so webhook driven changes are read after 75 s.
SITE = 'https://handicapperwatchdog.com'; API = 'https://api.handicapperwatchdog.com'
EMAIL = sys.argv[1]
if 'hwdqa' not in EMAIL and 'qa-hwd-probe' not in EMAIL: sys.exit('Use a QA address containing +hwdqa or qa-hwd-probe: the API sends no mail for those (owner rule, no test emails).')
results = []


def check(name, ok, detail=''):
    results.append((ok, name)); print(('PASS ' if ok else 'FAIL ') + name + (('  ' + str(detail)) if detail and not ok else ''), flush=True)


def stripe(method, path, params=None):
    data = urllib.parse.urlencode(params or {}, doseq=True).encode() if method != 'GET' else None
    url = 'https://api.stripe.com/v1/' + path + ('?' + urllib.parse.urlencode(params, doseq=True) if method == 'GET' and params else '')
    r = urllib.request.Request(url, data=data, method=method, headers={'Authorization': 'Bearer ' + KEY})
    return json.load(urllib.request.urlopen(r, timeout=60))


price = stripe('GET', 'prices/' + PRICE)
coupon = stripe('POST', 'coupons', {'percent_off': 100, 'duration': 'once', 'max_redemptions': 1, 'redeem_by': int(time.time()) + 7200,
                                     'applies_to[products][0]': price['product'], 'name': 'Watchdog QA (no charge)', 'metadata[app]': 'hwd_qa'})
sub_id = None
try:
    cs = stripe('POST', 'checkout/sessions', {
        'mode': 'subscription', 'line_items[0][price]': PRICE, 'line_items[0][quantity]': 1, 'discounts[0][coupon]': coupon['id'],
        'payment_method_collection': 'if_required', 'customer_email': EMAIL,
        'success_url': SITE + '/account.html?session_id={CHECKOUT_SESSION_ID}', 'cancel_url': SITE + '/pricing.html?canceled=1',
        'metadata[app]': 'hwd', 'subscription_data[metadata][app]': 'hwd', 'client_reference_id': 'hwd_qa',
        'branding_settings[display_name]': 'Handicapper Watchdog'})
    check('$0 live checkout session created (amount 0, Watchdog price)', cs['amount_total'] == 0, cs['amount_total'])
    with sync_playwright() as pw:
        b = pw.chromium.launch(headless=True)
        ctx = b.new_context(viewport={'width': 1280, 'height': 900})
        p = ctx.new_page()
        p.goto(cs['url'], wait_until='domcontentloaded', timeout=90000)
        try: p.wait_for_selector('button[type=submit]', timeout=60000)
        except Exception:
            p.screenshot(path=os.path.join(os.environ.get('TEMP', '.'), 'hwd_qa_fail.png')); open(os.path.join(os.environ.get('TEMP', '.'), 'hwd_qa_fail.txt'), 'w', encoding='utf-8').write(p.inner_text('body')); raise
        p.screenshot(path=os.path.join(os.environ.get('TEMP', '.'), 'hwd_qa_checkout.png'))
        p.click('button[type=submit]')
        p.wait_for_url(SITE + '/account.html*', timeout=90000)
        p.wait_for_timeout(6000)
        txt = p.inner_text('body')
        p.screenshot(path=os.path.join(os.environ.get('TEMP', '.'), 'hwd_qa_account.png'), full_page=True)
        check('after checkout the account page shows Watchdog Pro', 'watchdog pro' in txt.lower(), txt[:300])
        me = p.evaluate("fetch('%s/api/me',{credentials:'include'}).then(r=>r.json())" % API)
        check('/api/me: signed in, pro, %s plan' % PLAN, me.get('signed_in') and me.get('pro') and me.get('plan') == PLAN, me)
        k = p.evaluate("fetch('%s/api/pro/key?id=pending',{credentials:'include'}).then(r=>r.status)" % API)
        check('Pro member gets the pending picks key', k == 200, k)
        picks = p.goto(SITE + '/picks.html'); p.wait_for_timeout(6000)
        ptxt = p.inner_text('body')
        check('picks page decrypts for the member (no locked/closed notice)', 'checkout is not open' not in ptxt.lower() and 'subscribe' not in ptxt.lower()[:400], ptxt[:300])
        p.screenshot(path=os.path.join(os.environ.get('TEMP', '.'), 'hwd_qa_picks.png'))
        anon = ctx.browser.new_context().new_page()
        anon.goto(SITE + '/'); ak = anon.evaluate("fetch('%s/api/pro/key?id=pending',{credentials:'include'}).then(r=>r.status)" % API)
        check('anonymous visitor is refused the key', ak in (401, 402, 403), ak)

        sess = stripe('GET', 'checkout/sessions/' + cs['id'])
        sub_id = sess['subscription']
        time.sleep(10)
        ev = stripe('GET', 'events', {'limit': 30, 'created[gte]': int(time.time()) - 900})
        mine = [e for e in ev['data'] if json.dumps(e['data']['object']).find(sub_id) >= 0 or e['data']['object'].get('id') == cs['id']]
        check('Stripe events for this subscription delivered (pending_webhooks 0)', mine and all(e['pending_webhooks'] == 0 for e in mine),
              [(e['type'], e['pending_webhooks']) for e in mine])

        stripe('POST', 'subscriptions/' + sub_id, {"cancel_at_period_end": "true"}); time.sleep(75)
        me = p.evaluate("fetch('%s/api/me',{credentials:'include'}).then(r=>r.json())" % API)
        check('cancel at period end (webhook) keeps Pro and flags it', me.get('pro') and me.get('cancel_at_period_end'), me)
        po = p.evaluate("fetch('%s/api/portal',{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:'{}'}).then(r=>r.json())" % API)
        check('billing portal session opens', str(po.get('url', '')).startswith('https://billing.stripe.com/'), po)
        stripe('POST', 'subscriptions/' + sub_id, {"cancel_at_period_end": "false"}); time.sleep(75)
        me = p.evaluate("fetch('%s/api/me',{credentials:'include'}).then(r=>r.json())" % API)
        check('resume (webhook) clears the cancel flag', me.get('pro') and not me.get('cancel_at_period_end'), me)

        stripe('DELETE', 'subscriptions/' + sub_id); sub_id = None; time.sleep(75)
        me = p.evaluate("fetch('%s/api/me',{credentials:'include'}).then(r=>r.json())" % API)
        check('subscription ended (webhook) removes Pro', me.get('signed_in') and not me.get('pro'), me)
        k = p.evaluate("fetch('%s/api/pro/key?id=pending',{credentials:'include'}).then(r=>r.status)" % API)
        check('ended member is refused the key', k in (401, 402, 403), k)
        b.close()
finally:
    if sub_id:
        try: stripe('DELETE', 'subscriptions/' + sub_id)
        except Exception as e: print('cleanup sub', e)
    try: stripe('DELETE', 'coupons/' + coupon['id'])
    except Exception as e: print('cleanup coupon', e)
print('%d/%d passed' % (sum(1 for ok, _ in results if ok), len(results)))
sys.exit(0 if all(ok for ok, _ in results) else 1)
