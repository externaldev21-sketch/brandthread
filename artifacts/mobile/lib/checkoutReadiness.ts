import { CheckoutAddress, CheckoutContact, CheckoutSession } from '@/services/cartTypes';

export type CheckoutBlockingSection = 'information' | 'delivery' | 'acknowledgments';
export type CheckoutGuidedSection = 'information' | 'delivery' | 'review';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^[0-9+(). -]{7,32}$/;

export function isValidCheckoutEmail(email?: string | null): boolean {
  return EMAIL_PATTERN.test(email ?? '');
}

export function isValidCheckoutPhone(phone?: string | null): boolean {
  return PHONE_PATTERN.test((phone ?? '').trim());
}

export function isValidCheckoutPostalCode(postalCode?: string | null): boolean {
  return (postalCode ?? '').trim().length >= 3;
}

/**
 * Every shipping-address field `getCheckoutBlockingSection` requires. The
 * name is one "Full name" field (split into first/last for storage), so a
 * single-word name is accepted.
 */
export function isCompleteCheckoutAddress(address: Partial<CheckoutAddress>): boolean {
  return !!(
    address.firstName?.trim()
    && address.line1
    && address.city
    && address.state
    && isValidCheckoutPostalCode(address.postalCode)
    && address.country
  );
}

export function getCheckoutBlockingSection(
  contact: Partial<CheckoutContact>,
  address: Partial<CheckoutAddress>,
  session: Pick<CheckoutSession, 'deliveryGroups' | 'acknowledgments'>,
): CheckoutBlockingSection | null {
  if (
    !isValidCheckoutEmail(contact.email)
    || !isValidCheckoutPhone(contact.phone)
    || !isCompleteCheckoutAddress(address)
  ) {
    return 'information';
  }
  if (session.deliveryGroups.some(group => !group.selectedMethodId)) return 'delivery';
  if (session.acknowledgments.some(ack => ack.required && !ack.acknowledged)) return 'acknowledgments';
  return null;
}

export function getFirstIncompleteCheckoutSection(
  contact: Partial<CheckoutContact>,
  address: Partial<CheckoutAddress>,
  session: Pick<CheckoutSession, 'deliveryGroups' | 'acknowledgments'>,
): CheckoutGuidedSection {
  const blocking = getCheckoutBlockingSection(contact, address, session);
  if (blocking === 'information') return 'information';
  if (blocking === 'delivery') return 'delivery';
  return 'review';
}

/**
 * The single most useful next step, shown under the disabled "Place order"
 * button so a buyer is never left guessing why it won't enable. Follows the
 * same order `getCheckoutBlockingSection` checks in (top of the screen down).
 * Returns null once checkout is ready.
 */
export function getCheckoutNextStepHint(
  contact: Partial<CheckoutContact>,
  address: Partial<CheckoutAddress>,
  session: Pick<CheckoutSession, 'deliveryGroups' | 'acknowledgments'>,
): string | null {
  if (!isValidCheckoutEmail(contact.email)) return 'Enter a valid email to continue';
  if (!isValidCheckoutPhone(contact.phone)) return 'Enter a phone number for delivery updates';
  if (!isCompleteCheckoutAddress(address)) return 'Add a shipping address to continue';
  if (session.deliveryGroups.some(group => !group.selectedMethodId)) return 'Choose a delivery option to continue';
  if (session.acknowledgments.some(ack => ack.required && !ack.acknowledged)) return 'Accept the pre-order terms to continue';
  return null;
}

/** Inline, per-field messages for the Contact section. Only the fields asked for. */
export function getCheckoutContactErrors(contact: Partial<CheckoutContact>): { email?: string; phone?: string } {
  const errors: { email?: string; phone?: string } = {};
  if (!contact.email?.trim()) errors.email = 'Enter your email address';
  else if (!isValidCheckoutEmail(contact.email.trim())) errors.email = 'Enter a valid email, like name@example.com';
  if (!contact.phone?.trim()) errors.phone = 'Enter a phone number for delivery updates';
  else if (!isValidCheckoutPhone(contact.phone)) errors.phone = 'Enter a valid phone number';
  return errors;
}

export type CheckoutAddressField = 'firstName' | 'lastName' | 'line1' | 'city' | 'state' | 'postalCode' | 'country';

/** Inline, per-field messages for the shipping address editor. */
export function getCheckoutAddressErrors(address: Partial<CheckoutAddress>): Partial<Record<CheckoutAddressField, string>> {
  const errors: Partial<Record<CheckoutAddressField, string>> = {};
  if (!address.firstName?.trim()) errors.firstName = 'Enter the recipient’s full name';
  if (!address.line1?.trim()) errors.line1 = 'Enter a street address';
  if (!address.city?.trim()) errors.city = 'Required';
  if (!address.state?.trim()) errors.state = 'Required';
  if (!isValidCheckoutPostalCode(address.postalCode)) errors.postalCode = 'Enter a valid code';
  if (!address.country?.trim()) errors.country = 'Required';
  return errors;
}

/**
 * The client-side "I agree to the Terms…" checkbox this screen used to add to
 * every session. It was never sent to or enforced by the server (the only
 * legally-recorded agreement is the sign-up LegalConsent checkbox), so the
 * redesigned checkout replaces it with a plain "By placing your order you
 * agree to…" line under the button. Sessions persisted before that change can
 * still carry it, so it is stripped on load instead of blocking the button.
 * Pre-order acknowledgments are NOT affected — they stay required checkboxes.
 */
export const IMPLICIT_TERMS_ACK_KEY = 'terms';

export function withoutImplicitTermsAck<T extends { key: string }>(acknowledgments: T[]): T[] {
  return acknowledgments.filter(ack => ack.key !== IMPLICIT_TERMS_ACK_KEY);
}

export interface CheckoutDisplayTotals {
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  /** Bundle savings, already inside the total (shown on their own line). */
  bundleSavingsCents?: number;
  /** Promo code savings — only applied server-side to single-seller checkouts. */
  promoCents: number;
  /** Loyalty rewards already folded into summary.totalCents (Thread Cash has its own line). */
  rewardsCents: number;
  /**
   * Item 109: Thread Cash applied to this order. It's folded into
   * summary.totalCents like rewards, but shown on its own line, after the
   * order total, because it pays part of that total rather than lowering the
   * price (talabat "Pay with credit" / "Pay by card").
   */
  threadCashCents: number;
  /** What the order costs before Thread Cash: totalCents + threadCashCents. */
  orderTotalCents: number;
  /** What the card is charged (and what "Place order · $X" shows). */
  totalCents: number;
}

/**
 * The one price breakdown the screen shows. `summary.totalCents` already
 * nets out rewards; a validated promo code is subtracted on top because the
 * server applies it to the Stripe session (pay() sends `discountCode` for
 * single-seller orders only — so multi-seller orders never show it either).
 * Stripe remains the final authority on tax and the charged amount.
 */
export function getCheckoutDisplayTotals(
  session: Pick<CheckoutSession, 'summary' | 'discounts' | 'deliveryGroups'> & Partial<Pick<CheckoutSession, 'threadCashRedemption'>>,
): CheckoutDisplayTotals {
  const { summary } = session;
  const promoApplies = session.deliveryGroups.length === 1;
  const promoCents = promoApplies
    ? session.discounts.filter(d => d.isValid).reduce((sum, d) => sum + Math.max(0, d.appliedAmountCents || 0), 0)
    : 0;
  // Only what the summary actually folded in (withThreadCashRedemption keeps
  // them in step), so the lines always add up to the total.
  const threadCashCents = Math.min(Math.max(0, session.threadCashRedemption?.discountCents ?? 0), Math.max(0, summary.discountTotalCents));
  // The promo comes off the order before Thread Cash pays for part of it (the
  // server's order too, routes/buyer.ts), so it's capped by the total before
  // Thread Cash, never by what's left after it.
  const beforeThreadCashCents = summary.totalCents + threadCashCents;
  const cappedPromo = Math.min(promoCents, Math.max(0, beforeThreadCashCents));
  const orderTotalCents = Math.max(0, beforeThreadCashCents - cappedPromo);
  return {
    subtotalCents: summary.subtotalCents,
    shippingCents: summary.shippingTotalCents,
    taxCents: summary.taxTotalCents,
    bundleSavingsCents: Math.max(0, summary.bundleSavingsCents ?? 0),
    promoCents: cappedPromo,
    rewardsCents: summary.discountTotalCents - threadCashCents,
    threadCashCents,
    orderTotalCents,
    totalCents: Math.max(0, orderTotalCents - threadCashCents),
  };
}

export function mergeCheckoutFormState(
  session: CheckoutSession,
  contact: Partial<CheckoutContact>,
  address: Partial<CheckoutAddress>,
): CheckoutSession {
  return {
    ...session,
    contact: contact as CheckoutContact,
    shippingAddress: address as CheckoutAddress,
  };
}
