/**
 * Audit regressions for ShopProductSheet:
 *
 * 1. Switching tags while the previous tag's product is still loading used to
 *    let the slower, older response land last and overwrite the active tag's
 *    product — the DETAIL step then showed (and Add to bag added) product A
 *    under tag B's attribution.
 * 2. A second Add to bag inside the 1.2s "Added to bag" window left the first
 *    add's timer running, so it hid the second confirmation early.
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const cart = vi.hoisted(() => ({
  calls: [] as { id: string; resolve: (p: unknown) => void }[],
  addToCart: vi.fn(),
}));

vi.mock('@/services/cartService', () => ({
  getBuyerProduct: (id: string) => new Promise((resolve) => { cart.calls.push({ id, resolve }); }),
  addToCart: (...args: unknown[]) => cart.addToCart(...args),
  createBuyNowSession: vi.fn(),
  getCart: vi.fn(),
  warmCart: vi.fn(),
}));
// The shared react-native shim has no TouchableWithoutFeedback (the backdrop).
vi.mock('react-native', async (importOriginal) => {
  const RN = await importOriginal<Record<string, unknown>>();
  const R = require('react') as typeof import('react');
  return { ...RN, TouchableWithoutFeedback: ({ children }: { children?: React.ReactNode }) => R.createElement(R.Fragment, null, children) };
});
vi.mock('@/hooks/useSignInGate', () => ({ useSignInGate: () => ({ requireSignIn: () => true }) }));
vi.mock('@/components/ui/BottomSheet', () => ({
  useSheetTransition: () => ({ modalVisible: true, sheetStyle: {}, backdropStyle: {}, panGesture: {}, onSheetLayout: () => {} }),
}));
vi.mock('@/components/ProductReviewsSection', () => ({ ProductReviewsSection: () => null }));
vi.mock('@/components/SizeRecommendationBadge', () => ({
  SizeRecommendationBadge: () => null, RecommendedTag: () => null, useSizeBadgeModel: () => null,
}));
vi.mock('@/components/media/PhotoViewer', () => ({ PhotoViewer: () => null }));
vi.mock('@/components/media/ProductPhoto', () => ({ ProductPhoto: () => null }));
vi.mock('@/components/products/BrandLink', () => ({ BrandLink: () => null }));
vi.mock('@/components/ui/Avatar', () => ({ Avatar: () => null }));

const { ShopProductSheet } = await import('../ShopProductSheet');

function product(id: string, name: string) {
  return {
    id, name, sellerId: 's1', sellerName: 'Seller', sellerHandle: '@seller', description: 'd',
    priceCents: 1000, imageUris: [], category: 'apparel', isPreOrder: false, cancellationPolicy: '',
    refundPolicy: '', options: [], isActive: true, tags: [],
    variants: [{ id: `${id}-v`, title: 'One', optionValues: [], priceCents: 1000, inventoryQuantity: 9, isAvailable: true }],
  };
}

const selection = {
  postId: 'demo-post',
  activeTagIndex: 0,
  tags: [
    { productId: 'prod-a', productName: 'Alpha Tee', priceCents: 1000 },
    { productId: 'prod-b', productName: 'Bravo Hoodie', priceCents: 2000 },
  ],
};

function texts(r: ReactTestRenderer): string[] {
  return r.root.findAll((n) => (n.type as unknown) === 'Text').map((n) => [n.props.children].flat().join(''));
}

async function settle(fn: () => void) {
  await act(async () => { fn(); await Promise.resolve(); await Promise.resolve(); });
}

afterEach(() => { cart.calls.length = 0; cart.addToCart.mockReset(); vi.useRealTimers(); });

describe('ShopProductSheet — tag switch while loading', () => {
  it('keeps the active tag’s product when the previous tag’s response arrives last', async () => {
    let r!: ReactTestRenderer;
    await settle(() => { r = create(<ShopProductSheet selection={selection} onClose={() => {}} reduceMotion />); });
    // Open tag B's DETAIL step while tag A's load is still pending.
    await settle(() => {
      r.root.find((n) => (n.type as unknown) === 'TouchableOpacity' && String(n.props.accessibilityLabel).startsWith('View Bravo Hoodie')).props.onPress();
    });
    // Resolve every pending B request first, then the stale A ones.
    await settle(() => { cart.calls.filter(c => c.id === 'prod-b').forEach(c => c.resolve(product('prod-b', 'Bravo Hoodie'))); });
    await settle(() => { cart.calls.filter(c => c.id === 'prod-a').forEach(c => c.resolve(product('prod-a', 'Alpha Tee'))); });
    const shown = texts(r);
    expect(shown).toContain('Bravo Hoodie');
    expect(shown).not.toContain('Alpha Tee');
    r.unmount();
  });
});

describe('ShopProductSheet — repeated Add to bag', () => {
  it('a second add inside the window keeps its own full "Added to bag" confirmation', async () => {
    vi.useFakeTimers();
    cart.addToCart.mockResolvedValue({ success: true, cart: { items: [{ quantity: 1 }] } });
    let r!: ReactTestRenderer;
    await settle(() => { r = create(<ShopProductSheet selection={selection} onClose={() => {}} reduceMotion />); });
    await settle(() => { cart.calls.filter(c => c.id === 'prod-a').forEach(c => c.resolve(product('prod-a', 'Alpha Tee'))); });
    const rowCart = (name: string) => r.root.find((n) => (n.type as unknown) === 'TouchableOpacity' && n.props.accessibilityLabel === `Add ${name} to bag`);
    // Quick-add row A (already hydrated, active tag).
    await settle(() => { rowCart('Alpha Tee').props.onPress(); });
    expect(texts(r)).toContain('Added to bag');
    await act(async () => { vi.advanceTimersByTime(1000); });
    // Quick-add row B 1s later: switches tag, hydrates, then adds.
    await settle(() => { rowCart('Bravo Hoodie').props.onPress(); });
    await settle(() => { cart.calls.filter(c => c.id === 'prod-b').forEach(c => c.resolve(product('prod-b', 'Bravo Hoodie'))); });
    await settle(() => {});
    expect(cart.addToCart).toHaveBeenCalledTimes(2);
    // 300ms later the first add's 1.2s window has passed; B's has not.
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(texts(r)).toContain('Added to bag');
    r.unmount();
  });
});
