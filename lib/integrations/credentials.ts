import { supabaseServer } from "@/lib/supabaseServer";
import { decryptSecret } from "@/lib/integrations/vault";
import type { EntityCode } from "@/lib/integrations/types";

const ENV_FALLBACK: Record<string, Record<EntityCode, string | undefined>> = {
  holded: {
    IFL: process.env.HOLDED_API_KEY_TALLER,
    BM:  process.env.HOLDED_API_KEY_BISTRO_MONDO,
    BBH: process.env.HOLDED_API_KEY_HOLDINGS,
  },
};

// Cache within a single serverless invocation
const cache = new Map<string, string | null>();

export async function getEntityCredential(entity: EntityCode, vendor: string): Promise<string | null> {
  const cacheKey = `${entity}:${vendor}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey)!;
  const sb = supabaseServer();

  // DB path — entity_integrations, active rows only
  const { data } = await sb.from("entity_integrations")
    .select("encrypted_key,key_iv,key_tag")
    .eq("entity_code", entity)
    .eq("platform", vendor)
    .is("revoked_at", null)
    .not("encrypted_key", "is", null)
    .order("rotated_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (data?.encrypted_key && data.key_iv && data.key_tag) {
    try {
      const plain = decryptSecret({ encrypted_key: data.encrypted_key, key_iv: data.key_iv, key_tag: data.key_tag });
      cache.set(cacheKey, plain);
      return plain;
    } catch (e) {
      console.error(`[credentials] decrypt failed for ${entity}/${vendor}:`, (e as any)?.message);
    }
  }

  // Env fallback for the transitional period
  const fromEnv = ENV_FALLBACK[vendor]?.[entity] || null;
  cache.set(cacheKey, fromEnv);
  return fromEnv;
}
