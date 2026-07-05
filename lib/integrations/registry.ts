import type { EntityCode, IntegrationBinding, PosAdapter, AccountingAdapter, BookingAdapter, PaymentAdapter, BankingAdapter, MarketingAdapter, SocialAdapter, ReviewsAdapter } from "@/lib/integrations/types";

// POS
import { frestoAdapter } from "@/lib/integrations/pos/fresto";
import { squareAdapter } from "@/lib/integrations/pos/square";
import { microsAdapter } from "@/lib/integrations/pos/micros";
import { toastAdapter } from "@/lib/integrations/pos/toast";
import { lightspeedAdapter } from "@/lib/integrations/pos/lightspeed";
import { csvAdapter } from "@/lib/integrations/pos/csv";
// Accounting
import { holdedAdapter } from "@/lib/integrations/accounting/holded";
import { apideckAdapter } from "@/lib/integrations/accounting/apideck";
import { quickbooksAdapter } from "@/lib/integrations/accounting/quickbooks";
import { xeroAdapter } from "@/lib/integrations/accounting/xero";
import { sageAdapter } from "@/lib/integrations/accounting/sage";
// Booking
import { coverManagerAdapter } from "@/lib/integrations/booking/covermanager";
import { openTableAdapter } from "@/lib/integrations/booking/opentable";
import { sevenRoomsAdapter } from "@/lib/integrations/booking/sevenrooms";
import { theForkAdapter } from "@/lib/integrations/booking/thefork";
// Payment
import { stripeAdapter } from "@/lib/integrations/payment/stripe";
import { adyenAdapter } from "@/lib/integrations/payment/adyen";
import { redsysAdapter } from "@/lib/integrations/payment/redsys";
import { caixaBankAdapter } from "@/lib/integrations/payment/caixabank";
// Banking
import { caixaBankBankingAdapter } from "@/lib/integrations/banking/caixabank";
import { plaidAdapter } from "@/lib/integrations/banking/plaid";
import { tinkAdapter } from "@/lib/integrations/banking/tink";
import { goCardlessAdapter } from "@/lib/integrations/banking/gocardless";
// Marketing (Grow · Reach)
import { klaviyoAdapter } from "@/lib/integrations/marketing/klaviyo";
import { mailchimpAdapter } from "@/lib/integrations/marketing/mailchimp";
import { hubspotAdapter } from "@/lib/integrations/marketing/hubspot";
import { wixNewsletterAdapter } from "@/lib/integrations/marketing/wix-newsletter";
// Social (Grow · Reach)
import { bufferAdapter } from "@/lib/integrations/social/buffer";
import { laterAdapter } from "@/lib/integrations/social/later";
import { postizAdapter } from "@/lib/integrations/social/postiz";
// Reviews (Grow · Reputation)
import { googleBusinessAdapter } from "@/lib/integrations/reviews/google-business";
import { tripAdvisorAdapter } from "@/lib/integrations/reviews/tripadvisor";
import { theForkReviewsAdapter } from "@/lib/integrations/reviews/thefork";
import { yelpAdapter } from "@/lib/integrations/reviews/yelp";

const POS: Record<string, PosAdapter> = { fresto: frestoAdapter, square: squareAdapter, micros: microsAdapter, toast: toastAdapter, lightspeed: lightspeedAdapter, csv: csvAdapter };
const ACCT: Record<string, AccountingAdapter> = { holded: holdedAdapter, apideck: apideckAdapter, quickbooks: quickbooksAdapter, xero: xeroAdapter, sage: sageAdapter };
const BOOK: Record<string, BookingAdapter> = { covermanager: coverManagerAdapter, opentable: openTableAdapter, sevenrooms: sevenRoomsAdapter, thefork: theForkAdapter };
const PAY: Record<string, PaymentAdapter> = { stripe: stripeAdapter, adyen: adyenAdapter, redsys: redsysAdapter, caixabank: caixaBankAdapter };
const BANK: Record<string, BankingAdapter> = { caixabank: caixaBankBankingAdapter, plaid: plaidAdapter, tink: tinkAdapter, gocardless: goCardlessAdapter };
const MKTG: Record<string, MarketingAdapter> = { klaviyo: klaviyoAdapter, mailchimp: mailchimpAdapter, hubspot: hubspotAdapter, "wix-newsletter": wixNewsletterAdapter };
const SOCIAL: Record<string, SocialAdapter> = { buffer: bufferAdapter, later: laterAdapter, postiz: postizAdapter };
const REVIEWS: Record<string, ReviewsAdapter> = { "google-business": googleBusinessAdapter, tripadvisor: tripAdvisorAdapter, thefork: theForkReviewsAdapter, yelp: yelpAdapter };

// Default vendor map per entity. Env vars override (e.g. FS_POS_IFL=square).
const DEFAULTS: Record<EntityCode, { pos: string; accounting: string; booking: string; payment: string; banking: string; marketing: string; social: string; reviews: string }> = {
  IFL: { pos: "fresto", accounting: "holded", booking: "covermanager", payment: "caixabank", banking: "caixabank", marketing: "klaviyo", social: "buffer", reviews: "google-business" },
  BM:  { pos: "fresto", accounting: "holded", booking: "covermanager", payment: "caixabank", banking: "caixabank", marketing: "klaviyo", social: "buffer", reviews: "google-business" },
  BBH: { pos: "fresto", accounting: "holded", booking: "covermanager", payment: "caixabank", banking: "caixabank", marketing: "klaviyo", social: "buffer", reviews: "google-business" },
};

const env = (k: string) => (typeof process !== "undefined" ? process.env[k] : undefined);
const resolve = (entity: EntityCode, kind: string, fallback: string) =>
  env(`FS_${kind}_${entity}`)?.toLowerCase() || env(`FS_${kind}`)?.toLowerCase() || fallback;

export function getPosAdapter(entity: EntityCode): PosAdapter {
  const v = resolve(entity, "POS", DEFAULTS[entity].pos);
  return POS[v] || frestoAdapter;
}
export function getAccountingAdapter(entity: EntityCode): AccountingAdapter {
  const v = resolve(entity, "ACCOUNTING", DEFAULTS[entity].accounting);
  return ACCT[v] || holdedAdapter;
}
export function getBookingAdapter(entity: EntityCode): BookingAdapter {
  const v = resolve(entity, "BOOKING", DEFAULTS[entity].booking);
  return BOOK[v] || coverManagerAdapter;
}
export function getPaymentAdapter(entity: EntityCode): PaymentAdapter {
  const v = resolve(entity, "PAYMENT", DEFAULTS[entity].payment);
  return PAY[v] || caixaBankAdapter;
}
export function getBankingAdapter(entity: EntityCode): BankingAdapter {
  const v = resolve(entity, "BANKING", DEFAULTS[entity].banking);
  return BANK[v] || caixaBankBankingAdapter;
}
export function getMarketingAdapter(entity: EntityCode): MarketingAdapter {
  const v = resolve(entity, "MARKETING", DEFAULTS[entity].marketing);
  return MKTG[v] || klaviyoAdapter;
}
export function getSocialAdapter(entity: EntityCode): SocialAdapter {
  const v = resolve(entity, "SOCIAL", DEFAULTS[entity].social);
  return SOCIAL[v] || bufferAdapter;
}
export function getReviewsAdapter(entity: EntityCode): ReviewsAdapter {
  const v = resolve(entity, "REVIEWS", DEFAULTS[entity].reviews);
  return REVIEWS[v] || googleBusinessAdapter;
}

// Status — does the adapter have credentials to actually call out?
function envBag() { return (typeof process !== "undefined" ? process.env : {}) as Record<string, string | undefined>; }
function hasAny(...keys: string[]) { const e = envBag(); return keys.some((k) => !!e[k]); }

function status(vendor: string, entity: EntityCode): "connected" | "stub" | "off" {
  switch (vendor) {
    case "holded":  return hasAny(`HOLDED_API_KEY_${entity === "IFL" ? "TALLER" : entity === "BM" ? "BISTRO_MONDO" : "HOLDINGS"}`) ? "connected" : "off";
    case "apideck": return (hasAny("APIDECK_APP_ID") && hasAny("APIDECK_API_KEY")) ? "connected" : "off";
    case "fresto":  return "connected"; // upload path is always available
    case "csv":     return "connected";
    case "stripe":  return hasAny("STRIPE_SECRET_KEY") ? "connected" : "stub";
    case "adyen":   return hasAny("ADYEN_API_KEY") ? "connected" : "stub";
    case "square":  return hasAny("SQUARE_ACCESS_TOKEN") ? "connected" : "stub";
    case "toast":   return hasAny("TOAST_CLIENT_ID") ? "connected" : "stub";
    case "covermanager": return hasAny("COVERMANAGER_API_KEY") ? "connected" : "stub";
    case "opentable": return hasAny("OPENTABLE_API_KEY") ? "connected" : "stub";
    case "tink":    return hasAny("TINK_CLIENT_ID") ? "connected" : "stub";
    case "plaid":   return hasAny("PLAID_CLIENT_ID") ? "connected" : "stub";
    case "gocardless": return hasAny("GOCARDLESS_BAD_TOKEN") ? "connected" : "stub";
    case "quickbooks": return hasAny("QBO_CLIENT_ID") ? "connected" : "stub";
    case "xero":    return hasAny("XERO_CLIENT_ID") ? "connected" : "stub";
    case "sage":    return hasAny("SAGE_API_KEY") ? "connected" : "stub";
    case "caixabank": return "connected"; // we have the bank statements feed today
    case "klaviyo": return hasAny("KLAVIYO_API_KEY") ? "connected" : "stub";
    case "mailchimp": return hasAny("MAILCHIMP_API_KEY") ? "connected" : "stub";
    case "hubspot": return hasAny("HUBSPOT_ACCESS_TOKEN") ? "connected" : "stub";
    case "wix-newsletter": return hasAny("WIX_API_TOKEN") ? "connected" : "stub";
    case "buffer": return hasAny("BUFFER_ACCESS_TOKEN") ? "connected" : "stub";
    case "later": return hasAny("LATER_API_KEY") ? "connected" : "stub";
    case "postiz": return hasAny("POSTIZ_API_KEY") ? "connected" : "stub";
    case "google-business": return hasAny("GOOGLE_BUSINESS_API_KEY") ? "connected" : "stub";
    case "tripadvisor": return hasAny("TRIPADVISOR_API_KEY") ? "connected" : "stub";
    case "thefork": return hasAny("THEFORK_API_KEY") ? "connected" : "stub";
    case "yelp": return hasAny("YELP_API_KEY") ? "connected" : "stub";
    default: return "stub";
  }
}

export function getBindings(): IntegrationBinding[] {
  return (["IFL", "BM", "BBH"] as EntityCode[]).map((entity) => {
    const pos = getPosAdapter(entity);
    const acct = getAccountingAdapter(entity);
    const book = getBookingAdapter(entity);
    const pay = getPaymentAdapter(entity);
    const bank = getBankingAdapter(entity);
    const mktg = getMarketingAdapter(entity);
    const soc = getSocialAdapter(entity);
    const rev = getReviewsAdapter(entity);
    return {
      entity,
      pos:        { vendor: pos.vendor,  status: status(pos.vendor,  entity) },
      accounting: { vendor: acct.vendor, status: status(acct.vendor, entity) },
      booking:    { vendor: book.vendor, status: status(book.vendor, entity) },
      payment:    { vendor: pay.vendor,  status: status(pay.vendor,  entity) },
      banking:    { vendor: bank.vendor, status: status(bank.vendor, entity) },
      marketing:  { vendor: mktg.vendor, status: status(mktg.vendor, entity) },
      social:     { vendor: soc.vendor,  status: status(soc.vendor,  entity) },
      reviews:    { vendor: rev.vendor,  status: status(rev.vendor,  entity) },
    };
  });
}

export const AVAILABLE = {
  pos: Object.values(POS).map((a) => ({ vendor: a.vendor, name: a.name })),
  accounting: Object.values(ACCT).map((a) => ({ vendor: a.vendor, name: a.name })),
  booking: Object.values(BOOK).map((a) => ({ vendor: a.vendor, name: a.name })),
  payment: Object.values(PAY).map((a) => ({ vendor: a.vendor, name: a.name })),
  banking: Object.values(BANK).map((a) => ({ vendor: a.vendor, name: a.name })),
  marketing: Object.values(MKTG).map((a) => ({ vendor: a.vendor, name: a.name })),
  social: Object.values(SOCIAL).map((a) => ({ vendor: a.vendor, name: a.name })),
  reviews: Object.values(REVIEWS).map((a) => ({ vendor: a.vendor, name: a.name })),
};
