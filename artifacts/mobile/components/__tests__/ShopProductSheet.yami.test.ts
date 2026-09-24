/**
 * Structure tests for the Yami-style product sheet additions: a swipeable
 * image carousel with a 1/N counter, bold-border-selected / dashed-border-
 * unavailable variant chips, and a sticky (never-scrolls-away) Add to
 * Cart + Buy Now bar.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sheet = readFileSync(resolve(__dirname, '../ShopProductSheet.tsx'), 'utf8');

describe('Swipeable image carousel with a 1/N counter', () => {
  it('renders a horizontal, paged gallery of every product image', () => {
    expect(sheet).toContain('function ProductImageCarousel(');
    expect(sheet).toContain('<ProductImageCarousel imageUris={product.imageUris} />');
    expect(sheet).toContain('pagingEnabled');
  });

  it('shows a 1/N counter that tracks the current page', () => {
    expect(sheet).toContain('ss.carouselCounter');
    expect(sheet).toContain('{index + 1}/{images.length}');
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
