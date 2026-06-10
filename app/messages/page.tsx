"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { getMyProfile, MyProfile } from "@/lib/profile";
import { ENTITY_TO_RESTAURANT, EntityKey } from "@/lib/entities";
import { noEmoji } from "@/lib/text";

type Channel = { id: string; kind: string; name: string; section: string | null; restaurant_id: string | null };
type Msg = { id: string; author_id: string | null; author_name: string | null; body: string; created_at: string };
type Person = { id: string; name: string; role: string | null };

const when = (t: string) => { const d = new Date(t); const today = new Date(); const sameDay = d.toDateString() === today.toDateString(); return sameDay ? d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + " " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }); };

export default function Messages() {
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [rid, setRid] = useState("");
  const [channels, setChannels] = useState<Channel[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [active, setActive] = useState<Channel | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [sendErr, setSendErr] = useState("");
  const [ready, setReady] = useState(false);
  const [newCh, setNewCh] = useState(false);
  const [newChName, setNewChName] = useState("");
  const [dmPick, setDmPick] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const loadChannels = async (p: MyProfile, r: string) => {
    // venue + section + custom channels for this venue
    const { data: vc } = await supabaseBrowser.from("channels").select("id,kind,name,section,restaurant_id").eq("restaurant_id", r).order("kind");
    // my DM channels
    const { data: mem } = await supabaseBrowser.from("channel_members").select("channel_id").eq("profile_id", p.id);
    const dmIds = (mem || []).map((m: any) => m.channel_id);
    let dms: Channel[] = [];
    if (dmIds.length) { const { data: dc } = await supabaseBrowser.from("channels").select("id,kind,name,section,restaurant_id").in("id", dmIds).eq("kind", "dm"); dms = (dc || []) as Channel[]; }
    setChannels([...((vc || []) as Channel[]), ...dms]);
  };

  useEffect(() => {
    (async () => {
      const p = await getMyProfile(); setProfile(p);
      if (!p) { setReady(true); return; }
      const ent = (!p.isAdmin ? p.entity : ((localStorage.getItem("fs_entity") as EntityKey) || "utopia")) || "utopia";
      const r = p.restaurantId || ENTITY_TO_RESTAURANT[ent as EntityKey] || ENTITY_TO_RESTAURANT.utopia!;
      setRid(r);
      await loadChannels(p, r);
      const { data: ppl } = await supabaseBrowser.from("profiles").select("id,name,role");
      setPeople(((ppl || []) as Person[]).filter((x) => x.id !== p.id));
      setReady(true);
    })();
  }, []);

  const open = async (c: Channel) => {
    setActive(c);
    const { data } = await supabaseBrowser.from("messages").select("id,author_id,author_name,body,created_at").eq("channel_id", c.id).order("created_at");
    setMsgs((data || []) as Msg[]);
    setTimeout(() => endRef.current?.scrollIntoView(), 80);
  };
  const send = async () => {
    const b = text.trim(); if (!b || !active || !profile) return;
    setText(""); setSendErr("");
    const optimistic = { id: "tmp" + Date.now(), author_id: profile.id, author_name: profile.name, body: b, created_at: new Date().toISOString() };
    setMsgs((m) => [...m, optimistic]);
    setTimeout(() => endRef.current?.scrollIntoView(), 40);
    const { error } = await supabaseBrowser.from("messages").insert({ channel_id: active.id, author_id: profile.id, author_name: profile.name, body: b });
    if (error) { setSendErr("Couldn’t send — sign in to post to the team."); setMsgs((m) => m.filter((x) => x.id !== optimistic.id)); setText(b); return; }
    const { data } = await supabaseBrowser.from("messages").select("id,author_id,author_name,body,created_at").eq("channel_id", active.id).order("created_at");
    setMsgs((data || []) as Msg[]);
  };
  const createChannel = async () => {
    const n = newChName.trim(); if (!n || !profile) return;
    const { data } = await supabaseBrowser.from("channels").insert({ restaurant_id: rid, kind: "custom", name: n, created_by: profile.id }).select("id,kind,name,section,restaurant_id").maybeSingle();
    setNewCh(false); setNewChName("");
    if (data) { await loadChannels(profile, rid); open(data as Channel); }
  };
  const startDm = async (person: Person) => {
    if (!profile) return;
    setDmPick(false);
    // find existing dm with this person
    const { data: myMem } = await supabaseBrowser.from("channel_members").select("channel_id").eq("profile_id", profile.id);
    const myIds = (myMem || []).map((m: any) => m.channel_id);
    let found: string | null = null;
    if (myIds.length) {
      const { data: theirs } = await supabaseBrowser.from("channel_members").select("channel_id").eq("profile_id", person.id).in("channel_id", myIds);
      const dmCandidate = (theirs || [])[0]?.channel_id;
      if (dmCandidate) { const { data: ch } = await supabaseBrowser.from("channels").select("id,kind").eq("id", dmCandidate).eq("kind", "dm").maybeSingle(); if (ch) found = ch.id; }
    }
    if (!found) {
      const { data: ch } = await supabaseBrowser.from("channels").insert({ restaurant_id: rid, kind: "dm", name: person.name, created_by: profile.id }).select("id").maybeSingle();
      found = ch?.id || null;
      if (found) { await supabaseBrowser.from("channel_members").insert([{ channel_id: found, profile_id: profile.id }, { channel_id: found, profile_id: person.id }]); }
    }
    if (found && profile) { await loadChannels(profile, rid); const c = { id: found, kind: "dm", name: person.name, section: null, restaurant_id: rid } as Channel; open(c); }
  };

  if (!ready) return <main className="mx-auto max-w-xl px-6 py-12"><p className="font-serif text-2xl text-ink">Opening messages…</p></main>;
  if (!profile) return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/" className="font-sans text-sm text-ink-soft">← home</Link>
      <h1 className="mt-6 font-serif text-3xl text-ink">Messages</h1>
      <p className="mt-3 font-serif text-[17px] leading-relaxed text-ink-soft">Sign in to talk with the team — channels and direct messages, all in the OS.</p>
      <Link href="/login" className="mt-6 inline-block rounded-xl px-5 py-3 font-sans text-[14px] font-medium text-[#F7F7F4]" style={{ background: "var(--accent)" }}>Sign in</Link>
    </main>
  );

  const venueChs = channels.filter((c) => c.kind !== "dm");
  const dmChs = channels.filter((c) => c.kind === "dm");

  if (active) {
    return (
      <main className="mx-auto flex h-[calc(100vh-64px)] max-w-xl flex-col px-6 py-4">
        <button onClick={() => setActive(null)} className="font-sans text-sm text-ink-soft">← channels</button>
        <p className="mt-2 font-serif text-2xl text-ink">{active.kind === "dm" ? noEmoji(active.name) : "#" + noEmoji(active.name)}</p>
        <div className="mt-3 flex-1 space-y-3 overflow-y-auto pb-4">
          {msgs.map((m) => {
            const mine = m.author_id === profile.id;
            return (
              <div key={m.id} className={"flex " + (mine ? "justify-end" : "justify-start")}>
                <div className={"max-w-[80%] rounded-2xl px-4 py-2 " + (mine ? "text-[#F7F7F4]" : "border border-black/10 bg-card text-ink")} style={mine ? { background: "var(--accent)" } : undefined}>
                  {!mine ? <p className="font-mono text-[10px] uppercase tracking-wide text-clay">{m.author_name || "someone"}</p> : null}
                  <p className="font-serif text-[16px] leading-relaxed">{m.body}</p>
                  <p className={"mt-0.5 font-mono text-[9px] " + (mine ? "text-white/70" : "text-clay")}>{when(m.created_at)}</p>
                </div>
              </div>
            );
          })}
          {!msgs.length ? <p className="font-sans text-[14px] text-clay">No messages yet — say something.</p> : null}
          <div ref={endRef} />
        </div>
        {sendErr ? <p className="pb-2 text-center font-mono text-[10px] uppercase tracking-wide text-ink-soft">{sendErr}</p> : null}
        <div className="flex items-center gap-2 border-t border-black/10 pt-3">
          <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") send(); }} placeholder="Message…" className="flex-1 rounded-full border border-black/15 bg-paper px-4 py-2.5 font-sans text-[15px] text-ink outline-none focus:border-ink" />
          <button onClick={send} className="rounded-full px-5 py-2.5 font-sans text-[14px] font-medium text-[#F7F7F4]" style={{ background: "var(--accent)" }}>Send</button>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-xl px-6 py-10">
      <Link href="/" className="font-sans text-sm text-ink-soft">← home</Link>
      <p className="mt-5 font-sans text-xs font-medium" style={{ color: "var(--accent)" }}>Messages · the team</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">Channels</h1>

      <div className="mt-5 flex gap-3">
        <button onClick={() => { setNewCh(!newCh); setDmPick(false); }} className="rounded-full border border-black/15 px-4 py-1.5 font-sans text-[13px] text-ink-soft">+ New channel</button>
        <button onClick={() => { setDmPick(!dmPick); setNewCh(false); }} className="rounded-full border border-black/15 px-4 py-1.5 font-sans text-[13px] text-ink-soft">+ Direct message</button>
      </div>
      {newCh ? (
        <div className="mt-3 flex gap-2">
          <input value={newChName} onChange={(e) => setNewChName(e.target.value)} placeholder="Channel name (e.g. Events, Pastry)" className="flex-1 rounded-lg border border-black/15 bg-paper px-3 py-2 font-sans text-[14px] text-ink outline-none focus:border-ink" />
          <button onClick={createChannel} className="rounded-lg px-4 py-2 font-sans text-[13px] font-medium text-[#F7F7F4]" style={{ background: "var(--accent)" }}>Create</button>
        </div>
      ) : null}
      {dmPick ? (
        <div className="mt-3 rounded-xl border border-black/10 bg-card p-2">
          {people.length ? people.map((pp) => <button key={pp.id} onClick={() => startDm(pp)} className="block w-full rounded-lg px-3 py-2 text-left font-sans text-[14px] text-ink transition hover:bg-paper">{noEmoji(pp.name)}{pp.role ? " · " + pp.role : ""}</button>) : <p className="px-3 py-2 font-sans text-[13px] text-clay">No teammates signed up yet — they appear here once onboarded.</p>}
        </div>
      ) : null}

      <ul className="mt-6 divide-y divide-black/10 border-t border-black/10">
        {venueChs.map((c) => (
          <li key={c.id}><button onClick={() => open(c)} className="flex w-full items-baseline justify-between gap-3 py-3 text-left transition hover:opacity-70"><span className="font-serif text-[17px] text-ink">#{noEmoji(c.name)}</span><span className="font-mono text-[10px] uppercase tracking-wide text-clay">{c.kind === "section" ? c.section : c.kind}</span></button></li>
        ))}
      </ul>
      {dmChs.length ? (
        <>
          <p className="mt-7 font-mono text-[11px] uppercase tracking-[0.18em] text-clay">Direct</p>
          <ul className="mt-2 divide-y divide-black/10 border-t border-black/10">
            {dmChs.map((c) => <li key={c.id}><button onClick={() => open(c)} className="flex w-full items-baseline justify-between py-3 text-left transition hover:opacity-70"><span className="font-serif text-[17px] text-ink">{noEmoji(c.name)}</span><span className="font-mono text-[10px] uppercase tracking-wide text-clay">dm</span></button></li>)}
          </ul>
        </>
      ) : null}
      <p className="mt-7 font-mono text-[11px] uppercase tracking-[0.18em] text-clay">People</p>
      <ul className="mt-2 divide-y divide-black/10 border-t border-black/10">
        {people.length ? people.map((pp) => (
          <li key={pp.id} className="flex items-center justify-between gap-3 py-3">
            <span><span className="font-serif text-[16px] text-ink">{noEmoji(pp.name)}</span>{pp.role ? <span className="ml-2 font-mono text-[10px] uppercase tracking-wide text-clay">{pp.role}</span> : null}</span>
            <button onClick={() => startDm(pp)} className="rounded-full border border-black/15 px-3 py-1 font-sans text-[12px] text-ink-soft transition hover:border-ink/40">Message</button>
          </li>
        )) : <li className="py-3 font-sans text-[14px] text-clay">No teammates signed up yet — they appear here once onboarded.</li>}
      </ul>

    </main>
  );
}
