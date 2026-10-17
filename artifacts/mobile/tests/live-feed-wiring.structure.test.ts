/**
 * Structure tests for the LIVE pager screen and its entry points (the
 * repo's convention for screens that need native/Expo modules to render).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
const live = read('app/live.tsx');
const overlays = read('components/live/LiveOverlays.tsx');
const grid = read('components/live/LiveShowsGrid.tsx');
const liveFeed = read('app/live-feed.tsx');
const feed = read('app/(tabs)/feed.tsx');
const layout = read('app/_layout.tsx');
const inbox = read('app/(buyer)/inbox.tsx');
const shell = read('components/profile/ProfileShell.tsx');
const sellerProfile = read('app/seller-profile.tsx');
const factory = read('lib/live/liveProvider.ts');
const apiProvider = read('lib/live/apiLiveProvider.ts');
const rightActionRail = read('components/buyer-feed/RightActionRail.tsx');

describe('LIVE route', () => {
  it('is registered as a full-screen modal with no seller tab bar over it', () => {
    expect(layout).toContain('<Stack.Screen name="live"');
    expect(layout).toMatch(/\/\/ LIVE viewer pager[^\n]*\n\s*'live',/);
  });

  it('reuses the Threads feed pager + player instead of a new pager', () => {
    expect(live).toContain("import { VideoVisual } from './(tabs)/feed';");
    expect(live).toContain('{...verticalPagerListProps(pageHeight, streams.length)}');
    expect(live).toContain('VERTICAL_PAGER_VIEWABILITY');
    expect(feed).toContain('export function VideoVisual(props: VideoVisualProps)');
  });

  it('has every Whatnot overlay piece: host + Follow, viewer pill + leave, rail, chat, input, item + Buy now, hearts', () => {
    for (const piece of ['<LiveHostRow', '<LiveTopRight', '<LiveRail', '<LiveChatList', '<LiveChatInput', '<LiveProductCard', '<LiveHeartLayer']) {
      expect(live).toContain(piece);
    }
    expect(live).toContain("label: 'Buy now'");
    expect(overlays).toContain('placeholder="Say something..."');
    expect(overlays).toContain('testID="live-close"');
    expect(overlays).toContain("{following ? 'Following' : 'Follow'}");
    // Chat shows only the last few messages.
    expect(overlays).toContain('messages.slice(-LIVE_CHAT_VISIBLE)');
  });

  it('real shows play the host Agora video in the pager, not a hand-off to another screen', () => {
    expect(live).toContain('<LiveRtcVideo rtc={rt?.rtc}');
    expect(live).not.toContain('/buyer-live');
  });

  it('Buy opens the existing Shop sheet; Shop opens the product list', () => {
    expect(live).toContain('<ShopProductSheet');
    expect(live).toContain('liveShopSelection(stream, productId');
    expect(live).toContain('<LiveProductsSheet');
  });

  it('never renders a blank page: unavailable, loading, then pager or an honest empty state', () => {
    expect(live).toContain("availability === 'unavailable'");
    expect(live).toContain('LIVE_NOT_CONFIGURED_TITLE');
    expect(live).toContain(`"No one's live right now"`);
  });

  it('asks for the buyer agreement on the first show', () => {
    expect(live).toContain('<LiveBuyerAgreementSheet');
    expect(live).toContain("agreement === 'needed'");
  });

  it('animates an ended stream out before removing it', () => {
    expect(live).toContain('ending={!!pager.ending[item.id]}');
    expect(live).toContain('LIVE_END_ANIMATION_MS');
  });
});

describe('Provider seam', () => {
  it('has a single factory choosing preview vs the real backend', () => {
    expect(factory).toContain('export function getLiveStreamProvider(): LiveStreamProvider');
    expect(factory).toContain('createPreviewLiveProvider({ media: previewLiveMedia');
    // Preview media (expo-asset + bundled clips) is only loaded for preview.
    expect(factory).not.toMatch(/^import .*previewLiveMedia/m);
    expect(factory).toContain('return createApiLiveProvider();');
  });

  it('the real provider uses the new ordered feed endpoint and flags video as needing an RTC SDK', () => {
    expect(apiProvider).toContain("'/api/live/feed'");
    expect(apiProvider).toContain("video: { kind: 'rtc', vendor: 'agora'");
  });
});

describe('Entry points', () => {
  it('the Threads header LIVE entry opens the LIVE grid, and a show opens the viewer at it', () => {
    expect(feed).toContain("router.push('/live-feed' as never)");
    expect(liveFeed).toContain('<LiveShowsGrid');
    expect(liveFeed).toContain('liveHref({ streamId: stream.id })');
    expect(grid).toContain('numColumns={2}');
  });

  it('feed rail avatars wear the LIVE ring and open the stream', () => {
    // The rail's `hostId` prop is the video's `item.sellerId` — see
    // components/buyer-feed/RightActionRail.tsx (PR #129's sizing rebuild
    // moved the rail's JSX out of app/(tabs)/feed.tsx into its own file).
    expect(feed).toContain('hostId={item.sellerId}');
    expect(rightActionRail).toContain('<LiveHostRing hostId={hostId} size={38}');
    expect(feed).toContain('const liveStreamId = getLiveDirectory().streamFor(item.sellerId);');
  });

  it('profiles ring the avatar and open the stream on tap', () => {
    expect(shell).toContain('<LiveAvatarRing live={!!liveStreamId}');
    expect(shell).toContain('openLive({ streamId: liveStreamId, hostId: avatar?.liveHostId })');
    expect(sellerProfile).toContain('liveHostId: canonicalSellerId ?? routeSellerId ?? null');
  });

  it('Messages rows ring live people and tapping the avatar opens their live', () => {
    expect(inbox).toContain('<LiveHostRing hostId={participant.userId} hostName={participant.name} size={48} ringGap={2} pressToWatch>');
    expect(inbox).toContain('<LiveHostRing hostId={participant.userId} hostName={participant.name} size={64} ringGap={-2} pressToWatch>');
  });
});
