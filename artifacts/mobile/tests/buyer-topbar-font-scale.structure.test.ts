/**
 * Guards against the class of bug reported on a real device: the cart
 * button on the buyer Threads feed's top bar getting squeezed/clipped off
 * screen when iOS/Android "larger text" (Dynamic Type) inflates the
 * center "Following | Threads" tabs. The web preview harness never
 * reproduced this (its headless Chromium doesn't simulate OS font-scale
 * settings), so this is source-level + numeric evidence instead of a
 * screenshot.
 *
 * Repo convention for screens that need native/Expo modules to render —
 * see tests/live-feed-wiring.structure.test.ts.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
const feed = read('app/(tabs)/feed.tsx');
const segmentedControl = read('components/ui/SegmentedControl.tsx');

describe('buyer feed top bar: LIVE and search/cart never yield to the center tabs', () => {
  it('the LIVE cluster and the search/cart cluster are flexShrink: 0 — only the tabs may shrink', () => {
    expect(feed).toMatch(/buyerTopCluster: \{[^}]*flexShrink: 0[^}]*\}/);
  });

  it('the tabs wrap has an overflow: hidden backstop so an inflated label can never visually spill onto the icon clusters beside it', () => {
    expect(feed).toMatch(/buyerTabSwitcherWrap: \{[\s\S]*?overflow: 'hidden'[\s\S]*?\}/);
  });

  it('the creator-feed top bar (back / title / cart) keeps its two icon buttons flexShrink: 0 so the title text is the only thing that can give', () => {
    expect(feed).toMatch(/buyerTopBtn: \{[^}]*flexShrink: 0[^}]*\}/);
    // creatorTitle already carries `flex: 1` (RN implies flexShrink: 1 /
    // flexBasis: 0%), which is what keeps it from pushing the cart button
    // off screen when the creator/product title is long.
    expect(feed).toMatch(/creatorTitle: \{\s*flex: 1,/);
  });

  it('the cart button on every buyer-surface top bar caps its badge inside its own bounds, not past the icon or screen edge', () => {
    // Buyer Threads Home top bar (this PR's target) and the isCreatorFeed
    // variant share styles.buyerCartBadge / styles.cartCountBadge.
    expect(feed).toMatch(/buyerCartBadge: \{ top: -4, right: 0 \}/);
  });
});

describe('SegmentedControl underline tabs (the buyer feed\'s "Following | Threads"): Dynamic Type is capped, not unbounded', () => {
  it('caps Dynamic Type at 1.2x on the tab labels — the actual mechanism that stops "larger text" settings from inflating the row past its bounds', () => {
    expect(segmentedControl).toMatch(/maxFontSizeMultiplier=\{1\.2\}/);
  });

  it('the label can shrink its own font before overflowing (adjustsFontSizeToFit + a real floor, not shrinking to unreadable)', () => {
    expect(segmentedControl).toMatch(/adjustsFontSizeToFit/);
    expect(segmentedControl).toMatch(/minimumFontScale=\{0\.85\}/);
  });

  it('the row and each tab are flexShrink: 1 / minWidth: 0 — so a bounded parent (the buyer feed\'s absolutely-positioned tabs wrap) can compress them instead of letting them overflow it', () => {
    expect(segmentedControl).toMatch(/underlineRoot: \{[^}]*flexShrink: 1[^}]*minWidth: 0[^}]*\}/);
    expect(segmentedControl).toMatch(/underlineSegment: \{[^}]*flexShrink: 1[^}]*minWidth: 0[^}]*\}/);
  });
});

describe('numeric bound check: even at a real device\'s largest reported font scale, the capped tab label fits the space the top bar actually gives it', () => {
  // iOS effective per-Text scale is min(systemFontScale, maxFontSizeMultiplier)
  // once a Text sets maxFontSizeMultiplier — this mirrors that formula rather
  // than re-implementing RN's layout engine (not available in this test
  // environment; see the file header).
  const effectiveScale = (systemFontScale: number, maxFontSizeMultiplier: number) =>
    Math.min(systemFontScale, maxFontSizeMultiplier);

  // The owner's reported real-device scale (iOS "Larger Text" toward the
  // top of its non-accessibility range).
  const REPORTED_DEVICE_FONT_SCALE = 1.35;
  const MAX_FONT_SIZE_MULTIPLIER = 1.2;
  const BASE_LABEL_FONT_SIZE = 15; // styles.underlineLabel.fontSize in SegmentedControl.tsx

  // topRowSideGuard from feed.tsx: 24 (icon) * 2 clusters + topRowIconGap
  // (6-8, width-dependent) + 6 — the fixed band width.tsx's tabs wrap is
  // never allowed to draw outside of.
  const TOP_ROW_SIDE_GUARD_NARROW = 24 * 2 + 6 + 6; // narrowest screens use topRowIconGap: 6
  const NARROWEST_SUPPORTED_SCREEN_WIDTH = 320; // iPhone SE (1st gen)
  const availableCenterBandWidth = NARROWEST_SUPPORTED_SCREEN_WIDTH - TOP_ROW_SIDE_GUARD_NARROW * 2;

  // Rough per-character advance width at a given font size for the
  // FONT.medium/bold family used here (~0.55x font size is the standard
  // approximation for a mixed-case sans word) — a safety-margin check,
  // not a pixel-exact layout simulation.
  const approxLabelWidth = (text: string, fontSize: number) => text.length * fontSize * 0.55;
  const SEGMENT_PADDING_EACH_SIDE = 12; // styles.underlineSegment paddingHorizontal
  const totalTabsWidthAt = (fontSize: number) =>
    approxLabelWidth('Following', fontSize) + SEGMENT_PADDING_EACH_SIDE * 2
    + approxLabelWidth('Threads', fontSize) + SEGMENT_PADDING_EACH_SIDE * 2;

  it('capped effective scale is meaningfully below the uncapped device scale', () => {
    const capped = effectiveScale(REPORTED_DEVICE_FONT_SCALE, MAX_FONT_SIZE_MULTIPLIER);
    expect(capped).toBe(MAX_FONT_SIZE_MULTIPLIER);
    expect(capped).toBeLessThan(REPORTED_DEVICE_FONT_SCALE);
  });

  it('the cap alone is not enough on the narrowest screen — this is exactly why adjustsFontSizeToFit/minimumFontScale is also required, not optional polish', () => {
    const cappedFontSize = BASE_LABEL_FONT_SIZE * effectiveScale(REPORTED_DEVICE_FONT_SCALE, MAX_FONT_SIZE_MULTIPLIER);
    expect(totalTabsWidthAt(cappedFontSize)).toBeGreaterThan(availableCenterBandWidth);
  });

  it('"Following" + "Threads" fits inside the tabs wrap\'s bounded width on the narrowest supported screen once both defenses (the 1.2x cap AND the 0.85 shrink-to-fit floor) are engaged together', () => {
    const cappedFontSize = BASE_LABEL_FONT_SIZE * effectiveScale(REPORTED_DEVICE_FONT_SCALE, MAX_FONT_SIZE_MULTIPLIER);
    const MINIMUM_FONT_SCALE = 0.85; // SegmentedControl.tsx underline label's minimumFontScale
    const worstCaseShrunkFontSize = cappedFontSize * MINIMUM_FONT_SCALE;

    expect(totalTabsWidthAt(worstCaseShrunkFontSize)).toBeLessThanOrEqual(availableCenterBandWidth);
  });

  it('uncapped + un-shrunk (neither defense) at the same device scale is even further over budget — quantifies the regression both defenses together close', () => {
    const uncappedFontSize = BASE_LABEL_FONT_SIZE * REPORTED_DEVICE_FONT_SCALE;
    const cappedFontSize = BASE_LABEL_FONT_SIZE * effectiveScale(REPORTED_DEVICE_FONT_SCALE, MAX_FONT_SIZE_MULTIPLIER);

    expect(totalTabsWidthAt(uncappedFontSize)).toBeGreaterThan(totalTabsWidthAt(cappedFontSize));
    expect(totalTabsWidthAt(uncappedFontSize) - availableCenterBandWidth)
      .toBeGreaterThan(totalTabsWidthAt(cappedFontSize) - availableCenterBandWidth);
  });
});
