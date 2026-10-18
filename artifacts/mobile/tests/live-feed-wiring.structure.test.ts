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
const empty = read('components/live/LiveShowsGrid.tsx');
const feed = read('app/(tabs)/feed.tsx');
const layout = read('app/_layout.tsx');
const inbox = read('components/inbox/MessagesInbox.tsx');
const shell = read('components/profile/ProfileShell.tsx');
const sellerProfile = read('app/seller-profile.tsx');
const factory = read('lib/live/liveProvider.ts');
const apiProvider = read('lib/live/apiLiveProvider.ts');
const rightActionRail = read('components/buyer-feed/RightActionRail.tsx');
const homeTabs = read('components/buyer-feed/HomeFeedTabs.tsx');
const liveNow = read('components/buyer-feed/LiveNowList.tsx');

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

  it('has the unified host, audience, chat, product, rail and native-video overlays', () => {
    for (const piece of ['<LiveHostRow', '<LiveTopRight', '<LiveChatList', '<LiveProductCard', '<LiveRail', '<LiveHeartLayer', '<LiveChatInput', '<LiveRtcVideo']) {
      expect(live).toContain(piece);
    }
    expect(overlays).toContain('placeholder="Say something..."');
    expect(overlays).toContain('Follow');
    expect(overlays).toContain('LIVE');
    // Chat bounds visible rows and animates each arriving message.
    expect(overlays).toContain('messages.slice(-LIVE_CHAT_VISIBLE)');
    expect(overlays).toContain('opacity: enter');
  });

  it('Buy opens the existing Shop sheet; the bag opens the product list', () => {
    expect(live).toContain('<ShopProductSheet');
    expect(live).toContain('liveShopSelection(stream, productId');
    expect(live).toContain('<LiveProductsSheet');
  });

  it('never renders a blank page: loading, then pager or the empty state', () => {
    expect(live).toContain('<LiveNotice');
    expect(empty).toContain("No one's live right now");
    expect(empty).toContain('provider.setReminder(id, on)');
    expect(empty).toContain('LIVE_NOT_CONFIGURED_BUYER_BODY');
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
  it('LIVE is the first header tab (LIVE · Following · Threads) and its body opens streams in the LIVE pager', () => {
    // The TV glyph / red edge tab are gone: LIVE is a text tab on the same
    // underline control as Following/Threads, showing real live streams.
    expect(homeTabs).toContain("{ id: 'live', label: 'LIVE' },\n  { id: 'following', label: 'Following' },\n  { id: 'for-you', label: 'Threads' },");
    expect(homeTabs).toContain('variant="underline"');
    expect(feed).toContain('<HomeFeedTabs testID="buyer-home-tabs" onChange={handleHomeTabChange} />');
    expect(feed).not.toContain('testID="buyer-home-live"');
    expect(feed).not.toContain('LiveEdgeTab');
    expect(feed).toContain('<LiveNowList');
    expect(liveNow).toContain('<LiveShowsGrid');
    expect(liveNow).toContain('openLive({ streamId: stream.id, hostId: stream.host.id })');
    const directory = read('components/live/LiveShowsGrid.tsx');
    expect(directory).toContain('provider.listLive()');
    expect(directory).toContain("No one's live right now");
  });

  it('feed rail avatars wear the LIVE ring and open the stream', () => {
    // The rail's `hostId` prop is the video's `item.sellerId` — see
    // components/buyer-feed/RightActionRail.tsx (PR #129's sizing rebuild
    // moved the rail's JSX out of app/(tabs)/feed.tsx into its own file).
    expect(feed).toContain('hostId={item.sellerId}');
    expect(rightActionRail).toMatch(/\bAVATAR\s*=\s*48\b/);
    expect(rightActionRail).toContain('<LiveHostRing hostId={hostId} size={AVATAR}');
    expect(feed).toContain('const liveStreamId = getLiveDirectory().streamFor(item.sellerId);');
  });

  it('profiles ring the avatar and open the stream on tap', () => {
    expect(shell).toContain('<LiveAvatarRing live={!!liveStreamId}');
    expect(shell).toContain('openLive({ streamId: liveStreamId, hostId: avatar?.liveHostId })');
    expect(sellerProfile).toContain('liveHostId: canonicalSellerId ?? routeSellerId ?? null');
  });

  it('Messages rows ring live people and tapping the avatar opens their live', () => {
    expect(inbox).toContain('<LiveHostRing hostId={participant.userId} hostName={participant.name} size={48} ringGap={-2} pressToWatch>');
    expect(inbox).toContain('<LiveHostRing hostId={row.authorId} hostName={row.name} size={64} ringGap={-2} pressToWatch>');
  });
});
