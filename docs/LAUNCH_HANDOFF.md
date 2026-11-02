# Handicapper Watchdog Pro: launch handoff (October 24, 2026)

**State:** launch ready on a development branch, not launched. Nothing in this document is live except where it says "live".

- Repository: github.com/Nimadamus/handicapperwatchdog (local copy `C:\Users\BL\handicapperwatchdog`)
- Live site: `main` at commit `db37f37` (the free site plus the refresh scheduler). Live since this morning, unchanged in content.
- Development branch: **`pro-staging`** (everything below). Not merged, not deployed.
- Pricing: **Watchdog Pro $59.99 a month, $499 a year.** The earlier $19.99 / $149 are canceled and appear nowhere except
  the Stripe setup script, which archives them if they exist.

## 1. What is built (pro-staging)
| Area | What it does |
|---|---|
| Free site | Rankings of all 2,567 tracked handicappers, filters, in depth profiles, names hidden. |
| Pricing page | Annual first ($499, "$41.58 a month, save $220.88"), monthly $59.99, live preview of real records with names hidden, Free vs Pro table, FAQ. |
| Watchdog Pro | Handicapper names, complete graded pick history with original post links, search by handle, advanced filters (closing line value, z score, drawdown, profitable months), side by side comparison of up to four. |
| Accounts | Stripe Checkout, email sign in links, account page, Stripe billing portal (cancel, card update, monthly to annual switch). |
| Entitlements | active or trialing: Pro. Cancel at period end: Pro until the end. past_due: Pro for 3 days past period end. Anything else: free. |
| Data protection | Pro data is published only encrypted (AES-GCM, one key per handicapper). Keys go only to a signed in Pro account. |
| API | `backend/core.mjs`, deployed as a Cloudflare Worker on `handicapperwatchdog.com/api/*` (`wrangler.toml`, `backend/worker.mjs`). |
| Email | Brevo (existing account, free tier) or Resend. |
| Legal | `terms.html`, `privacy.html`: DRAFTS, not reviewed or approved. Decisions listed in `docs/LEGAL_REVIEW.md`. |

## 2. Test evidence (pro-staging `dd49694`, run October 24, 2026, 11:55 AM PT)
| Suite | Result | What it is |
|---|---|---|
| `node --test backend/test.mjs` | **20 / 20 pass** | API against a **mocked Stripe**: checkout (both plans), webhook signatures and replays, renewals, failed payments and grace, cancellation, deletion, live key guard, CSRF, cookie tampering, rate limits, encryption round trip with a file sealed by build.py, Brevo email. |
| `node backend/e2e.mjs` | **14 / 14 pass** | Full subscription journey over HTTP against `backend/dev.mjs` with a **mocked Stripe** (fake hosted checkout and portal sending signed webhooks). |
| `python tools/ui_test.py` | **81 / 81 pass** | Headless Chromium (Playwright) at desktop, tablet and phone sizes: layout, accessibility basics, filters, prices ($59.99 / $499, no old prices), free versus Pro data boundary, subscribe, unlock names and pick logs, compare, cancel. Screenshots in `docs/screens`. |
| `python tools/verify_live.py` | **PASS** | Live site: 2,567 of 2,567 rows match the source, 2,567 profiles published, 100 sampled profiles reconcile, no handle or outside URL in any published file. |
| `wrangler dev --local` | Pass | Worker run in the real Workers runtime: health, session, webhook signature accept and reject, Pro key refusal. |

**Mocked versus real Stripe:** every Stripe test so far uses a fake Stripe that mimics the API. **No real Stripe account has
been called.** Real verification happens at step 3 below (`stripe_setup.mjs` plus one test card purchase).

## 3. Refresh (live)
- GitHub's `*/30` cron fired only once (17:31 UTC) in the first three and a half hours: GitHub schedules on new public repos are
  best effort and are often delayed or dropped.
- **Permanent fix, live on main:** `.github/workflows/scheduler.yml`, a self-chaining workflow: each tick waits 25 minutes,
  starts "Build and deploy" (unless one is running) and queues the next tick. Runs entirely on GitHub, free, no laptop needed.
  An hourly cron and any manual run restart the chain if it ever breaks.
- Failures: a build that cannot fetch most profiles exits with an error and the previous site stays up; `data/status.json`
  (on pro-staging) records each build's progress and failures.
- The laptop task "HWD Site Refresh" is now only a backup (starts a build if none ran in 50 minutes). It can stay or be deleted.

## 4. Owner actions, in order
Secrets never go in chat. Store each one with `python tools/hwd_secrets.py set NAME` (hidden prompt, encrypted with Windows
DPAPI to `%USERPROFILE%\.hwd\secrets.dpapi`). Every resume command below reads them from there.

| # | Owner action | Then this resumes it |
|---|---|---|
| 1 | **Stripe:** create a separate Stripe account named Handicapper Watchdog. Stay in test mode. Store its test key: `python tools/hwd_secrets.py set STRIPE_SECRET_KEY`. | `python tools/hwd_secrets.py run -- node backend/stripe_setup.mjs --webhook https://handicapperwatchdog.com/api/webhook` creates Watchdog Pro, $59.99 / month and $499 / year prices, the billing portal with plan switching, and the webhook. Store the printed `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_ANNUAL`, `STRIPE_WEBHOOK_SECRET` with `hwd_secrets.py set`. |
| 2 | **Cloudflare:** Add site handicapperwatchdog.com, **Free** plan; check the imported DNS (4 GitHub A records, `www` CNAME); SSL mode Full (strict). Create a custom token with only Workers Scripts Edit, Workers KV Storage Edit (account) and Workers Routes Edit (this zone). Store it: `hwd_secrets.py set CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Details: `docs/CLOUDFLARE.md`. | Step 3 below. |
| 3 | **GoDaddy:** set the domain's nameservers to the two Cloudflare shows. | Wait for Cloudflare to show the site Active. |
| 4 | **Brevo:** Senders, Domains > add handicapperwatchdog.com, add the DNS records it lists (in Cloudflare), verify. Create a sender such as login@handicapperwatchdog.com. Store `BREVO_API_KEY` and `MAIL_FROM`. | Used by step 6. |
| 5 | **Legal and support:** decide the 8 items in `docs/LEGAL_REVIEW.md`; create support@handicapperwatchdog.com (or tell me another address). | I update the two pages. |
| 6 | **Approve the production release** in chat. | I merge `pro-staging` to `main` (add `HWD_PRO_KEY` as a GitHub Actions secret first), then run `hwd_secrets.py run -- bash tools/cf_setup.sh` (creates the KV namespace, stores the Worker secrets, deploys the Worker). Check `/api/health` shows `"billing":"test"`, make one purchase with card 4242 4242 4242 4242, confirm names unlock, cancel in the portal, run `tools/verify_live.py`. This is the first **real** Stripe verification. |
| 7 | **Approve live billing** in chat (separate, later). | Store the live key, rerun stripe_setup with `--live`, set the Worker secret `BILLING_LIVE=yes`. |

## 5. Known limitations
- Stripe has only been tested against a mock (see section 2).
- Pending picks are not part of Pro; the site has no pending picks feed.
- TrustMyRecord's public around-the-web pages show the same handicappers by name, so a determined visitor can match a record
  to a name there. Masking names on TMR is a separate decision.
- A Pro subscriber can request up to 400 handicapper keys an hour per Worker instance; bulk copying by a subscriber is slowed,
  not impossible.
- Behind Cloudflare's proxy, GitHub Pages certificate renewal (current certificate runs to January 22, 2027) may need SSL mode
  Full instead of Full (strict) at renewal time. See `docs/CLOUDFLARE.md`.
- Brevo would be shared with TMR's account (backend only; the sender address and domain are Watchdog's own).
- The legal pages are unreviewed drafts.

## 6. Undeployed changes (pro-staging versus main)
Pricing, account, compare, terms and privacy pages; Pro unlock in profiles and rankings; `pro.js`, `pricing.js`, `account.js`,
`compare.js`; `backend/` (API, Worker, Stripe setup, tests, dev server); `wrangler.toml`; build changes (encrypted Pro files,
fetch retries, `status.json`); phone layout fixes; `tools/` (ui_test, verify_live, cf_setup, hwd_secrets); docs.

## 7. Resuming later
Open a terminal in `C:\Users\BL\handicapperwatchdog`, `git checkout pro-staging`, read this file, and continue from the first
owner action not yet done. To re-run the tests: `node --test backend/test.mjs`; start `node backend/dev.mjs 8150` with
`HWD_PRO_KEY` set, then `node backend/e2e.mjs http://localhost:8150` and `python tools/ui_test.py http://localhost:8150`.
