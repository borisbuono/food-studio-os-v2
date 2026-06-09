"use client";
// Two-language scaffold. Boris locked 2026-06-09: each profile picks EN or ES.
// Keys are stable strings; languages are values. Missing translations fall back to EN.

export type Lang = "en" | "es";

const dict: Record<string, Record<Lang, string>> = {
  // — nav / wordmark
  "home.greeting": { en: "Hello", es: "Hola" },
  "home.brief": { en: "Your brief", es: "Tu pase" },
  "home.dashboard": { en: "Your dashboard", es: "Tu cuadro" },
  "home.academy": { en: "Your academy", es: "Tu academia" },
  "home.messages": { en: "Messages", es: "Mensajes" },
  "home.messages.blurb": { en: "The team — channels and direct messages, in the OS.", es: "El equipo — canales y mensajes directos, dentro del OS." },
  "home.receive": { en: "Receive a delivery", es: "Recibir una entrega" },
  "home.receive.blurb": { en: "Photograph the delivery note — costs, stock and the supplier all update automatically.", es: "Fotografía el albarán — costes, stock y proveedor se actualizan solos." },

  // — brief rows
  "brief.tonight": { en: "Tonight", es: "Esta noche" },
  "brief.tonight.empty": { en: "Nothing booked yet — covers connect when a booking system is linked", es: "Sin reservas — las cubiertas llegan cuando se enlaza el sistema de reservas" },
  "brief.tonight.why": { en: "Who's coming. Sets the pace for the night.", es: "Quién viene. Marca el ritmo de la noche." },
  "brief.prep": { en: "Prep", es: "Mise" },
  "brief.prep.empty": { en: "Nothing queued", es: "Nada pendiente" },
  "brief.prep.why": { en: "Scaled to tomorrow's covers — opens the recipe + SOP.", es: "Escalado a las cubiertas de mañana — abre la receta + SOP." },
  "brief.specials": { en: "Specials", es: "Sugerencias" },
  "brief.specials.empty": { en: "None flagged today", es: "Ninguna marcada hoy" },
  "brief.specials.why": { en: "What the floor pushes tonight. Tap to read the pitch.", es: "Lo que la sala destaca esta noche. Toca para leer el discurso." },
  "brief.86": { en: "86 tonight", es: "Agotado hoy" },
  "brief.86.empty": { en: "Nothing 86’d", es: "Nada agotado" },
  "brief.86.why": { en: "Tell the floor before they tell a guest.", es: "Avisa a la sala antes que al cliente." },
  "brief.deliveries": { en: "Deliveries", es: "Entregas" },
  "brief.deliveries.empty": { en: "None due", es: "Ninguna pendiente" },
  "brief.deliveries.why": { en: "Photograph the note on arrival — costs update everywhere.", es: "Fotografía el albarán al llegar — los costes se actualizan en todas partes." },
  "brief.cleaning": { en: "Cleaning", es: "Limpieza" },
  "brief.cleaning.empty": { en: "All clear", es: "Todo en orden" },
  "brief.cleaning.why": { en: "HACCP sign-off — auditable, station-by-station.", es: "Firma APPCC — auditable, partida por partida." },
  "brief.messages": { en: "Messages", es: "Mensajes" },
  "brief.messages.empty": { en: "Inbox clear", es: "Bandeja vacía" },
  "brief.messages.why": { en: "The team, in the OS. Not WhatsApp.", es: "El equipo, dentro del OS. No WhatsApp." },

  // — Office tiles
  "office.inbox": { en: "Inbox", es: "Bandeja" },
  "office.inbox.blurb": { en: "Emails, requests, reviews — what needs a reply or a call.", es: "Emails, peticiones, reseñas — lo que pide una respuesta o una llamada." },
  "office.team": { en: "Team", es: "Equipo" },
  "office.team.blurb": { en: "Everyone the team, in one place: channels, roster, message anyone.", es: "Todo el equipo en un sitio: canales, cuadrante, mensajes a cualquiera." },
  "office.numbers": { en: "The numbers", es: "Los números" },
  "office.numbers.blurb": { en: "What's moving — revenue, covers, costs to react to.", es: "Lo que se mueve — ingresos, cubiertas, costes a los que reaccionar." },
  "office.suppliers": { en: "Suppliers", es: "Proveedores" },
  "office.suppliers.blurb": { en: "Orders, prices, deliveries.", es: "Pedidos, precios, entregas." },

  // — universal
  "common.back": { en: "← home", es: "← inicio" },
  "common.signin": { en: "Sign in", es: "Entrar" },
  "common.open": { en: "open ›", es: "abrir ›" },
  "common.lang": { en: "EN", es: "ES" },
  "common.lang.switch": { en: "Español", es: "English" },
};

const FALLBACK_LANG: Lang = "en";

export function getLang(): Lang {
  if (typeof document === "undefined") return FALLBACK_LANG;
  const m = document.cookie.match(/(?:^|;\s*)fs_lang=(en|es)/);
  return (m ? (m[1] as Lang) : FALLBACK_LANG);
}
export function setLang(l: Lang) {
  if (typeof document === "undefined") return;
  document.cookie = "fs_lang=" + l + "; path=/; max-age=" + 60 * 60 * 24 * 365;
  // Reload so server components also pick it up
  if (typeof window !== "undefined") window.location.reload();
}
export function t(key: string, lang?: Lang): string {
  const L = lang || getLang();
  const row = dict[key];
  if (!row) return key;
  return row[L] || row[FALLBACK_LANG] || key;
}
