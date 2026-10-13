/**
 * Regions a seller can add a Stripe Tax registration for from the app
 * (routes/taxes.ts → stripe.tax.registrations on the seller's connected
 * account). US states use Stripe's state sales tax registration; the
 * countries listed use Stripe's "standard" registration type. Anything else
 * (EU OSS/IOSS, US local taxes, Canadian provincial PST/QST) is still managed
 * in the Stripe Dashboard.
 */
export type TaxRegion = {
  /** Stable id used by the app: "US-CA", "GB". */
  code: string;
  country: string;
  state: string | null;
  name: string;
};

const US_STATES: Array<[string, string]> = [
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"], ["CA", "California"],
  ["CO", "Colorado"], ["CT", "Connecticut"], ["DE", "Delaware"], ["DC", "District of Columbia"], ["FL", "Florida"],
  ["GA", "Georgia"], ["HI", "Hawaii"], ["ID", "Idaho"], ["IL", "Illinois"], ["IN", "Indiana"],
  ["IA", "Iowa"], ["KS", "Kansas"], ["KY", "Kentucky"], ["LA", "Louisiana"], ["ME", "Maine"],
  ["MD", "Maryland"], ["MA", "Massachusetts"], ["MI", "Michigan"], ["MN", "Minnesota"], ["MS", "Mississippi"],
  ["MO", "Missouri"], ["MT", "Montana"], ["NE", "Nebraska"], ["NV", "Nevada"], ["NH", "New Hampshire"],
  ["NJ", "New Jersey"], ["NM", "New Mexico"], ["NY", "New York"], ["NC", "North Carolina"], ["ND", "North Dakota"],
  ["OH", "Ohio"], ["OK", "Oklahoma"], ["OR", "Oregon"], ["PA", "Pennsylvania"], ["RI", "Rhode Island"],
  ["SC", "South Carolina"], ["SD", "South Dakota"], ["TN", "Tennessee"], ["TX", "Texas"], ["UT", "Utah"],
  ["VT", "Vermont"], ["VA", "Virginia"], ["WA", "Washington"], ["WV", "West Virginia"], ["WI", "Wisconsin"],
  ["WY", "Wyoming"],
];

const STANDARD_COUNTRIES: Array<[string, string]> = [
  ["AU", "Australia"], ["CA", "Canada"], ["NZ", "New Zealand"], ["GB", "United Kingdom"],
];

export const TAX_REGIONS: TaxRegion[] = [
  ...US_STATES.map(([state, name]) => ({ code: `US-${state}`, country: "US", state, name })),
  ...STANDARD_COUNTRIES.map(([country, name]) => ({ code: country, country, state: null, name })),
];

const BY_CODE = new Map(TAX_REGIONS.map((region) => [region.code, region]));

export function findTaxRegion(code: unknown): TaxRegion | null {
  if (typeof code !== "string") return null;
  return BY_CODE.get(code.trim().toUpperCase()) ?? null;
}

/** Params for stripe.tax.registrations.create. */
export function registrationCreateParams(region: TaxRegion) {
  const key = region.country.toLowerCase();
  return {
    country: region.country,
    active_from: "now" as const,
    country_options: region.state
      ? { [key]: { state: region.state, type: "state_sales_tax" } }
      : { [key]: { type: "standard" } },
  };
}

/** The region a Stripe registration is for, from its country + country_options. */
export function regionOfRegistration(registration: any): TaxRegion | { code: string; country: string; state: string | null; name: string } {
  const country = String(registration?.country ?? "").toUpperCase();
  const options = registration?.country_options?.[country.toLowerCase()] ?? null;
  const state = typeof options?.state === "string" ? options.state.toUpperCase() : null;
  const known = BY_CODE.get(state ? `${country}-${state}` : country);
  if (known) return known;
  return { code: state ? `${country}-${state}` : country, country, state, name: state ? `${state}, ${country}` : country };
}

export type HeadOfficeAddress = {
  line1: string;
  line2: string | null;
  city: string;
  state: string | null;
  postalCode: string;
  country: string;
};

const clean = (value: unknown, max = 200): string =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

/** Validates an app-supplied head office address; null when unusable. */
export function parseHeadOffice(input: unknown): HeadOfficeAddress | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const country = clean(raw.country, 2).toUpperCase();
  const address: HeadOfficeAddress = {
    line1: clean(raw.line1),
    line2: clean(raw.line2) || null,
    city: clean(raw.city, 100),
    state: clean(raw.state, 100) || null,
    postalCode: clean(raw.postalCode, 20),
    country,
  };
  if (!address.line1 || !address.city || !address.postalCode || !/^[A-Z]{2}$/.test(country)) return null;
  if (country === "US" && !address.state) return null;
  return address;
}

export function toStripeAddress(address: HeadOfficeAddress) {
  return {
    line1: address.line1,
    ...(address.line2 ? { line2: address.line2 } : {}),
    city: address.city,
    ...(address.state ? { state: address.state } : {}),
    postal_code: address.postalCode,
    country: address.country,
  };
}

/** A Stripe address (tax settings head office, or the account's business address) in app shape. */
export function fromStripeAddress(address: any): HeadOfficeAddress | null {
  if (!address) return null;
  return parseHeadOffice({
    line1: address.line1, line2: address.line2, city: address.city, state: address.state,
    postalCode: address.postal_code, country: address.country,
  });
}
