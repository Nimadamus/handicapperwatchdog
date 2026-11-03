# Analytics access: what is covered now, and the smallest extra grant worth asking for

## Covered with no new permissions (live November 3, 2026)
- First party counters on our own API (`/api/ev`, read with `/api/ev/summary` and the existing alerts token): visits by
  traffic source and landing page, Pro offer clicks by placement, pricing views, checkout starts, checkout cancels.
  Aggregate daily counts only, no cookies, no identifiers, no personal data, bots filtered, kept 120 days.
- Stripe checkout sessions and subscriptions now carry the buyer's first visit source, landing page and last offer
  clicked (metadata `src`, `landing`, `slot`), so purchases and retention are attributed from billing records.
- `python tools/hwd_metrics.py` joins both: source -> landing -> offer click -> pricing -> checkout -> purchase ->
  renewal/churn.

## Not covered, and the minimal grant that would cover it
| Gap | Needed only if | Minimal grant |
|---|---|---|
| Google search queries, impressions, position per page | weekly SEO reporting without opening the console in the owner's browser | Search Console: add the existing service account as a **Restricted** user on `sc-domain:handicapperwatchdog.com` (read only, no settings, no sitemap or removal rights) |
| GA4 engagement time, device, geography, returning visitor share | we want those cuts in the automated report | GA4: **Viewer** role on the Handicapper Watchdog property only (not the account), for the same service account |

Neither grant is needed for the conversion funnel. Recommendation: wait two weeks of first party data; request the
Search Console Restricted grant first if SEO reporting by query becomes the bottleneck.
