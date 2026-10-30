# Watchdog Pro on Cloudflare: plan without a nameserver move (October 29, 2026)

## What is live today
- DNS: GoDaddy nameservers (ns69/ns70.domaincontrol.com). Apex A records to GitHub Pages (185.199.108-111.153), `www` CNAME `nimadamus.github.io`, TXT google-site-verification. No MX, no AAAA.
- Hosting: GitHub Pages, built by `.github/workflows/refresh.yml` every 30 minutes and on push to main. HTTPS enforced, certificate to 2027-01-22.
- Search: Google Search Console domain property and Bing Webmaster verified by the GoDaddy TXT record.

## Decision: no migration of the site, nameservers or apex
Moving nameservers to Cloudflare would put the whole live site and its certificate behind a proxy change for no SEO gain, and risks a GitHub Pages certificate renewal problem in January. It is not needed.

Instead the API runs as its own Cloudflare Pages project (Functions, KV `HWD`), reached at `api.handicapperwatchdog.com`:
- Cloudflare Pages accepts a custom subdomain whose DNS stays at another provider: one new GoDaddy record, `CNAME api -> <project>.pages.dev`. Nothing existing changes. Removing that one record fully rolls it back.
- `api.handicapperwatchdog.com` and `handicapperwatchdog.com` are the same site for cookies, so the session cookie works with `fetch(..., {credentials:'include'})`. The API answers CORS only for `https://handicapperwatchdog.com` with credentials allowed.
- Stripe webhook: `https://api.handicapperwatchdog.com/api/webhook`. Checkout success and cancel URLs return to the main site.
- Cloudflare access: wrangler on this laptop is already signed in with Pages, Workers and KV write. No new API token is needed.

## Staging first
A full staging copy (static site plus API, same origin) on `<project>-staging.pages.dev`, test mode only, `BILLING_LIVE` unset. Tests and one test card purchase run there before anything touches the live domain.

## Owner approvals still needed
1. Add the single `api` CNAME at GoDaddy (production DNS, additive).
2. Merge the Pro release into `main` (changes the live pricing page to a working checkout in test mode until step 3).
3. Live billing, later and separately.
