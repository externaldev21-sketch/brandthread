import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(resolve(import.meta.dirname, '..', path), 'utf8');

describe('approved merge layouts remain visible in the shared screen owners', () => {
  it('keeps Repost and recent contacts, with an ellipsis More and no discovery actions in Share', () => {
    const share = source('components/ThreadShareSheet.tsx');
    expect(share).toContain('allShareTargets(getPreviewConversations()');
    expect(share).toMatch(/testID="thread-share-more-contacts"\s+icon="more-horizontal"/);
    expect(share).toContain('label={reposted ? \'Remove repost\' : \'Repost\'}');
    expect(share).not.toContain('<ShareAction label="Not interested"');
    expect(share).not.toContain('<ShareAction label="Why this video"');
  });

  it('does not replace dashboard metrics with the setup guide', () => {
    const dashboard = source('components/SellerHomeCommerceDashboard.tsx');
    expect(dashboard).not.toContain('{showReadyToSell && readyToSell.data ? (\\n                <View');
    expect(dashboard.indexOf('testID="seller-dashboard-hero-value"')).toBeLessThan(
      dashboard.indexOf('testID="seller-dashboard-ready-to-sell"'),
    );
    expect(dashboard).toContain('products={topProducts ?? []}');
    expect(dashboard).toContain('orders={recentOrders ?? []}');
    expect(source('components/SellerDashboardStatGrid.tsx')).toContain('borderRadius: RADIUS.lg');
    expect(source('components/SellerDashboardHomeRange.tsx')).toContain('<SellerDashboardRangePills');
    expect(source('components/SellerDashboardTrafficSources.tsx')).toContain('accessibilityLabel="Share your store"');
    const guide = source('components/ReadyToSellChecklist.tsx');
    expect(guide).toContain('accessibilityRole="progressbar"');
    expect(guide).not.toContain("borderStyle: 'dashed'");
    expect(guide).toContain('paddingVertical: 16');
  });

  it('uses the compact own-profile header without a banner, with both profile actions', () => {
    const profile = source('app/(buyer)/profile.tsx');
    expect(profile).toContain('{banner ? <ProfileBannerHeader');
    expect(profile).toContain('/> : <ProfileVideoHeader');
    expect(profile).toContain('testID="profile-edit-button"');
    expect(profile).toContain('testID="profile-share-button"');
  });

  it('keeps a full-bleed official B mark in the seller AI circle', () => {
    const bar = source('components/SellerGlobalTabBar.tsx');
    expect(bar).toContain('source={BRANDTHREAD_AVATAR_SOURCE}');
    expect(bar).toContain('testID="seller-ai-brandthread-mark"');
  });

  it('makes the official welcome chat available without adding fake conversations to fresh preview', () => {
    const inbox = source('lib/previewInbox.ts');
    expect(inbox).toContain('isPreviewCatalogEnabled() || isBuyerDevPreview()');
    expect(inbox).toContain('isPreviewDemoMode() ? allSeeds() : [BRANDTHREAD_AGENT_SEED]');
    expect(source('components/inbox/MessagesInbox.tsx')).toContain("'Your thoughts\\ngo here...'");
  });

  it('uses dots only and never puts a cover-cropped boot image over a slideshow', () => {
    expect(source('components/buyer-feed/PhotoCarousel.tsx')).toContain('showCounter={false}');
    expect(source('app/(tabs)/feed.tsx')).toContain("'contentType' in firstContentItem && firstContentItem.contentType === 'video'");
    expect(source('components/media/PhotoSlide.tsx')).toContain('!aspect && { opacity: 0 }');
  });
});
