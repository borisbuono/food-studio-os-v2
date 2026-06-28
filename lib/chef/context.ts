import { supabaseServer } from "@/lib/supabaseServer";

export type ChefTurn = { role: "user" | "assistant"; text: string };
export type ChefMemoryFact = { fact: string; scope?: string };

const HISTORY_TURNS = 10;
const MEMORY_FACTS = 20;
const FEWSHOT_PAIRS = 20;

export async function loadChefContext(opts: { sessionId?: string }) {
  const sb = supabaseServer();
  const { data: user } = await sb.auth.getUser();
  const uid = user.user?.id;
  if (!uid) return { uid: null, history: [] as ChefTurn[], memory: [] as ChefMemoryFact[], fewshot: [] as { text: string; intent: string }[] };

  // Recent turns for the current session (if any) — fallback to the latest N turns user-wide
  const baseQ = sb.from("chef_conversations").select("turn_role,text,created_at").eq("user_id", uid).order("created_at", { ascending: false }).limit(HISTORY_TURNS * 2);
  const { data: turns } = opts.sessionId
    ? await sb.from("chef_conversations").select("turn_role,text,created_at").eq("user_id", uid).eq("session_id", opts.sessionId).order("created_at", { ascending: false }).limit(HISTORY_TURNS * 2)
    : await baseQ;
  const history: ChefTurn[] = (turns || []).slice().reverse().filter((t: any) => t.turn_role !== "sys" && t.text).map((t: any) => ({ role: t.turn_role as any, text: t.text }));

  const { data: memrows } = await sb.from("chef_memory").select("fact,scope").eq("user_id", uid).is("retired_at", null).order("confirmed_at", { ascending: false }).limit(MEMORY_FACTS);
  const memory: ChefMemoryFact[] = (memrows || []).map((m: any) => ({ fact: m.fact, scope: m.scope }));

  const { data: pairs } = await sb.from("intent_classifications").select("text,confirmed_intent").eq("user_id", uid).not("confirmed_intent", "is", null).order("created_at", { ascending: false }).limit(FEWSHOT_PAIRS);
  const fewshot = (pairs || []).map((p: any) => ({ text: p.text, intent: p.confirmed_intent }));

  return { uid, history, memory, fewshot };
}

export async function writeTurn(uid: string, fields: { entity_id?: string | null; route?: string | null; session_id?: string | null; turn_role: "user" | "assistant" | "sys"; text: string; intent?: string | null; confidence?: number | null; did_action?: any }) {
  const sb = supabaseServer();
  const { data } = await sb.from("chef_conversations").insert({ user_id: uid, ...fields }).select("id").maybeSingle();
  return data?.id as string | undefined;
}
