"use client";
import { useMemo, useState } from "react";

type Lesson = {
  id: string;
  entity_code: string | null;
  title: string;
  body: string | null;
  category: "finance" | "ops" | "menu" | "team" | "pa" | "customer" | "marketing";
  difficulty: number;
  estimated_minutes: number;
  delivered_at: string | null;
  completed_by: string[];
};

const CATEGORIES: Lesson["category"][] = ["finance", "ops", "menu", "team", "pa", "customer", "marketing"];

function fmtDate(s: string | null) {
  if (!s) return "";
  try { return new Date(s).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }); }
  catch { return s; }
}

function DifficultyChip({ n }: { n: number }) {
  const labels = ["", "quick", "medium", "deep"];
  return <span className="font-mono text-[10px] uppercase tracking-wide text-clay">{labels[n] || "quick"}</span>;
}

export default function AcademyBoard({
  todays, rest, me,
}: {
  todays: Lesson | null;
  rest: Lesson[];
  me: string | null;
}) {
  const [items, setItems] = useState<{ todays: Lesson | null; rest: Lesson[] }>({ todays, rest });
  const [category, setCategory] = useState<string>("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (category === "all") return items.rest;
    return items.rest.filter((l) => l.category === category);
  }, [items.rest, category]);

  async function toggleComplete(id: string, completed: boolean) {
    const r = await fetch(`/api/academy?id=${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: completed ? "uncomplete" : "complete" }),
    });
    const d = await r.json();
    if (d.ok && d.lesson) {
      if (items.todays?.id === id) {
        setItems({ ...items, todays: d.lesson });
      } else {
        setItems({ todays: items.todays, rest: items.rest.map((l) => (l.id === id ? d.lesson : l)) });
      }
    }
  }

  function isDone(l: Lesson) {
    return me ? l.completed_by?.includes(me) : false;
  }

  return (
    <div className="mt-8">
      {/* Today's lesson */}
      {items.todays ? (
        <section className="border-t border-line pt-6">
          <p className="font-mono text-[10px] uppercase tracking-wide" style={{ color: "var(--accent)" }}>
            Today · {items.todays.category} · {items.todays.estimated_minutes} min
          </p>
          <h2 className="mt-2 font-serif text-3xl leading-tight text-ink">{items.todays.title}</h2>
          {items.todays.body ? (
            <div className="mt-4 whitespace-pre-wrap font-serif text-[16px] leading-relaxed text-ink">
              {items.todays.body}
            </div>
          ) : null}
          <div className="mt-5 flex flex-wrap gap-2">
            <button
              onClick={() => toggleComplete(items.todays!.id, isDone(items.todays!))}
              className="rounded-full border border-ink px-4 py-1.5 font-mono text-[10px] uppercase tracking-wide text-ink transition hover:bg-ink hover:text-paper"
            >
              {isDone(items.todays) ? "Mark unread" : "Mark completed"}
            </button>
          </div>
        </section>
      ) : (
        <section className="mt-8 border-t border-line py-8 text-center">
          <p className="font-serif italic text-[15px] text-ink-soft">
            No lesson yet — the Academy is quiet.
          </p>
        </section>
      )}

      {/* Category filter */}
      <div className="mt-10 flex flex-wrap gap-2 border-t border-line pt-4">
        <button
          onClick={() => setCategory("all")}
          className={`rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-wide transition ${
            category === "all" ? "border-ink bg-ink text-paper" : "border-line text-ink-soft hover:border-ink-soft"
          }`}
        >
          all
        </button>
        {CATEGORIES.map((c) => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            className={`rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-wide transition ${
              category === c ? "border-ink bg-ink text-paper" : "border-line text-ink-soft hover:border-ink-soft"
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      {/* Library */}
      <section className="mt-4">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Library · {filtered.length}</p>
        {filtered.length === 0 ? (
          <p className="mt-4 border-t border-line py-6 text-center font-serif italic text-[15px] text-ink-soft">
            Nothing under this category yet.
          </p>
        ) : (
          <ul className="mt-3">
            {filtered.map((l) => {
              const done = isDone(l);
              const open = expanded === l.id;
              return (
                <li key={l.id} className="border-t border-line py-4">
                  <button
                    onClick={() => setExpanded(open ? null : l.id)}
                    className="w-full text-left"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[10px] uppercase tracking-wide text-clay">{l.category}</span>
                          <DifficultyChip n={l.difficulty} />
                          {l.delivered_at ? <span className="font-mono text-[10px] text-clay">{fmtDate(l.delivered_at)}</span> : null}
                        </div>
                        <p className={`mt-1 font-serif text-[17px] ${done ? "text-ink-soft italic" : "text-ink"}`}>{l.title}</p>
                      </div>
                      {done ? <span className="font-mono text-[10px] uppercase tracking-wide text-basil">done</span> : null}
                    </div>
                  </button>
                  {open ? (
                    <div className="mt-3">
                      {l.body ? (
                        <div className="whitespace-pre-wrap font-serif text-[15px] leading-relaxed text-ink">{l.body}</div>
                      ) : null}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          onClick={() => toggleComplete(l.id, done)}
                          className="rounded-full border border-line px-3 py-1 font-mono text-[10px] uppercase tracking-wide text-ink-soft transition hover:border-ink hover:text-ink"
                        >
                          {done ? "Mark unread" : "Mark completed"}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
