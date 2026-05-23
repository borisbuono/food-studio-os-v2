import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;

// Public, anon-key client. Reads are governed by Row-Level Security in Supabase.
export const supabase = createClient(url, anon, { auth: { persistSession: false } });
