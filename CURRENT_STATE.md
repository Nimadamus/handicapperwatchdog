# Handicapper Watchdog: CURRENT STATE (saved 2026-11-15 ~11:45 AM PST)

Work from worktree `~/hwd-names-1114` (branch names-1114, push `HEAD:main`; main = deploy, site rebuilds every 30 min).

## Done 15 Nov
- Names refresh: 60 accounts showed #ID; refreshed (4290 names, main 2957095). Now automatic: scheduled task
  "HWD Names Refresh" daily 5:40 AM, hidden, log tools/refresh_names_daily.log (script pulls main before pushing).
- About page rewritten (main 1201a8c, LIVE 11:42 AM): neutral site, what we collect, what we cannot verify,
  "where there is smoke", why trust us, right of reply, how to use, FAQ. Live counts filled from meta. Every v2
  review page's "What customers say" now links to it (reviewv2.py).

## 23 Nov SEO (owner: "focus on SEO, do schema/meta titles, be careful")
Live crawl of 140 sitemap pages: all 200, 1 canonical/title/desc each, no dup titles/descs, JSON-LD valid. Fixed (main f63f4b8, live 5:0x AM PST, IndexNow 140 ok): FAQPage schema on all 95 v2 reviews (was 10 pages), Article image, null legalName dropped, KingCap title 77->55 chars. Audit tools ~/hwd_seo_1123 (crawl.py, render_test.py). Left alone: weekly report titles 72 chars (only truncation). DEDUP 23 Nov (owner: "yes" to faster pace, "current ones need to be detailed, not thin duplicate content"): boilerplate repeated on 37-120 pages removed (main 8a87863) + 33 sibling pages (WagerTalk/Pregame/SportsCapping) rewritten (df1c429 + queue files); verbatim shared sentence share median 7.6%->2.3% live, 0% queue, max 6%; no new numbers, sources untouched. Tools ~/hwd_seo_1123 (shared_exact.py, depth_audit.py, check_group.py). Task "HWD Review Publish" RE-ENABLED (was disabled 22 Nov "do not add more"; owner yes 23 Nov) at 9:15 AM + 2:15 PM Mon-Fri = 10/week. Titles 3c3ef7a: sport pages "Top NFL Handicappers <year>: Graded Records Ranked by Units", cappers "Sports Handicapper Rankings: Graded Records | Watchdog", new weekly reports no double suffix (old weekly files frozen). Internal links fine (min 2 inbound, research/today). GSC service account google_credentials.json has NO HWD access (owner would add it as user to use query data).

## Resume here
1. DONE 16 Nov 10:55 AM PST (main c36f175): 15 new reviews LIVE + IndexNow ok (102 URLs). Prez slug = the-prez-wagertalk
   (Kevin O'Neill name unsourced, removed). larry-ness held in ~/hwd_testimonials/new_reviews_1115/_hold (died 2022; owner to decide).
   Reddit archive rate limited during research; Northcoast/SIT/ATS/Tony George pages have thin Reddit coverage (labelled).
2. DONE 16 Nov 11:29 AM PST (main 8ebc36d): batch 2 LIVE (fargo, chris-jordan, phil-steele, payne-insider, rob-vinciletti,
   zack-cimini, sean-higgs) + IndexNow 109 ok. joe-gavazzi skipped (stopped selling ~2015). Drafts archived in _published_1116.
   Next batch: pick more active sellers from library.jsonl targets not yet in content/reviews_v2.
2b. DONE 16 Nov 12:04 PM PST (main b4e2841): batch 3 LIVE (dave-essler, jesse-schule, kyle-hunter, oskeim-sports, porter-picks,
   steve-merril, larry-ness historical per Nima yes) + IndexNow 116 ok. Skipped tom-freese, jeff-benton (not selling).
   Arctic Shift API source URLs replaced with reddit search/permalinks on all pages (Nima OK 16 Nov).
2c. DONE 17 Nov 12:38 PM PST (main e830554): batch 4 LIVE (cappertek, sportsmemo, jack-jones, sean-murphy, andy-iskoe,
   bryan-leonard, spartan-sports, will-rogers, gianni-the-greek, bryan-power), verify_reviews_live PASS x10, IndexNow 125 ok.
   Skipped (not selling / no sources): chase-diamond, hollywood-sports, erin-rynning; vegasexperts.com = reseller. Drafts in _published_1117.
   Arctic Shift full text search timed out all day 17 Nov; pages say Reddit search was partial.
2d. 17 Nov: impressions dip (GSC 8-14 Nov ~38/day, 15 Nov 14, last 24 h 0), loss on review pages, position steady ~13;
   330 indexed, no manual action/removals, site 200. Likely recrawl after 13-15 Nov sitewide changes. Nima OK'd Request indexing
   for top 10 reviews; GSC returned "problem submitting your indexing request, try again later" twice on stu-feiner 1:3x PM PST.
   Retry 18 Nov: stu-feiner, wayne-allyn-root-winningedge, juice-reel, covers-expert-picks, sharp-football-analysis, the-jewish-sharp,
   learn/what-bettors-say-about-handicappers, docs-sports-ai, vegas-dave, pickswise. Recheck GSC 20 Nov.
2e. 17 Nov 1:10 PM PST batch 5 LIVE (main 1f39c5e, 11 pages, IndexNow 136 ok). Batch 6 HELD (validated, not published, deep standard):
   gold-sheet, nellys-sports, the-sports-reporter, joe-damico, raphael-esparza, paul-bovi, tony-t in ~/hwd_testimonials/new_reviews_1115.
   PACE 5 a week (Nima OK 17 Nov): task "HWD Review Publish" Mon-Fri 9:15 AM runs ~/hwd_testimonials/publish_next.py, one file from ~/hwd_testimonials/publish_queue (NN_slug.json) per run, log publish_next.log; add new deep drafts to the queue. Skipped: al-mcmordie (= big-al), dave-cokin (died 2024), alan-harris, chris-king, ryan-pelczarski, doug-upstone, kevin-rogers.
   19 Nov PM (owner: add all online pick sellers, find reviews; break time ~2:30 PM PST): publish_queue now holds 32 files (03 to 34),
   24 written today: 11 scott-rickenbach, 12 stephen-nover, 13 ross-benjamin, 14 bob-balfe, 15 freddy-wills, 16 kingcap-sports,
   17 parlay-science, 18 dormroom-degenerates, 19 tipstrr, 20 rotobot, 21 elite-picks, 22 propgpt, 23 vernon-croy, 24 jimmy-adams,
   25 goodfella, 26 legup-picks, 27 winible, 28 whop-sports-betting, 29 picks-office, 30 brad-powers, 31 andre-gomes, 32 jr-odonnell,
   33 sleepyj, 34 greg-shaker. Drafts: ~/hwd_testimonials/new_reviews_1119/_queued. Pace still 5 a week (ask owner if faster).
   HELD for owner (new_reviews_1119/_hold): kelly-in-vegas (no paid buyer posts, press only), cody-brown-bets (free picks, not a seller).
   DONE 20 Nov 7:05 AM PST: 5 SportsCapping/BetFirm drafts validated + checked, queued 35 aaa-sports, 36 alex-smart, 37 black-widow,
   38 john-ryan, 39 marc-lyle (originals in new_reviews_1119/_queued). Queue now 03 to 39 (37 files, ~7 weeks at 5 a week).
   GSC 20 Nov 7:06 AM PST: impressions recovering (16 Nov 0, 17 Nov 5, 18 Nov 15; 8-14 Nov ~40/day); 28 d 25 clicks 463 impr pos 14.1. Recheck ~24 Nov.
   DEEPEN DONE 20 Nov 9:55 AM PST (owner: "these reviews need to be in depth"): all 84 thin live review pages rewritten to the BRIEF
   depth standard by 28 research agents (12 to 36 sources, 6 FAQ, 4+ strengths/concerns, claims checked vs seller's own records, prices
   rechecked 20 Nov). Re-audit: 0 pages below standard (payne-insider has 1 price = only one product). Commits da5a734 .. c959ba4 on main.
   Drafts archived ~/hwd_testimonials/deepen_1120/_published; brief DEEPEN_BRIEF.md; helper pub.sh. IndexNow 9:57 AM 139 ok.
   Open: none of the deepened pages has had a GSC Request indexing; Reddit was partial on most (Arctic Shift rate limited all day).
   SITEWIDE UNIQUENESS 20 Nov (owner: no thin/templated pages Google could penalize): audit tool ~/hwd_testimonials/dupaudit_1120 (fetch.py +
   audit.py on live pages). Profiles were the risk (929 indexable, 35% shared text, 21 GSC impressions/90 d): PROFILE_INDEX_MIN 20->100
   (now ~232 indexable; DIRECTORY_MIN 20 keeps the directory), data written per account analysis (rank, units curve peak/slide, sport
   split, last 30 d vs career). Reviews: method boilerplate cut to one page specific line. Sports: per sport analysis of listed records
   (bs breakdown is PARTIAL, never claim board wide). picks.html noindex. Learn: 9 guides rewritten ~2,500 words each from site data.
   Live verified 10:4x AM PST; IndexNow 138 ok. Commits f09556d ab594ba 05003d4 78f534e.
   NEXT (21 Nov): GSC Request indexing hit "Quota Exceeded" 20 Nov 11:4x AM PST. Request, 10 a day, in this order: learn/ are-sports-handicappers-legit,
   scam-handicapper-red-flags, should-you-pay-for-sports-picks, verified-handicapper-records, break-even-win-rate, units-and-roi, sample-size,
   closing-line-value, what-bettors-say-about-handicappers, the-board.html; then the 84 deepened reviews. (Search box ref "search URL inspection".)
   Board page now has sample size spread table (f5336f8, live 11:28 AM). Tech audit (dupaudit_1120/tech_audit.py) clean except frozen weekly title.
   BUG HUNT 20 Nov PM (tools in ~/hwd_testimonials/dupaudit_1120: bughunt_crawl.py, pick_sanity.py (box), index_consistency.py,
   review_integrity.py). Fixed live: dead r90/r365 ranking filters, profile JS title, compare copy, branded 404, home search ranking +
   loading state, unpriced pick method text, 545 forum pronouns -> they (+13 in queue).
   OWNER "fix all" 1:55 PM PST: HELD 23 picks in live DB (review_required, reason OWNER_HOLD_20261120, corrections_log tool
   owner_fix_20261120.py, --revert supported; copy in tools/owner_fixes): 12 futures/prop prices read as game MLs (Coolbet x3,
   DailyCFBCBB Yankees +3500, Bengals SB, Avdija prop, Drummond prop, 3 futures 0.25-0.75U, Arizona/MSU futures) + 11 record summary
   lines parsed as picks ("ML: 212-195, -9.27 units"). The "52 duplicates" were FALSE (1H/F5 vs full game), nothing changed.
   +9 more holds 00:48 UTC 21 Nov (props/contest share/UEFA Georgia/1H total read as full game) = 32 held. Holds reach the site only
   after the next publish_daily snapshot (raw/publish_snapshot.db is copied at publish start; 00:29 UTC copy predates the holds).
   Read only findings, NOT changed: ~118 ML and ~185 spread picks have market fields for the opposite side (CLV metric only,
   grades use posted price/line); alt lines and teaser legs graded at posted line by rule.
   ROI on priced picks kept (correct math), disclosed in method text. Genuine big dog MLs (acct 2844 Brugge/Charlotte/GaSo) left counted.
   HARVESTER: market stage CONFIRMED fixed (mkt_ok every cycle since 19 Nov 2:11 PM PST; first COMPLETE cycle 20 Nov 2:59 AM PST);
   only reconcile_parse.py still times out (parser backlog ~118k, box CPU). Picks 197339/192518 still await owner 'hold both'.
   Master list ~/hwd_testimonials/candidates_1119.json (134 sellers; 108 have no buyer buzz, most rosters now checked and rejected as thin).
   Rejected today (thin/inactive/not sellers): jim-hurley, dave-malinsky, pauly-howard, carlo-campanella, steve-janus, goat-sports-bets,
   trust-my-system, zcode, blogabet, betting-gods, the-hobby-capper, five-star-sports-picks, purdys-picks, chef-t, big-mikes-picks,
   mattys-picks, allen-eastman, tokyo-brandon, vegasbutcher + ~35 roster names with no forum posts.
   Arctic Shift full text search rate limited all day 19 Nov; retry Reddit for queued names.
   HARVESTER AUDIT 19 Nov: see memory project_watchdog_audit_20261119.md (2 picks await owner 'hold both': 197339, 192518).
   Owner rules 17 Nov: NO thin pages (BRIEF.md depth standard); NEVER his name/editor byline on HWD (7b51424 reverted 7fa860f).
   DONE 17 Nov: 7 thin pages deepened (11 to 17 sources, 6 FAQ) LIVE main 796d3e8, verified 6:47 PM PST. Drafts in ~/hwd_testimonials/deepen_1117/_published.
   validate.py now honours file args (before it silently checked only its own folder).
   DONE 19 Nov 12:4x AM PST: gold-sheet LIVE (main b7e7cb1, /reviews/gold-sheet.html 200). GSC Request indexing OK for all 10 listed
   (all 10 already 'URL is on Google') + gold-sheet (was 'unknown to Google'). Property = URL prefix https://handicapperwatchdog.com/ (not sc-domain).
   19 Nov: queued 08 asa-sports, 09 mike-barner, 10 king-creole (drafts copy in new_reviews_1115/_queued_1119). Skipped: johnny-detroit
   (not selling), tony-karpinski, chip-chirimbes, jeff-hochman (no independent buyer posts); joe-nelson = Nelly's, held as duplicate.
   raphael-esparza LIVE 19 Nov 9:15 (main b71bd09, 200). Next: queue auto publishes Mon-Fri 9:15 (03 the-sports-reporter 20 Nov), 7 left in queue, add deep drafts before 1 Dec; 20 Nov GSC impressions; owner call on graded record + data report.
3. SEO open (needs owner OK): add 209 profiles with 100+ picks to sitemap + IndexNow (1107 rule said let Google add naturally);
   profile titles with platform/handle for name searches; ~15 review pages still need GSC Request indexing (10/day, his Chrome).
4. FREE WEEKLY EMAIL LIVE 19 Nov (owner OK): API on Cloudflare Pages project hwd-api (deploy: cd api-pages && npx wrangler@3 pages
   deploy --project-name hwd-api --branch main; wrangler OAuth on laptop works, no token needed). Deployed 5a0ee800 3:05 AM PST
   (rollback = previous production deployment 89c25cec in CF Pages). Site main 80706cf/2579723: profile Follow button (free, 25 cap),
   review page sign up box, account page toggles, double opt in (/api/signup + /api/signup/confirm). Sender tools/send_digest.py,
   task "HWD Weekly Digest" Mon 8 AM (log tools/send_digest.log), graded results + new reviews only, never pending picks.
   QA probe qa-hwd-probe-1119 confirmed end to end then unsubscribed. Sitemap profiles: owner agreed NOT to add (19 Nov).
   Still open from item 4: Pro buttons to TMR Pro (conflicts 1024 no-link rule); Pro buttons to TMR Pro (conflicts 1024 no-link rule); trial/price (Stripe = his OK).
   Owner asked about hiding records until subscribe: recommended keep headline record free (SEO), offered "middle" option; no decision.
5. DONE 19 Nov: purchase/welcome mail text is in backend/core.mjs, live via Pages prod deploy 5a0ee800 (source 80706cf); Worker token blocker obsolete.

## Numbers
Nov 9 funnel 7d: 148 visits (chatgpt.com 91, google 10), 23 pricing views, 0 checkout starts, 0 subscribers.

## Rules
Names PUBLIC (HWD_NAMES=0 off). NO pending picks on this site (TMR Pro board only; HWD_PENDING_FEED=1 restores).
Never publish th- slugs, post text or post links. No test emails to Nima. No regrades without per pick approval.
No dashes in published text. Watchdog deploy only via wd_code_deploy.py. Reddit readable via Arctic Shift.
