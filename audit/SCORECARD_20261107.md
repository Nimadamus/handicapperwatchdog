# handicapperwatchdog.com baseline scorecard, 7 Nov 2026

Read-only. Measured 7 Nov 2026 between 7:10 and 7:20 AM PST with cache-busted GETs (Python urllib, one request per page) and a headless Chromium load at 390 px and 1366 px. No form was submitted. Scores are judgments from the observed values listed on each line; nothing below is estimated.

## Pages measured

| Page | URL | HTTP | TTFB | HTML total | HTML size | h1 | JSON-LD types | Internal / external links | Images with alt | Form fields labelled | Viewport meta |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Home | https://handicapperwatchdog.com/ | 200 | 288 ms | 295 ms | 24.5 KB | 1 | WebSite, Organization, FAQPage, ItemList | 46 / 2 | 1 of 1 | 4 of 4 | yes |
| Review | https://handicapperwatchdog.com/reviews/docs-sports.html | 200 | 201 ms | 205 ms | 26.1 KB | 1 | BreadcrumbList, Article | 47 / 14 | 1 of 1 | 2 of 2 | yes |
| Pricing | https://handicapperwatchdog.com/pricing.html | 200 | 195 ms | 199 ms | 9.7 KB | 1 | WebPage, BreadcrumbList | 30 / 0 | 1 of 1 | 3 of 3 | yes |
| Guide | https://handicapperwatchdog.com/learn/break-even-win-rate.html | 200 | 203 ms | 204 ms | 10.4 KB | 1 | Article, BreadcrumbList, FAQPage | 32 / 0 | 1 of 1 | 2 of 2 | yes |

Titles, descriptions and canonicals (all self referencing, none noindex):
- Home: "Verify a Handicapper Before You Pay for Picks | Watchdog" (56 chars); description 146 chars.
- Review: "Doc's Sports Review 2026: Prices, Guarantee, Record Claims" (58); description 148.
- Pricing: "Watchdog Pro Pricing | Handicapper Watchdog" (43); description 153.
- Guide: "Sports Betting Break Even Win Rate: 52.38% at -110 Explained" (60); description 148.

Browser load (headless Chromium, DOMContentLoaded / load / resources / transferred):
- 390 px: home 3,322 / 3,547 ms, 13 requests, 516 KB (first, cold load of the run); review 371 / 510 ms, 7, 20 KB; pricing 385 / 579 ms, 10, 21 KB; guide 368 / 515 ms, 6, 16 KB.
- 1366 px: home 301 / 461 ms, 12, 422 KB; review 290 / 444 ms, 9, 20 KB; pricing 269 / 402 ms, 10, 21 KB; guide 269 / 402 ms, 6, 16 KB.
- No page errors on any page. scrollWidth equalled the viewport on all 8 loads (no horizontal scroll).

Internal links: all 45 unique internal links found on the four pages were checked with HEAD requests (the pool was smaller than 50): 0 returned 4xx or 5xx.

Pricing call to action (read only): two buttons, "Subscribe yearly, $499" and "Subscribe monthly, $49.99". They are wired in pricing.js: a click validates the email field, fires the GA4 begin_checkout event and calls HWD.checkout(plan), which opens Stripe checkout. Note under the buttons: "Secure checkout by Stripe. Cancel any time from your account page."

## Scores

| # | Dimension | Score | Evidence (URL: observed value) |
|---|---|---|---|
| 1 | Design | 8 | https://handicapperwatchdog.com/reviews/docs-sports.html: consistent dark editorial layout, sticky contents and Pro card at 1366 px, stacked tables at 390 px, no horizontal scroll at either width |
| 2 | Functionality | 6 | https://handicapperwatchdog.com/reviews/sportsline.html: HTTP 404. The batch 1 reviews are on main, but GitHub Pages deploys of that content have timed out since 5:03 AM PST (5 attempts), so new content does not ship and the board data stops refreshing |
| 3 | Performance | 7 | https://handicapperwatchdog.com/: TTFB 288 ms, but 516 KB and 3,322 ms DOMContentLoaded on the first 390 px load; inner pages 16 to 21 KB and under 600 ms |
| 4 | Accessibility | 8 | All four pages: 1 h1, every image has alt, every form field labelled (4/4, 2/2, 3/3, 2/2), viewport meta present. Contrast and keyboard order were not measured here |
| 5 | Content | 7 | https://handicapperwatchdog.com/reviews/docs-sports.html: about 2,300 words, every claim labelled verified, seller claim, customer report or allegation, 14 dated outbound sources |
| 6 | Internal links | 9 | 45 of 45 internal links returned 200; 30 to 47 internal links per page |
| 7 | Metadata | 9 | All four pages: unique title 43 to 60 characters, description 146 to 153, self canonical, no noindex |
| 8 | Schema | 7 | https://handicapperwatchdog.com/pricing.html: WebPage and BreadcrumbList only, no Product or Offer for a priced subscription; review page has Article and BreadcrumbList; home and guide have FAQPage |
| 9 | SEO | 4 | Search Console on 7 Nov 2026 (read earlier this session): 0 pages reported indexed, 2 clicks and 124 impressions from 23 Oct to 4 Nov; on-page signals above are sound, so the gap is indexing and authority, not markup |
| 10 | Conversions | 3 | Stripe data pulled at 1:16 AM PST 7 Nov: 0 checkout starts and 0 subscribers in 30 days, 14 pricing views in 4 days. https://handicapperwatchdog.com/pricing.html: $49.99 a month or $499 a year, no trial, no sample of Pro data on the page |

## Top 5 defects by user and search impact

1. **Production deploys are blocked.** Every GitHub Pages deploy of the current main content stalls at "syncing_files" and times out (5:03, 5:17, 5:42, 6:07 and 6:21 AM PST). Five finished reviews return 404 (https://handicapperwatchdog.com/reviews/sportsline.html), and the board data stops refreshing at the last good deploy (6:20 AM PST). A redeploy of the earlier commit 9a39d10 succeeded in 8 seconds, so Pages works for this repository; the stall is tied to the newer content.
2. **Google has not indexed the site.** Search Console reports 0 indexed pages and 2 clicks in two weeks. Without indexing, the review program cannot earn search traffic.
3. **No one reaches checkout.** 0 checkout starts in 30 days and 14 pricing views in 4 days. The pricing page asks for $49.99 a month with no trial and no preview of what Pro shows.
4. **The home page is heavy on a first mobile load.** 516 KB and 3.3 s DOMContentLoaded at 390 px on a cold load, against 16 to 21 KB for inner pages; most of the weight is the hero background image.
5. **Pricing has no product schema.** https://handicapperwatchdog.com/pricing.html carries only WebPage and BreadcrumbList, so the two priced plans are not described as an Offer that search engines can read.
