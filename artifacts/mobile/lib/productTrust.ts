/**
 * Seller-backed trust copy for the buyer product page and the Shop sheet.
 *
 * Source: GET /api/public/products/:id returns `sellerReturnPolicy`,
 * `sellerCancellationPolicy` and `sellerShipping` (api-server
 * lib/publicProductTrust.ts), all straight from what the seller configured.
 * Nothing here invents terms: missing data means the line is hidden, or the
 * policy row says it isn't listed.
 *
 * Pure module: no react-native imports, safe to unit test.
 */
import { formatCents } from './money';

export type SellerShippingSummary = {
  /** Domestic shipping charge in cents; null when it depends on weight. */
  rateCents: number | null;
  /** Subtotal at which shipping is free; null = never. */
  freeAboveCents: number | null;
  /** Business days before the seller ships; null when not set. */
  processingDays: number | null;
};

/** Shown in the policy rows when the seller hasn't written a policy. */
export const POLICY_NOT_LISTED = 'Not listed by the seller';

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function cents(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

/** The seller's own policy text from the public product row ('' when none). */
export function readSellerPolicies(row: unknown): { refundPolicy: string; cancellationPolicy: string } {
  const r = (row ?? {}) as Record<string, unknown>;
  return {
    refundPolicy: cleanText(r.sellerReturnPolicy),
    cancellationPolicy: cleanText(r.sellerCancellationPolicy),
  };
}

/** The seller's shipping summary from the public product row, or null. */
export function readSellerShipping(row: unknown): SellerShippingSummary | null {
  const raw = (row as Record<string, unknown> | null | undefined)?.sellerShipping;
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  const summary: SellerShippingSummary = {
    rateCents: cents(s.rateCents),
    freeAboveCents: cents(s.freeAboveCents),
    processingDays: typeof s.processingDays === 'number' && Number.isInteger(s.processingDays) && s.processingDays >= 0
      ? s.processingDays : null,
  };
  return summary.rateCents == null && summary.freeAboveCents == null && summary.processingDays == null ? null : summary;
}

/** $75 for whole dollars, $5.95 otherwise. */
function money(c: number): string {
  return c % 100 === 0 ? `$${(c / 100).toLocaleString('en-US')}` : formatCents(c);
}

/** "Shipping $5.95 · Free over $75", "Free shipping", "Shipping $5.95", or null (hide the line). */
export function shippingCostLine(shipping: SellerShippingSummary | null | undefined): string | null {
  if (!shipping) return null;
  const { rateCents, freeAboveCents } = shipping;
  if (rateCents === 0) return 'Free shipping';
  // A free-over threshold of $0 means every order ships free.
  if (freeAboveCents === 0) return 'Free shipping';
  const parts: string[] = [];
  if (rateCents != null) parts.push(`Shipping ${money(rateCents)}`);
  if (freeAboveCents != null) parts.push(parts.length ? `Free over ${money(freeAboveCents)}` : `Free shipping over ${money(freeAboveCents)}`);
  return parts.length ? parts.join(' · ') : null;
}

/** "Ships in 3 business days" from the seller's processing time; null for pre-orders or when unset. */
export function processingTimeLine(shipping: SellerShippingSummary | null | undefined, isPreOrder: boolean): string | null {
  const days = shipping?.processingDays;
  if (isPreOrder || days == null) return null;
  if (days === 0) return 'Ships in 1 business day';
  return `Ships in ${days} business day${days === 1 ? '' : 's'}`;
}

const NO_RETURNS = /\b(no returns?|non[-\s]?returnable|all sales (are )?final|final sale|not accept(ed)? returns?|returns? (are )?not accepted|do(es)? not accept returns?|only (for|if|when)|unless)\b/i;
const RETURNS_WORD = /\breturn(s|ed|able)?\b|\brefund(s|ed|able)?\b|\bexchange(s|d)?\b/i;

/**
 * True only when the seller's own policy text plainly offers returns: it
 * talks about returns/refunds/exchanges and does not say "no returns",
 * "final sale" or limit them to special cases ("only if damaged").
 * Anything ambiguous returns false, so the "Returns accepted" cue hides.
 */
export function sellerAcceptsReturns(policy: string | null | undefined): boolean {
  const text = cleanText(policy);
  if (!text) return false;
  if (NO_RETURNS.test(text)) return false;
  return RETURNS_WORD.test(text);
}
