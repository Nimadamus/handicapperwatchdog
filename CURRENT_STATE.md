# Handicapper Watchdog: CURRENT STATE (saved 2026-11-03 ~7:15 AM PST)

## Nov 6 update
Every account has a profile page: build.py publishes all ATW accounts (3,826 live, 850 with no graded picks, reason no_grades); meta.tracked stays graded only, meta.monitored = all. Item 1 below looks done (profiles dated Nov 6/7).

Homepage #what and #bettors sections live; 11 customer review pages in content/reviews.json (testimonials field, 165 reviews read 6 Nov, paraphrased, one short quote per page) + learn/what-bettors-say-about-handicappers. Original 10 reviews still have no buyer sample.

## Resume here, in order
1. DEPLOY the profile freshness fix: `python ~/tools/site_audit/wd_code_deploy.py` (deploys tmr-watchdog main 8eef41d).
   Last attempt was killed by laptop memory reap during drain; harvest/publish were resumed by hand (paused False).
   Live Watchdog = efe3f07. Run it in the foreground or watch it; if it dies mid drain run
   `cd ~/tmr-watchdog-repo/ops && python -c "import deploy as D; D.resume()"`.
   After deploy + next publish: check `/api/hwd/research?slug=th-0115` (HWD token = sha256(WATCHDOG_TOKEN+"|hwd-export|v1")),
   then confirm HWD data/index.json meta.odds_study "+250 or longer" count drops from 399 (held picks leaving).
2. Refresh numbers in docs/BASB_ODDS_ARTICLE_DRAFT.md from the refreshed odds report; owner approves before publishing.
3. Owner decisions pending: release moneyline price check (docs/PRICE_CHECK_VALIDATION_20261103.md, branch
   staging-price-check-20261103); post TwoPlusTwo / Covers drafts (docs/OUTREACH_DRAFTS.md).

## Why profiles are frozen
Nov 2 NO_FREE_PICKS removed __WD_RESEARCH from public ATW pages; HWD build.py could no longer refresh profile research and
kept stale cache. Fix: Watchdog writes private raw/hwd_research/<slug>.json each publish and serves /api/hwd/research (HWD
token only, kill switch HWD_RESEARCH_EXPORT=0); HWD build.py fetch_research() uses it (f013b55), page fallback.

## Done today (Nov 3)
- Long shot audit: 278 picks held (LONGSHOT_PRICE_20261103), grades untouched, revertable
  (tmr-watchdog app/audit_integrity/longshot_quarantine_20261103.py --revert --apply). Report docs/LONGSHOT_AUDIT_20261103.md.
- Release guard: ops/check_release.py + pre-push hook in tmr-watchdog-repo refuse undeployable pushes to main.
- Funnel: /api/ev first party counters, Stripe metadata src/landing/slot, tools/hwd_metrics.py joins (QA probes excluded).
- Conversion: stale "checkout not open" copy removed; pricing table wraps on phones; sign in field styled; integrity log on
  how-we-grade. Verified desktop + phone, 0 page errors.
- TMR editorial links (owner approved): methodology, stats/streaks, stats/sample-size. All live.
- Docs: ANALYTICS_ACCESS_PROPOSAL.md, OUTREACH_DRAFTS.md (2+2 no self promo, Covers links only in Website Promotions).

## Numbers (Nov 3)
Stripe: 0 subscribers, $0. GA 7d: 54 users. GSC: 79 impressions, 0 clicks (navigational "cappers watchdog").

## Rules
No names anywhere. No test emails to Nima. No regrades without per pick approval. No dashes in published text.
Push hwd-home to main and pro-anon-20261102. Watchdog deploy only via wd_code_deploy.py.
