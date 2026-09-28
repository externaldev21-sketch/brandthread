/**
 * Structure tests for the Yami-style product sheet additions: a swipeable,
 * fixed-3:4-aspect image carousel with dot-only paging (no numeric "1/N"
 * badge — removed in the single-product rework, item 3), bold-border-
 * selected / dashed-border-unavailable variant chips, and a sticky
 * (never-scrolls-away) Add to Cart + Buy Now bar.
 *
 * Photo audit follow-up: the carousel used to be `cover`-fit and capped
 * near-square (~45% of the sheet's own height) — now it's always a full
 * sheet-width 3:4 portrait frame, `contentFit="contain"` (letterboxed, not
 * cropped) — see the module comment above ProductImageCarousel.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sheet = readFileSync(resolve(__dirname, '../ShopProductSheet.tsx'), 'utf8');

describe('Swipeable image carousel, dot-only paging (no numeric badge)', () => {
  it('renders a horizontal, paged gallery of every product image, at a fixed 3:4 aspect', () => {
    expect(sheet).toContain('function ProductImageCarousel(');
    expect(sheet).toContain('<ProductImageCarousel imageUris={product.imageUris} />');
    expect(sheet).toContain('const pageHeight = Math.round(pageWidth * (4 / 3));');
    expect(sheet).toContain('contentFit="contain"');
    expect(sheet).toContain('pagingEnabled');
  });

  it('shows page dots but no numeric "1/N" counter badge in the sheet\'s own carousel', () => {
    expect(sheet).toContain('ss.dotsRow');
    expect(sheet).toContain('i === index && ss.dotActive');
    // The sheet's inline carousel counter pill is gone; only the separate
    // full-screen viewer (FullScreenImageViewer) still shows one.
    expect(sheet).not.toContain('ss.carouselCounter}');
    const carouselFnBody = sheet.slice(
      sheet.indexOf('function ProductImageCarousel('),
      sheet.indexOf('// ─── Trust cue pill'),
    );
    expect(carouselFnBody).not.toContain('{index + 1}/{images.length}');
  });
});

describe('Variant chips: bold border = selected, dashed = unavailable', () => {
  it('thickens the border and bolds the label when selected', () => {
    expect(sheet).toContain('borderWidth: 2, backgroundColor: `${accentColor}1A`');
    expect(sheet).toContain("fontFamily: FONT.bold");
  });

  it('dashes the border for an unavailable combination instead of a strikethrough', () => {
    expect(sheet).toContain("borderStyle: 'dashed'");
    expect(sheet).not.toContain('strikethrough');
  });
});

describe('Sticky Add to Cart + Buy Now', () => {
  it('sits in its own absolutely-positioned bar outside the scrollable content', () => {
    expect(sheet).toContain('stickyActionsWrap');
    expect(sheet).toMatch(/stickyActionsWrap: \{\s*position: 'absolute',\s*left: 0,\s*right: 0,\s*bottom: 0,/);
  });

  it('reserves scroll-content space so nothing sits hidden behind the sticky bar', () => {
    expect(sheet).toContain('{/* Spacer so content never sits behind the sticky action bar below */}');
  });
});
