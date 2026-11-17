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
   gold-sheet, nellys-sports, the-sports-reporter, joe-damico, raphael-esparza, paul-bovi in ~/hwd_testimonials/new_reviews_1115.
   Proposed pace ~5 deep pages/week (awaiting Nima OK). Skipped: alan-harris, chris-king, ryan-pelczarski, doug-upstone, kevin-rogers.
   Owner rules 17 Nov: NO thin pages (BRIEF.md depth standard); NEVER his name/editor byline on HWD (7b51424 reverted 7fa860f).
   Next: deepen thin live pages (chris-jordan, mike-lundin, bryan-power, will-rogers, paul-leiner, sean-murphy, jack-jones).
3. SEO open (needs owner OK): add 209 profiles with 100+ picks to sitemap + IndexNow (1107 rule said let Google add naturally);
   profile titles with platform/handle for name searches; ~15 review pages still need GSC Request indexing (10/day, his Chrome).
4. Signups (owner to pick): free follow-alert email signup; Pro buttons to TMR Pro (conflicts 1024 no-link rule); trial/price (Stripe = his OK).
   Owner asked about hiding records until subscribe: recommended keep headline record free (SEO), offered "middle" option; no decision.
5. Still open: HWD Cloudflare Worker welcome email text not deployed (no CF token).

## Numbers
Nov 9 funnel 7d: 148 visits (chatgpt.com 91, google 10), 23 pricing views, 0 checkout starts, 0 subscribers.

## Rules
Names PUBLIC (HWD_NAMES=0 off). NO pending picks on this site (TMR Pro board only; HWD_PENDING_FEED=1 restores).
Never publish th- slugs, post text or post links. No test emails to Nima. No regrades without per pick approval.
No dashes in published text. Watchdog deploy only via wd_code_deploy.py. Reddit readable via Arctic Shift.
