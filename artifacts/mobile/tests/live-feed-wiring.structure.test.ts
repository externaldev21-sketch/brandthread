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
const empty = read('components/live/LiveEmptyState.tsx');
const feed = read('app/(tabs)/feed.tsx');
const layout = read('app/_layout.tsx');
const inbox = read('app/(buyer)/inbox.tsx');
const shell = read('components/profile/ProfileShell.tsx');
const sellerProfile = read('app/seller-profile.tsx');
const factory = read('lib/live/liveProvider.ts');
const apiProvider = read('lib/live/apiLiveProvider.ts');

describe('LIVE route', () => {
  it('is registered as a full-screen modal with no seller tab bar over it', () => {
    expect(layout).toContain('<Stack.Screen name="live"');
    expect(layout).toMatch(/\/\/ LIVE viewer pager[^\n]*\n\s*'live',/);
  });

  it('reuses the Threads feed pager + player instead of a new pager', () => {
    expect(live).toContain("import { VideoVisual } from './(tabs)/feed';");
    expect(live).toContain('{...verticalPagerListProps(pageHeight, streams.length)}');
    expect(live).toContain('VERTICAL_PAGER_VIEWABILITY');
    expect(feed).toContain('export function VideoVisual({');
  });

  it('has every overlay piece: host pill, close, viewer stack, chat, pinned product, rail, hearts, comment pill', () => {
    for (const piece of ['<LiveHostPill', '<LiveViewerStack', '<LiveChatList', '<LivePinnedProductCard', '<LiveRail', '<LiveHeartLayer', '<LiveCommentBar', 'testID="live-close"']) {
      expect(live).toContain(piece);
    }
    expect(overlays).toContain('placeholder="Add comment..."');
    expect(overlays).toContain('<Text style={styles.followText}>Follow</Text>');
    expect(overlays).toContain('<Text style={styles.liveBadgeText}>LIVE</Text>');
    // Chat shows only the last ~5 messages, fading upward.
    expect(overlays).toContain('messages.slice(-LIVE_CHAT_VISIBLE)');
    expect(overlays).toContain('const FADE = [');
  });

  it('Buy opens the existing Shop sheet; the bag opens the product list', () => {
    expect(live).toContain('<ShopProductSheet');
    expect(live).toContain('liveShopSelection(stream, productId');
    expect(live).toContain('<LiveProductsSheet');
  });

  it('never renders a blank page: loading, then pager or the empty state', () => {
    expect(live).toContain('<LiveEmptyState');
    expect(empty).toContain('No one&apos;s live right now');
    expect(empty).toContain("'Remind me'");
    expect(empty).toContain('Creators to follow');
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
  it('the Threads header LIVE button opens the LIVE pager', () => {
    // Both the dev header's liveJumpBtn and PR #88's FeedTopBar
    // (onPressLive={jumpToNearestLive}) call jumpToNearestLive.
    expect(feed).toContain('onPress={jumpToNearestLive}');
    expect(feed).toMatch(/function jumpToNearestLive\(\) \{[\s\S]*?openLive\(\{ streamId: ahead\?\.streamId \}\);/);
  });

  it('feed rail avatars wear the LIVE ring and open the stream', () => {
    expect(feed).toContain('<LiveHostRing hostId={item.sellerId} size={44}');
    expect(feed).toContain('const liveStreamId = getLiveDirectory().streamFor(item.sellerId);');
  });

  it('profiles ring the avatar and open the stream on tap', () => {
    expect(shell).toContain('<LiveAvatarRing live={!!liveStreamId}');
    expect(shell).toContain('openLive({ streamId: liveStreamId, hostId: avatar?.liveHostId })');
    expect(sellerProfile).toContain('liveHostId: canonicalSellerId ?? routeSellerId ?? null');
  });

  it('Messages rows ring live people and tapping the avatar opens their live', () => {
    expect(inbox).toContain('<LiveHostRing hostId={participant.userId} hostName={participant.name} size={60} pressToWatch>');
    expect(inbox).toContain('<LiveHostRing hostId={participant.userId} hostName={participant.name} size={64} ringGap={-2} pressToWatch>');
  });
});
