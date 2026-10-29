/**
 * "Add all to Bag": the 2s "Added" timer is cancelled on unmount, and an add
 * that throws (instead of returning success:false) ends the spinner and says so.
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const addToCart = vi.fn();
const forProduct = vi.fn();
vi.mock('@/services/cartService', () => ({ addToCart: (...a: unknown[]) => addToCart(...a) }));
vi.mock('@/lib/api', () => ({ useApi: () => api }));
const api = { bundles: { forProduct: (...a: unknown[]) => forProduct(...a) } };
vi.mock('@/lib/devPreview', () => ({ isPreviewDemoMode: () => false }));
vi.mock('@/lib/previewProducts', () => ({ isPreviewProductId: () => false, getPreviewBuyerProduct: () => null }));
vi.mock('@/lib/haptics', () => ({ haptic: () => {} }));
vi.mock('@/hooks/useColors', () => ({ useColors: () => new Proxy({}, { get: () => '#888' }) }));
vi.mock('@/components/CachedImage', () => ({ CachedImage: () => null }));
vi.mock('@/components/ui', () => ({ BottomSheet: () => null }));

import { BundleOffer } from '../BundleOffer';

const P = '11111111-1111-4111-8111-111111111111';
const bundle = {
  id: 'b1', sellerId: 's1', name: 'Set', bundlePriceCents: 9000, itemsTotalCents: 10000,
  items: [{ productId: P, variantId: 'v1', quantity: 1, name: 'Tee', image: null, isPreOrder: false, priceCents: 10000,
    variants: [{ id: 'v1', size: 'M', color: null, priceCents: 10000, stock: 5 }] }],
};

async function mount(): Promise<ReactTestRenderer> {
  forProduct.mockResolvedValue([bundle]);
  let r!: ReactTestRenderer;
  await act(async () => { r = create(<BundleOffer productId={P} />); });
  return r;
}
const addAllButton = (r: ReactTestRenderer) =>
  r.root.find((n) => typeof n.props.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith('Add all') && typeof n.props.onPress === 'function');

afterEach(() => { vi.useRealTimers(); addToCart.mockReset(); });

describe('BundleOffer', () => {
  it('cancels the "Added" timer when it unmounts', async () => {
    const r = await mount();
    vi.useFakeTimers();
    addToCart.mockResolvedValue({ success: true, cart: {} });
    await act(async () => { addAllButton(r).props.onPress(); });
    expect(vi.getTimerCount()).toBe(1);
    act(() => { r.unmount(); });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops the spinner and shows a message when adding throws', async () => {
    const r = await mount();
    addToCart.mockRejectedValue(new Error('storage'));
    await act(async () => { addAllButton(r).props.onPress(); });
    const texts = r.root.findAll((n) => (n.type as unknown) === 'Text').map((n) => [n.props.children].flat().join(''));
    expect(texts).toContain('Could not add Tee to bag.');
    expect(addAllButton(r).props.disabled).toBe(false);
  });
});
