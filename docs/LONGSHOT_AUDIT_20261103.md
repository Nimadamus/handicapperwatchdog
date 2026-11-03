# Long shot odds reconciliation, November 3, 2026

Scope: every non duplicate Watchdog pick with a posted price of +250 or longer, or no posted price and a reference
price of +250 or longer (1,045 picks, all statuses), plus a second tier at +150 to +249. Source of truth: the
production ledger (normalized_picks joined to raw_captures and tracker_events), read only, then a logged hold.

Note on the "514": that count came from the local HWD profile cache, which still holds 47 profile files under old
slugs (renamed accounts), so 66 rows were the same picks counted twice. The real public set was 448 unique picks.
The production HWD build loops over current accounts only and was not double counting.

## Method
1. Price check: posted price vs the market price for that side at post time, capture and close (the closest of the
   three). Agreement within 10 points of implied probability = price confirmed.
2. Source check: every pick's original post text, read by rule (props, futures, parlays, margins, hypotheticals,
   boosts, games outside the posting window) and by hand for every pick the rules flagged without a price conflict.
3. Grading check: every graded +250 pick recomputed from the final score at the stored line: 711 match, 9 cannot be
   recomputed (no score row), 5 differ and all 5 are soccer draws graded as moneyline losses, which is the house rule.
   Grading and settlement logic is correct; the problem is upstream, in reading the post.

## Result (+250 tier, public eligible graded picks: 725)
| Bucket | Picks | Won-lost | Status |
|---|---|---|---|
| Price confirmed by the market | 275 | 78-197 | Reliable, public |
| Reference priced (no posted price, price taken from the market) | 133 | 29-104 | Reliable price, public |
| Alternate spread named in the post, graded at its own line | 15 | 2-13 | Reliable, public |
| Boosted price (real posted price, market lower) | 2 | 1-1 | Public, labelled by rule |
| No market price to compare (mostly soccer and small leagues) | 124 | 31-93 | Unverified, public, win rate in line with the prices |
| Quarantined | 176 graded (+ 8 ungraded) | 107-67 | Held out of all public stats |

The quarantined group won 61% at an average stated price near +400, which is impossible for real long shots. The
public group that remains wins 25% to 28%, consistent with its prices.

## Root causes of the quarantined +250 picks (approximate, by post text)
| Cause | Picks | Example |
|---|---|---|
| Team name and price but market strongly disagrees (other game, stale or misread price; includes props written as "C. Williams (CHI) +340") | 94 | Bears @ +340, market -198 |
| Player prop read as a team bet (surname or team in parentheses) | 36 | "Aliyah Boston - Layup +1000" stored as Red Sox +1000 |
| Linked to a game outside the posting window (mostly futures) | 24 | "Texas +625" (title future) stored as a game line with market -6500 |
| Future or series price read as a game bet | 13 | "CWS to make the playoffs at +1600" |
| Parlay, same game or combo price | 7 | "One dog in Houston. Two favorites around it. +525." |
| Exotic market (win margin, exact margin) | 4 | "Bears exact margin 14-20 at +1900" |
| Spread or total with a price no book offered for that line | 5 | "Atl x Over 7 +260" |
| Not a bet (hypothetical, commentary) | 2 | "if it's Kansas State -13.5 it will be +4500" |

Second tier (+150 to +249): 94 picks held where the posted price was more than 10 points longer than every market
price (38-47 graded record); boosted prices were left public.

## What changed in production
- 278 picks: review_status ok -> review_required, reason "LONGSHOT_PRICE_20261103: <cause>". Status, grade, price,
  line and capture untouched (0 status changes in grade_ledger). 278 corrections_log rows + 278 grade_ledger rows.
- Script: tmr-watchdog app/audit_integrity/longshot_quarantine_20261103.py (items file beside it).
  Revert all: `longshot_quarantine_20261103.py --revert --apply`.
- Public records drop these picks at the next Watchdog publish; HWD profiles follow on their next refresh.

## Prevention (staged, not live)
Branch staging-price-check-20261103 in tmr-watchdog adds a moneyline price check to wager_check.py: a pending pick at
+150 or longer whose price is more than 10 points longer than every market price is held for review (boosts exempt).
Dry run on production: 207 picks would carry the label, 0 pending picks would be newly held today. It needs a parser
release (wager_check.py is a gated module), so it was taken back off main to keep deploys open.

## Open
- 124 public +250 picks in leagues without market data stay unverified.
- The same reading error exists below +150 for props on favorites; the price check cannot see those. A parser rule
  for "first name + team word" and "(TEAM)" prop formats is the real fix and belongs in the next parser release.
