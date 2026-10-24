#!/usr/bin/env bash
# Sets up and deploys the Watchdog Pro API Worker. Run once the owner has:
#   1. added handicapperwatchdog.com to Cloudflare (Free plan) and switched GoDaddy nameservers,
#   2. created an API token with ONLY: Account > Workers Scripts:Edit, Account > Workers KV Storage:Edit,
#      Zone (handicapperwatchdog.com) > Workers Routes:Edit,
#   3. created the Stripe account and run backend/stripe_setup.mjs.
# Usage: CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... STRIPE_SECRET_KEY=sk_test_... STRIPE_WEBHOOK_SECRET=whsec_... \
#        STRIPE_PRICE_MONTHLY=price_... STRIPE_PRICE_ANNUAL=price_... HWD_PRO_KEY=... BREVO_API_KEY=... MAIL_FROM=login@handicapperwatchdog.com \
#        bash tools/cf_setup.sh
set -euo pipefail
cd "$(dirname "$0")/.."
W="npx --yes wrangler@3"
case "${STRIPE_SECRET_KEY:-}" in sk_live_*) echo "Live Stripe key refused: live billing needs owner approval."; exit 1;; esac
if grep -q REPLACE_WITH_KV_NAMESPACE_ID wrangler.toml; then
  ID=$($W kv namespace create HWD 2>&1 | grep -oE 'id = "[0-9a-f]{32}"' | grep -oE '[0-9a-f]{32}')
  [ -n "$ID" ] || { echo "KV namespace was not created"; exit 1; }
  sed -i "s/REPLACE_WITH_KV_NAMESPACE_ID/$ID/" wrangler.toml
  echo "KV namespace HWD: $ID"
fi
SESSION_SECRET=${SESSION_SECRET:-$(python -c "import secrets;print(secrets.token_urlsafe(32))")}
for n in STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET STRIPE_PRICE_MONTHLY STRIPE_PRICE_ANNUAL SESSION_SECRET HWD_PRO_KEY BREVO_API_KEY MAIL_FROM; do
  v="${!n:-}"; [ -n "$v" ] || { echo "missing $n"; exit 1; }
  printf '%s' "$v" | $W secret put "$n" >/dev/null
  echo "secret set: $n"
done
$W deploy
echo "Check: curl https://handicapperwatchdog.com/api/health  -> {\"ok\":true,\"billing\":\"test\"}"
