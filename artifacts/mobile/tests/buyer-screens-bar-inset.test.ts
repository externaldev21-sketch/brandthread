import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('screens behind the floating buyer bar', () => {
  it('pads every buyer screen by the shared bar inset instead of guessed numbers', () => {
    const screens: Record<string, string> = {
      'app/(buyer)/discover.tsx': 'paddingBottom: barInset + SP.md',
      'app/(buyer)/profile.tsx': 'paddingBottom: barInset + SP.lg',
      'app/(buyer)/inbox.tsx': '{ paddingBottom: barInset + SP.md }',
      'app/(buyer)/orders.tsx': 'paddingBottom: barInset + SP.md',
      // Phase 2 design-system pass migrated these two screens from the legacy
      // `SP` alias (lib/theme.ts) to the canonical `SPACING` token
      // (constants/spacing.ts) — same 16pt value, new shared-token source.
      'app/(buyer)/friends.tsx': 'paddingBottom: barInset + SPACING.md',
      // edit-profile.tsx is intentionally excluded: it's a pushed,
      // modal-style screen and the floating bar is hidden on it entirely
      // (BUYER_TAB_BAR_HIDDEN_ROUTES in components/buyer-nav/BuyerTabBar.tsx),
      // so it pads by the safe-area bottom inset instead of the bar inset —
      // see the dedicated assertion below.
      'app/(buyer)/cart.tsx': 'paddingBottom: barInset + 150',
      'app/(tabs)/following.tsx': 'Math.max(120, barInset + SPACING.md)',
    };
    for (const [file, padding] of Object.entries(screens)) {
      const source = read(file);
      expect(source, file).toContain("from '@/components/buyer-nav/buyerTabBarMetrics'");
      expect(source, file).toContain('const barInset = useBuyerTabBarInset();');
      expect(source, file).toContain(padding);
    }
  });

  it('lifts the cart checkout summary above the bar', () => {
    const cart = read('app/(buyer)/cart.tsx');
    expect(cart).toContain('<StickyFooter tabBarInset={barInset}>');
  });

  it('edit-profile hides the floating bar and pads by the safe-area inset instead', () => {
    const editProfile = read('app/(buyer)/edit-profile.tsx');
    expect(editProfile).not.toContain("from '@/components/buyer-nav/buyerTabBarMetrics'");
    expect(editProfile).not.toContain('useBuyerTabBarInset');
    expect(editProfile).toContain('paddingBottom: insets.bottom + SP.xl');

    const tabBar = read('components/buyer-nav/BuyerTabBar.tsx');
    expect(tabBar).toContain("BUYER_TAB_BAR_HIDDEN_ROUTES = new Set<string>(['edit-profile']);");
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
    // The shop tag anchors to bare bottomClearance (it sits well above the
    // scrub bar regardless). The rail and caption block anchor to
    // bottomClearance *plus* their own extra gap constants instead — bare
    // bottomClearance is where the scrub/progress bar itself sits, so both
    // used to end up touching/overlapping it with zero gap.
    expect(feed).toContain('styles.rail, chromeStyle, { bottom: bottomClearance + RAIL_BOTTOM_GAP }');
    expect(feed).toContain('{ bottom: bottomClearance + CAPTION_BOTTOM_GAP }]} pointerEvents="box-none"');
    // The shop trigger is a collapsed side tab on the left screen edge (see
    // ShopSideTab), not part of the bottom-left flex column at all any more.
    expect(feed).toContain('function ShopSideTab(');
    expect(feed).toContain("shopSideTab: {\n    position: 'absolute', left: 0,");
    expect(feed).not.toContain('bottom: bottomClearance + (hasRepostIdentity ? 158 : 122)');
    expect(feed).toContain('const RAIL_BOTTOM_GAP = 22;');
    expect(feed).toContain('const CAPTION_BOTTOM_GAP = 18;');
    // The scrub line sits exactly at the seam where the sharp video is
    // clipped and the blurred tab-bar strip begins — no offset gap.
    expect(feed).toContain('progressBottom={immersive ? bottomClearance : undefined}');
    // The blurred strip only shows where there's an actual floating tab bar
    // to blend into (hasTabBar) — the creator-profile-videos player reuses
    // this same component without one.
    expect(feed).toContain('bottomStripHeight={immersive && hasTabBar ? bottomClearance : 0}');
  });

  it('fills the screen only when that crops little, and letterboxes otherwise', () => {
    expect(feed).toContain("const fit = immersive && cropFraction <= 0.3 ? 'cover' : 'contain';");
    expect(feed).toContain("player.addListener('videoTrackChange'");
    expect(feed).toContain('contentFit={fit}');
    expect(feed).toContain('styles.videoFill');
  });

  it('keeps the seller feed on its original clearance', () => {
    expect(feed).toContain(': Math.max(previewBottomInset, 8) + 14;');
  });
});
