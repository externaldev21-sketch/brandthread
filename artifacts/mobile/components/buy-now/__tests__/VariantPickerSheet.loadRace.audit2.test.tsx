/**
 * Audit regression: VariantPickerSheet.load() had no cancel guard — when the
 * sheet was re-pointed at another product, the earlier product's slower
 * response landed last and replaced it (wrong product, price and variants
 * under the new id).
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { getBuyerProduct } = vi.hoisted(() => ({ getBuyerProduct: vi.fn() }));
vi.mock('@/services/cartService', () => ({ getBuyerProduct: (...a: unknown[]) => getBuyerProduct(...a) }));
vi.mock('@/hooks/useApi', () => ({ useApi: () => ({ waitlist: { check: vi.fn(async () => ({ joined: false })) } }) }));
vi.mock('@/hooks/useSignInGate', () => ({ useSignInGate: () => ({ isSignedIn: false, goToSignIn: vi.fn() }) }));
vi.mock('@/hooks/useAutoSelectSize', () => ({ useAutoSelectSize: () => {} }));
vi.mock('@/components/SizeRecommendationBadge', () => ({ useSizeBadgeModel: () => null }));
vi.mock('@/components/media/ProductPhoto', () => ({ ProductPhoto: () => null }));
vi.mock('@/components/CachedImage', () => ({ CachedImage: () => null }));
vi.mock('@/components/ui/Snackbar', () => ({ Snackbar: () => null }));
vi.mock('@/components/ui/BottomSheet', () => {
  const R = require('react') as typeof import('react');
  return {
    useSheetTransition: () => ({}),
    Sheet: (props: Record<string, unknown>) => R.createElement('Sheet', null, props.children as React.ReactNode),
  };
});

const { VariantPickerSheet } = await import('../VariantPickerSheet');

const product = (id: string, name: string) => ({
  id, name, sellerName: 'S', priceCents: 1000, imageUris: [], options: [], isPreOrder: false,
  variants: [{ id: `${id}-v`, title: 'Default', optionValues: [], isAvailable: true, inventoryQuantity: 3, priceCents: 1000 }],
});

const texts = (r: ReactTestRenderer) => r.root.findAll((n) => (n.type as unknown) === 'Text').map((n) => [n.props.children].flat().join(''));

describe('VariantPickerSheet — product switch while loading', () => {
  it("never replaces the current product with an earlier product's late response", async () => {
    let resolveFirst!: (p: unknown) => void;
    getBuyerProduct.mockImplementationOnce(() => new Promise((res) => { resolveFirst = res; }));
    getBuyerProduct.mockImplementationOnce(async () => product('p2', 'Second Product'));
    let r!: ReactTestRenderer;
    await act(async () => { r = create(<VariantPickerSheet productId="p1" onClose={() => {}} onConfirm={() => {}} />); });
    await act(async () => { r.update(<VariantPickerSheet productId="p2" onClose={() => {}} onConfirm={() => {}} />); });
    expect(texts(r)).toContain('Second Product');
    await act(async () => { resolveFirst(product('p1', 'First Product')); });
    expect(texts(r)).toContain('Second Product');
    expect(texts(r)).not.toContain('First Product');
    r.unmount();
  });
});
