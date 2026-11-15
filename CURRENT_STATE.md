# Handicapper Watchdog: CURRENT STATE (saved 2026-11-15 ~11:45 AM PST)

Work from worktree `~/hwd-names-1114` (branch names-1114, push `HEAD:main`; main = deploy, site rebuilds every 30 min).

## Done 15 Nov
- Names refresh: 60 accounts showed #ID; refreshed (4290 names, main 2957095). Now automatic: scheduled task
  "HWD Names Refresh" daily 5:40 AM, hidden, log tools/refresh_names_daily.log (script pulls main before pushing).
- About page rewritten (main 1201a8c, LIVE 11:42 AM): neutral site, what we collect, what we cannot verify,
  "where there is smoke", why trust us, right of reply, how to use, FAQ. Live counts filled from meta. Every v2
  review page's "What customers say" now links to it (reviewv2.py).

## Resume here
1. NEW REVIEWS (owner: "build review pages on all handicappers who sell picks", based on what is posted online).
   Batch of 16 drafted by research agents into `~/hwd_testimonials/new_reviews_1115/<slug>.json` (brief: BRIEF.md there):
   kelso-sturgeon, winning-points, ats-consultants, sports-information-traders, kevin-oneill-the-prez, hammering-hank,
   pickdawgz, ben-burns, vsin-picks, unabated, bettingpros, northcoast-sports, tony-george, larry-ness, kevin-thomas,
   bill-krackomberger. Some may be missing if an agent was cut off; redo those.
   Publish steps: `python ~/hwd_testimonials/new_reviews_1115/validate.py` (schema, dashes, source indexes, related slugs)
   -> read each file (fairness, no names of reviewers, allegations labeled, max one quote) -> copy to content/reviews_v2/
   -> test render (build._write_editorial into a scratch dir with a data/ folder) -> commit, push main -> verify live
   -> IndexNow (`~/tools/indexnow_bulk.py`) for the new URLs.
2. Next batch ideas: Matt Fargo, Chris Jordan, Joe Gavazzi, Phil Steele, Payne Insider, Rob Vinciletti, Zack Cimini, Sean Higgs.
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
