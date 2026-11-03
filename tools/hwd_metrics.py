"""Watchdog Pro revenue and funnel numbers, straight from Stripe (the source of truth for money).

    python tools/hwd_metrics.py            # print the report
    python tools/hwd_metrics.py --json     # machine readable

Counts only Watchdog Pro objects (the two Watchdog price ids, metadata app=hwd) on the shared Stripe account.
Funnel, no extra permissions: first party daily counters from our own API (/api/ev/summary, alerts token): visits by
source and landing page, offer clicks by placement, pricing views, checkout starts and cancels. Checkout sessions carry
the buyer's first visit source, landing page and last offer clicked in metadata (src, landing, slot), so purchases are
attributed from Stripe itself. GA4 (G-SC607ZYK1F) keeps the same events for the owner's own reports.
"""
import json, os, sys, time, urllib.parse, urllib.request
sys.path.insert(0, os.path.dirname(__file__))
import hwd_secrets as H

S = H.load(); KEY = S['STRIPE_SECRET_KEY']
PRICES = {S['STRIPE_PRICE_MONTHLY']: ('monthly', 4999), S['STRIPE_PRICE_ANNUAL']: ('annual', 49900)}
QA = ('hwdqa', 'qa-hwd-probe')
_ex = os.path.join(os.path.dirname(__file__), 'hwd_metrics_exclude.txt')
EXCLUDE = {l.strip() for l in open(_ex) if l.strip() and not l.startswith('#')} if os.path.exists(_ex) else set()


def get(path, params):
    out, after = [], None
    while True:
        p = dict(params, limit=100, **({'starting_after': after} if after else {}))
        r = urllib.request.Request('https://api.stripe.com/v1/' + path + '?' + urllib.parse.urlencode(p, doseq=True), headers={'Authorization': 'Bearer ' + KEY})
        d = json.load(urllib.request.urlopen(r, timeout=60))
        out += d['data']
        if not d.get('has_more'): return out
        after = d['data'][-1]['id']


def is_qa(email): return any(q in (email or '') for q in QA)


now = int(time.time()); d30 = now - 30 * 86400; d7 = now - 7 * 86400
subs = [s for s in get('subscriptions', {'status': 'all', 'expand[]': 'data.customer'})
        if s['items']['data'] and s['items']['data'][0]['price']['id'] in PRICES]
subs = [s for s in subs if not is_qa((s.get('customer') or {}).get('email') if isinstance(s.get('customer'), dict) else '')]
paying = [s for s in subs if s['status'] in ('active', 'trialing', 'past_due')]
mrr = sum(PRICES[s['items']['data'][0]['price']['id']][1] / (12 if PRICES[s['items']['data'][0]['price']['id']][0] == 'annual' else 1) for s in paying if s['status'] != 'trialing') / 100
sessions = [c for c in get('checkout/sessions', {'created[gte]': d30}) if (c.get('metadata') or {}).get('app') == 'hwd' and c['id'] not in EXCLUDE and not is_qa(c.get('customer_email') or (c.get('customer_details') or {}).get('email'))]
inv_failed = [e for e in get('events', {'type': 'invoice.payment_failed', 'created[gte]': d30})
              if any(l.get('pricing', {}).get('price_details', {}).get('price') in PRICES or (l.get('price') or {}).get('id') in PRICES
                     for l in e['data']['object'].get('lines', {}).get('data', []))]
def hwd_line(l):
    return l.get('pricing', {}).get('price_details', {}).get('price') in PRICES or (l.get('price') or {}).get('id') in PRICES


paid = [i for i in get('invoices', {'status': 'paid', 'created[gte]': d30}) if any(hwd_line(l) for l in i.get('lines', {}).get('data', []))
        and not is_qa(i.get('customer_email'))]
rep = {
    'as_of_pt': time.strftime('%Y-%m-%d %I:%M %p', time.localtime(now)),
    'active_paying': sum(1 for s in paying if s['status'] == 'active'),
    'past_due': sum(1 for s in paying if s['status'] == 'past_due'),
    'canceling_at_period_end': sum(1 for s in paying if s.get('cancel_at_period_end')),
    'monthly_plans': sum(1 for s in paying if PRICES[s['items']['data'][0]['price']['id']][0] == 'monthly'),
    'annual_plans': sum(1 for s in paying if PRICES[s['items']['data'][0]['price']['id']][0] == 'annual'),
    'mrr_usd': round(mrr, 2), 'arr_usd': round(mrr * 12, 2),
    'new_7d': sum(1 for s in subs if s['created'] >= d7), 'new_30d': sum(1 for s in subs if s['created'] >= d30),
    'ended_30d': sum(1 for s in subs if s['status'] == 'canceled' and (s.get('ended_at') or 0) >= d30),
    'checkout_starts_30d': len(sessions), 'checkouts_completed_30d': sum(1 for c in sessions if c['status'] == 'complete'),
    'checkouts_abandoned_30d': sum(1 for c in sessions if c['status'] == 'expired'), 'checkouts_open_now': sum(1 for c in sessions if c['status'] == 'open'),
    'failed_payments_30d': len(inv_failed),
    'renewals_30d': sum(1 for i in paid if i.get('billing_reason') == 'subscription_cycle'),
    'first_payments_30d': sum(1 for i in paid if i.get('billing_reason') == 'subscription_create' and (i.get('amount_paid') or 0) > 0),
    'revenue_collected_30d_usd': round(sum(i.get('amount_paid') or 0 for i in paid) / 100, 2),
    'trials': 'none offered (Watchdog Pro has no trial)',
}
rep['checkout_conversion_30d'] = round(rep['checkouts_completed_30d'] / rep['checkout_starts_30d'], 3) if rep['checkout_starts_30d'] else None
start = rep['active_paying'] + rep['ended_30d']
rep['churn_30d'] = round(rep['ended_30d'] / start, 3) if start else None

# first party funnel (aggregate counts by Pacific day), joined with Stripe attribution
try:
    r = urllib.request.Request('https://api.handicapperwatchdog.com/api/ev/summary?days=30', headers={'x-alerts-token': S['ALERTS_TOKEN'], 'user-agent': 'hwd-metrics'})
    days = json.load(urllib.request.urlopen(r, timeout=60))['days']
except Exception as e:
    days = None; rep['funnel_error'] = str(e)[:120]
if days is not None:
    tot, by_src, by_land, by_slot = {}, {}, {}, {}
    for day in days.values():
        for k, n in day.items():
            ev, src, detail = (k.split(' ', 2) + ['', ''])[:3]
            if any(q in src for q in QA + ('journey-audit',)):
                continue   # our own QA probes
            tot[ev] = tot.get(ev, 0) + n
            if ev == 'land':
                by_src[src] = by_src.get(src, 0) + n; by_land[detail] = by_land.get(detail, 0) + n
            if ev == 'offer_click':
                by_slot[detail] = by_slot.get(detail, 0) + n
    top = lambda d, n=8: dict(sorted(d.items(), key=lambda x: -x[1])[:n])
    rep['funnel_days_counted'] = len(days)
    rep['funnel_30d'] = {'visits': tot.get('land', 0), 'offer_clicks': tot.get('offer_click', 0), 'pricing_views': tot.get('pricing', 0),
                         'checkout_starts': tot.get('checkout', 0), 'checkout_cancels': tot.get('cancel', 0),
                         'purchases_stripe': rep['first_payments_30d']}
    rep['visits_by_source'] = top(by_src); rep['visits_by_landing'] = top(by_land); rep['offer_clicks_by_slot'] = top(by_slot)
won = [c for c in sessions if c['status'] == 'complete']
rep['purchases_by_source_30d'] = {}
for c in won:
    k = (c.get('metadata') or {}).get('src') or 'before attribution'
    rep['purchases_by_source_30d'][k] = rep['purchases_by_source_30d'].get(k, 0) + 1
if '--json' in sys.argv: print(json.dumps(rep, indent=1))
else:
    for k, v in rep.items(): print(f'{k:28} {v}')
