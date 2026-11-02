# Cloudflare: free tier plan for the Watchdog Pro API

## Shape
- The static site stays on **GitHub Pages**, built and deployed every 30 minutes by the GitHub Actions schedule (free).
- One **Cloudflare Worker** (`hwd-api`, `backend/worker.mjs`) answers only `handicapperwatchdog.com/api/*`. Same origin as
  the site, so the sign in cookie is first party.
- One **KV namespace** (`HWD`) holds accounts, Stripe customer links, webhook event ids and one time sign in tokens.
- DNS for handicapperwatchdog.com moves to Cloudflare (Free plan) with the same records as today (4 A records to GitHub
  Pages, `www` CNAME to nimadamus.github.io), proxied, SSL mode **Full (strict)**.

Bundle checked with `wrangler deploy --dry-run`: 17 KiB (5 KiB gzipped). Run locally in the real Workers runtime
(`wrangler dev --local`): health, session, webhook signature accept and reject, and Pro key refusal all behaved as in tests.

## Does it fit the free tier?
| Limit (Free) | Our use |
|---|---|
| Workers: 100,000 requests a day | One `/api/me` per page view plus one key per Pro profile view. Fits until roughly 80,000 page views a day. |
| Workers: 10 ms CPU per request | Each request is an HMAC, a JSON parse and at most one Stripe call (network time is not CPU). |
| KV: 100,000 reads a day | Anonymous visitors cause no reads. One read per signed in page view. |
| KV: 1,000 writes a day | Writes only on account changes, webhooks and sign in links. Pro key requests are deliberately not written to KV. |
| KV: 1 GB storage | About 1 KB per account. |
| DNS, SSL, proxy | Free plan. |
| Workers Routes | Free plan. |
Nothing here needs a paid plan. The first limit to watch is 100,000 Worker requests a day.

## Minimum API token (owner creates it, then shares it once)
Create token > Custom token, with only:
- Account > **Workers Scripts : Edit**
- Account > **Workers KV Storage : Edit**
- Zone > **Workers Routes : Edit**, limited to the zone handicapperwatchdog.com
No DNS, billing, member or account settings permissions are needed.

## Owner steps
1. Cloudflare dashboard > Add a site > handicapperwatchdog.com > **Free** plan. Cloudflare imports the current DNS records;
   check the 4 GitHub A records and the `www` CNAME are there, and set SSL/TLS mode to Full (strict).
2. GoDaddy > handicapperwatchdog.com > Nameservers > change to the two Cloudflare nameservers shown. (I can do this step in
   your GoDaddy account if the browser extension is working.)
3. Create the API token above.
4. Then run `bash tools/cf_setup.sh` (creates the KV namespace, stores the secrets, deploys the Worker and its route).

## Risk to note
GitHub Pages renews its HTTPS certificate by checking DNS. Behind the Cloudflare proxy that check can fail at renewal time
(the current certificate runs to 2027-01-22). With SSL mode Full (strict) visitors are unaffected while GitHub's certificate
is valid; if a renewal fails, switch SSL mode to Full (not strict) or briefly turn off the proxy for the renewal.
