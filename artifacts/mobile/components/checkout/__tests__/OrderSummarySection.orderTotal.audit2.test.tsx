/**
 * Audit regression: with Thread Cash AND a store gift card applied, the price
 * breakdown printed two "Order total" lines with different values — one
 * leaving out the gift card (orderTotalCents), one leaving out Thread Cash
 * (totalCents + gift card). The order costs totalCents (charged to card) +
 * Thread Cash + gift card (server: checkout-intent.ts totalCents =
 * full - threadCash - giftCard), so show that once.
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/components/ui/Icon', () => ({ Icon: () => null }));
vi.mock('@/components/CachedImage', () => ({ CachedImage: () => null }));
vi.mock('@/components/intl/ApproxPrice', () => ({ ApproxPrice: () => null }));
vi.mock('../CheckoutLanguage', () => ({
  useCheckoutT: () => (key: string, vars?: Record<string, unknown>) => key.replace(/\{(\w+)\}/g, (_, k) => String(vars?.[k] ?? '')),
}));
vi.mock('../CheckoutPrimitives', () => {
  const R = require('react') as typeof import('react');
  return {
    useCheckoutColors: () => ({ text: '#fff', muted: '#888', subtle: '#555', divider: '#333' }),
    CheckoutSection: (props: Record<string, unknown>) => R.createElement('CheckoutSection', null, props.children as React.ReactNode),
  };
});

const { OrderSummarySection } = await import('../OrderSummarySection');

const session = { deliveryGroups: [] } as never;
const base = {
  subtotalCents: 7500, shippingCents: 0, taxCents: 0, promoCents: 0, rewardsCents: 0,
};

function orderTotalLines(r: ReactTestRenderer): string[] {
  return r.root.findAll((n) => n.props.testID === 'checkout-order-total-line' && (n.type as unknown) === 'View')
    .map((n) => n.findAll((c) => (c.type as unknown) === 'Text').map((t) => [t.props.children].flat().join('')).join(' '));
}

describe('OrderSummarySection — order total with Thread Cash and a gift card', () => {
  it('shows a single, truthful "Order total"', async () => {
    let r!: ReactTestRenderer;
    // Card pays $60; Thread Cash $10 and a $5 gift card paid the rest of a $75 order.
    const totals = { ...base, threadCashCents: 1000, orderTotalCents: 7000, totalCents: 6000 };
    await act(async () => { r = create(<OrderSummarySection session={session} totals={totals} itemCount={1} giftCardCents={500} />); });
    expect(orderTotalLines(r)).toEqual(['Order total $75.00']);
    r.unmount();
  });

  it('keeps Thread-Cash-only and gift-card-only totals', async () => {
    let r!: ReactTestRenderer;
    await act(async () => {
      r = create(<OrderSummarySection session={session} totals={{ ...base, threadCashCents: 1000, orderTotalCents: 7500, totalCents: 6500 }} itemCount={1} />);
    });
    expect(orderTotalLines(r)).toEqual(['Order total $75.00']);
    await act(async () => {
      r.update(<OrderSummarySection session={session} totals={{ ...base, threadCashCents: 0, orderTotalCents: 7000, totalCents: 7000 }} itemCount={1} giftCardCents={500} />);
    });
    expect(orderTotalLines(r)).toEqual(['Order total $75.00']);
    r.unmount();
  });
});
