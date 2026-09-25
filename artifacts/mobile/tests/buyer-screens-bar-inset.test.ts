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
      'app/(buyer)/edit-profile.tsx': 'paddingBottom: barInset + SP.lg',
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
    // Rail, caption and shop tag all anchor to the same clearance.
    expect(feed).toContain('styles.rail, chromeStyle, { bottom: bottomClearance }');
    expect(feed).toContain('{ bottom: bottomClearance }]} pointerEvents="box-none"');
    expect(feed).toContain('bottom: bottomClearance + (hasRepostIdentity ? 158 : 122)');
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
