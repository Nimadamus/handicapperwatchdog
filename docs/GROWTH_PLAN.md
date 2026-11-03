# Handicapper Watchdog growth plan (November 3, 2026)

Goal: a standalone subscription business. Every acquisition channel below is built on the graded record, never on claims about winning.
Separation rule: no links, references or shared branding with TrustMyRecord anywhere (owner decision, 11/03).

## Baseline (11/03, last 7 days, GA4 property p560566571)
- 54 visitors, 119 page views: home 52, profile 26, rankings 10, NFL page 9, pricing 5.
- Sources: direct 48 sessions, ChatGPT 13, organic 2. Search Console (28 days): 79 impressions, 0 clicks, avg position 8.7.
- Stripe: 0 subscribers, 0 checkout starts from real visitors.
- The bottleneck is traffic, not checkout: 5 pricing views a week cannot produce a sale rate worth measuring.

## 1. Search (compounding, owned)
- Pages Google can rank: research reports, Today on the board (daily), weekly reports (every Monday), sport pages, reviews.
- Target intents: "are sports handicappers legit", "verified handicapper records", "best handicappers [sport] record",
  "handicapper ROI", "do hot handicappers stay hot", review queries for named public services (reviews section).
- Cadence: one original research report every two weeks from the live data. Next topics, each answerable from data we hold:
  1. Favorites vs underdogs: how price changes what win rate a record needs (win rate trap).
  2. Does posting volume hurt ROI? Picks per week vs ROI across established records.
  3. Sport by sport: which leagues have the most profitable public records, with sample sizes.
  4. How long until a record means something: when ROI stabilizes as picks accumulate.
- Every report: method, sample, limits, no predictive claims, links to profiles by anonymous ID and to Pro.
- Monitor: Search Console sitemap read, indexed count, queries. Request indexing for each new report.

## 2. AI assistants (already the second source of traffic)
- ChatGPT sent 13 sessions in a week with no effort. Keep pages factual, dated, and quotable; answers
  in the first paragraph; structured data on research (done).

## 3. Communities and publicity (each send needs owner approval first)
- Share findings, not the product: the "hot handicappers" study and weekly reports suit betting forums where
  data posts are allowed (TwoPlusTwo sports betting, Covers forum, TheRX). Read each forum's self promotion rule first.
- Reddit r/sportsbook and r/sportsbetting forbid promotion; only answer questions with the data when asked.
- Press: sports betting data writers and podcasts covering tout scams. Pitch: an independent dataset of
  thousands of public records, graded from timestamped posts, with an original finding. Needs owner approval per send.

## 4. Conversion (measured, iterate after traffic exists)
- Funnel: pricing view (GA view_item) -> plan click (begin_checkout) -> Stripe -> return paid (purchase) or
  canceled (checkout_canceled). Offer placements: view_promotion / select_promotion with creative_slot.
- Stripe side: tools/hwd_metrics.py (weekly task, Mondays 7 AM): starts, completed, abandoned, renewals,
  first payments, collected revenue, churn. QA and probe sessions excluded.
- Review weekly once there are 50+ pricing views: move the Pro offer to the placements with the best click rate.

## 5. Retention
- Follows + pregame email alerts (live), daily page, weekly report. Next: an opt-in weekly email digest of the
  accounts a member follows (needs owner approval before any send).
