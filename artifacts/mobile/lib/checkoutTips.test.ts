import { describe, expect, it } from 'vitest';
import {
  MAX_TIP_CENTS_CLIENT, maxTipCents, parseTipInput, percentTipCents, tipCentsFor, tipsForRequest,
} from './checkoutTips';
import { buildCreatePaymentIntentBody, buildQuoteBody, paymentGroups, quoteTipCents } from './checkoutPayment';

describe('tip amounts', () => {
  it('rounds percentage presets to the cent', () => {
    expect(percentTipCents(2_999, 15)).toBe(450);
    expect(percentTipCents(1_000, 10)).toBe(100);
    expect(percentTipCents(0, 20)).toBe(0);
  });

  it('parses custom amounts', () => {
    expect(parseTipInput('5')).toBe(500);
    expect(parseTipInput('$5.5')).toBe(550);
    expect(parseTipInput(' 2.25 ')).toBe(225);
    expect(parseTipInput('')).toBe(0);
    expect(parseTipInput('abc')).toBeNull();
    expect(parseTipInput('1.234')).toBeNull();
    expect(parseTipInput('-1')).toBeNull();
  });

  it('caps a tip at the subtotal and at the server maximum', () => {
    expect(maxTipCents(2_000)).toBe(2_000);
    expect(maxTipCents(10_000_000)).toBe(MAX_TIP_CENTS_CLIENT);
    expect(tipCentsFor({ kind: 'custom', text: '20' }, 2_000)).toBe(2_000);
    expect(tipCentsFor({ kind: 'custom', text: '20.01' }, 2_000)).toBeNull();
    expect(tipCentsFor({ kind: 'none' }, 2_000)).toBe(0);
    expect(tipCentsFor({ kind: 'percent', percent: 20 }, 2_000)).toBe(400);
  });
});

describe('tipsForRequest', () => {
  const groups = [
    { sellerId: 'tips-on', subtotalCents: 2_000, tippingEnabled: true },
    { sellerId: 'tips-off', subtotalCents: 2_000, tippingEnabled: false },
  ];

  it('only sends valid, non-zero tips for sellers that accept tips', () => {
    expect(tipsForRequest({
      'tips-on': { kind: 'percent', percent: 15 },
      'tips-off': { kind: 'custom', text: '5' },
    }, groups)).toEqual({ 'tips-on': 300 });
    expect(tipsForRequest({ 'tips-on': { kind: 'custom', text: 'nope' } }, groups)).toEqual({});
    expect(tipsForRequest({ 'tips-on': { kind: 'none' } }, groups)).toEqual({});
    expect(tipsForRequest({}, groups)).toEqual({});
  });
});

describe('tips in payment requests', () => {
  const session = {
    deliveryGroups: [
      { sellerId: 's1', items: [{ variantId: 'v1', productId: 'p1', quantity: 1 }] },
      { sellerId: 's2', items: [{ variantId: 'v2', productId: 'p2', quantity: 1 }] },
    ],
    discounts: [],
  } as any;

  it('adds tipCents to the matching seller group only', () => {
    expect(paymentGroups(session, { s2: 250 })).toEqual([
      { items: [{ variantId: 'v1', productId: 'p1', quantity: 1 }] },
      { items: [{ variantId: 'v2', productId: 'p2', quantity: 1 }], tipCents: 250 },
    ]);
    expect(paymentGroups(session)).toEqual([
      { items: [{ variantId: 'v1', productId: 'p1', quantity: 1 }] },
      { items: [{ variantId: 'v2', productId: 'p2', quantity: 1 }] },
    ]);
  });

  it('carries tips in the quote and create bodies', () => {
    expect(buildQuoteBody(session, { postalCode: '10001', country: 'US' }, { s1: 100 }).groups[0].tipCents).toBe(100);
    const body = buildCreatePaymentIntentBody({
      session, contact: { email: 'a@b.co', phone: '5555555555' }, address: { postalCode: '10001' },
      idempotencyKey: 'ck_123456789', saveCard: true, tips: { s1: 100 },
    });
    expect(body.groups[0].tipCents).toBe(100);
    expect(body.groups[1].tipCents).toBeUndefined();
  });

  it('totals the tips in a quote', () => {
    expect(quoteTipCents({
      amountCents: 0,
      groups: [
        { sellerId: 'a', checkoutSessionId: '', subtotalCents: 0, shippingCents: 0, discountCents: 0, taxCents: 0, totalCents: 0, processingDays: null, tipCents: 300 },
        { sellerId: 'b', checkoutSessionId: '', subtotalCents: 0, shippingCents: 0, discountCents: 0, taxCents: 0, totalCents: 0, processingDays: null },
      ],
    })).toBe(300);
  });
});
