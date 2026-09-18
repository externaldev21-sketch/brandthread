import { CheckoutAddress, CheckoutContact, CheckoutSession } from '@/services/cartTypes';

export type CheckoutBlockingSection = 'information' | 'delivery' | 'acknowledgments';
export type CheckoutGuidedSection = 'information' | 'delivery' | 'review';

export function getCheckoutBlockingSection(
  contact: Partial<CheckoutContact>,
  address: Partial<CheckoutAddress>,
  session: Pick<CheckoutSession, 'deliveryGroups' | 'acknowledgments'>,
): CheckoutBlockingSection | null {
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email ?? '');
  const validPhone = /^[0-9+(). -]{7,32}$/.test((contact.phone ?? '').trim());
  const validPostalCode = (address.postalCode ?? '').trim().length >= 3;
  if (
    !validEmail
    || !validPhone
    || !address.firstName
    || !address.lastName
    || !address.line1
    || !address.city
    || !address.state
    || !validPostalCode
    || !address.country
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