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
 * The fix (rejectMissingVariant): scroll the option chips into view so the
 * one inline message next to them (rendered once, right where the chips
 * are) is always what's on screen when it fires. This locks that fix in
 * place as a static source check, matching this file's existing convention
 * (see ShopProductSheet.structure.test.ts) rather than a full component
 * render, which this codebase doesn't do for this screen (see
 * tests/buyer-shopping-no-nested-pressables.test.ts's static-analysis
 * approach for the same reason).
 *
 * Overnight follow-up: this used to ALSO mirror the same message a second
 * time into the sticky action bar below, so it rendered twice at once —
 * found live. The mirror is gone; the message now renders exactly once,
 * next to the option chips it's about (see the last two tests below).
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

  it('the variant error message renders exactly once — not mirrored into the sticky action bar', () => {
    // Only one JSX render site for `ss.variantError` in the whole file (the
    // one next to the option chips) — the earlier duplicate in the sticky
    // bar (`ss.stickyVariantError`) is gone entirely.
    const variantErrorRenders = sheetSource.match(/style=\{ss\.variantError\}/g) ?? [];
    expect(variantErrorRenders.length).toBe(1);
    expect(sheetSource).not.toContain('ss.stickyVariantError');
    expect(sheetSource).not.toContain('stickyVariantError:');
  });

  it('the one variant error message is announced to assistive tech and sits right next to the option chips', () => {
    const variantErrorIdx = sheetSource.indexOf('style={ss.variantError}');
    const optionsBlock = sheetSource.slice(variantErrorIdx, variantErrorIdx + 300);
    expect(optionsBlock).toContain('style={ss.variantError}');
    expect(optionsBlock).toContain('accessibilityRole="alert"');
    expect(optionsBlock).toContain('accessibilityLiveRegion="polite"');

    // And it comes right after the Qty/options block, before the sticky
    // action bar — i.e. it's still inside the scrollable content next to
    // the chips, not floating disconnected near the bottom.
    const stickyBarIdx = sheetSource.indexOf('{/* Sticky Add to Cart + Buy Now');
    expect(variantErrorIdx).toBeGreaterThan(0);
    expect(variantErrorIdx).toBeLessThan(stickyBarIdx);
  });
});
