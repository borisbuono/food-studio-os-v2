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


  // — onboarding: first-run tour (/welcome)
  "welcome.loading": { en: "One second…", es: "Un segundo…" },
  "welcome.eyebrow": { en: "Welcome · step {i} of {n}", es: "Bienvenida · paso {i} de {n}" },
  "welcome.step.you": { en: "You", es: "Tú" },
  "welcome.step.rules": { en: "House rules", es: "Normas de la casa" },
  "welcome.step.os": { en: "Your OS", es: "Tu OS" },
  "welcome.you.title": { en: "This is you", es: "Este eres tú" },
  "welcome.you.body": { en: "Check your name — it's how the team sees you in messages, the schedule and The Pass.", es: "Revisa tu nombre — así te ve el equipo en los mensajes, el cuadrante y el Pase." },
  "welcome.you.name": { en: "Your name", es: "Tu nombre" },
  "welcome.you.role": { en: "Role", es: "Puesto" },
  "welcome.you.world": { en: "World", es: "Mundo" },
  "welcome.you.cta": { en: "That's me", es: "Soy yo" },
  "welcome.rules.title": { en: "House rules", es: "Normas de la casa" },
  "welcome.rules.p1": { en: "Your name, role, schedule and clock-ins live in the OS so the venue can run service, pay you correctly and meet its legal duties. Your data stays inside the company and is never sold. You can ask the office to see or correct it at any time (GDPR).", es: "Tu nombre, puesto, cuadrante y fichajes viven en el OS para que el local pueda dar el servicio, pagarte correctamente y cumplir sus obligaciones legales. Tus datos se quedan dentro de la empresa y nunca se venden. Puedes pedir a oficina verlos o corregirlos en cualquier momento (RGPD)." },
  "welcome.rules.p2": { en: "Clock-in uses your phone's location only at the moment you clock in, only to confirm you're at the venue.", es: "El fichaje usa la ubicación de tu móvil solo en el momento de fichar, solo para confirmar que estás en el local." },
  "welcome.rules.p3": { en: "No phones on the floor during service — the OS is for before and after. Allergen answers come from the Menu, never from memory.", es: "Nada de móviles en sala durante el servicio — el OS es para antes y después. Las respuestas sobre alérgenos salen de la Carta, nunca de memoria." },
  "welcome.rules.cta": { en: "I understand + accept", es: "Lo entiendo y acepto" },
  "welcome.tour.title": { en: "Your OS, in 60 seconds", es: "Tu OS, en 60 segundos" },
  "welcome.tour.body": { en: "As {world}, your home has {n} places. That's all of it — the Chef button finds everything else.", es: "Como {world}, tu inicio tiene {n} sitios. Eso es todo — el botón Chef encuentra el resto." },
  "welcome.finish": { en: "Finish → {task}", es: "Terminar → {task}" },
  "welcome.skip": { en: "Skip to home", es: "Saltar al inicio" },
  "welcome.task.brief": { en: "Read today's brief", es: "Lee el pase de hoy" },
  "welcome.task.clockin": { en: "Clock in on The Pass", es: "Ficha en el Pase" },

  // — onboarding: invite (/administrate/team/invite)
  "invite.back": { en: "← team", es: "← equipo" },
  "invite.eyebrow": { en: "Team · invite", es: "Equipo · invitación" },
  "invite.title": { en: "Add to the team", es: "Añadir al equipo" },
  "invite.sub": { en: "They get a sign-in link; venue + role bind automatically on first sign-in.", es: "Recibe un enlace de acceso; el local y el puesto se asignan solos en el primer acceso." },
  "invite.name": { en: "Name", es: "Nombre" },
  "invite.name.ph": { en: "Full name", es: "Nombre completo" },
  "invite.email": { en: "Email (their sign-in)", es: "Email (su acceso)" },
  "invite.phone": { en: "Phone (for the WhatsApp invite)", es: "Teléfono (para la invitación por WhatsApp)" },
  "invite.role": { en: "Role", es: "Puesto" },
  "invite.venue": { en: "Venue", es: "Local" },
  "invite.lang": { en: "Language", es: "Idioma" },
  "invite.save": { en: "Save + get the invite link", es: "Guardar y obtener el enlace" },
  "invite.saving": { en: "Saving…", es: "Guardando…" },
  "invite.err.required": { en: "Name and email are required — the email is how they sign in.", es: "Nombre y email son obligatorios — el email es su forma de entrar." },
  "invite.err.rls": { en: "Couldn't save — are you signed in as a manager?", es: "No se pudo guardar — ¿has entrado como manager?" },
  "invite.saved": { en: "Invite saved", es: "Invitación guardada" },
  "invite.saved.title": { en: "{name} is on the roster", es: "{name} ya está en el equipo" },
  "invite.saved.body.a": { en: "When they first sign in with", es: "Cuando entre por primera vez con" },
  "invite.saved.body.b": { en: ", the OS binds them to their venue and role automatically and walks them through a 60-second first run. Send them the link:", es: ", el OS le asigna su local y su puesto automáticamente y le guía por una primera vuelta de 60 segundos. Envíale el enlace:" },
  "invite.wa": { en: "Send on WhatsApp", es: "Enviar por WhatsApp" },
  "invite.mail": { en: "Send by email", es: "Enviar por email" },
  "invite.mail.subject": { en: "Your Food Studio OS sign-in", es: "Tu acceso al Food Studio OS" },
  "invite.another": { en: "+ Invite another", es: "+ Invitar a otra persona" },

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
