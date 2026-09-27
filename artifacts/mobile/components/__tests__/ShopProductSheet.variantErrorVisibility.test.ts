import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sheetSource = readFileSync(
  resolve(process.cwd(), 'components/ShopProductSheet.tsx'),
  'utf8',
);

/**
 * Regression guard for the real "Add to cart does nothing" bug: the sheet
 * opens scrolled to the top (hero image, name/price, the sticky Add to
 * cart/Buy now bar) while the size/color chips a required-variant error is
 * about sit further down the scrollable content, off-screen until the
 * buyer scrolls. Tapping Add to cart before scrolling used to hit the
 * `!allOptionsSelected` early return with only an inline message rendered
 * below the fold — no exception, no console error, nothing written to
 * cartService (there was nothing to write, addToCart() was never called),
 * and no visible feedback at the buyer's actual scroll position. That's
 * indistinguishable from "the button is broken."
 *
 * The fix (rejectMissingVariant): scroll the option chips into view AND
 * mirror the same message into the sticky action bar, which is always on
 * screen regardless of scroll position. This locks that fix in place as a
 * static source check, matching this file's existing convention (see
 * ShopProductSheet.structure.test.ts) rather than a full component render,
 * which this codebase doesn't do for this screen (see
 * tests/buyer-shopping-no-nested-pressables.test.ts's static-analysis
 * approach for the same reason).
 */
describe('ShopProductSheet — a missing-variant error is always visible, not just below the fold', () => {
  it('handleAddToCart and handleBuyNow route their validation failures through rejectMissingVariant, not a bare setVariantError', () => {
    const addToCartHandler = sheetSource.slice(
      sheetSource.indexOf('async function handleAddToCart()'),
      sheetSource.indexOf('// Buy now'),
    );
    expect(addToCartHandler).toContain("rejectMissingVariant('Please select all options before adding to cart.')");
    expect(addToCartHandler).toContain("rejectMissingVariant('Please select a valid combination.')");
    expect(addToCartHandler).toContain("rejectMissingVariant('This combination is out of stock.')");
    // The old direct calls must be gone from this handler — every guard here
    // goes through the scroll-and-mirror path.
    expect(addToCartHandler).not.toMatch(/setVariantError\('Please select all options before adding to cart\.'\)/);

    const buyNowHandler = sheetSource.slice(
      sheetSource.indexOf('async function handleBuyNow()'),
      sheetSource.indexOf('// View full detail'),
    );
    expect(buyNowHandler).toContain("rejectMissingVariant('Please select all options.')");
    expect(buyNowHandler).toContain("rejectMissingVariant('The selected variant is not available.')");
  });

  it('rejectMissingVariant scrolls the option chips into view', () => {
    const fn = sheetSource.slice(
      sheetSource.indexOf('function rejectMissingVariant'),
      sheetSource.indexOf('async function handleAddToCart()'),
    );
    expect(fn).toContain('contentScrollRef.current?.scrollTo(');
    expect(fn).toContain('optionsSectionY.current');
  });

  it('the option chips section reports its own scroll offset via onLayout', () => {
    expect(sheetSource).toContain('onLayout={e => { optionsSectionY.current = e.nativeEvent.layout.y; }}');
  });

  it('the main content ScrollView is wired to contentScrollRef', () => {
    const scrollViewOpen = sheetSource.slice(
      sheetSource.indexOf('{(phase === \'ready\' || phase === \'adding\' || phase === \'buying\' || phase === \'added\') && product && (\n          <ScrollView'),
    ).slice(0, 780);
    expect(scrollViewOpen).toContain('ref={contentScrollRef}');
  });

  it('the sticky action bar (always on screen) mirrors the variant error message', () => {
    const stickyBar = sheetSource.slice(
      sheetSource.indexOf('{/* Sticky Add to Cart + Buy Now'),
      sheetSource.indexOf('{/* Sticky Add to Cart + Buy Now') + 800,
    );
    expect(stickyBar).toContain('ss.stickyActionsWrap');
    expect(stickyBar).toContain('!!variantError &&');
    expect(stickyBar).toContain('ss.stickyVariantError');
    expect(stickyBar).toContain('accessibilityRole="alert"');
  });
});
