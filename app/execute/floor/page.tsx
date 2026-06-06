"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { supabaseBrowser as supabase } from "@/lib/supabaseBrowser";
import { readEntityCookie } from "@/lib/ctx";
import { ENTITY_TO_RESTAURANT, EntityKey } from "@/lib/entities";

export const dynamic = "force-dynamic";

type Zone = { id: string; name: string; sort: number };
type Tbl = { id: string; label: string; seats: number; shape: string; x: number; y: number; w: number; h: number; zone_id: string | null };
type Booking = { id: string; guest_name: string | null; party_size: number; service_time: string | null; table_id: string | null; status: string };

const VB = { w: 1000, h: 680 };
const todayISO = () => new Date().toISOString().slice(0, 10);

export default function FloorPlan() {
  const [rid, setRid] = useState<string | null>(null);
  const [zones, setZones] = useState<Zone[]>([]);
  const [tables, setTables] = useState<Tbl[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);

  useEffect(() => {
    const ent = (readEntityCookie() || "utopia") as EntityKey;
    const r = ENTITY_TO_RESTAURANT[ent] || ENTITY_TO_RESTAURANT.utopia!;
    setRid(r);
  }, []);

  useEffect(() => {
    if (!rid) return;
    (async () => {
      setLoading(true);
      const z = await supabase.from("floor_zones").select("*").eq("restaurant_id", rid).order("sort");
      if (z.error) { setMissing(true); setLoading(false); return; }
      const t = await supabase.from("dining_tables").select("*").eq("restaurant_id", rid);
      const b = await supabase.from("bookings").select("*").eq("restaurant_id", rid).eq("service_date", todayISO());
      setZones((z.data as Zone[]) || []);
      setTables((t.data as Tbl[]) || []);
      setBookings((b.data as Booking[]) || []);
      setLoading(false);
    })();
  }, [rid]);

  const occupied = useMemo(() => {
    const m: Record<string, Booking> = {};
    bookings.forEach((b) => { if (b.table_id && b.status !== "cancelled") m[b.table_id] = b; });
    return m;
  }, [bookings]);

  function toCanvas(e: React.PointerEvent) {
    const svg = svgRef.current!;
    const r = svg.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  }
  function onDown(e: React.PointerEvent, t: Tbl) {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = toCanvas(e);
    drag.current = { id: t.id, dx: p.x - t.x, dy: p.y - t.y };
    setSel(t.id);
  }
  function onMove(e: React.PointerEvent) {
    if (!drag.current) return;
    const p = toCanvas(e);
    const { id, dx, dy } = drag.current;
    setTables((prev) => prev.map((t) => t.id === id
      ? { ...t, x: Math.min(0.97, Math.max(0.03, p.x - dx)), y: Math.min(0.96, Math.max(0.04, p.y - dy)) }
      : t));
    setDirty((d) => ({ ...d, [id]: true }));
  }
  function onUp() { drag.current = null; }

  async function addTable() {
    if (!rid) return;
    const n = tables.length + 1;
    const row = { restaurant_id: rid, label: "T" + n, seats: 2, shape: "round", x: 0.5, y: 0.5, w: 0.07, h: 0.07, zone_id: zones[0]?.id ?? null };
    const ins = await supabase.from("dining_tables").insert(row).select().single();
    if (ins.data) setTables((p) => [...p, ins.data as Tbl]);
  }
  async function saveLayout() {
    setSaving(true);
    const ids = Object.keys(dirty);
    for (const id of ids) {
      const t = tables.find((x) => x.id === id);
      if (!t) continue;
      await supabase.from("dining_tables").update({ x: t.x, y: t.y, updated_at: new Date().toISOString() }).eq("id", id);
    }
    setDirty({});
    setSaving(false);
  }

  const selected = tables.find((t) => t.id === sel) || null;
  const unassigned = bookings.filter((b) => !b.table_id && b.status !== "cancelled");
  const dirtyCount = Object.keys(dirty).length;

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Link href="/" className="font-sans text-sm text-ink-soft">← home</Link>
      <p className="mt-6 font-sans text-xs font-medium text-basil">Bookings · the floor</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">Floor plan</h1>

      {missing ? (
        <p className="mt-6 font-sans text-[15px] leading-relaxed text-ink-soft">
          The floor tables aren’t set up yet. Apply <span className="font-mono text-[13px]">db/migrations/20260607_floor_bookings.sql</span> (Supabase) and reload — zones, tables, bookings and integrations land here.
        </p>
      ) : loading ? (
        <p className="mt-6 font-sans text-[15px] text-ink-soft">Loading the room…</p>
      ) : (
        <>
          <div className="mt-5 flex items-center gap-3">
            <button onClick={addTable} className="rounded-full border border-line px-4 py-1.5 font-sans text-sm text-ink hover:bg-paper-deep">+ Add table</button>
            <button onClick={saveLayout} disabled={!dirtyCount || saving}
              className="rounded-full px-4 py-1.5 font-sans text-sm text-white disabled:opacity-40"
              style={{ background: "var(--accent)" }}>
              {saving ? "Saving…" : dirtyCount ? `Save layout (${dirtyCount})` : "Saved"}
            </button>
            <span className="font-mono text-xs text-clay">{tables.length} tables · {bookings.length} booked tonight</span>
          </div>

          <svg ref={svgRef} viewBox={`0 0 ${VB.w} ${VB.h}`} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}
            className="mt-4 w-full touch-none rounded-lg border border-line bg-paper" style={{ aspectRatio: `${VB.w}/${VB.h}` }}>
            {Array.from({ length: 11 }).map((_, i) => (
              <line key={"v" + i} x1={(i * VB.w) / 10} y1={0} x2={(i * VB.w) / 10} y2={VB.h} stroke="#D9D9D6" strokeWidth={0.5} />
            ))}
            {Array.from({ length: 8 }).map((_, i) => (
              <line key={"h" + i} x1={0} y1={(i * VB.h) / 7} x2={VB.w} y2={(i * VB.h) / 7} stroke="#D9D9D6" strokeWidth={0.5} />
            ))}
            {tables.map((t) => {
              const cx = t.x * VB.w, cy = t.y * VB.h, rad = (t.w * VB.w) / 2;
              const occ = occupied[t.id];
              const fill = occ ? "#9A3122" : "#3E5A37";
              const isSel = t.id === sel;
              return (
                <g key={t.id} onPointerDown={(e) => onDown(e, t)} style={{ cursor: "grab" }}>
                  {t.shape === "round" ? (
                    <circle cx={cx} cy={cy} r={rad} fill={fill} opacity={0.92} stroke={isSel ? "#171511" : "none"} strokeWidth={2} />
                  ) : (
                    <rect x={cx - rad} y={cy - rad} width={rad * 2} height={rad * 2} rx={8} fill={fill} opacity={0.92} stroke={isSel ? "#171511" : "none"} strokeWidth={2} />
                  )}
                  <text x={cx} y={cy + 4} textAnchor="middle" fontSize={15} fill="#F2ECDE" fontFamily="DM Mono, monospace">{t.label}</text>
                </g>
              );
            })}
          </svg>

          {selected && (
            <div className="mt-4 rounded-lg border border-line p-4">
              <p className="font-sans text-sm text-ink">{selected.label} · {selected.seats} seats · {selected.shape}
                {occupied[selected.id] ? ` · ${occupied[selected.id].guest_name || "Guest"} ${occupied[selected.id].service_time || ""}` : " · free"}</p>
            </div>
          )}

          <h2 className="mt-8 font-serif text-xl text-ink">Tonight</h2>
          {bookings.length === 0 ? (
            <p className="mt-2 font-sans text-[15px] text-ink-soft">No bookings for tonight yet. Once Fresto is connected (Day 6 adapter), the book fills here and seats map onto the plan.</p>
          ) : (
            <ul className="mt-3 divide-y divide-line border-t border-line">
              {bookings.map((b) => (
                <li key={b.id} className="flex justify-between py-2 font-sans text-[15px] text-ink">
                  <span>{b.guest_name || "Guest"} · {b.party_size}p {b.service_time || ""}</span>
                  <span className="font-mono text-xs text-clay">{b.table_id ? "seated" : "unassigned"}</span>
                </li>
              ))}
            </ul>
          )}
          {unassigned.length > 0 && (
            <p className="mt-3 font-sans text-xs text-ember">{unassigned.length} booking(s) not yet on a table.</p>
          )}
        </>
      )}
    </main>
  );
}
