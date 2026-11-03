# Moneyline price check: validation report (testing only, NOT released)

Candidate: tmr-watchdog branch `staging-price-check-20261103` (wager_check.py + test_wager_check.py on top of main 061e996).
Production runs the released code (release 20261102T052955-53dd5458, server gate open).

## 1. Why the safeguard blocked deploys, and the fix
- wager_check.py is on the production gate's PICK_PATH (app/production_gate.py). Any change to it without a new
  parser release makes the tree fail the gate, and wd_code_deploy.py then refuses to ship. That is the safeguard
  working as designed. On Nov 3 I pushed the candidate to main without a release, so main was undeployable from
  13:00 to 13:13 UTC. Nothing undeployable reached the server: the parser gate failed the first attempt and the
  production gate failed the second, both before the Render push. Production stayed on the released code the whole time.
- Gap: nothing stopped a gated file from reaching main. Fix (stronger, not weaker): `ops/check_release.py` checks any
  commit against its PARSER_RELEASE.json without checking it out, and `ops/hooks/pre-push`, now installed in the shared
  laptop repo, refuses any push to main that would fail the gate. Main 061e996 carries both.
  Tested: refuses 79a3b35 and the staging branch, allows main, ignores non main branches.

## 2. Read only run on every live pick (112,582, production ledger, read only connection)
| Market | Change vs released code |
|---|---|
| Spread, total, team total, alt lines, teasers, parlay legs, player props, first half ML | 0 picks change class or hold |
| Full game moneyline (40,571) | 1,274 get a "straight" label (price verified, no hold); 203 get "price_check" |

All 203 price_check picks are already held for review today: 173 by the Nov 3 long shot quarantine, 30 by earlier
holds. A release today would newly hold 0 picks. It only acts on future pending picks.

## 3. Are the 203 real errors? Random sample of 70 read against the post
- 54 (77%): the post shows a different bet: player props, futures, series prices, parlays, exact margins or scores,
  draws, wrong team, or not a bet at all.
- 16 (23%): plain team moneylines whose price is 10 to 30 points of implied probability longer than every book at
  post, capture and close. No book offered those prices, so the price or the game link is wrong, but the post alone
  cannot say which.
- 0 confirmed legitimate unusual prices. Boosted prices are exempt by rule.
False positive rate: 0 confirmed; 23% upper bound if every unresolved case were genuine.

## 4. Safety properties (end to end tests on a throwaway ledger, test_wager_check.py)
- A flagged pending pick is held for review (review_required, reason "WAGER_CHECK: price check ..."); its row, post
  text, price, line and status are unchanged; nothing is deleted.
- A settled pick is never changed; it is listed for the owner instead.
- Normal underdogs, boosted prices, spreads, totals, explicit alt lines, player props and first half moneylines stay counted.
- `wager_check.py --revert` releases every price check hold.
All new checks pass. One unrelated check already fails on main too ("ALT SPREAD" board label vs "ALT FULL GAME SPREAD").

## 5. Ingestion and staging deploy
- Ingestion was normal during testing: 7,483 picks normalized in the 24 hours to 13:15 UTC; publish ran 13:14 to 13:20 UTC rc 0.
- Staging deploy dry run on a throwaway worktree: candidate release cut locally (never pushed): full parser gate PASS
  (corpus 418 cases 0 FAIL, golden 167/167, triage 31/31, all replay suites 0 failed), production gate OPEN,
  check_release DEPLOYABLE. Parse stamp unchanged (53dd5458): parsing is byte identical, so pick ingestion cannot change.
- Not done: a real deploy to a separate staging server. None exists (the Hetzner box plan was never provisioned).

## 6. Release and rollback plan (when approved)
1. On the branch: `python app/release_parser.py --validated-by "<owner approval>" --evidence "<this report>"`, commit,
   merge to main (the pre-push hook confirms it is deployable), `python ~/tools/site_audit/wd_code_deploy.py`.
2. Watch the first wager_check run: new holds must be price_check only, and pending picks must keep flowing.
3. Rollback: `wager_check.py --revert` on the server (releases the holds), then restore the previous wager_check.py
   and PARSER_RELEASE.json from 061e996 on main and redeploy. Under 10 minutes; no grades are touched either way.

Recommendation: release. A false positive costs a pick a review hold, not its record. Without the check, new
picks like these count publicly until someone finds them by hand.
