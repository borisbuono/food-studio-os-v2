// lib/countries.ts — country profiles for the self-serve /onboard flow.
//
// One tiny table so the wizard can:
//   * offer a country picker with the right VAT rates, timezone, tax-id
//     label pre-filled (operator can still edit);
//   * defer country-specific complexity (fiscal quirks, filing rhythms) to
//     later once we know what breaks first.
//
// Push (2026-09-20). Boris's first paying customer is an Amsterdam venue
// so NL ships with ES. Every other country slot is placeholder until
// there's a real venue in it.

export type CountryCode = "ES" | "NL" | "FR" | "IT" | "PT" | "DE" | "GB" | "US";

export type VatRegime = {
  standard: number;
  reduced_food: number;
  zero: number;
};

export type CountryProfile = {
  code: CountryCode;
  name: string;
  vat: VatRegime;
  timezone: string;
  currency_code: string;
  tax_id_label: string;
};

export const COUNTRY_PROFILES: Record<CountryCode, CountryProfile> = {
  ES: { code: "ES", name: "Spain",         vat: { standard: 21, reduced_food: 10, zero: 0 }, timezone: "Europe/Madrid",    currency_code: "EUR", tax_id_label: "CIF" },
  NL: { code: "NL", name: "Netherlands",   vat: { standard: 21, reduced_food: 9,  zero: 0 }, timezone: "Europe/Amsterdam", currency_code: "EUR", tax_id_label: "KVK / BTW" },
  FR: { code: "FR", name: "France",        vat: { standard: 20, reduced_food: 10, zero: 0 }, timezone: "Europe/Paris",     currency_code: "EUR", tax_id_label: "SIRET" },
  IT: { code: "IT", name: "Italy",         vat: { standard: 22, reduced_food: 10, zero: 0 }, timezone: "Europe/Rome",      currency_code: "EUR", tax_id_label: "Partita IVA" },
  PT: { code: "PT", name: "Portugal",      vat: { standard: 23, reduced_food: 13, zero: 0 }, timezone: "Europe/Lisbon",    currency_code: "EUR", tax_id_label: "NIF" },
  DE: { code: "DE", name: "Germany",       vat: { standard: 19, reduced_food: 7,  zero: 0 }, timezone: "Europe/Berlin",    currency_code: "EUR", tax_id_label: "USt-IdNr" },
  GB: { code: "GB", name: "United Kingdom",vat: { standard: 20, reduced_food: 5,  zero: 0 }, timezone: "Europe/London",    currency_code: "GBP", tax_id_label: "VAT no." },
  US: { code: "US", name: "United States", vat: { standard: 0,  reduced_food: 0,  zero: 0 }, timezone: "America/New_York", currency_code: "USD", tax_id_label: "EIN" },
};

export const COUNTRY_ORDER: CountryCode[] = ["NL", "ES", "FR", "IT", "PT", "DE", "GB", "US"];

export function countryProfile(code: string | null | undefined): CountryProfile {
  const c = (code || "ES").toUpperCase() as CountryCode;
  return COUNTRY_PROFILES[c] ?? COUNTRY_PROFILES.ES;
}

// slug helper — kebab-case the trading name so /h/<slug> is stable and typable.
// Not perfect (accents get stripped) but good enough for the address bar.
export function slugify(name: string): string {
  return (name || "")
    .toString()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "house";
}
