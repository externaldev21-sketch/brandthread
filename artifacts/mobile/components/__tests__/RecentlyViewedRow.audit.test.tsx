/**
 * "Recently viewed" is one buyer's private history. When the account signs
 * out — or another account signs in — while the row stays mounted, the
 * previous buyer's products must disappear, and a different account's
 * history must be fetched.
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const auth = { isSignedIn: true as boolean, userId: 'user_a' as string | null };
const list = vi.fn();
const api = { buyer: { recentlyViewed: { list } } };

vi.mock('@clerk/expo', () => ({ useAuth: () => auth }));
vi.mock('@/hooks/useApi', () => ({ useApi: () => api }));
vi.mock('expo-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/contexts/AppThemeContext', () => ({ useAppTheme: () => ({ theme: { muted: '#888', text: '#fff' } }) }));
vi.mock('@/components/ui/Icon', () => ({ Icon: () => null }));
vi.mock('@/components/media/ProductPhoto', () => ({ ProductPhoto: () => null }));
vi.mock('@/components/sharedPhoto/SharedPhotoFrame', () => ({
  SharedPhotoFrame: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@/lib/sharedPhoto', () => ({ openWithSharedPhoto: vi.fn() }));
vi.mock('@/components/CachedImage', () => ({ CachedImage: () => null }));
vi.mock('@/lib/detailPrefetch', () => ({ prefetchProductOnPressIn: vi.fn() }));

import { RecentlyViewedRow } from '../RecentlyViewedRow';

const row = (productId: string, name: string) => ({
  productId, name, brand: 'B', image: null, priceCents: 1000, viewedAt: '2026-01-01T00:00:00Z',
});

function texts(renderer: ReactTestRenderer): string[] {
  return renderer.root
    .findAll((n) => typeof n.props.children === 'string')
    .map((n) => n.props.children as string);
}

describe('RecentlyViewedRow account scoping', () => {
  it('drops the previous buyer\'s history on sign-out and refetches for a new account', async () => {
    list.mockResolvedValueOnce([row('p1', 'Alpha jacket')]);
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<RecentlyViewedRow />); });
    expect(texts(renderer)).toContain('Alpha jacket');

    // Sign out while the row stays mounted.
    auth.isSignedIn = false; auth.userId = null;
    await act(async () => { renderer.update(<RecentlyViewedRow />); });
    expect(texts(renderer)).not.toContain('Alpha jacket');

    // A different buyer signs in: their own history is fetched and shown.
    list.mockResolvedValueOnce([row('p2', 'Beta boots')]);
    auth.isSignedIn = true; auth.userId = 'user_b';
    await act(async () => { renderer.update(<RecentlyViewedRow />); });
    expect(texts(renderer)).toContain('Beta boots');
    expect(texts(renderer)).not.toContain('Alpha jacket');
  });

  it('refetches when the signed-in account changes without a signed-out gap', async () => {
    list.mockReset();
    auth.isSignedIn = true; auth.userId = 'user_a';
    list.mockResolvedValueOnce([row('p1', 'Alpha jacket')]);
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<RecentlyViewedRow />); });
    expect(texts(renderer)).toContain('Alpha jacket');

    list.mockResolvedValueOnce([row('p3', 'Gamma tee')]);
    auth.userId = 'user_c';
    await act(async () => { renderer.update(<RecentlyViewedRow />); });
    expect(list).toHaveBeenCalledTimes(2);
    expect(texts(renderer)).toContain('Gamma tee');
    expect(texts(renderer)).not.toContain('Alpha jacket');
  });
});
