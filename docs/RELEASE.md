# Watchdog Pro: how it works and how to release it

Branch `pro-staging`. Nothing here is live. `main` (the live site) is unchanged by this branch.

## What is built

| Piece | File | Notes |
|---|---|---|
| Pricing page | `pricing.html`, `pricing.js` | $19.99 a month, $149 a year. Buttons say "Opening soon" until the API reports billing ready. |
| Account page | `account.html`, `account.js` | Checkout return, email sign in link, plan and status, Stripe billing portal, sign out. |
| Compare | `compare.html`, `compare.js` | Pro only. Up to four handicappers side by side. |
| Pro unlock | `pro.js`, `capper.js`, `app.js` | Names, pick logs with original post links, name search, CLV / z score / drawdown / consistency filters, compare picks. |
| Terms, privacy | `terms.html`, `privacy.html` | Plain drafts. Owner should read them before launch. |
| API | `backend/core.mjs` via `functions/api/[[path]].js` | Cloudflare Pages Function, KV namespace bound as `HWD`. |
| Tests | `backend/test.mjs` (18), `backend/e2e.mjs` (14) | `node --test backend/test.mjs`; e2e needs `backend/dev.mjs` running. |
| Live check | `tools/verify_live.py` | Board vs source, profile reconciliation, identity leak scan. |

## How Pro data stays private
`build.py` writes each capper's names and pick log to `data/x/<id>.bin`, encrypted with AES-GCM under its own key,
HMAC(`HWD_PRO_KEY`, 'capper:' + id). Without a key the files are random bytes. The API hands a key only to a signed
in account whose subscription is active (or past_due inside a 3 day grace), rate limited to 400 keys an hour.
No names or pick rows are ever published in the clear.

## Entitlement rules
active, trialing: Pro. cancel_at_period_end: Pro until Stripe ends it. past_due: Pro until period end + 3 days.
unpaid, canceled, incomplete, incomplete_expired: free. Webhooks are verified (5 minute tolerance) and deduplicated by event id.
A live Stripe key is refused unless `BILLING_LIVE=yes`.

## Owner steps (need you)
1. **Stripe account** for Handicapper Watchdog (separate from TMR). In test mode create one product "Watchdog Pro" with two
   recurring prices: $19.99 monthly and $149 yearly. Turn on the customer portal (cancel, update card).
2. **Cloudflare**: a Pages project for this repo (free), a KV namespace bound as `HWD`, and move handicapperwatchdog.com DNS
   to Cloudflare (nameserver change at GoDaddy). Free tier covers this.
3. **Email** for sign in links: a Resend account (free tier) with the domain verified, from address such as
   `login@handicapperwatchdog.com`.
4. Approve the production release.

## Environment (Cloudflare Pages settings, all secret)
`STRIPE_SECRET_KEY` (sk_test_ until live is approved), `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_ANNUAL`,
`SESSION_SECRET` (random 32+ chars), `HWD_PRO_KEY` (random 32+ chars, also a GitHub Actions secret for the build),
`SITE_URL=https://handicapperwatchdog.com`, `RESEND_API_KEY`, `MAIL_FROM`. Leave `BILLING_LIVE` unset until live is approved.
Stripe webhook endpoint: `https://handicapperwatchdog.com/api/webhook`, events: checkout.session.completed,
customer.subscription.created, customer.subscription.updated, customer.subscription.deleted, invoice.paid, invoice.payment_failed.

## Release steps (after approval)
1. Add `HWD_PRO_KEY` to GitHub Actions secrets.
2. Switch the workflow deploy target from GitHub Pages to Cloudflare Pages (`wrangler pages deploy _site`), keeping the 30 minute build.
3. Point DNS at Cloudflare, confirm https://handicapperwatchdog.com/api/health returns `"billing":"test"`.
4. Run a real test mode purchase with card 4242 4242 4242 4242, confirm names unlock, cancel in the portal, confirm access ends at period end.
5. Run `python tools/verify_live.py`. Must print PASS.
6. When approved: swap to live keys and set `BILLING_LIVE=yes`.
