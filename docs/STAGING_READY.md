# Watchdog staging readiness

`python tools/staging_check.py` prints names and file facts only. It does not deploy, and it does not read secret values.

Checked 2026-10-26. Result: NOT_READY.

Ready without new credentials:

- `wrangler.staging.toml` uses workers.dev and has no production route.
- `BILLING_LIVE` is unset. The deploy script refuses a live Stripe key.
- `terms.html` and `privacy.html` are drafts, marked noindex, and are not a published policy.
- The local store already has `CLOUDFLARE_ACCOUNT_ID`, `HWD_PRO_KEY`, `SESSION_SECRET`, and `HWD_STAGING_MASK_KEY`.

Still missing, by name:

- `CLOUDFLARE_API_TOKEN` limited to Workers Scripts Edit and Workers KV Storage Edit on the existing account.
- A separate Handicapper Watchdog test key and its webhook secret and price ids. Do not use the TrustMyRecord or RealAiGirls Stripe account.
- `BREVO_API_KEY`, `MAIL_FROM`, and `PURCHASE_NOTIFY_EMAIL`.

The staging KV id is still the placeholder. `tools/staging_deploy.py` checks the Cloudflare token before it builds or creates anything. The token must list Workers and KV, and its permission list must not include DNS, members, or billing. The existing Stream token fails that check: Workers list returns 200 with no scripts, and KV returns 401.

`backend/stripe_setup.mjs` refuses a TrustMyRecord or RealAiGirls account before it creates a product. It also refuses a live key unless `--live` is passed. A webhook signing secret is written under `.hwd` and is not printed. Do not run `tools/cf_setup.sh`. Do not change production DNS.
