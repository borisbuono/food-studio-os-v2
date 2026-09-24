// Pure (non-client, non-server) i18n dictionary + resolver. Kept separate
// from lib/i18n.ts so server components can import t() without crossing
// the "use client" boundary. lib/i18n.ts re-exports these for the client.
//
// See lib/i18n.ts for the language-cycle contract and Boris rules.

export type Lang = "en" | "es" | "nl";
export const LANGS: Lang[] = ["en", "es", "nl"];
export const LANG_LABEL: Record<Lang, string> = {
  en: "English",
  es: "Español",
  nl: "Nederlands",
};

export const FALLBACK_LANG: Lang = "en";

export const dict: Record<string, Record<Lang, string>> = {
  // — nav / wordmark
  "home.greeting": { en: "Hello", es: "Hola", nl: "Hallo" },
  "home.brief": { en: "Your brief", es: "Tu pase", nl: "Jouw briefing" },
  "home.dashboard": { en: "Your dashboard", es: "Tu cuadro", nl: "Jouw dashboard" },
  "home.academy": { en: "Your academy", es: "Tu academia", nl: "Jouw academie" },
  "home.messages": { en: "Messages", es: "Mensajes", nl: "Berichten" },
  "home.messages.blurb": { en: "The team — channels and direct messages, in the OS.", es: "El equipo — canales y mensajes directos, dentro del OS.", nl: "Het team — kanalen en directe berichten, in het OS." },
  "home.receive": { en: "Receive a delivery", es: "Recibir una entrega", nl: "Levering ontvangen" },
  "home.receive.blurb": { en: "Photograph the delivery note — costs, stock and the supplier all update automatically.", es: "Fotografía el albarán — costes, stock y proveedor se actualizan solos.", nl: "Fotografeer de pakbon — kosten, voorraad en leverancier worden automatisch bijgewerkt." },

  // — brief rows
  "brief.tonight": { en: "Tonight", es: "Esta noche", nl: "Vanavond" },
  "brief.tonight.empty": { en: "Nothing booked yet — covers connect when a booking system is linked", es: "Sin reservas — las cubiertas llegan cuando se enlaza el sistema de reservas", nl: "Nog geen reserveringen — couverts komen binnen zodra een reserveringssysteem is gekoppeld" },
  "brief.tonight.why": { en: "Who's coming. Sets the pace for the night.", es: "Quién viene. Marca el ritmo de la noche.", nl: "Wie er komt. Bepaalt het ritme van de avond." },
  "brief.prep": { en: "Prep", es: "Mise", nl: "Mise" },
  "brief.prep.empty": { en: "Nothing queued", es: "Nada pendiente", nl: "Niets in de wacht" },
  "brief.prep.why": { en: "Scaled to tomorrow's covers — opens the recipe + SOP.", es: "Escalado a las cubiertas de mañana — abre la receta + SOP.", nl: "Geschaald op de couverts van morgen — opent het recept + SOP." },
  "brief.specials": { en: "Specials", es: "Sugerencias", nl: "Suggesties" },
  "brief.specials.empty": { en: "None flagged today", es: "Ninguna marcada hoy", nl: "Vandaag niets aangeduid" },
  "brief.specials.why": { en: "What the floor pushes tonight. Tap to read the pitch.", es: "Lo que la sala destaca esta noche. Toca para leer el discurso.", nl: "[NL:REVIEW] Wat de bediening vanavond aanraadt. Tik voor de pitch." },
  "brief.86": { en: "86 tonight", es: "Agotado hoy", nl: "86 vanavond" },
  "brief.86.empty": { en: "Nothing 86’d", es: "Nada agotado", nl: "Niets van de kaart" },
  "brief.86.why": { en: "Tell the floor before they tell a guest.", es: "Avisa a la sala antes que al cliente.", nl: "Laat het de bediening weten vóór de gast erom vraagt." },
  "brief.deliveries": { en: "Deliveries", es: "Entregas", nl: "Leveringen" },
  "brief.deliveries.empty": { en: "None due", es: "Ninguna pendiente", nl: "Geen verwacht" },
  "brief.deliveries.why": { en: "Photograph the note on arrival — costs update everywhere.", es: "Fotografía el albarán al llegar — los costes se actualizan en todas partes.", nl: "Fotografeer de bon bij aankomst — kosten worden overal bijgewerkt." },
  "brief.cleaning": { en: "Cleaning", es: "Limpieza", nl: "Schoonmaak" },
  "brief.cleaning.empty": { en: "All clear", es: "Todo en orden", nl: "Alles in orde" },
  "brief.cleaning.why": { en: "HACCP sign-off — auditable, station-by-station.", es: "Firma APPCC — auditable, partida por partida.", nl: "HACCP-aftekening — controleerbaar, per station." },
  "brief.messages": { en: "Messages", es: "Mensajes", nl: "Berichten" },
  "brief.messages.empty": { en: "Inbox clear", es: "Bandeja vacía", nl: "Postvak leeg" },
  "brief.messages.why": { en: "The team, in the OS. Not WhatsApp.", es: "El equipo, dentro del OS. No WhatsApp.", nl: "Het team, in het OS. Niet WhatsApp." },

  // — Office tiles
  "office.inbox": { en: "Inbox", es: "Bandeja", nl: "Inbox" },
  "office.inbox.blurb": { en: "Emails, requests, reviews — what needs a reply or a call.", es: "Emails, peticiones, reseñas — lo que pide una respuesta o una llamada.", nl: "E-mails, verzoeken, reviews — wat een antwoord of telefoontje nodig heeft." },
  "office.team": { en: "Team", es: "Equipo", nl: "Team" },
  "office.team.blurb": { en: "Everyone the team, in one place: channels, roster, message anyone.", es: "Todo el equipo en un sitio: canales, cuadrante, mensajes a cualquiera.", nl: "Het hele team op één plek: kanalen, rooster, bericht iedereen." },
  "office.numbers": { en: "The numbers", es: "Los números", nl: "De cijfers" },
  "office.numbers.blurb": { en: "What's moving — revenue, covers, costs to react to.", es: "Lo que se mueve — ingresos, cubiertas, costes a los que reaccionar.", nl: "Wat er beweegt — omzet, couverts, kosten om op te reageren." },
  "office.suppliers": { en: "Suppliers", es: "Proveedores", nl: "Leveranciers" },
  "office.suppliers.blurb": { en: "Orders, prices, deliveries.", es: "Pedidos, precios, entregas.", nl: "Bestellingen, prijzen, leveringen." },


  // — onboarding: first-run tour (/welcome)
  "welcome.loading": { en: "One second…", es: "Un segundo…", nl: "Een moment…" },
  "welcome.eyebrow": { en: "Welcome · step {i} of {n}", es: "Bienvenida · paso {i} de {n}", nl: "Welkom · stap {i} van {n}" },
  "welcome.step.you": { en: "You", es: "Tú", nl: "Jij" },
  "welcome.step.rules": { en: "House rules", es: "Normas de la casa", nl: "Huisregels" },
  "welcome.step.os": { en: "Your OS", es: "Tu OS", nl: "Jouw OS" },
  "welcome.you.title": { en: "This is you", es: "Este eres tú", nl: "Dit ben jij" },
  "welcome.you.body": { en: "Check your name — it's how the team sees you in messages, the schedule and The Pass.", es: "Revisa tu nombre — así te ve el equipo en los mensajes, el cuadrante y el Pase.", nl: "Controleer je naam — zo ziet het team je in berichten, het rooster en de Pass." },
  "welcome.you.name": { en: "Your name", es: "Tu nombre", nl: "Je naam" },
  "welcome.you.role": { en: "Role", es: "Puesto", nl: "Functie" },
  "welcome.you.world": { en: "World", es: "Mundo", nl: "[NL:REVIEW] Wereld" },
  "welcome.you.cta": { en: "That's me", es: "Soy yo", nl: "Dat ben ik" },
  "welcome.rules.title": { en: "House rules", es: "Normas de la casa", nl: "Huisregels" },
  "welcome.rules.p1": { en: "Your name, role, schedule and clock-ins live in the OS so the venue can run service, pay you correctly and meet its legal duties. Your data stays inside the company and is never sold. You can ask the office to see or correct it at any time (GDPR).", es: "Tu nombre, puesto, cuadrante y fichajes viven en el OS para que el local pueda dar el servicio, pagarte correctamente y cumplir sus obligaciones legales. Tus datos se quedan dentro de la empresa y nunca se venden. Puedes pedir a oficina verlos o corregirlos en cualquier momento (RGPD).", nl: "Je naam, functie, rooster en werktijden staan in het OS zodat de zaak service kan draaien, je correct kan betalen en aan de wettelijke plichten kan voldoen. Je gegevens blijven binnen het bedrijf en worden nooit verkocht. Je kunt kantoor altijd vragen om ze in te zien of te corrigeren (AVG)." },
  "welcome.rules.p2": { en: "Clock-in uses your phone's location only at the moment you clock in, only to confirm you're at the venue.", es: "El fichaje usa la ubicación de tu móvil solo en el momento de fichar, solo para confirmar que estás en el local.", nl: "Inklokken gebruikt de locatie van je telefoon alleen op het moment van inklokken, alleen om te bevestigen dat je in de zaak bent." },
  "welcome.rules.p3": { en: "No phones on the floor during service — the OS is for before and after. Allergen answers come from the Menu, never from memory.", es: "Nada de móviles en sala durante el servicio — el OS es para antes y después. Las respuestas sobre alérgenos salen de la Carta, nunca de memoria.", nl: "Geen telefoons in de zaak tijdens service — het OS is voor vóór en na. Allergeeninformatie komt uit de Kaart, nooit uit je hoofd." },
  "welcome.rules.cta": { en: "I understand + accept", es: "Lo entiendo y acepto", nl: "Ik begrijp het en ga akkoord" },
  "welcome.tour.title": { en: "Your OS, in 60 seconds", es: "Tu OS, en 60 segundos", nl: "Jouw OS, in 60 seconden" },
  "welcome.tour.body": { en: "As {world}, your home has {n} places. That's all of it — the Chef button finds everything else.", es: "Como {world}, tu inicio tiene {n} sitios. Eso es todo — el botón Chef encuentra el resto.", nl: "[NL:REVIEW] Als {world} heeft je start {n} plekken. Meer is het niet — de Chef-knop vindt de rest." },
  "welcome.finish": { en: "Finish → {task}", es: "Terminar → {task}", nl: "Afronden → {task}" },
  "welcome.skip": { en: "Skip to home", es: "Saltar al inicio", nl: "Naar start" },
  "welcome.task.brief": { en: "Read today's brief", es: "Lee el pase de hoy", nl: "Lees de briefing van vandaag" },
  "welcome.task.clockin": { en: "Clock in on The Pass", es: "Ficha en el Pase", nl: "Klok in op de Pass" },

  // — onboarding: invite (/administrate/team/invite)
  "invite.back": { en: "← team", es: "← equipo", nl: "← team" },
  "invite.eyebrow": { en: "Team · invite", es: "Equipo · invitación", nl: "Team · uitnodiging" },
  "invite.title": { en: "Add to the team", es: "Añadir al equipo", nl: "Aan het team toevoegen" },
  "invite.sub": { en: "They get a sign-in link; venue + role bind automatically on first sign-in.", es: "Recibe un enlace de acceso; el local y el puesto se asignan solos en el primer acceso.", nl: "Ze krijgen een inloglink; zaak en functie worden automatisch gekoppeld bij de eerste aanmelding." },
  "invite.name": { en: "Name", es: "Nombre", nl: "Naam" },
  "invite.name.ph": { en: "Full name", es: "Nombre completo", nl: "Volledige naam" },
  "invite.email": { en: "Email (their sign-in)", es: "Email (su acceso)", nl: "E-mail (hun inlog)" },
  "invite.phone": { en: "Phone (for the WhatsApp invite)", es: "Teléfono (para la invitación por WhatsApp)", nl: "Telefoon (voor de WhatsApp-uitnodiging)" },
  "invite.role": { en: "Role", es: "Puesto", nl: "Functie" },
  "invite.venue": { en: "Venue", es: "Local", nl: "Zaak" },
  "invite.lang": { en: "Language", es: "Idioma", nl: "Taal" },
  "invite.save": { en: "Save + get the invite link", es: "Guardar y obtener el enlace", nl: "Opslaan en de uitnodigingslink krijgen" },
  "invite.saving": { en: "Saving…", es: "Guardando…", nl: "Opslaan…" },
  "invite.err.required": { en: "Name and email are required — the email is how they sign in.", es: "Nombre y email son obligatorios — el email es su forma de entrar.", nl: "Naam en e-mail zijn verplicht — met het e-mailadres logt hij of zij in." },
  "invite.err.rls": { en: "Couldn't save — are you signed in as a manager?", es: "No se pudo guardar — ¿has entrado como manager?", nl: "Opslaan mislukt — ben je ingelogd als manager?" },
  "invite.saved": { en: "Invite saved", es: "Invitación guardada", nl: "Uitnodiging opgeslagen" },
  "invite.saved.title": { en: "{name} is on the roster", es: "{name} ya está en el equipo", nl: "{name} staat op het rooster" },
  "invite.saved.body.a": { en: "When they first sign in with", es: "Cuando entre por primera vez con", nl: "Wanneer zij voor het eerst inloggen met" },
  "invite.saved.body.b": { en: ", the OS binds them to their venue and role automatically and walks them through a 60-second first run. Send them the link:", es: ", el OS le asigna su local y su puesto automáticamente y le guía por una primera vuelta de 60 segundos. Envíale el enlace:", nl: ", koppelt het OS ze automatisch aan hun zaak en functie en loopt met ze door een eerste tour van 60 seconden. Stuur de link:" },
  "invite.wa": { en: "Send on WhatsApp", es: "Enviar por WhatsApp", nl: "Verstuur via WhatsApp" },
  "invite.mail": { en: "Send by email", es: "Enviar por email", nl: "Verstuur via e-mail" },
  "invite.mail.subject": { en: "Your Food Studio OS sign-in", es: "Tu acceso al Food Studio OS", nl: "Jouw Food Studio OS-inlog" },
  "invite.another": { en: "+ Invite another", es: "+ Invitar a otra persona", nl: "+ Nog iemand uitnodigen" },

  // — universal
  "common.back": { en: "← home", es: "← inicio", nl: "← start" },
  "common.signin": { en: "Sign in", es: "Entrar", nl: "Inloggen" },
  "common.open": { en: "open ›", es: "abrir ›", nl: "openen ›" },
  "common.lang": { en: "EN", es: "ES", nl: "NL" },
  "common.lang.switch": { en: "Español", es: "English", nl: "English" },

  // — welcome / marketing landing (2026-09-20 runway d2 — Amsterdam)
  "welcome.landing.eyebrow": { en: "Food Studios OS", es: "Food Studios OS", nl: "Food Studios OS" },
  "welcome.landing.h1a": { en: "The chef-built", es: "El sistema operativo", nl: "Het door chefs" },
  "welcome.landing.h1b": { en: "operating system.", es: "hecho por chefs.", nl: "gebouwde OS." },
  "welcome.landing.strap": { en: "built by operators for operators", es: "hecho por operadores para operadores", nl: "gebouwd door operators voor operators" },
  "welcome.landing.sub": { en: "Recipes, service, invoices, GP — one calm surface. Voice-first. Built at the pass, not the spreadsheet.", es: "Recetas, servicio, facturas, margen — una sola superficie. Voz primero. Construido en el pase, no en la hoja de cálculo.", nl: "Recepten, service, facturen, marge — één rustig scherm. Voice-first. Gebouwd aan de pass, niet in een spreadsheet." },
  "welcome.landing.auth": { en: "Google · magic link · no password", es: "Google · enlace mágico · sin contraseña", nl: "Google · magische link · geen wachtwoord" },
  "welcome.landing.footer": { en: "Food Studios · the chef-built operating system", es: "Food Studios · el OS hecho por chefs", nl: "Food Studios · het door chefs gebouwde OS" },

  // — sidebar / rooms (Overview/Kitchen/Dining/Office)
  "rooms.overview": { en: "Overview", es: "Vista", nl: "Overzicht" },
  "rooms.kitchen": { en: "Kitchen", es: "Cocina", nl: "Keuken" },
  "rooms.dining": { en: "Dining Room", es: "Sala", nl: "Restaurant" },
  "rooms.office": { en: "Office", es: "Oficina", nl: "Kantoor" },
  "rooms.house": { en: "House", es: "Casa", nl: "Zaak" },
  "rooms.room": { en: "Room", es: "Sala", nl: "Ruimte" },

  // — chef assistant
  "chef.placeholder": { en: "Message Chef", es: "Mensaje al Chef", nl: "Bericht aan Chef" },
  "chef.listening": { en: "Listening…", es: "Escuchando…", nl: "Luistert…" },
  "chef.thinking": { en: "Thinking…", es: "Pensando…", nl: "Bezig…" },
  // — chef v3 (one control, cards, confirm gate)
  "chef.heard": { en: "heard:", es: "oído:", nl: "gehoord:" },
  "chef.slow": { en: "slow mode", es: "modo lento", nl: "trage modus" },
  "chef.still_working": { en: "Still working…", es: "Sigo en ello…", nl: "Nog bezig…" },
  "chef.tap_to_talk": { en: "Tap to talk · hold for camera", es: "Toca para hablar · mantén para cámara", nl: "Tik om te praten · houd vast voor camera" },
  "chef.confirm_hint": { en: "Waiting for Yes or No", es: "Esperando Sí o No", nl: "Wacht op Ja of Nee" },
  "chef.yes": { en: "Yes", es: "Sí", nl: "Ja" },
  "chef.no": { en: "No", es: "No", nl: "Nee" },
  "chef.undo": { en: "Undo", es: "Deshacer", nl: "Ongedaan" },
  "chef.undone": { en: "Undone", es: "Deshecho", nl: "Ongedaan gemaakt" },
  "chef.done": { en: "Done", es: "Hecho", nl: "Klaar" },
  "chef.error": { en: "Chef couldn't do that", es: "Chef no ha podido", nl: "Chef kon dat niet" },
  "chef.offline": { en: "No signal — try again", es: "Sin señal — inténtalo otra vez", nl: "Geen verbinding — probeer opnieuw" },
  "chef.mic_needed": { en: "Microphone needed", es: "Hace falta el micrófono", nl: "Microfoon nodig" },
  "chef.type_placeholder": { en: "Ask or tell Chef…", es: "Pregunta o dile al Chef…", nl: "Vraag of zeg het Chef…" },
  "chef.which_house": { en: "Which house?", es: "¿Qué casa?", nl: "Welke zaak?" },
  // — chef v3 phase 2 (camera → capture, inbox by voice, voice yes/no, chips, pass)
  "chef.capturing": { en: "Reading the document…", es: "Leyendo el documento…", nl: "Document lezen…" },
  "chef.photo": { en: "photo", es: "foto", nl: "foto" },
  "chef.looks_right": { en: "Looks right", es: "Está bien", nl: "Klopt" },
  "chef.fix": { en: "Fix", es: "Corregir", nl: "Aanpassen" },
  "chef.add_page": { en: "Add page", es: "Otra página", nl: "Pagina erbij" },
  "chef.lines": { en: "lines", es: "líneas", nl: "regels" },
  "chef.pages": { en: "pages", es: "páginas", nl: "pagina's" },
  "chef.capture_failed": { en: "Couldn't read that photo", es: "No he podido leer la foto", nl: "Kon de foto niet lezen" },
  "chef.say_yes_or_tap": { en: "Say yes or no, or tap", es: "Di sí o no, o toca", nl: "Zeg ja of nee, of tik" },
  "chef.tap_only": { en: "Tap Yes to confirm", es: "Toca Sí para confirmar", nl: "Tik Ja om te bevestigen" },
  "chef.not_a_yes": { en: "Didn't hear a yes — tap to confirm", es: "No he oído un sí — toca para confirmar", nl: "Geen ja gehoord — tik om te bevestigen" },
  "chef.cancelled": { en: "Cancelled, nothing sent", es: "Cancelado, no se ha enviado nada", nl: "Geannuleerd, niets verstuurd" },
  "chef.send": { en: "Send", es: "Enviar", nl: "Verstuur" },
  "chef.skip": { en: "Skip", es: "Saltar", nl: "Overslaan" },
  "chef.edit": { en: "Edit", es: "Editar", nl: "Bewerken" },
  "chef.next": { en: "Next", es: "Siguiente", nl: "Volgende" },
  "chef.edit_reply_hint": { en: "Say or type the new reply", es: "Di o escribe la nueva respuesta", nl: "Zeg of typ het nieuwe antwoord" },
  "chef.speech_off": { en: "Voice replies off", es: "Voz desactivada", nl: "Spraak uit" },
  "chef.speech_on": { en: "Voice replies on", es: "Voz activada", nl: "Spraak aan" },
  "chef.pass_now": { en: "Now", es: "Ahora", nl: "Nu" },
  "chef.pass_covers": { en: "covers tonight", es: "cubiertos esta noche", nl: "couverts vanavond" },
  "chef.pass_next": { en: "next booking", es: "próxima reserva", nl: "volgende reservering" },
  "chef.pass_prep": { en: "prep left", es: "mise pendiente", nl: "prep open" },
  "chef.pass_inbox": { en: "waiting", es: "esperando", nl: "wachtend" },
  "chef.pass_headset": { en: "Headset: press play/pause or Space to talk", es: "Auricular: pulsa play/pausa o Espacio para hablar", nl: "Headset: druk play/pauze of Spatie om te praten" },

  // — capture (invoice / delivery-note camera)
  "capture.title": { en: "Capture", es: "Capturar", nl: "Vastleggen" },
  "capture.invoice": { en: "Capture invoice", es: "Capturar factura", nl: "Factuur vastleggen" },
  "capture.delivery": { en: "Capture delivery note", es: "Capturar albarán", nl: "Bon vastleggen" },
  "capture.retake": { en: "Retake", es: "Reintentar", nl: "Opnieuw" },
  "capture.use": { en: "Use this photo", es: "Usar esta foto", nl: "Deze foto gebruiken" },
  "capture.uploading": { en: "Uploading…", es: "Subiendo…", nl: "Uploaden…" },
  "capture.done": { en: "Sent to Office", es: "Enviado a Oficina", nl: "Naar Kantoor gestuurd" },
  "capture.camera.deny": { en: "Camera access needed — enable in your browser settings.", es: "Se necesita acceso a la cámara — actívalo en el navegador.", nl: "Cameratoegang nodig — sta dit toe in je browserinstellingen." },

  // — daily loop essentials
  "loop.covers": { en: "Covers", es: "Cubiertas", nl: "Couverts" },
  "loop.ticket": { en: "Ticket", es: "Ticket", nl: "Bon" },
  "loop.tickets": { en: "Tickets", es: "Tickets", nl: "Bonnen" },
  "loop.today": { en: "Today", es: "Hoy", nl: "Vandaag" },
  "loop.yesterday": { en: "Yesterday", es: "Ayer", nl: "Gisteren" },
  "loop.tomorrow": { en: "Tomorrow", es: "Mañana", nl: "Morgen" },
  "loop.clockin": { en: "Clock in", es: "Fichar", nl: "Inklokken" },
  "loop.clockout": { en: "Clock out", es: "Fichar salida", nl: "Uitklokken" },
  "loop.eod": { en: "End of day", es: "Cierre", nl: "Einde van de dag" },
  "loop.prep": { en: "Prep list", es: "Mise", nl: "Miselijst" },

  // — settings / language page
  "settings.language.title": { en: "Language", es: "Idioma", nl: "Taal" },
  "settings.language.sub": { en: "Pick your language. Menus, briefs and messages follow you.", es: "Elige tu idioma. Menús, pases y mensajes te siguen.", nl: "Kies je taal. Kaarten, briefings en berichten volgen je." },
  "settings.language.saved": { en: "Language set to {label}", es: "Idioma establecido en {label}", nl: "Taal ingesteld op {label}" },
};

export function resolve(key: string, lang: Lang): string {
  const row = dict[key];
  if (!row) return key;
  return row[lang] || row[FALLBACK_LANG] || key;
}

// Locale-from-country hint. NL → nl, ES → es, everywhere else → en.
export function langForCountry(code: string | null | undefined): Lang {
  const c = (code || "").toUpperCase();
  if (c === "NL") return "nl";
  if (c === "ES") return "es";
  return "en";
}
