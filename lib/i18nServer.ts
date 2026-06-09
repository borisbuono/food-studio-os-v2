import { cookies } from "next/headers";
export type Lang = "en" | "es";
export function serverLang(): Lang {
  const c = cookies().get("fs_lang")?.value;
  return c === "es" ? "es" : "en";
}
