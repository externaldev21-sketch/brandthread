/**
 * Types and pure helpers for Taxes and duties → Tax regions
 * (app/tax-regions.tsx, app/tax-head-office.tsx). Mirrors
 * GET/POST /api/taxes/registrations and PUT /api/taxes/head-office.
 */

export type TaxHeadOffice = {
  line1: string;
  line2: string | null;
  city: string;
  state: string | null;
  postalCode: string;
  country: string;
};

export type TaxRegion = { code: string; country: string; state: string | null; name: string };

export type TaxRegistration = TaxRegion & {
  id: string;
  status: string;
  activeFrom: string | null;
  expiresAt: string | null;
};

export type TaxRegistrationsInfo = {
  connected: boolean;
  providerConfigured: boolean;
  headOffice: TaxHeadOffice | null;
  registrations: TaxRegistration[];
  regions: TaxRegion[];
};

/** Right-hand label of a region row, like Shopify's "Basic Tax" column. */
export function registrationStatusLabel(status: string): string {
  switch (status) {
    case 'active': return 'Collecting';
    case 'scheduled': return 'Starts soon';
    case 'expired': return 'Stopped';
    default: return status ? status[0].toUpperCase() + status.slice(1) : '';
  }
}

/** One line for the head office row. */
export function headOfficeLine(address: TaxHeadOffice | null): string | null {
  if (!address) return null;
  const cityLine = [address.city, [address.state, address.postalCode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return [address.line1, cityLine, address.country].filter(Boolean).join(', ');
}

function matches(region: TaxRegion, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return region.name.toLowerCase().includes(q)
    || region.code.toLowerCase() === q
    || (region.state ?? '').toLowerCase() === q;
}

/** Registered regions filtered by the search box. */
export function filterRegistrations(list: TaxRegistration[], query: string): TaxRegistration[] {
  return list.filter((r) => matches(r, query));
}

/**
 * Regions the seller can still add: not already collecting or starting,
 * matching the search, US states first then countries (server order).
 */
export function addableRegions(info: Pick<TaxRegistrationsInfo, 'regions' | 'registrations'>, query: string): TaxRegion[] {
  const taken = new Set(
    info.registrations.filter((r) => r.status === 'active' || r.status === 'scheduled').map((r) => r.code),
  );
  return info.regions.filter((region) => !taken.has(region.code) && matches(region, query));
}

export type HeadOfficeDraft = {
  line1: string; line2: string; city: string; state: string; postalCode: string; country: string;
};

export function draftFromHeadOffice(address: TaxHeadOffice | null): HeadOfficeDraft {
  return {
    line1: address?.line1 ?? '',
    line2: address?.line2 ?? '',
    city: address?.city ?? '',
    state: address?.state ?? '',
    postalCode: address?.postalCode ?? '',
    country: address?.country ?? 'US',
  };
}

/** Field errors for the head office form; empty when it can be saved. */
export function headOfficeErrors(draft: HeadOfficeDraft): Partial<Record<keyof HeadOfficeDraft, string>> {
  const errors: Partial<Record<keyof HeadOfficeDraft, string>> = {};
  if (!draft.line1.trim()) errors.line1 = 'Enter a street address';
  if (!draft.city.trim()) errors.city = 'Enter a city';
  if (!draft.postalCode.trim()) errors.postalCode = 'Enter a ZIP or postal code';
  const country = draft.country.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) errors.country = 'Use a 2-letter country code, like US';
  if (country === 'US' && !draft.state.trim()) errors.state = 'Enter a state';
  return errors;
}

// A confirmation to show on the screen we go back to after a pushed screen
// (add a region, head office) saves. Read once.
let pendingToast: string | null = null;
export function setPendingTaxToast(message: string): void { pendingToast = message; }
export function takePendingTaxToast(): string | null {
  const message = pendingToast;
  pendingToast = null;
  return message;
}

export function headOfficeFromDraft(draft: HeadOfficeDraft): TaxHeadOffice {
  return {
    line1: draft.line1.trim(),
    line2: draft.line2.trim() || null,
    city: draft.city.trim(),
    state: draft.state.trim().toUpperCase() || null,
    postalCode: draft.postalCode.trim(),
    country: draft.country.trim().toUpperCase(),
  };
}
