import React from 'react';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  signedIn: true,
  list: vi.fn(),
}));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native', () => {
  const host = (name: string) => (props: any) => React.createElement(name, props, props.children);
  return {
    ScrollView: host('ScrollView'),
    Text: host('Text'),
    TouchableOpacity: host('TouchableOpacity'),
    View: host('View'),
    StyleSheet: { create: (s: any) => s },
  };
});
vi.mock('@expo/vector-icons', () => ({ Feather: () => null }));
vi.mock('expo-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@clerk/expo', () => ({ useAuth: () => ({ isSignedIn: mocks.signedIn }) }));
vi.mock('@/hooks/useApi', () => ({ useApi: () => ({ buyer: { recentlyViewed: { list: mocks.list } } }) }));
vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({ theme: { muted: 'muted', text: 'text', cardElevated: 'card' } }),
}));
vi.mock('@/components/CachedImage', () => ({ CachedImage: () => null }));
vi.mock('@/lib/money', () => ({ formatCents: (c: number) => `$${(c / 100).toFixed(2)}` }));
vi.mock('@/lib/theme', () => ({ FONT: {}, FS: {}, SP: {}, RADIUS: {} }));

import { RecentlyViewedRow, excludeRecentlyViewed } from '@/components/RecentlyViewedRow';

const item = (productId: string) => ({ productId, name: `Name ${productId}`, brand: 'B', image: null, priceCents: 1000, viewedAt: '' });

async function render(el: React.ReactElement) {
  let r!: ReturnType<typeof create>;
  await act(async () => { r = create(el); });
  await act(async () => { await Promise.resolve(); });
  return r;
}

const cardIds = (r: ReturnType<typeof create>) =>
  r.root.findAll((n) => (n.type as any) === 'TouchableOpacity').map((n) => n.props.accessibilityLabel.split(',')[0]);

describe('RecentlyViewedRow excludeProductId', () => {
  beforeEach(() => { mocks.signedIn = true; mocks.list.mockReset(); });

  it('excludeRecentlyViewed drops only the current product', () => {
    expect(excludeRecentlyViewed([item('a'), item('b')], 'a').map((i) => i.productId)).toEqual(['b']);
    expect(excludeRecentlyViewed([item('a')], undefined)).toHaveLength(1);
  });

  it('renders the history without the current product', async () => {
    mocks.list.mockResolvedValue([item('cur'), item('x'), item('y')]);
    const r = await render(<RecentlyViewedRow excludeProductId="cur" />);
    expect(cardIds(r)).toEqual(['Name x', 'Name y']);
  });

  it('hides when the current product is the only one viewed', async () => {
    mocks.list.mockResolvedValue([item('cur')]);
    const r = await render(<RecentlyViewedRow excludeProductId="cur" />);
    expect(r.toJSON()).toBeNull();
  });

  it('never calls the protected API signed out', async () => {
    mocks.signedIn = false;
    const r = await render(<RecentlyViewedRow excludeProductId="cur" />);
    expect(mocks.list).not.toHaveBeenCalled();
    expect(r.toJSON()).toBeNull();
  });

  it('keeps existing callers unchanged without the prop', async () => {
    mocks.list.mockResolvedValue([item('cur'), item('x')]);
    const r = await render(<RecentlyViewedRow />);
    expect(cardIds(r)).toEqual(['Name cur', 'Name x']);
  });
});
