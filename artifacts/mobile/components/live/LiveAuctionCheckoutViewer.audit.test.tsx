import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
vi.mock('@/lib/live/useLiveSocket', () => ({ useLiveSocket: () => {} }));
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
const byProp = (r: ReactTestRenderer, key: string, value: unknown) =>
  r.root.findAll((n) => n.props[key] === value && typeof n.type === 'string')[0];

function fillDelivery(r: ReactTestRenderer) {
  const values: Record<string, string> = {
    Email: 'a@b.co', 'Full name': 'Ana B', 'Phone number': '5551234567', 'Street address': '1 Main St', City: 'Austin', State: 'TX', ZIP: '78701',
  };
  act(() => {
    for (const [placeholder, v] of Object.entries(values)) (byProp(r, 'placeholder', placeholder).props.onChangeText as (t: string) => void)(v);
  });
}

async function pressBuy(r: ReactTestRenderer) {
  const buy = r.root.findAll((n) => n.type === ('PressableScale' as never))
    .find((n) => n.findAll((c) => c.props.children === 'Buy now').length > 0)!;
  await act(async () => { (buy.props.onPress as () => void)(); });
  await flush();
}

const texts = (r: ReactTestRenderer) => r.root.findAll((n) => (n.type as unknown) === 'Text').map((n) => ([] as unknown[]).concat(n.props.children).join(''));

describe('LiveAuctionCheckoutViewer checkout', () => {
  beforeEach(() => {
    createSession.mockReset().mockResolvedValue({ url: 'https://stripe', sessionId: 'cs_1' });
    verifySession.mockReset();
    openAuthSessionAsync.mockReset().mockResolvedValue({ type: 'cancel' });
  });

  it('never says "Couldn’t start checkout" when verifying fails after the payment page closed', async () => {
    verifySession.mockRejectedValue(new Error('network'));
    let r!: ReactTestRenderer;
    act(() => { r = create(<BuyerLiveScreen />); });
    await flush();
    fillDelivery(r);
    await pressBuy(r);
    expect(createSession).toHaveBeenCalled();
    const lines = texts(r);
    expect(lines.some((t) => t.includes('Couldn’t start checkout'))).toBe(false);
    expect(lines.some((t) => t.includes('Payment was cancelled'))).toBe(false);
    expect(lines.some((t) => t.includes('still pending'))).toBe(true);
  });

  it('closing the auction pay sheet ends auction pricing: a later Buy of the same piece is a plain buy', async () => {
    verifySession.mockResolvedValue({ paymentStatus: 'unpaid' });
    let r!: ReactTestRenderer;
    act(() => { r = create(<BuyerLiveScreen />); });
    await flush();
    // Auto-opened to pay the won auction; close it.
    act(() => { (byProp(r, 'accessibilityLabel', 'Close purchase sheet').props.onPress as () => void)(); });
    // Open the same piece from the product strip.
    const chip = r.root.findAll((n) => typeof n.props.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith('Shop Coat') && n.props.onPress)[0];
    await act(async () => { (chip.props.onPress as () => void)(); });
    await flush();
    fillDelivery(r);
    await pressBuy(r);
    const items = createSession.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(items[0].auctionId).toBeUndefined();
  });

  it('still sends the auction id while paying the won auction', async () => {
    verifySession.mockResolvedValue({ paymentStatus: 'unpaid' });
    let r!: ReactTestRenderer;
    act(() => { r = create(<BuyerLiveScreen />); });
    await flush();
    fillDelivery(r);
    await pressBuy(r);
    const items = createSession.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(items[0].auctionId).toBe('a1');
  });
});
