/**
 * Audit regression: `{compare && compare > price && …}` rendered a bare `0`
 * inside the price row <View> when compareAtPriceCents was 0 — on native that
 * is "Text strings must be rendered within a <Text> component" (crash).
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native-gesture-handler', () => {
  const R = require('react') as typeof import('react');
  const Swipeable = R.forwardRef((props: Record<string, unknown>, _ref) => R.createElement('Swipeable', null, props.children as React.ReactNode));
  return { Swipeable };
});
vi.mock('@/components/media/ProductPhoto', () => ({ ProductPhoto: () => null }));
vi.mock('@/components/CachedImage', () => ({ CachedImage: () => null }));
vi.mock('@/components/BrandthreadUI', () => {
  const R = require('react') as typeof import('react');
  const pass = (name: string) => (props: Record<string, unknown>) => R.createElement(name, props, props.children as React.ReactNode);
  return { StatusBadge: pass('StatusBadge'), PressableScale: pass('PressableScale') };
});

const { ProductCard } = await import('../ProductCard');

const product = {
  id: 'p1', name: 'Tee', category: 'T-shirt', status: 'active', variants: [],
  media: [], inventory: { totalStock: 10, lowStockThreshold: 2 },
  pricing: { priceCents: 2500, compareAtPriceCents: 0 },
} as never;

/** Every raw string/number child rendered directly inside a host View. */
function bareTextInViews(r: ReactTestRenderer): unknown[] {
  return r.root.findAll((n) => (n.type as unknown) === 'View')
    .flatMap((n) => n.children.filter((c) => typeof c === 'string' || typeof c === 'number'));
}

describe('ProductCard — compare-at price of 0', () => {
  it('renders no bare "0" outside <Text>', async () => {
    let r!: ReactTestRenderer;
    const noop = () => {};
    await act(async () => {
      r = create(<ProductCard product={product} width={200} onPress={noop} onMore={noop} onQuickArchive={noop} onQuickDelete={noop} onEditStock={noop} />);
    });
    expect(bareTextInViews(r)).toEqual([]);
    r.unmount();
  });
});
