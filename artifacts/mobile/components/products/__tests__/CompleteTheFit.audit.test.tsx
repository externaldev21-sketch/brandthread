/**
 * "Complete the fit" quick add: the 2s check-mark timer is cancelled on
 * unmount, and an add that throws shows an error instead of doing nothing.
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const addToCart = vi.fn();
const publicList = vi.fn();
const api = { productPairings: { publicList: (...a: unknown[]) => publicList(...a) } };
vi.mock('@/services/cartService', () => ({ addToCart: (...a: unknown[]) => addToCart(...a) }));
vi.mock('@/lib/api', () => ({ useApi: () => api }));
vi.mock('@/lib/devPreview', () => ({ isPreviewDemoMode: () => false }));
vi.mock('@/lib/previewProducts', () => ({ isPreviewProductId: () => false, getPreviewBuyerProduct: () => null, getPreviewRelatedProducts: () => [] }));
vi.mock('@/lib/haptics', () => ({ haptic: () => {}, haptics: {} }));
vi.mock('@/hooks/useColors', () => ({ useColors: () => new Proxy({}, { get: () => '#888' }) }));
vi.mock('@/components/CachedImage', () => ({ CachedImage: () => null }));
vi.mock('@/components/media/ProductPhoto', () => ({ ProductPhoto: () => null }));
vi.mock('@/components/ui/Icon', () => ({ Icon: () => null }));
vi.mock('@/components/ui', () => ({ Sheet: () => null }));

import { CompleteTheFit } from '../CompleteTheFit';

const row = {
  id: 'p2', sellerId: 's1', sellerName: 'Brand', name: 'Cap', image: null, images: [], priceCents: 2000,
  isPreOrder: false, available: true, variants: [{ id: 'v1', size: null, color: null, priceCents: 2000, stock: 3 }],
};

async function mount(): Promise<ReactTestRenderer> {
  publicList.mockResolvedValue([row]);
  let r!: ReactTestRenderer;
  await act(async () => { r = create(<CompleteTheFit productId="p1" />); });
  return r;
}
const plus = (r: ReactTestRenderer) =>
  r.root.find((n) => n.props.accessibilityLabel === 'Add Cap to bag' && typeof n.props.onPress === 'function');

afterEach(() => { vi.useRealTimers(); addToCart.mockReset(); });

describe('CompleteTheFit', () => {
  it('cancels the "added" timer when it unmounts', async () => {
    const r = await mount();
    vi.useFakeTimers();
    addToCart.mockResolvedValue({ success: true, cart: {} });
    await act(async () => { plus(r).props.onPress(); });
    expect(vi.getTimerCount()).toBe(1);
    act(() => { r.unmount(); });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('shows an error when adding throws', async () => {
    const r = await mount();
    addToCart.mockRejectedValue(new Error('storage'));
    await act(async () => { plus(r).props.onPress(); });
    const texts = r.root.findAll((n) => (n.type as unknown) === 'Text').map((n) => [n.props.children].flat().join(''));
    expect(texts).toContain('Could not add to bag.');
  });
});
