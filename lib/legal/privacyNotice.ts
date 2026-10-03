// lib/legal/privacyNotice.ts — the privacy notice, ES + EN, one source.
//
// Rendered at /legal/privacy (public) and linked from every public form:
// /apply/<house>, /book/<slug>, /m/<slug>/book, /m/<slug>/private, /onboard.
// docs/legal/privacy-notice.md is the human-readable copy of the same text;
// change both or change neither. Retention periods here MUST match the jobs
// in supabase/migrations/20261002_security_s6_rgpd.sql (fn_retention_*).
//
// Controller model: each house (the restaurant's company) is the controller of
// its guests', candidates' and staff's data; Food Studio OS (Boris Buono
// Holdings / Ibiza Food Studio) is the processor that runs the platform, and
// the controller for platform accounts (the people who sign in).

export type Lang = "es" | "en";

export type Controller = {
  name: string;          // trading name
  legalName: string;     // legal entity
  taxId: string | null;  // CIF / tax id
  address: string | null;
  contact: string;       // mailbox for data requests
};

// Fallback when the holdings row cannot be read; the page overwrites it from
// privacy_page_controller('holdings') at render time.
export const PLATFORM: Controller = {
  name: "Food Studio OS",
  legalName: "Boris Buono Holding SL (Ibiza Food Studio)",
  taxId: null,
  address: "Calle Alt 2, 07800 Eivissa, ES",
  contact: "hola@ibzfoodstudio.com",
};

// Who processes data on our behalf — docs/legal/processors.md has the long form.
export const PROCESSORS: Array<{ name: string; what: Record<Lang, string>; where: string }> = [
  { name: "Supabase", where: "EU (eu-west-1, Irlanda / Ireland)", what: { es: "base de datos, autenticación y archivos", en: "database, sign-in and file storage" } },
  { name: "Vercel", where: "EU/US", what: { es: "alojamiento de la aplicación", en: "application hosting" } },
  { name: "Anthropic", where: "US", what: { es: "modelo de lenguaje que lee CVs, correos y transcribe peticiones al asistente; no entrena con nuestros datos", en: "language model that reads CVs and emails and interprets requests to the assistant; does not train on our data" } },
  { name: "OpenAI (Whisper) / Deepgram", where: "US", what: { es: "transcripción de voz del asistente", en: "voice transcription for the assistant" } },
  { name: "Google", where: "EU/US", what: { es: "inicio de sesión, correo, calendario y Drive del equipo", en: "sign-in, email, calendar and Drive for the team" } },
  { name: "Resend", where: "US", what: { es: "envío de correos transaccionales (invitaciones, confirmaciones)", en: "transactional email (invitations, confirmations)" } },
  { name: "Meta", where: "US", what: { es: "mensajes de Instagram y Facebook de la casa", en: "the house's Instagram and Facebook messages" } },
  { name: "Fresto", where: "EU", what: { es: "sistema de caja (tickets, reservas)", en: "point of sale (tickets, bookings)" } },
  { name: "Holded", where: "EU", what: { es: "contabilidad y facturación", en: "accounting and invoicing" } },
];

// Retention — the numbers the jobs enforce.
export const RETENTION = {
  candidatesMonths: 6,   // not hired → anonymised (fn_retention_candidates, retain_until)
  guestsYears: 3,        // after the last visit/booking (fn_retention_guests)
  chefTurnsDays: 90,     // transcripts (fn_retention_chef_turns)
  backupsWeeks: 8,       // weekly copies kept (db-backup)
  accountingYears: 6,    // invoices, tickets, payroll — Spanish commercial/tax law
};

export const NOTICE_UPDATED = "2026-10-02";

type Section = { h: string; p: string[] };

export function privacyNotice(lang: Lang, c: Controller, houseName: string | null): Section[] {
  const who = houseName ? (lang === "es" ? `${c.legalName} (${houseName})` : `${c.legalName} (${houseName})`) : c.legalName;
  const idLine = [c.taxId ? `CIF ${c.taxId}` : null, c.address].filter(Boolean).join(" · ");
  const R = RETENTION;
  if (lang === "es") {
    return [
      { h: "Quién trata tus datos", p: [
        `Responsable: ${who}${idLine ? ` — ${idLine}` : ""}. Para cualquier solicitud sobre tus datos escribe a ${c.contact}.`,
        houseName
          ? `La casa usa Food Studio OS, una plataforma operada por ${PLATFORM.legalName}, que actúa como encargado del tratamiento: guarda y procesa los datos por cuenta de la casa y siguiendo sus instrucciones.`
          : `${PLATFORM.legalName} opera la plataforma Food Studio OS y es responsable de los datos de las cuentas que inician sesión en ella.`,
      ]},
      { h: "Qué datos y para qué", p: [
        "Reservas y peticiones: nombre, contacto, tamaño del grupo, fecha, alergias o preferencias que nos cuentes — para preparar tu visita y poder avisarte de cambios. Base: ejecución del servicio que pides.",
        "Candidaturas: nombre, contacto, CV y tus respuestas al formulario — para valorar tu candidatura. Una herramienta de IA lee el CV y ordena las respuestas para que las revisemos antes; la decisión la toma siempre una persona. Base: tu consentimiento y las medidas precontractuales.",
        "Equipo: datos de contacto, turnos, fichajes, formación y lo necesario para la nómina y la seguridad alimentaria — por obligación legal y contrato de trabajo.",
        "Cuentas de la plataforma: correo con el que inicias sesión y lo que haces dentro (acciones, peticiones al asistente, sus transcripciones) — para que la herramienta funcione y para su seguridad.",
        "No vendemos ni cedemos datos a terceros para su propio uso. No hacemos perfiles con efectos jurídicos. No usamos tus datos para entrenar modelos de IA.",
      ]},
      { h: "Quién nos ayuda (encargados)", p: [
        "Trabajamos con proveedores que tratan datos siguiendo nuestras instrucciones y con contrato de encargo: " +
        PROCESSORS.map((x) => `${x.name} (${x.what.es}; ${x.where})`).join("; ") + ".",
        "Cuando un proveedor está fuera del Espacio Económico Europeo la transferencia se ampara en las cláusulas contractuales tipo de la Comisión Europea o en el Marco de Privacidad de Datos UE-EE.UU.",
      ]},
      { h: "Cuánto tiempo", p: [
        `Candidaturas: ${R.candidatesMonths} meses desde el envío si no te contratamos; después anonimizamos la ficha y borramos el CV. Si te contratamos, pasan a tu expediente de personal.`,
        `Clientes: ${R.guestsYears} años desde tu última visita o reserva; después anonimizamos nombre y contacto y queda solo la estadística (fecha, número de personas).`,
        `Asistente de voz: las transcripciones se borran a los ${R.chefTurnsDays} días; se conservan las métricas (duración, coste) sin el texto.`,
        `Facturas, tickets y nóminas: ${R.accountingYears} años, como exige la legislación mercantil y fiscal.`,
        `Copias de seguridad: ${R.backupsWeeks} semanas; un dato borrado desaparece de las copias en ese plazo.`,
        "Estos plazos los aplica un proceso automático cada noche.",
      ]},
      { h: "Tus derechos", p: [
        `Puedes pedir acceso, rectificación, supresión, limitación, portabilidad u oponerte al tratamiento escribiendo a ${c.contact}. Respondemos en un mes. Si no quedas conforme puedes reclamar ante la Agencia Española de Protección de Datos (aepd.es).`,
        "Si diste tu consentimiento (por ejemplo para una candidatura o un boletín) puedes retirarlo en cualquier momento sin que afecte a lo anterior.",
      ]},
      { h: "Seguridad", p: [
        "Los datos están en servidores de la UE, cifrados en tránsito y en reposo. Cada casa solo ve sus propios datos; el acceso del equipo depende de su puesto. Las acciones sensibles exigen confirmación humana. Hacemos copia de seguridad semanal y comprobamos que se puede restaurar.",
      ]},
      { h: "Cambios", p: [ `Última actualización: ${NOTICE_UPDATED}. Si cambiamos algo relevante te lo diremos en la propia página o por correo.` ]},
    ];
  }
  return [
    { h: "Who processes your data", p: [
      `Controller: ${who}${idLine ? ` — ${idLine}` : ""}. For anything about your data write to ${c.contact}.`,
      houseName
        ? `The house runs on Food Studio OS, a platform operated by ${PLATFORM.legalName}, which acts as processor: it stores and processes the data on the house's behalf and on its instructions.`
        : `${PLATFORM.legalName} operates the Food Studio OS platform and is the controller for the accounts that sign in to it.`,
    ]},
    { h: "What data and why", p: [
      "Bookings and enquiries: name, contact details, party size, date, any allergies or preferences you tell us — to prepare your visit and reach you about changes. Basis: performance of the service you asked for.",
      "Job applications: name, contact details, CV and your answers — to assess your application. An AI tool reads the CV and sorts the answers so we can review them faster; a person always makes the decision. Basis: your consent and pre-contractual steps.",
      "Team: contact details, shifts, clock-ins, training and what payroll and food-safety law require — legal obligation and employment contract.",
      "Platform accounts: the email you sign in with and what you do inside (actions, requests to the assistant and their transcripts) — to make the tool work and keep it secure.",
      "We do not sell or share data with third parties for their own use. No profiling with legal effects. Your data is not used to train AI models.",
    ]},
    { h: "Who helps us (processors)", p: [
      "We work with providers that process data on our instructions under a data-processing agreement: " +
      PROCESSORS.map((x) => `${x.name} (${x.what.en}; ${x.where})`).join("; ") + ".",
      "Where a provider is outside the European Economic Area the transfer relies on the European Commission's standard contractual clauses or the EU-US Data Privacy Framework.",
    ]},
    { h: "How long", p: [
      `Applications: ${R.candidatesMonths} months from submission if we do not hire you; then the record is anonymised and the CV deleted. If we hire you, it becomes part of your personnel file.`,
      `Guests: ${R.guestsYears} years from your last visit or booking; then name and contact details are anonymised and only the statistics remain (date, party size).`,
      `Voice assistant: transcripts are deleted after ${R.chefTurnsDays} days; the metrics (duration, cost) stay without the text.`,
      `Invoices, tickets and payroll: ${R.accountingYears} years, as Spanish commercial and tax law requires.`,
      `Backups: ${R.backupsWeeks} weeks; a deleted record leaves the copies within that period.`,
      "An automatic job applies these periods every night.",
    ]},
    { h: "Your rights", p: [
      `You can ask for access, rectification, erasure, restriction, portability or object to processing by writing to ${c.contact}. We answer within a month. If you are not satisfied you can complain to the Spanish data protection authority (aepd.es).`,
      "Where you gave consent (an application, a newsletter) you can withdraw it at any time without affecting what came before.",
    ]},
    { h: "Security", p: [
      "Data lives on EU servers, encrypted in transit and at rest. Each house sees only its own data; a team member's access follows their role. Sensitive actions need a human confirmation. We back up weekly and test that the copy restores.",
    ]},
    { h: "Changes", p: [ `Last updated ${NOTICE_UPDATED}. If something relevant changes we will say so on this page or by email.` ]},
  ];
}
