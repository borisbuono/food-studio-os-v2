"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { getMyProfile, MyProfile } from "@/lib/profile";
import { ENTITY_TO_RESTAURANT, EntityKey } from "@/lib/entities";
import { dictateOnce, speechSupported, haptic, HAPTIC, useSpeech } from "@/lib/calmtech";

type Equip = { key: string; name: string; type: string; min: number; max: number | null };
const EQUIP: Equip[] = [
  { key: "walkin", name: "Walk-in fridge", type: "refrigeration", min: 0, max: 4 },
  { key: "fridge", name: "Fridge", type: "refrigeration", min: 0, max: 5 },
  { key: "freezer", name: "Freezer", type: "freezer", min: -25, max: -18 },
  { key: "hot", name: "Hot hold", type: "hot_holding", min: 63, max: null },
  { key: "core", name: "Cooked / core", type: "cooking", min: 75, max: null },
];

const WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

function parseSpoken(raw: string): { temp: number | null; equipKey: string | null } {
  const t = raw.toLowerCase();
  let equipKey: string | null = null;
  if (/walk|walkin|walk-in/.test(t)) equipKey = "walkin";
  else if (/freez/.test(t)) equipKey = "freezer";
  else if (/hot|hold|bain|pass/.test(t)) equipKey = "hot";
  else if (/core|cook|center|centre|probe/.test(t)) equipKey = "core";
  else if (/fridge|chiller|cold/.test(t)) equipKey = "fridge";

  const neg = /minus|negative|below zero|below freezing|-/.test(t);
  let temp: number | null = null;
  const digits = t.match(/-?\d+(\.\d+)?/);
  if (digits) {
    temp = parseFloat(digits[0]);
  } else {
    // word numbers: combine tens + units (e.g. "sixty three")
    let total = 0, found = false, pendingTens = 0;
    for (const w of t.replace(/-/g, " ").split(/\s+/)) {
      if (w in WORDS) {
        const v = WORDS[w];
        found = true;
        if (v >= 20 && v % 10 === 0) pendingTens = v;
        else { total += pendingTens + v; pendingTens = 0; }
      }
    }
    if (pendingTens) { total += pendingTens; }
    if (found) temp = total;
  }
  if (temp !== null && neg && temp > 0) temp = -temp;
  return { temp, equipKey };
}

const inRange = (e: Equip, t: number) => t >= e.min && (e.max === null || t <= e.max);
const todayStartISO = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); };

type Logged = { equipment_name: string; temperature_c: number; is_within_range: boolean | null; measured_at: string };

export default function TempLog() {
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [rid, setRid] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [equipKey, setEquipKey] = useState<string | null>(null);
  const [temp, setTemp] = useState<string>("");
  const [corrective, setCorrective] = useState("");
  const [transcript, setTranscript] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [logs, setLogs] = useState<Logged[]>([]);

  const { speak } = useSpeech();
  const equip = useMemo(() => EQUIP.find((e) => e.key === equipKey) || null, [equipKey]);
  const tempNum = temp.trim() === "" || isNaN(Number(temp)) ? null : Number(temp);
  const ok = equip && tempNum !== null ? inRange(equip, tempNum) : null;

  const loadLogs = async (restaurant: string) => {
    const { data } = await supabaseBrowser
      .from("haccp_temperature_logs")
      .select("equipment_name,temperature_c,is_within_range,measured_at")
      .eq("restaurant_id", restaurant)
      .gte("measured_at", todayStartISO())
      .order("measured_at", { ascending: false });
    setLogs((data as Logged[]) || []);
  };

  useEffect(() => {
    (async () => {
      const p = await getMyProfile();
      setProfile(p);
      const ent = (p && !p.isAdmin ? p.entity : ((localStorage.getItem("fs_entity") as EntityKey) || "utopia")) || "utopia";
      const restaurant = p?.restaurantId || ENTITY_TO_RESTAURANT[ent] || ENTITY_TO_RESTAURANT.utopia!;
      setRid(restaurant);
      await loadLogs(restaurant);
      setReady(true);
    })();
  }, []);

  const listen = async () => {
    setErr(null);
    setListening(true);
    haptic(HAPTIC.tap);
    try {
      const said = await dictateOnce();
      setTranscript(said);
      const { temp: tp, equipKey: ek } = parseSpoken(said);
      if (ek) setEquipKey(ek);
      if (tp !== null) setTemp(String(tp));
      if (tp === null) setErr("Didn't catch a number — say e.g. “walk-in fridge three degrees”, or type it.");
    } catch (e: any) {
      const m = e?.message || "";
      setErr(m === "speech-unsupported" ? "Voice isn't available on this device — type the temperature." : "Didn't hear that — tap and try again, or type it.");
    } finally {
      setListening(false);
    }
  };

  const save = async () => {
    if (!equip || tempNum === null || !rid) return;
    if (!profile) { setErr("Sign in to log a temperature."); return; }
    setSaving(true);
    setErr(null);
    const within = inRange(equip, tempNum);
    const { error } = await supabaseBrowser.from("haccp_temperature_logs").insert({
      restaurant_id: rid,
      equipment_name: equip.name,
      equipment_type: equip.type,
      temperature_c: tempNum,
      target_min_c: equip.min,
      target_max_c: equip.max,
      is_within_range: within,
      measured_by: profile.id,
      measured_at: new Date().toISOString(),
      corrective_action: within ? null : (corrective.trim() || null),
      notes: transcript ? `voice: "${transcript}"` : null,
    });
    if (error) {
      setErr("Couldn't save — " + error.message);
      setSaving(false);
      return;
    }
    haptic(within ? HAPTIC.confirm : HAPTIC.done);
    speak(`Logged. ${equip.name}, ${tempNum} degrees, ${within ? "within range" : "out of range"}.`);
    setTemp("");
    setCorrective("");
    setTranscript(null);
    await loadLogs(rid);
    setSaving(false);
  };

  const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

  if (!ready) return <main className="mx-auto max-w-xl px-6 py-12"><p className="font-serif text-2xl text-ink">Opening the log…</p></main>;

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/" className="font-sans text-sm text-ink-soft">← home</Link>
      <p className="mt-6 font-sans text-xs font-medium text-basil">Execute · Kitchen</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">Temperatures</h1>
      <p className="mt-1 font-sans text-[14px] text-ink-soft">Say it, glance, confirm. Hands can stay where they are.</p>

      {/* Capture card */}
      <div className="mt-7 rounded-2xl border border-black/10 bg-card p-6">
        {speechSupported() ? (
          <button onClick={listen} disabled={listening}
            className="w-full rounded-2xl bg-ember py-5 font-serif text-[20px] text-[#F7F7F4] transition active:scale-[0.99] disabled:opacity-60">
            {listening ? "Listening…" : "Speak the temperature"}
          </button>
        ) : (
          <p className="rounded-xl bg-paper-deep px-4 py-3 font-sans text-[13px] text-ink-soft">Voice isn't available on this device — pick the equipment and type the temperature below.</p>
        )}
        {transcript && <p className="mt-3 font-mono text-[11px] text-clay">heard: &ldquo;{transcript}&rdquo;</p>}

        {/* Equipment */}
        <p className="mt-6 font-mono text-[11px] uppercase tracking-[0.18em] text-basil">Equipment</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {EQUIP.map((e) => (
            <button key={e.key} onClick={() => { setEquipKey(e.key); haptic(HAPTIC.tap); }}
              className={"rounded-full border px-4 h-11 font-sans text-[14px] transition " + (equipKey === e.key ? "border-ember bg-ember/10 text-ink" : "border-black/15 text-ink-soft")}>
              {e.name}
            </button>
          ))}
        </div>

        {/* Temp input */}
        <p className="mt-6 font-mono text-[11px] uppercase tracking-[0.18em] text-basil">Reading</p>
        <div className="mt-2 flex items-center gap-3">
          <input value={temp} onChange={(e) => setTemp(e.target.value)} inputMode="numeric" placeholder="—"
            className="w-32 rounded-xl border border-black/15 bg-paper px-4 py-3 font-serif text-2xl text-ink outline-none focus:border-ember/50" />
          <span className="font-serif text-2xl text-ink-soft">°C</span>
        </div>

        {/* Range read */}
        {equip && tempNum !== null && (
          <div className={"mt-4 rounded-xl px-4 py-3 font-sans text-[14px] " + (ok ? "bg-basil/10 text-basil" : "bg-tomato/10 text-tomato")}>
            {ok
              ? `Within range — target ${equip.min}${equip.max === null ? "°C or above" : `–${equip.max}°C`}.`
              : `Out of range — target ${equip.min}${equip.max === null ? "°C or above" : `–${equip.max}°C`}. Note a corrective action.`}
          </div>
        )}
        {equip && tempNum !== null && !ok && (
          <input value={corrective} onChange={(e) => setCorrective(e.target.value)} placeholder="Corrective action (e.g. moved stock, called engineer)"
            className="mt-3 w-full rounded-xl border border-tomato/30 bg-paper px-4 py-3 font-sans text-[14px] text-ink outline-none" />
        )}

        {err && <p className="mt-3 font-sans text-[13px] text-tomato">{err}</p>}

        <button onClick={save} disabled={!equip || tempNum === null || saving}
          className="mt-5 w-full rounded-2xl border border-ink/20 py-4 font-serif text-[17px] text-ink transition hover:border-ink/40 disabled:opacity-30">
          {saving ? "Logging…" : "Confirm & log"}
        </button>
        {!profile && <p className="mt-2 text-center font-mono text-[10px] uppercase tracking-wide text-clay">Sign in to record to the HACCP book</p>}
      </div>

      {/* Today's log */}
      <p className="mt-9 font-mono text-[11px] uppercase tracking-[0.18em] text-basil">Logged today · {logs.length}</p>
      <div className="mt-2 divide-y divide-black/10 overflow-hidden rounded-2xl border border-black/10 bg-card">
        {logs.length === 0 && <p className="px-5 py-4 font-sans text-[14px] text-ink-soft">Nothing logged yet today.</p>}
        {logs.map((l, k) => (
          <div key={k} className="flex items-center justify-between px-5 py-3">
            <div>
              <p className="font-serif text-[17px] text-ink">{l.equipment_name}</p>
              <p className="font-mono text-[10px] uppercase tracking-wide text-clay">{fmtTime(l.measured_at)}</p>
            </div>
            <div className="text-right">
              <p className="font-serif text-[19px] text-ink">{l.temperature_c}°C</p>
              <p className={"font-mono text-[10px] uppercase tracking-wide " + (l.is_within_range ? "text-basil" : "text-tomato")}>{l.is_within_range ? "in range" : "out of range"}</p>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
