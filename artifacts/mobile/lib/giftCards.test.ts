import { describe, expect, it } from 'vitest';
import {
  amountTextToCents, giftCardBalanceLine, giftCardMask, giftCardPurchaseIssue, spendableCards, type GiftCard,
} from './giftCards';
import { buildQuoteBody, paymentGroups, quoteTotals } from './checkoutPayment';

const card = (over: Partial<GiftCard>): GiftCard => ({
  id: 'c', sellerId: 's1', last4: '1234', initialCents: 5000, balanceCents: 5000, status: 'active', expiresAt: null,
  createdAt: '2026-01-01', role: 'owner', recipientName: null, message: null, ...over,
});
const info = { denominations: [2500, 5000], allowCustom: false, minCents: 500, maxCents: 100000 };

describe('gift card helpers', () => {
  it('only offers active cards the buyer owns, for the right store', () => {
    const cards = [card({ id: 'a' }), card({ id: 'b', role: 'purchaser' }), card({ id: 'c', status: 'depleted' }), card({ id: 'd', sellerId: 's2' })];
    expect(spendableCards(cards, 's1').map(c => c.id)).toEqual(['a']);
    expect(spendableCards(cards).map(c => c.id)).toEqual(['a', 'd']);
  });

  it('formats masks and balances', () => {
    expect(giftCardMask({ last4: '4821' })).toBe('•••• 4821');
    expect(giftCardBalanceLine({ balanceCents: 3200, initialCents: 5000 })).toBe('$32.00 of $50.00');
    expect(giftCardBalanceLine({ balanceCents: 5000, initialCents: 5000 })).toBe('$50.00');
  });

  it('parses typed amounts strictly', () => {
    expect(amountTextToCents('25')).toBe(2500);
    expect(amountTextToCents('$12.5')).toBe(1250);
    expect(amountTextToCents('abc')).toBeNull();
    expect(amountTextToCents('1.234')).toBeNull();
    expect(amountTextToCents('0')).toBeNull();
  });

  it('says what is missing before paying', () => {
    expect(giftCardPurchaseIssue({ amountCents: null, info, email: 'a@b.co' })).toBe('Choose an amount');
    expect(giftCardPurchaseIssue({ amountCents: 3000, info, email: 'a@b.co' })).toContain('one of the amounts');
    expect(giftCardPurchaseIssue({ amountCents: 2500, info, email: 'nope' })).toContain('email');
    expect(giftCardPurchaseIssue({ amountCents: 2500, info, email: 'a@b.co' })).toBeNull();
    expect(giftCardPurchaseIssue({ amountCents: 300, info: { ...info, allowCustom: true }, email: 'a@b.co' })).toContain('from $5.00');
  });
});

describe('checkout request with a gift card', () => {
  const session = {
    deliveryGroups: [
      { sellerId: 's1', items: [{ variantId: 'v1', productId: 'p1', quantity: 1 }] },
      { sellerId: 's2', items: [{ variantId: 'v2', productId: 'p2', quantity: 1 }] },
    ],
    discounts: [],
    giftCards: { s1: { cardId: 'card-1', last4: '1234' } },
  } as any;

  it('attaches the card to its own seller group only', () => {
    const groups = paymentGroups(session);
    expect(groups[0].giftCard).toEqual({ cardId: 'card-1' });
    expect(groups[1].giftCard).toBeUndefined();
    expect(JSON.stringify(buildQuoteBody(session, { postalCode: '10012' }))).toContain('card-1');
  });

  it('leaves the request unchanged when no card is applied', () => {
    expect(paymentGroups({ ...session, giftCards: undefined }).every(g => !('giftCard' in g))).toBe(true);
  });

  it('totals the gift card cents only when there are some', () => {
    const base = { sellerId: 'a', checkoutSessionId: '', subtotalCents: 1000, shippingCents: 0, discountCents: 0, taxCents: 0, totalCents: 400, processingDays: null };
    expect(quoteTotals({ amountCents: 400, groups: [{ ...base, giftCardCents: 600 }] }).giftCardCents).toBe(600);
    expect('giftCardCents' in quoteTotals({ amountCents: 400, groups: [base] })).toBe(false);
  });
});
