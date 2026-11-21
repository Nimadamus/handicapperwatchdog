"""Owner approved 2026-11-20 ~1:55 PM PST in chat ("fix all") after the Handicapper Watchdog bug hunt:
  1. HOLD for review the counted picks whose stated price is a futures / prop / boost price read as a game moneyline
     (e.g. "bengals +1200 to win Superbowl", "Deni Avdija Triple-Double vs. LAL (+2000)", "MIL > NYY +3500").
     review_status ok -> review_required (held: never in the record). Status, grade and units are kept exactly.
  2. HOLD the counted 'picks' whose text is only a record summary line (e.g. "ML: 212-195, -9.27 units").
Every change writes a corrections_log row with the before and after state.

  python owner_fix_20261120.py [db]            dry run
  python owner_fix_20261120.py [db] --apply
  python owner_fix_20261120.py [db] --revert
"""
import json, os, sqlite3, sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
APPROVED = "Nima in chat 2026-11-20 ~1:55 PM PST: 'fix all' (hold misread long price picks, count duplicates once)"
TOOL = "owner_fix_20261120.py"
HOLD = {
    155875: "Florida +1200 (0.75U): a futures price, not a game moneyline",
    155876: "Kansas +2800 (0.5U): a futures price, not a game moneyline",
    155877: "Kentucky +6600 (0.25U): a futures price, not a game moneyline",
    157255: "Deni Avdija triple double prop (+2000) read as a Lakers moneyline",
    162598: "'MIL > NYY +3500': a futures comparison, not a Yankees game moneyline",
    169167: "'bengals +1200 to win Superbowl': a futures bet, not a game moneyline",
    173000: "Arizona +1600 posted with Michigan St +2000: futures prices, not game moneylines",
    173001: "Michigan St +2000 posted with Arizona +1600: futures prices, not game moneylines",
    165523: "Andre Drummond double double prop (+1040) read as a moneyline",
    200887: "Kansas +1650 (sportsbook post listing futures prices), not a game moneyline",
    200888: "Texas +2000 (sportsbook post listing futures prices), not a game moneyline",
    200889: "Louisville +2500 (sportsbook post listing futures prices), not a game moneyline",
    97389: "the line is a record summary (ML: 212-194, -8.26 units), not a pick",
    100013: "the line is a record summary (ML: 212-195, -9.27 units), not a pick",
    100527: "the line is a record summary (ML: 212-195, -9.27 units), not a pick",
    105891: "the line is a record summary (ML: 212-195, -9.27 units), not a pick",
    115814: "the line is a record summary (ML: 212-195, -9.27 units), not a pick",
    119864: "the line is a record summary (ML: 212-195, -9.27 units), not a pick",
    160426: "the line is a record summary (ML: 18-16), not a pick",
    168474: "the line is a record summary (ML: 19-16), not a pick",
    175704: "the line is a record summary (ML: 22-17), not a pick",
    186095: "the line is a record summary (ML: 30-29, -4.12 units), not a pick",
    202066: "the line is a record summary (ML: 26-22), not a pick",
    169610: "Zach Edey double double prop (+358) read as a Raptors moneyline",
    178178: "a Wild ML plus Devin Booker 3PM parlay; the -106 is the parlay price, not the Wild moneyline",
    11635: "Patrick Mahomes O14.5 player prop read as a full game total over 14.5",
    2378: "Pittsburgh/Syracuse o25.5 is a first half number (full game market 51.5) graded as a full game total",
    7959: "'The Chargers - 22.5% of the field' is a contest share, read as Chargers -22.5",
    32105: "'Jordan Marshall -105' is a player prop (Michigan running back), read as a Marshall moneyline",
    36404: "'Jordan Marshall -105' is a player prop (Michigan running back), read as a Marshall moneyline",
    23193: "'Georgia (UEFA) -124' is the Georgia national soccer team, read as a Georgia Bulldogs moneyline",
    33516: "'Georgia (UEFA) -124' is the Georgia national soccer team, read as a Georgia Bulldogs moneyline",
}
HOLD_TAG = "OWNER_HOLD_20261120"
DUP_REASON = "same account, game, pick and start time parsed twice from the same post (owner fix 2026-11-20)"


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    db = args[0] if args else os.path.join(HERE, "records_test.db")
    mode = "apply" if "--apply" in sys.argv else "revert" if "--revert" in sys.argv else "dry"
    c = sqlite3.connect(db, timeout=600)
    c.row_factory = sqlite3.Row
    if mode != "dry":
        __import__("production_gate").require_open(c, TOOL + " " + mode)
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    cols = "id, status, review_status, review_reason, dup_of_pick_id, dup_reason, source_account_id, raw_capture_id, event_id, selection, raw_fragment, result_units_posted"
    log = lambda pid, acct, cat, b, a, why: c.execute(
        "INSERT INTO corrections_log(pick_id,account,category,before_json,after_json,reason,approved_by,applied_at,tool) VALUES(?,?,?,?,?,?,?,?,?)",
        (pid, str(acct), cat, json.dumps(b), json.dumps(a), why, APPROVED, now, TOOL))
    held = dup = 0
    if mode == "revert":
        for r in c.execute("SELECT pick_id, category, before_json FROM corrections_log WHERE tool=? AND category IN ('owner_hold_20261120','owner_dedupe_20261120')", (TOOL,)).fetchall():
            b = json.loads(r["before_json"])
            c.execute("UPDATE normalized_picks SET status=?, review_status=?, review_reason=?, dup_of_pick_id=?, dup_reason=? WHERE id=?",
                      (b["status"], b["review_status"], b["review_reason"], b["dup_of_pick_id"], b["dup_reason"], r["pick_id"]))
            log(r["pick_id"], "", r["category"] + "_revert", {}, b, "revert")
            held += 1
        c.commit()
        print("reverted", held)
        return
    for pid, why in HOLD.items():
        p = c.execute("SELECT %s FROM normalized_picks WHERE id=?" % cols, (pid,)).fetchone()
        if not p or p["review_status"] != "ok" or p["status"] not in ("won", "lost", "push"):
            print("skip hold", pid, p and (p["status"], p["review_status"]))
            continue
        b = {k: p[k] for k in ("status", "review_status", "review_reason", "dup_of_pick_id", "dup_reason")}
        a = dict(b, review_status="review_required", review_reason="%s: %s. Held from every record until reviewed." % (HOLD_TAG, why))
        print("HOLD", pid, p["status"], p["result_units_posted"], "|", p["raw_fragment"][:60])
        if mode == "apply":
            c.execute("UPDATE normalized_picks SET review_status=?, review_reason=? WHERE id=? AND review_status='ok'", (a["review_status"], a["review_reason"], pid))
            log(pid, p["source_account_id"], "owner_hold_20261120", b, a, why)
        held += 1
    if mode == "apply":
        c.commit()
    print(mode, "held", held)


if __name__ == "__main__":
    main()
