/**
 * Round 2 fix-backs for docs/audit/buyer-commerce.md (PDP, bag, checkout).
 * Pure helpers are tested directly; screen wiring is pinned by source.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { containedPhotoBands } from '@/lib/touchInput';
import { withTaxEstimate, type CheckoutDisplayTotals } from '@/lib/checkoutReadiness';
import { serviceTitle } from '@/components/checkout/OrderSummarySection';

const read = (file: string) => readFileSync(resolve(__dirname, '..', file), 'utf8');

describe('containedPhotoBands (pinch hint anchored to the photo)', () => {
  it('a wide photo in a tall box leaves bands above and below', () => {
    expect(containedPhotoBands(390, 520, 1)).toEqual({ horizontal: 0, vertical: 65 });
  });
  it('a tall photo in a wide box leaves bands on the sides', () => {
    expect(containedPhotoBands(400, 400, 0.5)).toEqual({ horizontal: 100, vertical: 0 });
  });
  it('a photo that fills the box, or an unknown ratio, leaves none', () => {
    expect(containedPhotoBands(300, 400, 0.75)).toEqual({ horizontal: 0, vertical: 0 });
    expect(containedPhotoBands(300, 400, undefined)).toEqual({ horizontal: 0, vertical: 0 });
    expect(containedPhotoBands(300, 400, Number.NaN)).toEqual({ horizontal: 0, vertical: 0 });
  });
});

describe('PDP gallery pinch hint', () => {
  const pdp = read('app/buyer-product-detail.tsx');
  it('only shows on touch devices and sits on the photo, not the letterbox band', () => {
    expect(pdp).toContain('const showPinchHint = useMemo(() => supportsTouchGestures(), [])');
    expect(pdp).toContain("showPinchHint && slides[activeIndex]?.kind === 'image'");
    expect(pdp).toContain('bottom: SP.md + bands.vertical');
  });
  it('labels the countdown with what ends', () => {
    expect(pdp).toContain("label={product.preOrderClosingDate ? 'Pre-orders close in' : 'Drop ends in'}");
  });
});

describe('withTaxEstimate (hosted checkout tax estimate)', () => {
  const totals: CheckoutDisplayTotals = {
    subtotalCents: 10_000, shippingCents: 1_200, taxCents: 0, promoCents: 0, rewardsCents: 0,
    threadCashCents: 0, orderTotalCents: 11_200, totalCents: 11_200,
  };
  it('adds the estimate to the tax line and both totals so the lines add up', () => {
    const next = withTaxEstimate(totals, 890);
    expect(next.taxCents).toBe(890);
    expect(next.orderTotalCents).toBe(12_090);
    expect(next.totalCents).toBe(12_090);
  });
  it('leaves the totals alone for a zero or invalid estimate', () => {
    expect(withTaxEstimate(totals, 0).totalCents).toBe(11_200);
    expect(withTaxEstimate(totals, Number.NaN).totalCents).toBe(11_200);
    expect(withTaxEstimate(totals, -5).taxCents).toBe(0);
  });
  it('checkout quotes the hosted path too, and says "Calculated at payment" without an estimate', () => {
    const checkout = read('app/buyer-checkout.tsx');
    expect(checkout).toContain("(inApp || payment.path === 'hosted') && canQuote(address)");
    expect(checkout).toContain('withTaxEstimate(sessionTotals, quoteTotals(activeQuote).taxCents)');
    expect(checkout).toContain("? undefined : 'Calculated at payment'");
    expect(checkout).not.toContain("'Added with your address'");
  });
});

describe('serviceTitle (courier time vs processing window)', () => {
  it('qualifies a rate name that carries its own transit time', () => {
    expect(serviceTitle('Express courier (2–3 days)')).toBe('Express courier (2–3 days) after it ships');
  });
  it('leaves a plain rate name alone', () => {
    expect(serviceTitle('Standard shipping')).toBe('Standard shipping');
  });
});

describe('bag', () => {
  const cart = read('app/(buyer)/cart.tsx');
  it('takes shipping from the same per-seller rate checkout charges, with a line per brand', () => {
    expect(cart).toContain('const shippingRates = useBagShippingRates(groups);');
    expect(cart).toContain('const shippingTotal = bagShippingTotal(groups, shippingRates);');
    expect(cart).toContain('<GroupShippingLine cents={shippingRates[group.sellerId]}');
    expect(cart).not.toContain('estimateGroupShipping');
  });
  it('saved-for-later move/remove are guarded, show progress and report failures', () => {
    expect(cart).toContain('if (pendingSavedRef.current.has(savedId)) return;');
    expect(cart).toContain("loading={busy === 'move'}");
    expect(cart).toContain("loading={busy === 'remove'}");
    expect(cart).toContain("friendlyError(error, 'Try again.')");
  });
  it('shows the saved item photo and never calls the web no-op Alert.alert', () => {
    expect(cart).toContain('<CachedImage source={{ uri: item.imageUri }}');
    expect(cart).not.toContain('Alert.alert(');
  });
});
