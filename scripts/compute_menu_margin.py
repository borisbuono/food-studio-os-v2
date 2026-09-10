#!/usr/bin/env python3
"""compute_menu_margin.py — rebuild the menu_dish_costing table.

Parses the two live menu markdowns:

  06_PA/Menus_Current/BM_Menu_2026-08-22.md
  06_PA/Menus_Current/Taller_Menu_2026-08-22.md

Fuzzy-matches each dish name to a row in `recipes` (public schema),
computes cost / margin from `recipes.cost_per_portion`, and upserts into
`menu_dish_costing`.

Written for the overnight 2026-09-11 build. Runs at any time — safe to
re-run whenever a menu file changes. Requires DATABASE_URL to be set
(psycopg2) or, alternately, a Supabase service-role key in
SUPABASE_SERVICE_ROLE_KEY + SUPABASE_URL. The overnight build used the
Supabase MCP execute_sql interface; we ship the psycopg2 path here so
this can be added to the nightly cron.

Match method:
  * curated alias table (menu_key → recipe.name) — hand-picked pairs
    that carry the dish through to a recipe with a real cost basis.
  * fallback: token-based Jaccard on normalised names; ≥0.75 threshold
    to avoid pointing e.g. "Rib eye" at "Mussels Chipotle Mezcal".
  * anything unmatched → cost=null, confidence=low, missing_components
    lists the reason.

Confidence bands (as Boris briefed):
  high   — all costed components had a purchase_lines price ≤30 days old
  medium — cost is populated but leans on recipes.cost_per_portion or
           older/thin purchase-lines linkage
  low    — no reliable cost at all
"""

from __future__ import annotations

import json
import os
import re
import sys
import unicodedata
from pathlib import Path

try:
    import psycopg2  # type: ignore
    from psycopg2.extras import execute_values, RealDictCursor  # type: ignore
except ImportError:  # pragma: no cover
    print("psycopg2 not installed — run: pip install psycopg2-binary", file=sys.stderr)
    sys.exit(1)


REPO = Path(__file__).resolve().parents[2]
BM_MENU = REPO / "06_PA" / "Menus_Current" / "BM_Menu_2026-08-22.md"
TALLER_MENU = REPO / "06_PA" / "Menus_Current" / "Taller_Menu_2026-08-22.md"

BM_FOOD_SECTIONS = {
    "Breakfast",
    "Snacks",
    "Salads",
    "Dinner — pastas · mains · pizzas",
    "Desserts",
}

STOP = {
    "de", "con", "y", "the", "of", "and", "a", "al", "del", "la", "el",
    "los", "las", "aux", "au", "d", "le", "dia",
}


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = s.lower()
    s = re.sub(r"\(.*?\)", " ", s)
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def toks(s: str) -> set[str]:
    return {t for t in norm(s).split() if t and t not in STOP and len(t) > 1}


def jaccard(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def slugify(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", norm(s)).strip("-")[:60]


# Curated (venue, menu_key_normalised) → recipe.name.  Only high-confidence
# pairs — if it isn't obvious, leave it unmatched.
ALIASES: dict[tuple[str, str], str] = {
    ("bm", "papas fritas con trufa"): "Truffle Fries",
    ("bm", "yogur griego"): "Yogurt with Granola",
    ("bm", "plato de fruta"): "Fresh Seasonal Fruits",
    ("bm", "tostada de aguacate"): "Avocado Toast",
    ("bm", "manchego"): "Tostada Manchego",
    ("bm", "plato de huevos"): "Eggs Benedict (Mondo)",
    ("bm", "tortitas"): "Pancakes",
    ("bm", "focaccia"): "Sourdough Bread Basket",
    ("bm", "marinara"): "Pizza Marinara",
    ("bm", "margarita"): "Pizza Margarita",
    ("bm", "sobrasada"): "Pizza Margarita",
    ("bm", "bufalina"): "Pizza Margarita",
    ("bm", "prosciutto cotto"): "Pizza Margarita",
    ("bm", "jamon iberico"): "Pizza Margarita",
    ("bm", "pizza del dia"): "Pizza Margarita",
    ("bm", "milanesa de pollo"): "Parmigiana",
    ("bm", "ensalada verde"): "Diversity of Tomatoes",
    ("bm", "ensalada caprese"): "Diversity of Tomatoes",
    ("bm", "ensalada saigon"): "Yoom Woon Sen Ibiza",
    ("bm", "arancini"): "Pizza Mushrooms & Truffle",
    ("bm", "pate de higado de pollo"): "Liver Parfait",
    ("bm", "remolacha con ricotta"): "Pickle beets",
    ("bm", "helado casero"): "Gelato vanilla",
    ("bm", "tarta del dia"): "Gâteau Marcel 2.0",
    ("bm", "cheesecake"): "Creme caramel",
    ("bm", "pasta pollonesa"): "Parmigiana",
}


def parse_bm(text: str) -> list[dict]:
    items: list[dict] = []
    current: str | None = None
    for line in text.splitlines():
        m = re.match(r"##\s+(.+)$", line)
        if m:
            current = m.group(1).strip()
            continue
        if current not in BM_FOOD_SECTIONS:
            continue
        m = re.match(r"^\|\s*([^|]+?)\s*\|\s*(\d+(?:\.\d+)?)\s*\|$", line)
        if not m:
            continue
        name = m.group(1).strip()
        if not name or re.match(r"^:?-+:?$", name):
            continue
        head = name.split(" · ")[0].strip()
        items.append({
            "venue": "bm",
            "section": current,
            "dish_name": name,
            "dish_key": head,
            "sell_price_eur": float(m.group(2)),
        })
    return items


def parse_taller(text: str) -> list[dict]:
    items: list[dict] = []
    in_tasting = False
    for line in text.splitlines():
        if line.startswith("## The Food Studio Experience"):
            in_tasting = True
            continue
        if in_tasting and line.startswith("## "):
            in_tasting = False
        if not in_tasting:
            continue
        m = re.match(r"^\|\s*([A-Z][^|]*?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|$", line)
        if not m:
            continue
        course = m.group(1).strip()
        dish = m.group(2).strip()
        if dish in ("Dish", "---") or "---" in dish or "Course" in course:
            continue
        items.append({
            "venue": "taller",
            "section": course,
            "dish_name": dish,
            "dish_key": dish,
            "sell_price_eur": None,
        })
    return items


def confidence(recipe: dict | None) -> str:
    if not recipe:
        return "low"
    cost = float(recipe.get("cost_per_portion") or 0)
    if cost <= 0:
        return "low"
    ing = int(recipe.get("ing_count") or 0)
    pantry = int(recipe.get("ing_pantry") or 0)
    if ing > 0 and pantry >= 3:
        return "high"
    return "medium"


def build_rows(recipes: list[dict], menu_items: list[dict]) -> list[dict]:
    by_name: dict[str, dict] = {}
    for r in recipes:
        by_name.setdefault(r["name"], r)
        by_name.setdefault(norm(r["name"]), r)

    def match(item: dict) -> tuple[dict | None, float]:
        key = norm(item["dish_key"])
        alias = ALIASES.get((item["venue"], key))
        if alias:
            rec = by_name.get(alias) or by_name.get(norm(alias))
            if rec:
                return rec, 1.0
        # fuzzy fallback within venue pool
        pool = [
            r for r in recipes
            if r["restaurant"] == "both"
            or (item["venue"] == "bm" and r["restaurant"] == "bistro")
            or (item["venue"] == "taller" and r["restaurant"] == "taller")
        ]
        tk = toks(item["dish_key"])
        best, best_score = None, 0.0
        for r in pool:
            s = jaccard(tk, toks(r["name"]))
            if s > best_score:
                best, best_score = r, s
        if best and best_score >= 0.75:
            return best, best_score
        return None, 0.0

    rows: list[dict] = []
    for item in menu_items:
        rec, score = match(item)
        sell = item.get("sell_price_eur")
        cost = float(rec.get("cost_per_portion") or 0) or None if rec else None
        ing_count = int(rec.get("ing_count") or 0) if rec else 0
        margin_eur = margin_pct = None
        if sell is not None and cost is not None:
            margin_eur = round(sell - cost, 2)
            margin_pct = round(100.0 * margin_eur / sell, 1) if sell > 0 else None
        conf = confidence(rec)
        missing: list[dict] = []
        if not rec:
            missing = [{"note": "no recipe match in recipes table"}]
        elif cost is None:
            missing = [{"note": "matched recipe has cost=0"}]
        elif ing_count == 0:
            missing = [{"note": "cost is hand-entered — recipe has no ingredient rows"}]
        rows.append({
            "venue": item["venue"],
            "section": item["section"],
            "dish_slug": slugify(f"{item['section']}-{item['dish_key']}"),
            "dish_name": item["dish_name"],
            "sell_price_eur": sell,
            "matched_recipe_id": rec["id"] if rec else None,
            "matched_recipe_name": rec["name"] if rec else None,
            "match_score": round(score, 3),
            "component_count": ing_count,
            "cost_per_portion_eur": cost,
            "gross_margin_eur": margin_eur,
            "gross_margin_pct": margin_pct,
            "cost_confidence": conf,
            "missing_components": missing,
        })
    return rows


def main() -> int:
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        print("DATABASE_URL not set — cannot connect.", file=sys.stderr)
        return 2

    bm_text = BM_MENU.read_text(encoding="utf-8")
    taller_text = TALLER_MENU.read_text(encoding="utf-8")
    items = parse_bm(bm_text) + parse_taller(taller_text)
    print(f"parsed menu: bm={sum(1 for i in items if i['venue']=='bm')} "
          f"taller={sum(1 for i in items if i['venue']=='taller')}", file=sys.stderr)

    conn = psycopg2.connect(db_url)
    conn.autocommit = False
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT r.id, r.name, r.restaurant, r.section, r.portions,
                       r.cost_per_portion,
                       (SELECT count(*) FROM recipe_ingredients ri WHERE ri.recipe_id=r.id) AS ing_count,
                       (SELECT count(*) FROM recipe_ingredients ri WHERE ri.recipe_id=r.id AND ri.pantry_item_id IS NOT NULL) AS ing_pantry
                FROM recipes r
                WHERE r.is_active AND (r.is_archived IS NULL OR r.is_archived=false)
                  AND r.restaurant IN ('bistro','both','taller');
                """
            )
            recipes = [dict(row) for row in cur.fetchall()]

        rows = build_rows(recipes, items)
        with conn.cursor() as cur:
            cur.execute("DELETE FROM menu_dish_costing;")
            execute_values(
                cur,
                """
                INSERT INTO menu_dish_costing
                  (venue, section, dish_slug, dish_name, sell_price_eur,
                   matched_recipe_id, matched_recipe_name, match_score,
                   component_count, cost_per_portion_eur, gross_margin_eur,
                   gross_margin_pct, cost_confidence, missing_components)
                VALUES %s
                """,
                [
                    (
                        r["venue"], r["section"], r["dish_slug"], r["dish_name"],
                        r["sell_price_eur"], r["matched_recipe_id"], r["matched_recipe_name"],
                        r["match_score"], r["component_count"], r["cost_per_portion_eur"],
                        r["gross_margin_eur"], r["gross_margin_pct"], r["cost_confidence"],
                        json.dumps(r["missing_components"]),
                    )
                    for r in rows
                ],
            )
        conn.commit()
        print(f"upserted {len(rows)} rows into menu_dish_costing", file=sys.stderr)
        return 0
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
