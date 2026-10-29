/**
 * Audit regression: on socket connect the viewer backfills with poll(),
 * which fetches comments since lastTs. A comment the socket delivered while
 * that request was in flight came back in the backfill too and was appended
 * a second time (same id, so also a duplicate React key).
 * Mocks mirror LiveAuctionCheckoutViewer.audit.test.tsx.
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const createSession = vi.fn();
const verifySession = vi.fn();
const openAuthSessionAsync = vi.fn();
const api = {
  live: {
    get: vi.fn(async () => ({ stream: { status: 'live', seller_id: 'seller', title: 'Show', product_tags: [{ productId: 'p1', productName: 'Coat', priceCents: 900 }] } })),
    join: vi.fn(async () => ({})),
    leave: vi.fn(async () => ({})),
    comments: vi.fn(async () => ({ comments: [] })),
  },
  liveCohost: { list: vi.fn(async () => ({ cohosts: [] })) },
  publicProducts: { get: vi.fn(async () => ({ id: 'p1', variants: [{ id: 'v1', stock: 1, priceCents: 900 }] })) },
  buyer: {
    addresses: { list: vi.fn(async () => []) },
    checkout: { createSession: (...a: unknown[]) => createSession(...a), verifySession: (...a: unknown[]) => verifySession(...a) },
  },
  social: { block: vi.fn() },
};
const auction = { id: 'a1', productId: 'p1', productName: 'Coat', status: 'sold', currentBidCents: 500, startingBidCents: 100, payable: true, youWon: true };

vi.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ streamId: 's1', payAuction: 'a1' }),
  useRouter: () => ({ push() {}, replace() {}, back() {}, canGoBack: () => false }),
}));
vi.mock('expo-web-browser', () => ({ openAuthSessionAsync: (...a: unknown[]) => openAuthSessionAsync(...a) }));
vi.mock('expo-linking', () => ({ createURL: () => 'x' }));
vi.mock('@/lib/api', () => ({ useApi: () => api }));
vi.mock('@/lib/live/useLiveAuction', () => ({
  useLiveAuction: () => ({ auction, receivedAt: 0, bid: async () => null, handleEvent: () => {}, refresh: () => {} }),
}));
vi.mock('@/contexts/FeatureFlagContext', () => ({ useFeatureFlag: (k: string) => k === 'live_auctions' }));
vi.mock('@/lib/contextMenu', () => ({ menuItemsFromButtons: (x: unknown) => x, openPullDownMenu: () => {} }));
vi.mock('@/lib/haptics', () => ({ hapticSuccessAction: vi.fn(), haptics: {}, haptic: vi.fn(), hapticLight: vi.fn(), hapticPrimaryAction: vi.fn() }));
vi.mock('@/lib/live/roomAnnouncement', () => ({ roomAnnouncement: () => ({}) }));
vi.mock('@/lib/navigation/goBackOr', () => ({ goBackOr: () => {} }));
vi.mock('@/components/KeyboardProviderCompat', () => {
  const React = require('react') as typeof import('react');
  return { KeyboardAvoidingView: (p: Record<string, unknown>) => React.createElement('KAV', p, p.children as React.ReactNode) };
});
vi.mock('@/lib/shareLinks', () => ({ buildLiveUrl: () => 'u' }));
vi.mock('@/components/ui/Icon', () => ({ Icon: () => null }));
vi.mock('@/lib/agoraAvailability', () => ({ loadAgoraModule: () => null }));
vi.mock('@/components/live/LiveAuctionCard', () => ({ LiveAuctionCard: () => null }));
vi.mock('@/components/live/LiveAuctionBidSheet', () => ({ LiveAuctionBidSheet: () => null }));
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));
vi.mock('@/lib/liveCheckoutPrefill', () => ({ pickDefaultAddress: () => null, prefillDelivery: (x: unknown) => x }));
vi.mock('@/hooks/useColors', () => ({ useColors: () => ({ primary: '#fff' }) }));
vi.mock('@/hooks/useHeaderTopInset', () => ({ useHeaderTopInset: () => 0 }));
vi.mock('@/hooks/useScrollToEndOnContentChange', () => ({
  useScrollToEndOnContentChange: () => ({ requestScrollToEnd() {}, onContentSizeChange() {}, cancelScrollToEnd() {} }),
}));
vi.mock('@/contexts/AppThemeContext', () => ({ useAppTheme: () => ({ theme: { accent: '#fff', onAccent: '#000' } }) }));
vi.mock('@/lib/theme', () => ({
  BG: '#000', BORDER: '#333', FG: '#fff', MUTED: '#888', SUBTLE: '#555', RED: '#f00', FONT: {}, FS: {}, SP: { xs: 8, sm: 12, md: 16, lg: 24 }, RADIUS: {}, TEXT_SECONDARY: '#aaa',
}));
vi.mock('@/components/live/LiveAvatarRing', () => ({ LIVE_RED: '#d00' }));
vi.mock('@/components/NativeOnlyFeature', () => ({ default: () => null }));
vi.mock('@/lib/safety', () => ({ apiErrorMessage: (_e: unknown, f: string) => f, confirmBlock: async () => false, reportHref: () => '/r' }));
vi.mock('@/lib/friendlyError', () => ({ friendlyError: (_e: unknown, f: string) => f }));
vi.mock('@/lib/actionSheet', () => ({ showAlert: () => {} }));
vi.mock('@/components/BrandthreadUI', () => {
  const React = require('react') as typeof import('react');
  return { PressableScale: (p: Record<string, unknown>) => React.createElement('PressableScale', p, p.children as React.ReactNode) };
});
vi.mock('@/components/ui/IconButton', () => ({ IconButton: () => null }));
vi.mock('@/components/ui/Snackbar', () => ({ Snackbar: () => null }));
vi.mock('@/components/ui/Composer', () => ({ default: () => null }));
const socket: { opts: any } = { opts: null };
vi.mock('@/lib/live/useLiveSocket', () => ({ useLiveSocket: (o: unknown) => { socket.opts = o; } }));
vi.mock('@/lib/live/liveVideoConnect', () => ({ LIVE_VIDEO_CONNECT_TIMEOUT_MS: 1000, canRetryLiveVideo: () => false, liveVideoPlaceholderText: () => '' }));
vi.mock('@/lib/live/useLiveModeration', () => ({ useLiveModeration: () => ({ pinned: null, handleEvent() {}, refresh() {} }) }));
vi.mock('@/components/live/LiveModerationOverlays', () => ({ PinnedCommentBar: () => null, CohostTiles: () => null }));
vi.mock('@/constants/radii', () => ({ radius: {} }));
vi.mock('@/components/live/LiveThreadCashSheet', () => ({ LiveThreadCashSheet: () => null }));
vi.mock('@/services/liveShoppingService', () => ({ fetchLiveBag: async () => [] }));
vi.mock('@/components/live/LiveCohostSplit', () => ({ LiveCohostSplit: () => null }));
vi.mock('@/components/live/LivePurchaseToast', () => ({ LivePurchaseToast: () => null, useLivePurchaseToasts: () => ({ current: null, push() {} }) }));
vi.mock('@/lib/format', () => ({ formatMoney: (c: number) => `$${c / 100}` }));

import BuyerLiveScreen from './LiveAuctionCheckoutViewer';

const flush = () => act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); });
const texts = (r: ReactTestRenderer) => r.root.findAll((n) => (n.type as unknown) === 'Text').map((n) => ([] as unknown[]).concat(n.props.children).join(''));

describe('LiveAuctionCheckoutViewer — connect backfill vs socket comments', () => {
  it('shows a comment once when both the socket and the backfill deliver it', async () => {
    const comment = { id: 'c1', user_id: 'u9', display_name: 'Ana', message: 'hello from chat', created_at: '2026-01-01T00:00:01Z' };
    let r!: ReactTestRenderer;
    act(() => { r = create(<BuyerLiveScreen />); });
    await flush();
    expect(socket.opts).toBeTruthy();
    let resolveBackfill!: (v: unknown) => void;
    (api.live.comments as any).mockImplementationOnce(() => new Promise((res) => { resolveBackfill = res; }));
    await act(async () => { socket.opts.onConnected(); });
    await act(async () => { socket.opts.onEvent({ type: 'comment', comment }); });
    await act(async () => { resolveBackfill({ comments: [comment] }); });
    await flush();
    expect(texts(r).filter((t) => t === 'hello from chat')).toHaveLength(1);
    r.unmount();
  });
});
