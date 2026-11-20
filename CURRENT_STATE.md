# Handicapper Watchdog: CURRENT STATE (saved 2026-11-15 ~11:45 AM PST)

Work from worktree `~/hwd-names-1114` (branch names-1114, push `HEAD:main`; main = deploy, site rebuilds every 30 min).

## Done 15 Nov
- Names refresh: 60 accounts showed #ID; refreshed (4290 names, main 2957095). Now automatic: scheduled task
  "HWD Names Refresh" daily 5:40 AM, hidden, log tools/refresh_names_daily.log (script pulls main before pushing).
- About page rewritten (main 1201a8c, LIVE 11:42 AM): neutral site, what we collect, what we cannot verify,
  "where there is smoke", why trust us, right of reply, how to use, FAQ. Live counts filled from meta. Every v2
  review page's "What customers say" now links to it (reviewv2.py).

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
   DEEPEN 20 Nov (owner: "these reviews need to be in depth"): audit = 84 of 93 LIVE review pages below BRIEF depth standard
   (mostly FAQ 4 not 6, strengths 3, 18 pages under 10 sources); all 37 queued drafts meet it. Brief ~/hwd_testimonials/deepen_1120/DEEPEN_BRIEF.md,
   output deepen_1120/<slug>.json. Wave 1 (18 thinnest by sources) running 7:20 AM PST: bill-krackomberger larry-ness bender-wins rob-veno
   ben-burns kevin-thomas kyle-hunter action-network-pro bryan-leonard andy-iskoe tony-george oskeim-sports indian-cowboy juice-reel
   bettingpros teddy-covers matt-fargo nobrainerwagers. Then: check (validate.py + manual), copy to reviews_v2, push main, verify_reviews_live,
   IndexNow; next waves = the remaining 66 thin slugs (ordered by source count).
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
