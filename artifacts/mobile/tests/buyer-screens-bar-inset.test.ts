import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('screens behind the floating buyer bar', () => {
  it('pads every buyer screen by the shared bar inset instead of guessed numbers', () => {
    const screens: Record<string, string> = {
      'app/(buyer)/discover.tsx': 'paddingBottom: barInset + SP.md',
      'app/(buyer)/profile.tsx': 'paddingBottom: barInset + SP.lg',
      'components/inbox/MessagesInbox.tsx': '{ paddingBottom: barInset + SP.md }',
      'app/(buyer)/orders.tsx': 'paddingBottom: barInset + SP.md',
      // Phase 2 design-system pass migrated these two screens from the legacy
      // `SP` alias (lib/theme.ts) to the canonical `SPACING` token
      // (constants/spacing.ts) — same 16pt value, new shared-token source.
      'app/(buyer)/friends.tsx': 'paddingBottom: barInset + SPACING.md',
      // edit-profile.tsx and cart.tsx are intentionally excluded: both are
      // pushed, modal-style screens and the floating bar is hidden on them
      // entirely (BUYER_TAB_BAR_HIDDEN_ROUTES in
      // components/buyer-nav/BuyerTabBar.tsx), so they pad by the safe-area
      // bottom inset instead of the bar inset — see the dedicated assertions
      // below.
      'app/(tabs)/following.tsx': 'Math.max(120, barInset + SPACING.md)',
    };
    for (const [file, padding] of Object.entries(screens)) {
      const source = read(file);
      expect(source, file).toContain("from '@/components/buyer-nav/buyerTabBarMetrics'");
      if (file === 'components/inbox/MessagesInbox.tsx') {
        // Shared buyer/seller inbox: the buyer variant pads by the buyer bar
        // inset; the seller variant (a pushed scene that already sits above
        // the seller bar) by the safe-area inset.
        expect(source, file).toContain('const buyerBarInset = useBuyerTabBarInset();');
        expect(source, file).toContain('const barInset = isSeller ? insets.bottom : buyerBarInset;');
      } else {
        expect(source, file).toContain('const barInset = useBuyerTabBarInset();');
      }
      expect(source, file).toContain(padding);
    }
  });

  it('cart is a pushed screen: the floating bar is hidden and its sticky checkout bar pads by the safe-area inset instead', () => {
    const cart = read('app/(buyer)/cart.tsx');
    expect(cart).not.toContain("from '@/components/buyer-nav/buyerTabBarMetrics'");
    expect(cart).not.toContain('useBuyerTabBarInset');
    expect(cart).toContain("import { useSafeAreaInsets } from 'react-native-safe-area-context';");
    expect(cart).toContain('const insets = useSafeAreaInsets();');
    // (Flat, theme-following fill + hairline since the checkout follow-up.)
    expect(cart).toContain('<StickyFooter style={{ paddingBottom: insets.bottom + 8, backgroundColor: theme.background, borderTopColor: theme.borderSubtle }}>');

    const tabBar = read('components/buyer-nav/BuyerTabBar.tsx');
    expect(tabBar).toContain("BUYER_TAB_BAR_HIDDEN_ROUTES = new Set<string>(['edit-profile', 'cart']);");
  });

  it('edit-profile hides the floating bar and pads by the safe-area inset instead', () => {
    const editProfile = read('app/(buyer)/edit-profile.tsx');
    expect(editProfile).not.toContain("from '@/components/buyer-nav/buyerTabBarMetrics'");
    expect(editProfile).not.toContain('useBuyerTabBarInset');
    expect(editProfile).toContain('paddingBottom: insets.bottom + SP.xl');

    const tabBar = read('components/buyer-nav/BuyerTabBar.tsx');
    expect(tabBar).toContain("BUYER_TAB_BAR_HIDDEN_ROUTES = new Set<string>(['edit-profile', 'cart']);");
    expect(tabBar).toContain('if (BUYER_TAB_BAR_HIDDEN_ROUTES.has(activeRoute)) return null;');
  });
});

describe('buyer Home feed behind the bar', () => {
  const feed = read('app/(tabs)/feed.tsx');

  it('plays edge to edge and starts every overlay above the bar', () => {
    expect(feed).toContain('const isBuyerSurface = buyerMode || showFashionPreview;');
    // bottomClearance is exactly the tab bar's own zone now (no added
    // padding) so the sharp video, the blurred tab-bar strip and the scrub
    // line all key off one shared number with no gap between them.
    expect(feed).toContain('? buyerBarInset\n    : Math.max(previewBottomInset, 8) + 14;');
    expect(feed).toContain('immersive={isBuyerSurface}');
    // Rail and caption block (which carries the shop pill in its own flow,
    // rather than a separately-positioned overlay) — see
    // components/buyer-feed/RightActionRail.tsx and CaptionBlock.tsx, wired
    // from app/(tabs)/feed.tsx. Each anchors to bottomClearance *plus* its
    // own extra gap constant, not bare bottomClearance: that's where the
    // scrub/progress bar itself sits, so bare bottomClearance on both used
    // to put the rail's last item and the caption's sound line touching it.
    // Gap values (16/12) and the rail/shop-tab sizing itself come from dev
    // PR #129 (TikTok-exact feed sizing) — see the RightActionRail.tsx and
    // ShopSideTab.tsx component files, ported from that PR's inline JSX.
    expect(feed).toContain('<RightActionRail\n        style={[chromeStyle, { bottom: bottomClearance + RAIL_BOTTOM_GAP }]}');
    expect(feed).toContain('<CaptionBlock\n        style={[chromeStyle, { bottom: bottomClearance + CAPTION_BOTTOM_GAP }]}');
    // Round-2 feed fixes raised RAIL_BOTTOM_GAP again (16 -> 24) for more
    // headroom above the tab bar and to track the caption block's first
    // line rather than its last.
    expect(feed).toContain('const RAIL_BOTTOM_GAP = 24;');
    // PR #133 shrank CAPTION_BOTTOM_GAP again (12 -> 10) on top of #129.
    expect(feed).toContain('const CAPTION_BOTTOM_GAP = 10;');
    // Resting-pill redesign: the shop trigger no longer floats at the
    // screen edge — its pill renders inside CaptionBlock's own stack (see
    // components/buyer-feed/ShopSideTab.tsx's `ShopTagPill`, passed as
    // CaptionBlock's `topSlot`); only its full-screen collapse backdrop
    // stays at this top level.
    expect(feed).toContain('<ShopTagBackdrop');
    expect(feed).toContain('topSlot={');
    expect(feed).toContain('<ShopTagPill');
    expect(feed).not.toContain('bottom: bottomClearance + (hasRepostIdentity ? 158 : 122)');
    // The scrub line sits exactly at the seam where the sharp video is
    // clipped and the blurred tab-bar strip begins — no offset gap.
    expect(feed).toContain('progressBottom={immersive ? bottomClearance : undefined}');
    // The blurred strip only shows where there's an actual floating tab bar
    // to blend into (hasTabBar) — the creator-profile-videos player reuses
    // this same component without one. It's sized off `videoFrameInset`
    // (the bar's own top pixel — buyerBarTopInset) rather than the padded
    // `bottomClearance`, so the sharp video's bottom edge lands exactly on
    // the bar's top edge, not on the extra breathing room above it.
    expect(feed).toContain('bottomStripHeight={immersive && hasTabBar ? (videoFrameInset ?? bottomClearance) : 0}');
    expect(feed).toContain('videoFrameInset={isBuyerSurface ? buyerBarTopInset : undefined}');
  });

  it('fills the screen only when that crops little, and letterboxes otherwise', () => {
    // Callers with a bottom strip (Buyer Home's immersive frame) use the
    // tighter Reels/TikTok 15% tolerance, keyed to the FRAME's own aspect
    // (pageHeight minus the tab-bar strip); callers with no strip (e.g. the
    // LIVE viewer, which has no tab bar) keep the original 30% tolerance
    // against the full page, unaffected by this change.
    expect(feed).toContain('const IMMERSIVE_FRAME_COVER_CROP_THRESHOLD = 0.15;');
    expect(feed).toContain('const FULL_PAGE_COVER_CROP_THRESHOLD = 0.3;');
    expect(feed).toContain("const fit = immersive && cropFraction <= coverThreshold ? 'cover' : 'contain';");
    expect(feed).toContain("player.addListener('videoTrackChange'");
    expect(feed).toContain('contentFit={fit}');
    expect(feed).toContain('styles.videoFill');
  });

  it('keeps the seller feed on its original clearance', () => {
    expect(feed).toContain(': Math.max(previewBottomInset, 8) + 14;');
  });
});
