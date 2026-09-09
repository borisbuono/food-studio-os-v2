#!/usr/bin/env python3
"""Backfill fresto_z_reports_raw from cached NI dumps.

Reason: the OS lane needs historical z-report bodies so the derived
metrics (payment_mix, tips, span detection) can be re-computed without
re-hitting the live Fresto API for closed months.

We only backfill what the dumps actually contain in row form:
  - z_<date>.json         → fresto_z_reports_raw (full body per z)

The `ol_days_*.json` dumps carry aggregates only (no line detail), so
they can't feed fresto_orderlines_raw. Historical orderlines require a
live-API replay run (out of scope here) — see follow-up in report.

businessDate offset (see memory `fresto_businessdate_field_fixed_2026-09-07`):
  Z-reports were UNAFFECTED by the 09-07 shift (they bucket by close
  time, not by the mutated field). We still route each raw row through
  `resolve_trading_date(pulled_at, business_date_label)` for consistency,
  and log the pre/post-fix identity for spot-checks.

Usage:
  export SUPABASE_URL=... SUPABASE_SERVICE_KEY=...
  python3 scripts/backfill_fresto_raw_from_dumps.py \
    --dumps "/path/to/05_Finance/fresto_api/ni_dumps"
"""

import argparse, os, glob, json, re, sys, datetime as dt
from urllib.request import Request, urlopen
from urllib.error import HTTPError

FRESTO_BDATE_FIX = dt.date(2026, 9, 7)  # server-side shift

def resolve_trading_date(pulled_at: dt.date, business_date_label: str | None) -> str | None:
    """The single date derivation — mirrors lib/integrations/pos/fresto-derive.ts.
    Pre-fix pulls → label + 1 day. Post-fix pulls → label unchanged.
    """
    if not business_date_label:
        return None
    m = re.match(r"^(\d{4}-\d{2}-\d{2})", str(business_date_label))
    if not m:
        return None
    d = dt.date.fromisoformat(m.group(1))
    if pulled_at >= FRESTO_BDATE_FIX:
        return d.isoformat()
    return (d + dt.timedelta(days=1)).isoformat()

def parse_pull_date_from_filename(fn: str) -> dt.date | None:
    m = re.search(r"(\d{4}-\d{2}-\d{2})", os.path.basename(fn))
    return dt.date.fromisoformat(m.group(1)) if m else None

def sb_post(sb_url: str, sb_key: str, table: str, rows: list, on_conflict: str):
    url = f"{sb_url}/rest/v1/{table}?on_conflict={on_conflict}"
    body = json.dumps(rows).encode()
    req = Request(url, data=body, method="POST", headers={
        "apikey": sb_key,
        "authorization": f"Bearer {sb_key}",
        "content-type": "application/json",
        "prefer": "resolution=merge-duplicates,return=minimal",
    })
    try:
        with urlopen(req, timeout=60) as r:
            return r.status
    except HTTPError as e:
        print(f"ERROR upsert {table}: HTTP {e.code} {e.read()[:400]!r}", file=sys.stderr)
        raise

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dumps", required=True, help="Path to 05_Finance/fresto_api/ni_dumps/")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    sb_url = os.environ.get("SUPABASE_URL")
    sb_key = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ.get("SUPABASE_ANON_KEY")
    if not args.dry_run and not (sb_url and sb_key):
        sys.exit("SUPABASE_URL + SUPABASE_SERVICE_KEY (or ANON) required unless --dry-run")

    files = sorted(glob.glob(os.path.join(args.dumps, "z_*.json")))
    print(f"# {len(files)} z_*.json files")

    total = 0
    per_venue = {"BM": 0, "IFL": 0}
    per_pull_summary = {}

    for fn in files:
        pull_date = parse_pull_date_from_filename(fn)
        try:
            j = json.load(open(fn))
        except Exception as e:
            print(f"  skip {fn}: {e}")
            continue

        for venue in ("BM", "IFL", "BBH"):
            zs = j.get(venue) or []
            if not isinstance(zs, list) or not zs:
                continue

            rows = []
            for z in zs:
                zid = z.get("id") or z.get("slug")
                if not zid:
                    continue
                from_ts = z.get("fromDate")
                to_ts = z.get("toDate")
                bd_label = (from_ts or "")[:10] if from_ts else None
                spans = bool(from_ts and to_ts and str(from_ts)[:10] != str(to_ts)[:10])
                rows.append({
                    "entity_code": venue,
                    "fresto_id": str(zid),
                    "from_date": from_ts,
                    "to_date": to_ts,
                    "business_date": bd_label,
                    "trading_date": resolve_trading_date(pull_date, bd_label) if pull_date else bd_label,
                    "spans_days": spans,
                    "revenue_eur": z.get("revenue") or 0,
                    "cash_revenue_eur": z.get("cashRevenue") or 0,
                    "cards_total_eur": z.get("cardsTotal") or 0,
                    "online_cards_total_eur": z.get("onlineCardsTotal") or 0,
                    "tips_eur": z.get("tips") or 0,
                    "vat_amount_eur": z.get("vatAmount") or 0,
                    "quantity": z.get("quantity") or 0,
                    "raw": z,
                    "pulled_at": (pull_date.isoformat() + "T00:00:00Z") if pull_date else None,
                })
            per_pull_summary.setdefault((venue, str(pull_date)), 0)
            per_pull_summary[(venue, str(pull_date))] += len(rows)
            per_venue[venue] = per_venue.get(venue, 0) + len(rows)
            total += len(rows)

            if not rows:
                continue
            if args.dry_run:
                print(f"  DRY {venue} {pull_date}: {len(rows)} z rows")
                continue
            # PostgREST tolerates repeated on_conflict — dedup keeps the newest pull_at row.
            sb_post(sb_url, sb_key, "fresto_z_reports_raw", rows, on_conflict="entity_code,fresto_id")

    print(f"# TOTAL {total} rows upserted (BM {per_venue['BM']}, IFL {per_venue['IFL']})")

if __name__ == "__main__":
    main()
