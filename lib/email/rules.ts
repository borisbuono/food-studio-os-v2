// lib/email/rules.ts — the PURE part of the email classifier: categories,
// enquiry fields, and the sender/header/keyword rules that run before any
// model call. No imports, so tests/email-channel.test.ts compiles it alone.
// The model path and the routing live in lib/email/classify.ts.

export type Category = "enquiry" | "supplier_doc" | "fiscal_legal" | "booking_change" | "newsletter_noise" | "other";
export const CATEGORIES: Category[] = ["enquiry", "supplier_doc", "fiscal_legal", "booking_change", "newsletter_noise", "other"];

export type EnquiryFields = {
  date: string | null;              // YYYY-MM-DD or null
  pax: number | null;
  budget_pp: number | null;         // € per person, only if they wrote one
  venue_case: "provider" | "ours" | "help" | null;   // their venue / ours / they need one
  food_shape: "set" | "sharing" | "buffet" | "canapes" | null;
  language: string | null;          // ISO 639-1
};

export type ClassifyInput = {
  from_address: string | null; from_name: string | null; subject: string | null; body: string | null;
  list_unsubscribe: string | null; precedence: string | null; auto_submitted: string | null;
  attachments: Array<{ filename: string; mime: string }>;
  direction: "in" | "out";
};
export type Verdict = { category: Category; confidence: number; by: string; enquiry_fields?: EnquiryFields | null; needs_you_due?: string | null; reason?: string | null; language?: string | null };

export const SLUG_CODE: Record<string, "BM" | "IFL" | "BBH" | "UTOPIA"> = { bm: "BM", taller: "IFL", holdings: "BBH", utopia: "UTOPIA" };
export const CAPTURE_MIMES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic"]);
export const LABEL_CAPTURED = "OS/Captured", LABEL_NOISE = "OS/Noise", LABEL_NEEDS_YOU = "OS/Needs you";

// ---------------------------------------------------------------- rules (pure, tested)
export const domainOf = (a: string | null) => (a || "").split("@")[1]?.toLowerCase() || "";
const FISCAL_DOMAINS = /(^|\.)(aeat\.es|agenciatributaria\.gob\.es|agenciatributaria\.es|seg-social\.es|seg-social\.gob\.es|administracion\.gob\.es|correos\.es|dgt\.es|caib\.es|eivissa\.es|conselldeivissa\.es|notariado\.org|justicia\.es|poderjudicial\.es|caixabank\.com|caixabank\.es|bbva\.com|bbva\.es|bancsabadell\.com|santander\.es|bankinter\.com)$/i;
const FISCAL_WORDS = /\b(AEAT|Agencia Tributaria|Seguridad Social|TGSS|requerimiento|notificaci[oó]n electr[oó]nica|notificaci[oó]n administrativa|embargo|diligencia|providencia de apremio|apremio|juzgado|demanda|burofax|abogad[oa]s?|procurador|letrad[oa]|arrendador|arrendamiento|desahucio|Ayuntamiento|sanci[oó]n|expediente sancionador|recurso de reposici[oó]n|inspecci[oó]n|modelo 303|modelo 390|modelo 111|IVA trimestral|Hacienda|comunicaci[oó]n de embargo|aplazamiento)\b/i;
const DOC_WORDS = /\b(factura|facturas|invoice|albar[aá]n|albaranes|extracto|statement of account|estado de cuenta|recibo|nota de entrega|delivery note|FRA\b|FVA\b|n[uú]mero de factura|su factura)\b/i;
const NOISE_SENDER = /^(no-?reply|noreply|newsletter|news|marketing|notifications?|notificaciones|mailer-daemon|donotreply|do-not-reply|info-?noreply|promo|promotions?|hello)@/i;
const NOISE_WORDS = /\b(newsletter|unsubscribe|darse de baja|cancelar suscripci[oó]n|webinar|black friday|descuento exclusivo|oferta especial|promoci[oó]n|%\s*off|verify your email|confirma tu correo)\b/i;
const BOOKING_DOMAIN = /(^|\.)(fresto\.io|fresto\.es|thefork\.com|thefork\.es|opentable\.com|covermanager\.com|resy\.com)$/i;
const BOOKING_WORDS = /\b(reserva|reservation|booking|mesa|table for|cancelaci[oó]n|cancel|modificar|change (my|our) (booking|reservation)|cambiar la reserva|no[- ]show)\b/i;
const ENQUIRY_WORDS = /\b(evento|event|cena privada|private dinner|private chef|chef privado|chef a domicilio|catering|grupo de|group of|personas|pax|people|presupuesto|quote|budget|boda|wedding|cumplea[nñ]os|birthday|aniversario|anniversary|experience|experiencia|taller|workshop|cooking class|clase de cocina|celebraci[oó]n|team building|corporate|empresa|disponibilidad|availability|tarifa|price list|precios)\b/i;

export function ruleClassify(x: ClassifyInput): Verdict | null {
  const from = (x.from_address || "").toLowerCase();
  const dom = domainOf(from);
  const subj = x.subject || "";
  const text = `${subj}\n${(x.body || "").slice(0, 4000)}`;
  const hasDoc = x.attachments.some((a) => CAPTURE_MIMES.has(a.mime) || /\.(pdf|jpe?g|png)$/i.test(a.filename));
  const autoSubmitted = !!x.auto_submitted && !/^no\b/i.test(x.auto_submitted);
  const bulk = /\b(bulk|list|junk)\b/i.test(x.precedence || "");

  // Booking platforms before the noise rule: their mails are noreply but matter.
  if (BOOKING_DOMAIN.test(dom)) return { category: "booking_change", confidence: 0.85, by: "rule:booking_platform" };
  // Fiscal / legal / bank: sender first, words second.
  if (FISCAL_DOMAINS.test(dom)) return { category: "fiscal_legal", confidence: 0.9, by: "rule:fiscal_domain" };
  if (FISCAL_WORDS.test(text)) return { category: "fiscal_legal", confidence: 0.8, by: "rule:fiscal_words" };
  // Holded's own notifications are system mail about documents already in the books.
  if (/(^|\.)(holded\.com|holdedbox\.com)$/i.test(dom)) return { category: "newsletter_noise", confidence: 0.8, by: "rule:holded_notification" };
  // Supplier document: a readable attachment + the words.
  if (hasDoc && DOC_WORDS.test(text)) return { category: "supplier_doc", confidence: 0.9, by: "rule:doc_attachment_words" };
  // Noise: list headers, bulk precedence, automated senders, marketing words.
  if (x.list_unsubscribe || bulk) return { category: "newsletter_noise", confidence: 0.9, by: "rule:list_headers" };
  if (autoSubmitted && !BOOKING_WORDS.test(text)) return { category: "newsletter_noise", confidence: 0.75, by: "rule:auto_submitted" };
  if (NOISE_SENDER.test(from) && !BOOKING_WORDS.test(text) && !DOC_WORDS.test(text)) return { category: "newsletter_noise", confidence: 0.7, by: "rule:noreply_sender" };
  if (NOISE_WORDS.test(text) && !ENQUIRY_WORDS.test(text)) return { category: "newsletter_noise", confidence: 0.65, by: "rule:marketing_words" };
  // Documents without the words still smell like documents when a PDF is the whole mail.
  if (hasDoc && (x.body || "").trim().length < 200 && !ENQUIRY_WORDS.test(text)) return { category: "supplier_doc", confidence: 0.6, by: "rule:bare_attachment" };
  return null;   // enquiry / booking_change / other → the model decides and extracts
}

