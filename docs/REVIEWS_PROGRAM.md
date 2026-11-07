# Handicapper Reviews Program: plan for approval

Status: draft for Nima, 7 Nov 2026. Nothing here is deployed. Branch `reviews-program-1107`.

Goal: become the place bettors check before paying a handicapper or picks service, and turn that trust into Watchdog Pro subscriptions.

## 1. Where we start (pulled 7 Nov 2026)

- 33 reviews are live at `/reviews/` (old format). They are sourced and dated but thin on customer evidence, and every page ends "Not rated".
- Search Console, last 90 days: review pages got impressions for Dr Bob Sports (4, avg position 5.5), Jim Feist (3), Big Al (3), Doc's Sports AI (2, position 4.0), Scott Spreitzer (1). Clicks: 0. The site is two weeks old, so this is a seed, not a verdict.
- Search demand proxy: Google autocomplete for "<name> review / legit / scam / reddit / record", run 7 Nov 2026 on 59 candidate names. A name with many buyer intent suggestions has people researching it before paying. Raw output: `docs/research/autocomplete_20261107.txt`.

## 2. Prioritized 20

Score = buyer intent autocomplete terms + Search Console signal + evidence we can reach (a readable sales site, public posts we may already grade, real customer discussion). "Page" = we already have an old format page that would be upgraded at the same URL.

| # | Subject | Type | Demand signal (7 Nov) | Page | Evidence to work with |
|---|---|---|---|---|---|
| 1 | Doc's Sports | Pick shop, roster | GSC impressions on the Doc's AI page; requested | Yes | Full price list and guarantee terms, forum thread, sample done |
| 2 | SportsLine (CBS) | Media + paid expert picks | "sportsline legit", "reddit", "discount reddit" | No | Large brand, public expert records on site, many Reddit threads |
| 3 | Action Network PRO | Media + paid tools/picks | "pro review", "reddit" | Yes | Prices read 7 Nov, app store reviews, Reddit |
| 4 | BetQL | Model ratings app | "reviews complaints", "review reddit" | Yes | Prices read 7 Nov, app store reviews |
| 5 | Dimers | Model picks app | "dimers legit", "betting review", "pro reviews" | Yes | App store reviews, published model claims |
| 6 | Pickswise | Free/paid picks media | "pickswise legit", "record", "review" | No | Posts records publicly, checkable |
| 7 | DubClub | Picks marketplace | "dubclub legit", "reviews complaints" | Yes | Many sellers, Trustpilot, Reddit |
| 8 | Leans AI | AI picks app | "leans ai legit", "review reddit" | No | App store, Reddit, bold AI claims |
| 9 | Rithmm | AI picks app | "rithmm reviews reddit", "premium review" | No | App store reviews |
| 10 | Juice Reel | Picks/tracking app | "juice reel legit", "app review" | No | App store, Reddit |
| 11 | WagerTalk | Handicapper marketplace | "reviews complaints", "reddit" | Yes | Named roster, public free picks |
| 12 | Wunderdog | Pick service | "reviews complaints", "picks review" | No | Site blocks scripts: needs a real browser check |
| 13 | Stu Feiner | Celebrity tout | "betting record", "all time record", "barstool reddit" | No | Public TV/radio claims, X posts we may grade |
| 14 | The Jewish Sharp | X based tout | "reviews complaints", "reviews reddit" | Yes | Public X posts we may grade |
| 15 | Brandon Lang | Celebrity tout | "record", "super bowl record", "reddit" | Yes | Prices read 7 Nov, film and press history |
| 16 | Vegas Dave | Celebrity tout | "reviews", "reddit" | Yes | Site gone; news record (retirement Dec 2024) |
| 17 | Steve Fezzik | Pro bettor, paid picks | "record", "reddit" | No | Public contest results (verifiable), podcast claims |
| 18 | Pregame.com | Handicapper marketplace | "pregame" brand searches (noisy) | Yes | Roster, guarantee terms |
| 19 | Jim Feist | Legacy tout brand | GSC impressions | Yes | Long press history |
| 20 | Dr Bob Sports | Analyst, published records | GSC impressions, best position (5.5) | Yes | Publishes long records: can be checked against results |

The evidence column lists leads to confirm during research, not findings. Only Doc's Sports has been researched in full.

Alternates if one fails the evidence bar: Big Al (GSC), Sharp Football Analysis, Covers experts, Marc Lawrence, BettingPros.
Left out on purpose: OddsJam, Unabated, Outlier (betting tools, not pick sellers), names with only noise in autocomplete (Kevin Thomas, Joe Duffy, Tony George: autocomplete is other people).

## 3. Review template (see the sample)

Same URL as today (`/reviews/<slug>.html`), so upgrades keep any ranking.

1. Hero: what it is, one paragraph finding, byline, date checked, status plate with six facts at a glance.
2. Evidence key: Verified (we checked it), Seller claim, Customer report, Allegation. Every claim on the page carries one.
3. Is it legit? A short, direct answer. "Legit" means a real business that delivers what it sells. Profitability is answered separately and only with evidence.
4. What it costs: table of every package, price and what happens if it loses, from a page we opened, with the date.
5. How the guarantee works: the exact wording, and whether it is cash, credit or extension.
6. What they advertise: quoted claims with where they appear, plus what the claims leave out.
7. Track record: what a buyer can verify, and our own graded data when matched (see section 6).
8. What customers say: positive and negative, each dated and linked, labeled by type. Seller curated testimonials are labeled as such. Never invented, never edited.
9. Conflicts of interest: sportsbook affiliate links, revenue share, ownership ties.
10. Strengths and concerns.
11. Before you pay any handicapper: checklist plus the Watchdog Pro path.
12. FAQ (4 questions people actually search).
13. Related reviews, sources with access dates, how we review, corrections and right of reply.

Page chrome: sticky table of contents and Pro card on desktop, chips on mobile. Checked at 1366 px and 390 px with no horizontal scroll.

## 4. Free vs paid

Free, on every review: everything above, including our headline graded record when matched (record, units, ROI, sample size). That is what earns trust and search traffic.
Pro only: the full graded pick log, pending picks before games start, splits by sport, market and odds band, streaks and drawdown. Each review links to the matched profile and to pricing.

## 5. Editorial standards

- Sources: every fact links to the page it came from, with the date we opened it. If a page did not open, we do not use it. We save a Wayback Machine snapshot of each sales page at the time of the check so a later change cannot erase the evidence.
- Accuracy: numbers are copied from the page, then checked a second time against the saved text before publishing. Our own statistics are computed from `data/index.json` at build time, never typed by hand.
- Fairness: every review has a strengths section. Allegations are reported as allegations, dated, linked and never repeated as fact. We do not call any company a scam unless a regulator, court or our own documented findings support it, and then we say exactly which.
- Legal history: only from the court, the regulator or a major news outlet, with the exact status (charged, settled, convicted).
- No fabrication: no invented testimonials, no paraphrased "reviews" presented as quotes, no copied review collections, no AI written filler. Customer evidence is summarized in our words with a link.
- Plagiarism: no copying of other review sites. Quotes from the subject's own pages are short and marked.
- Independence: no payment, affiliate fees or free picks from reviewed services. No sportsbook signup links on review pages.
- Corrections: errors are fixed with a dated note on the page. Material changes update "Last updated".
- Right of reply: every page invites the subject to respond through the contact page. A fair summary of a reply is added to the page.
- Freshness: each page is rechecked at least every 90 days, and its date shows when.
- Style: plain sentences, no dashes, written for a bettor deciding whether to pay.

## 6. Our own tracking data

The strongest thing we can publish is a graded record for a named service. Example: the Doc's sample says no Doc's handicapper is matched yet.

Decision needed (Nima): today the rule is names off everywhere. For commercial services that sell picks to the public (not forum members), matching their public posts to a graded record and showing it on their review would be the single biggest trust and SEO advantage. Proposal: allow named records only for commercial pick sellers, only from picks they posted publicly before the start, with the same grading rules as the board. Until you approve, reviews say "not matched" and show only board wide context.

## 7. Technical SEO

- Structured data: BreadcrumbList, Article (author and publisher Handicapper Watchdog, dates) and `about` Organization. No Review or AggregateRating markup: we do not score, and Google does not show ratings for this kind of page anyway.
- Title pattern: "<Name> Review 2026: Prices, Guarantee, Record Claims" (under 60 characters where possible). Descriptions name the check date.
- Canonicals, sitemap rules and noindex: unchanged. Review URLs stay the same; the existing sitemap rule already includes `/reviews/`.
- Internal links: each review links to 4 or 5 related reviews, the matching guide (red flags, break even, sample size), the rankings and pricing. Guides link back to the most relevant reviews.
- Indexing checks after each batch: URL Inspection on every new or upgraded page in Search Console, then a weekly look at impressions per review page.

## 8. Directory

Upgrade `/reviews/` into a searchable directory: search box (exists), filters by type (pick shop, marketplace, AI app, media, celebrity tout), status (verified record, not verified), sort by most searched or recently updated, a card per review with price range and guarantee type. Clear "Check graded records" path to the board and Pro.

## 9. Rollout

1. Now: you review the Doc's Sports sample and this plan. Nothing deployed.
2. On approval: wire the v2 template into `build.py` (reviews with `content/reviews_v2/<slug>.json` render in v2, others stay as they are), ship Doc's Sports, check it live at desktop and phone width, request indexing.
3. Batches of 4 or 5 reviews, in the order of section 2. Each batch: research, a second fact check against saved sources, local render check at both widths, then deploy after your OK. About 2 to 3 hours of work per review.
4. Directory upgrade after the first 10.
5. Every Monday: Search Console impressions and clicks per review, Pro clicks from review pages, and the next batch.

Open questions for Nima: named records for commercial sellers (section 6); whether the two weakest existing pages (Odds Shark, now just a Covers redirect, and Wayne Allyn Root, based on a 2008 article) should be merged or kept.
