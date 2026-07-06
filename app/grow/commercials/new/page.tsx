"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { getMyProfile } from "@/lib/profile";
import { ENTITY_TO_RESTAURANT, EntityKey } from "@/lib/entities";

type MenuItem = { id: string; name: string; price: number | null; section: string | null; category: string | null };

const TYPES = [
  { value: "happy_hour", label: "Happy hour", blurb: "Time-window pricing on drinks, snacks, plates." },
  { value: "package", label: "Package", blurb: "Fixed price · fixed selection · one bill." },
  { value: "seasonal", label: "Seasonal", blurb: "Ingredient-of-the-moment special. Runs for a stretch." },
  { value: "wine_club", label: "Wine club", blurb: "Recurring membership · monthly bottles." },
  { value: "private_event_menu", label: "Private event menu", blurb: "Set menu for a private booking." },
];

const eur = (n: number | null | undefined) => "€" + Number(n || 0).toFixed(2);

export default function NewCommercial() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState({
    type: "happy_hour",
    title: "",
    description: "",
    starts_at: "",
    ends_at: "",
    active: false,
  });
  const [items, setItems] = useState<MenuItem[]>([]);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [overrides, setOverrides] = useState<Record<string, string>>({}); // price string per menu_item_id

  useEffect(() => {
    (async () => {
      const ent = ((typeof localStorage !== "undefined" && localStorage.getItem("fs_entity")) as EntityKey | null) || "utopia";
      const rid = ENTITY_TO_RESTAURANT[ent] || ENTITY_TO_RESTAURANT.utopia!;
      const { data } = await supabaseBrowser
        .from("menu_items")
        .select("id,name,price,section,category")
        .eq("restaurant_id", rid)
        .eq("is_active", true)
        .order("name")
        .limit(500);
      setItems((data || []) as MenuItem[]);
    })();
  }, []);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return items.filter((i) => !ql || i.name.toLowerCase().includes(ql) || (i.section || "").toLowerCase().includes(ql));
  }, [items, q]);

  const selectedIds = Object.keys(selected).filter((k) => selected[k]);
  const selectedItems = items.filter((i) => selected[i.id]);

  async function save() {
    setBusy(true); setErr(null);
    try {
      const prof = await getMyProfile();
      const ent = (prof && !prof.isAdmin ? prof.entity : ((typeof localStorage !== "undefined" && localStorage.getItem("fs_entity")) as EntityKey | null)) || "utopia";
      const rid = prof?.restaurantId || ENTITY_TO_RESTAURANT[ent as EntityKey] || ENTITY_TO_RESTAURANT.utopia!;
      const payload: any = {
        restaurant_id: rid,
        type: f.type,
        title: f.title.trim(),
        description: f.description || null,
        starts_at: f.starts_at || null,
        ends_at: f.ends_at || null,
        active: f.active,
      };
      const { data: c, error } = await supabaseBrowser.from("commercials").insert(payload).select("id").maybeSingle();
      if (error) throw error;
      const cid = c?.id;
      if (cid && selectedIds.length) {
        const rows = selectedIds.map((menu_item_id) => {
          const raw = overrides[menu_item_id];
          const price = raw ? Number(raw) : null;
          return { commercial_id: cid, menu_item_id, price_override_eur: Number.isFinite(price as number) && (price as number) > 0 ? price : null };
        });
        const { error: e2 } = await supabaseBrowser.from("commercial_items").insert(rows);
        if (e2) throw e2;
      }
      router.push(cid ? `/grow/commercials/${cid}` : "/grow/commercials");
    } catch (e: any) {
      setErr(e?.message || "Save failed"); setBusy(false);
    }
  }

  const lbl = "font-mono text-[10px] uppercase tracking-wide text-clay";
  const inp = "mt-1 w-full border-b border-line bg-transparent py-2 font-sans text-[15px] text-ink placeholder:text-clay outline-none focus:border-ink";

  const StepHeader = () => (
    <p className="mt-6 font-mono text-[10px] uppercase tracking-wide text-clay">
      Step {step} of 5 · <span className="text-tomato">{["Type", "Details", "Items", "Prices", "Activate"][step - 1]}</span>
    </p>
  );

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <Link href="/grow/commercials" className="font-sans text-sm text-ink-soft">← commercials</Link>
      <StepHeader />
      <h1 className="mt-1 font-serif text-4xl leading-tight text-ink">Build an offer.</h1>

      {/* STEP 1 — TYPE */}
      {step === 1 ? (
        <section className="mt-8">
          <p className={lbl}>Pick a type</p>
          <ul className="mt-3 divide-y divide-line border-y border-line">
            {TYPES.map((t) => (
              <li key={t.value}>
                <button
                  onClick={() => setF({ ...f, type: t.value })}
                  className="grid w-full grid-cols-[auto_1fr] items-baseline gap-4 py-4 text-left"
                >
                  <span className={"inline-block h-3 w-3 rounded-full border " + (f.type === t.value ? "border-transparent" : "border-line")}
                        style={f.type === t.value ? { background: "var(--accent)" } : undefined} />
                  <span>
                    <span className="font-serif text-[17px] text-ink">{t.label}</span>
                    <span className="ml-2 font-serif italic text-[13px] text-clay">{t.blurb}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <button onClick={() => setStep(2)} className="mt-8 rounded-xl px-5 py-3 font-sans text-[14px] font-medium text-[#F7F7F4]" style={{ background: "var(--accent)" }}>Next →</button>
        </section>
      ) : null}

      {/* STEP 2 — DETAILS */}
      {step === 2 ? (
        <section className="mt-8 space-y-5">
          <div>
            <p className={lbl}>Title*</p>
            <input required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Sunday brunch happy hour" className={inp} />
          </div>
          <div>
            <p className={lbl}>Description</p>
            <textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} rows={3} placeholder="One line for the guest menu, one paragraph for the campaign." className={inp + " resize-none"} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className={lbl}>From</p>
              <input type="date" value={f.starts_at} onChange={(e) => setF({ ...f, starts_at: e.target.value })} className={inp + " font-mono text-[13px]"} />
            </div>
            <div>
              <p className={lbl}>To</p>
              <input type="date" value={f.ends_at} onChange={(e) => setF({ ...f, ends_at: e.target.value })} className={inp + " font-mono text-[13px]"} />
            </div>
          </div>
          <div className="flex gap-3 pt-4">
            <button onClick={() => setStep(1)} className="rounded-xl border border-line px-4 py-2.5 font-sans text-[13px] text-ink-soft">← Back</button>
            <button onClick={() => setStep(3)} disabled={!f.title.trim()} className="rounded-xl px-5 py-3 font-sans text-[14px] font-medium text-[#F7F7F4] disabled:opacity-60" style={{ background: "var(--accent)" }}>Next →</button>
          </div>
        </section>
      ) : null}

      {/* STEP 3 — ITEMS */}
      {step === 3 ? (
        <section className="mt-8">
          <p className={lbl}>Pick menu items · {selectedIds.length} selected</p>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search menu…"
            className="mt-3 w-full border-b border-line bg-transparent py-2 font-sans text-[15px] text-ink placeholder:text-clay outline-none"
          />
          {items.length === 0 ? (
            <p className="mt-8 font-serif italic text-[14px] text-clay">
              No menu items to pick from yet. Add items in Develop · Menu, then come back.
            </p>
          ) : (
            <ul className="mt-4 max-h-[420px] divide-y divide-line overflow-y-auto border-y border-line">
              {filtered.map((i) => (
                <li key={i.id}>
                  <label className="grid cursor-pointer grid-cols-[auto_1fr_auto] items-baseline gap-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={!!selected[i.id]}
                      onChange={(e) => setSelected({ ...selected, [i.id]: e.target.checked })}
                      className="h-4 w-4 accent-tomato"
                    />
                    <span>
                      <span className="font-serif text-[15px] text-ink">{i.name}</span>
                      {i.section ? <span className="ml-2 font-mono text-[10px] uppercase tracking-wide text-clay">{i.section}</span> : null}
                    </span>
                    <span className="font-mono text-[12px] text-clay">{i.price != null ? eur(i.price) : "—"}</span>
                  </label>
                </li>
              ))}
              {filtered.length === 0 ? <li className="py-4 font-serif italic text-[13px] text-clay">Nothing matches.</li> : null}
            </ul>
          )}
          <div className="mt-6 flex gap-3">
            <button onClick={() => setStep(2)} className="rounded-xl border border-line px-4 py-2.5 font-sans text-[13px] text-ink-soft">← Back</button>
            <button onClick={() => setStep(4)} className="rounded-xl px-5 py-3 font-sans text-[14px] font-medium text-[#F7F7F4]" style={{ background: "var(--accent)" }}>Next →</button>
          </div>
        </section>
      ) : null}

      {/* STEP 4 — PRICES */}
      {step === 4 ? (
        <section className="mt-8">
          <p className={lbl}>Price overrides · leave blank to keep menu price</p>
          {selectedItems.length === 0 ? (
            <p className="mt-6 font-serif italic text-[14px] text-clay">No items selected. Go back and pick some.</p>
          ) : (
            <ul className="mt-3 divide-y divide-line border-y border-line">
              {selectedItems.map((i) => (
                <li key={i.id} className="grid grid-cols-[1fr_auto_auto] items-baseline gap-3 py-2.5">
                  <span>
                    <span className="font-serif text-[15px] text-ink">{i.name}</span>
                    <span className="ml-2 font-mono text-[10px] text-clay">was {i.price != null ? eur(i.price) : "—"}</span>
                  </span>
                  <span className="font-mono text-clay">€</span>
                  <input
                    inputMode="decimal"
                    placeholder={i.price != null ? i.price.toString() : "0.00"}
                    value={overrides[i.id] || ""}
                    onChange={(e) => setOverrides({ ...overrides, [i.id]: e.target.value })}
                    className="w-24 bg-transparent text-right font-mono text-[14px] text-ink outline-none"
                  />
                </li>
              ))}
            </ul>
          )}
          <div className="mt-6 flex gap-3">
            <button onClick={() => setStep(3)} className="rounded-xl border border-line px-4 py-2.5 font-sans text-[13px] text-ink-soft">← Back</button>
            <button onClick={() => setStep(5)} className="rounded-xl px-5 py-3 font-sans text-[14px] font-medium text-[#F7F7F4]" style={{ background: "var(--accent)" }}>Next →</button>
          </div>
        </section>
      ) : null}

      {/* STEP 5 — ACTIVATE */}
      {step === 5 ? (
        <section className="mt-8">
          <p className={lbl}>Review + activate</p>
          <div className="mt-3 border-y border-line divide-y divide-line">
            <div className="flex items-baseline justify-between py-2.5">
              <span className={lbl}>Type</span>
              <span className="font-serif text-[14px] text-ink">{TYPES.find((t) => t.value === f.type)?.label}</span>
            </div>
            <div className="flex items-baseline justify-between py-2.5">
              <span className={lbl}>Title</span>
              <span className="font-serif text-[14px] text-ink">{f.title || "—"}</span>
            </div>
            <div className="flex items-baseline justify-between py-2.5">
              <span className={lbl}>Window</span>
              <span className="font-mono text-[12px] text-ink">{f.starts_at || "—"} → {f.ends_at || "—"}</span>
            </div>
            <div className="flex items-baseline justify-between py-2.5">
              <span className={lbl}>Items</span>
              <span className="font-mono text-[12px] text-ink">{selectedIds.length}</span>
            </div>
          </div>

          <label className="mt-6 flex items-center gap-3">
            <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} className="h-4 w-4 accent-tomato" />
            <span className="font-serif text-[15px] text-ink">Activate now</span>
            <span className="font-serif italic text-[13px] text-clay">(otherwise saved as draft)</span>
          </label>

          {err ? <p className="mt-4 font-mono text-[12px] text-tomato">⚠ {err}</p> : null}
          <div className="mt-6 flex gap-3">
            <button onClick={() => setStep(4)} className="rounded-xl border border-line px-4 py-2.5 font-sans text-[13px] text-ink-soft">← Back</button>
            <button onClick={save} disabled={busy || !f.title.trim()} className="rounded-xl px-5 py-3 font-sans text-[14px] font-medium text-[#F7F7F4] disabled:opacity-60" style={{ background: "var(--accent)" }}>
              {busy ? "Saving…" : "Save commercial"}
            </button>
          </div>
        </section>
      ) : null}
    </main>
  );
}
