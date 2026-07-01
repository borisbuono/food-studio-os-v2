import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";

const ALGO = "aes-256-gcm";
function key() {
  const s = process.env.FS_INTEGRATIONS_SECRET;
  if (!s || s.length < 16) throw new Error("FS_INTEGRATIONS_SECRET missing or too short (min 16 chars)");
  return createHash("sha256").update(s).digest();
}

export function encryptSecret(plaintext: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    encrypted_key: enc.toString("base64"),
    key_iv: iv.toString("base64"),
    key_tag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptSecret(rec: { encrypted_key: string; key_iv: string; key_tag: string }) {
  const dec = createDecipheriv(ALGO, key(), Buffer.from(rec.key_iv, "base64"));
  dec.setAuthTag(Buffer.from(rec.key_tag, "base64"));
  const out = Buffer.concat([dec.update(Buffer.from(rec.encrypted_key, "base64")), dec.final()]);
  return out.toString("utf8");
}
