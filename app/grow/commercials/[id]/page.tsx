"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabaseBrowser";

export const dynamic = "force-dynamic";

type Commercial = {
  id: string;
  restaurant_id: string;
  type: string;
  title: string;
  description: string | null;
  starts_at: string | null;
  ends_at: string | null;
  active: boolean;
};
type MenuItem = { id: string; name: string; price: number | null; section: string | null };
type Item = { id: string; commercial_id: string; menu_item_id: string; price_override_eur: number | null };

const TYPES = [
  { value: "happy_hour", label: "Happy hour" },
  { value: "package", label: "Package" },
  { value: "seasonal", label: "Seasonal" },
  { value: "wine_club", label: "Wine club" },
  { value: "private_event_menu", label: "Private event menu" },
];

const eur = (n: number | null | undefined) => "€" + Number(n || 0).toFixed(2);
const toInputDate = (s: string | null) => (s ? s.slice(0, 10) : "");

export default function CommercialDetail({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [c, setC] = useState<Commercial | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [menuByIdMap, setMenuByIdMap] = useState<Record<string, MenuItem>>({});
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [draft, setDraft] = useState<Partial<Commercial>>({});

  // menu picker
  const [allMenu, setAllMenu] = useState<MenuItem[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQ, setPickerQ] = useState("");

  useEffect(() => {
    (async () => {
      const { data: cd } = await supabaseBrowser
        .from("commercials")
        .select("id,restaurant_id,type,title,description,starts_at,ends_at,active")
        .eq("id", params.id)
        .maybeSingle();
      setC(cd as Commercial | null);
      setDraft(cd || {});

      const { data: is } = await supabaseBrowser
        .from("commercial_items")
        .select("id,commercial_id,menu_item_id,price_override_eur")
        .eq("commercial_id", params.id);
      const itemsArr = (is || []) as Item[];
      setItems(itemsArr);

      if (cd) {
        const { data: menu } = await supabaseBrowser
          .from("menu_items")
          .select("id,name,price,section")
          .eq("restaurant_id", (cd as Commercial).restaurant_id)
          .eq("is_active", true)
          .order("name")
          .limit(1000);
        setAllMenu((menu || []) as MenuItem[]);
        const map: Record<string, MenuItem> = {};
        (menu || []).forEach((m: any) => { map[m.id] = m; });
        setMenuByIdMap(map);
      }
      setLoaded(true);
    })();
  }, [params.id]);

  const dirty = c && (
    (draft.title || "") !== c.title ||
    (draft.description || "") !== (c.description || "") ||
    (draft.type || "") !== c.type ||
    toInputDate(draft.starts_at || null) !== toInputDate(c.starts_at) ||
    toInputDate(draft.ends_at || null) !== toInputDate(c.ends_at) ||
    !!draft.active !== c.active
  );

  const filteredPicker = useMemo(() => {
    const chosen = new Set(items.map((i) => i.menu_item_id));
    const ql = pickerQ.trim().toLowerCase();
    return allMenu.filter((i) => !chosen.has(i.id) && (!ql || i.name.toLowerCase().includes(ql)));
  }, [allMenu, items, pickerQ]);

  async function saveMeta() {
    if (!c) return;
    setBusy(true); setErr(null);
    try {
      const payload: any = {
        title: draft.title || c.title,
        description: draft.description ?? c.description,
        type: draft.type || c.type,
        starts_at: draft.starts_at || null,
        ends_at: draft.ends_at || null,
        active: !!draft.active,
      };
      const { error } = await supabaseBrowser.from("commercials").update(payload).eq("id", c.id);
      if (error) throw error;
      setC({ ...c, ...payload });
    } catch (e: any) { setErr(e?.message || "Save failed"); }
    setBusy(false);
  }

  async function addItem(menu_item_id: string) {
    if (!c) return;
    const { data, error } = await supabaseBrowser
      .from("commercial_items")
      .insert({ commercial_id: c.id, menu_item_id })
      .select("id,commercial_id,menu_item_id,price_override_eur")
      .maybeSingle();
    if (error) { setErr(error.message); return; }
    if (data) setItems([...items, data as Item]);
  }
  async function removeItem(id: string) {
    const { error } = await supabaseBrowser.from("commercial_items").delete().eq("id", id);
    if (error) { setErr(error.message); return; }
    setItems(items.filter((i) => i.id !== id));
  }
  async function setPrice(id: string, val: string) {
    const price = val ? Number(val) : null;
    const clean = Number.isFinite(price as number) && (price as number) > 0 ? price : null;
    const next = items.map((i) => i.id === id ? { ...i, price_override_eur: clean } : i);
    setItems(next);
    const { error } = await supabaseBrowser.from("commercial_items").update({ price_override_eur: clean }).eq("id", id);
    if (error) setErr(error.message);
  }
  async function del() {
    if (!c) return;
    if (!confirm("Delete this commercial?")) return;
    const { error } = await supabaseBrowser.from("commercials").delete().eq("id", c.id);
    if (error) { setErr(error.message); return; }
    router.push("/grow/commercials");
  }

  const lbl = "font-mono text-[10px] uppercase tracking-wide text-clay";
  const inp = "w-full bg-transparent font-sans text-[14px] text-ink placeholder:text-clay outline-none";

  if (!loaded) return <main className="mx-auto max-w-3xl lg:max-w-5xl px-6 py-12"><p className="font-mono text-[11px] text-clay">Loading…</p></main>;
  if (!c) return (
    <main className="mx-auto max-w-3xl lg:max-w-5xl px-6 py-12">
      <Link href="/grow/commercials" className="font-sans text-sm text-ink-soft">← commercials</Link>
      <p className="mt-8 font-serif italic text-[16px] text-clay">Commercial not found.</p>
    </main>
  );

  return (
    <main className="mx-auto max-w-3xl lg:max-w-5xl px-6 py-12">
      <Link href="/grow/commercials" className="font-sans text-sm text-ink-soft">← commercials</Link>

      <div className="mt-6 flex items-baseline justify-between gap-4">
        <div>
          <p className={lbl}>Grow · commercial</p>
          <input value={draft.title || ""} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className="mt-1 w-full bg-transparent font-serif text-4xl leading-tight text-ink outline-none" />
        </div>
        <button onClick={del} className="font-mono text-[10px] uppercase tracking-wide text-clay hover:text-tomato">Delete</button>
      </div>

      <section className="mt-6 border-y border-line divide-y divide-line">
        <div className="flex items-baseline gap-3 py-2.5">
          <span className={lbl + " w-24"}>Type</span>
          <select value={draft.type || c.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })} className={inp + " font-serif text-[14px]"}>
            {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div className="flex items-baseline gap-3 py-2.5">
          <span className={lbl + " w-24"}>Description</span>
          <textarea value={draft.description || ""} onChange={(e) => setDraft({ ...draft, description: e.target.value })} rows={2} className={inp + " resize-none"} />
        </div>
        <div className="flex items-baseline gap-3 py-2.5">
          <span className={lbl + " w-24"}>From</span>
          <input type="date" value={toInputDate(draft.starts_at || null)} onChange={(e) => setDraft({ ...draft, starts_at: e.target.value })} className={inp + " font-mono text-[13px]"} />
          <span className={lbl}>To</span>
          <input type="date" value={toInputDate(draft.ends_at || null)} onChange={(e) => setDraft({ ...draft, ends_at: e.target.value })} className={inp + " font-mono text-[13px]"} />
        </div>
        <div className="flex items-baseline gap-3 py-2.5">
          <span className={lbl + " w-24"}>Status</span>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={!!draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} className="h-4 w-4 accent-tomato" />
            <span className="font-serif text-[14px] text-ink">{draft.active ? "Active" : "Draft"}</span>
          </label>
        </div>
      </section>

      {err ? <p className="mt-3 font-mono text-[11px] text-tomato">⚠ {err}</p> : null}
      {dirty ? (
        <button onClick={saveMeta} disabled={busy} className="mt-4 rounded-xl px-4 py-2.5 font-sans text-[13px] font-medium text-[#F7F7F4]" style={{ background: "var(--accent)" }}>
          {busy ? "Saving…" : "Save changes"}
        </button>
      ) : null}

      {/* Items */}
      <section className="mt-10">
        <div className="flex items-baseline justify-between">
          <p className={lbl}>Items · {items.length}</p>
          <button onClick={() => setPickerOpen(!pickerOpen)} className="font-mono text-[10px] uppercase tracking-wide" style={{ color: "var(--accent)" }}>{pickerOpen ? "Close" : "+ Add item"}</button>
        </div>

        {items.length === 0 ? (
          <p className="mt-3 py-3 font-serif italic text-[13px] text-clay border-y border-line">No items on this offer yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line border-y border-line">
            {items.map((ci) => {
              const mi = menuByIdMap[ci.menu_item_id];
              return (
                <li key={ci.id} className="grid grid-cols-[1fr_auto_auto_auto] items-baseline gap-3 py-2.5">
                  <span>
                    <span className="font-serif text-[15px] text-ink">{mi?.name || "(item)"}</span>
                    {mi?.section ? <span className="ml-2 font-mono text-[10px] uppercase text-clay">{mi.section}</span> : null}
                    {mi?.price != null ? <span className="ml-2 font-mono text-[10px] text-clay">was {eur(mi.price)}</span> : null}
                  </span>
                  <span className="font-mono text-clay">€</span>
                  <input
                    inputMode="decimal"
                    placeholder={mi?.price != null ? mi.price.toString() : "0.00"}
                    defaultValue={ci.price_override_eur != null ? ci.price_override_eur.toString() : ""}
                    onBlur={(e) => setPrice(ci.id, e.target.value)}
                    className="w-24 bg-transparent text-right font-mono text-[13px] text-ink outline-none border-b border-line focus:border-ink"
                  />
                  <button onClick={() => removeItem(ci.id)} className="font-mono text-[10px] uppercase text-clay hover:text-tomato">Remove</button>
                </li>
              );
            })}
          </ul>
        )}

        {pickerOpen ? (
          <div className="mt-4 border-t border-line pt-3">
            <input value={pickerQ} onChange={(e) => setPickerQ(e.target.value)} placeholder="Search menu…" className="w-full border-b border-line bg-transparent py-2 font-sans text-[14px] text-ink outline-none" />
            <ul className="mt-2 max-h-[280px] divide-y divide-line overflow-y-auto">
              {filteredPicker.slice(0, 200).map((i) => (
                <li key={i.id}>
                  <button onClick={() => addItem(i.id)} className="grid w-full grid-cols-[1fr_auto] gap-3 py-2 text-left transition hover:bg-line-soft/40">
                    <span>
                      <span className="font-serif text-[14px] text-ink">{i.name}</span>
                      {i.section ? <span className="ml-2 font-mono text-[10px] uppercase text-clay">{i.section}</span> : null}
                    </span>
                    <span className="font-mono text-[12px] text-clay">{i.price != null ? eur(i.price) : "—"} +</span>
                  </button>
                </li>
              ))}
              {filteredPicker.length === 0 ? <li className="py-3 font-serif italic text-[13px] text-clay">Nothing to add.</li> : null}
            </ul>
          </div>
        ) : null}
      </section>

      {/* Publishes to (info-only for now) */}
      <section className="mt-10 border-t border-line pt-4">
        <p className={lbl}>Publishes to</p>
        <ul className="mt-2 space-y-1 font-serif text-[14px] text-ink-soft">
          <li>· <span className="text-ink">/m</span> — guest menu</li>
          <li>· <span className="text-ink">POS pricing rules</span> — Fresto</li>
          <li>· <span className="text-ink">Grow · Reach</span> — campaign source</li>
        </ul>
        <p className="mt-2 font-serif italic text-[12px] text-clay">Wiring lands with the Reach adapter — for now the surface just says where this goes.</p>
      </section>
    </main>
  );
}
