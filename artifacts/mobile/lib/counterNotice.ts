/**
 * Seller DMCA counter-notice (POST /api/ip-cases/seller/:reference/counter-notice).
 * Mirrors the server's validation (api-server lib/ipCounterNotice.ts) so the
 * form can point at the exact missing element before submitting.
 */

export interface SellerIpCase {
  caseReference: string;
  rightsType: string;
  status: string;
  listingProductId: string | null;
  listingName: string | null;
  takedownAt: string | null;
  counterNoticeStatus: 'none' | 'received' | 'reinstated' | 'upheld' | string;
  counterNoticeReceivedAt: string | null;
  canFileCounterNotice: boolean;
}

export interface CounterNoticeInput {
  fullName: string;
  address: string;
  phone: string;
  email?: string;
  removedMaterial: string;
  explanation: string;
  perjuryStatement: boolean;
  consentToJurisdiction: boolean;
  signature: string;
}

export const PERJURY_COPY =
  'I swear, under penalty of perjury, that I have a good faith belief that the material identified above was removed or disabled as a result of a mistake or misidentification of the material to be removed or disabled.';

export const JURISDICTION_COPY =
  'I consent to the jurisdiction of the Federal District Court for the judicial district in which my address is located (or, if my address is outside the United States, any judicial district in which Brandthread may be found), and I will accept service of process from the person who filed the original notice or their agent.';

const norm = (v: string) => v.trim().toLowerCase().replace(/\s+/g, ' ');

/** First problem with the form, or null when it can be submitted. */
export function counterNoticeError(input: CounterNoticeInput): string | null {
  if (input.fullName.trim().length < 2) return 'Enter your full legal name.';
  if (input.address.trim().length < 10) return 'Enter your full postal address.';
  if (input.phone.replace(/\D/g, '').length < 7) return 'Enter a phone number where you can be reached.';
  if (input.email?.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) return 'Enter a valid email address.';
  if (input.removedMaterial.trim().length < 5) return 'Identify the removed listing and where it appeared.';
  if (input.explanation.trim().length < 20) return 'Explain why the listing was removed by mistake (at least 20 characters).';
  if (!input.perjuryStatement) return 'Confirm the statement made under penalty of perjury.';
  if (!input.consentToJurisdiction) return 'Confirm your consent to jurisdiction and service of process.';
  if (input.signature.trim().length < 2) return 'Type your full name as your electronic signature.';
  if (norm(input.signature) !== norm(input.fullName)) return 'Your signature must match your full legal name.';
  return null;
}

/** Prefilled identification of the removed material. */
export function defaultRemovedMaterial(c: Pick<SellerIpCase, 'listingName' | 'listingProductId' | 'caseReference'>): string {
  const where = c.listingProductId ? `brandthread.app/product/${c.listingProductId}` : 'my Brandthread store';
  return `${c.listingName ? `My listing "${c.listingName}"` : 'My listing'} at ${where} (case ${c.caseReference}).`;
}

export function counterNoticeStatusLabel(c: Pick<SellerIpCase, 'counterNoticeStatus' | 'canFileCounterNotice'>): string {
  switch (c.counterNoticeStatus) {
    case 'received': return 'Counter-notice under review';
    case 'reinstated': return 'Listing reinstated';
    case 'upheld': return 'Takedown upheld';
    default: return c.canFileCounterNotice ? 'You can file a counter-notice' : 'Taken down';
  }
}
