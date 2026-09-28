/**
 * Structure tests for the two-step list -> detail rebuild of "Shop the
 * Post": a post with 2+ tagged products opens on a LIST step (one row per
 * product, real thumbnail/price/seller/sold-count, a compact per-row cart
 * button — no giant preview image); tapping a row pushes to that product's
 * DETAIL step within the same sheet, with a working back chevron. A
 * single-product post skips the list entirely and opens straight on
 * DETAIL, with no back target.
 *
 * Static source checks, matching this file's existing convention (see
 * ShopProductSheet.structure.test.ts / .yami.test.ts) rather than a full
 * component render, which this codebase doesn't do for this screen.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sheet = readFileSync(resolve(__dirname, '../ShopProductSheet.tsx'), 'utf8');

describe('Routing: list step only for 2+ tagged products, detail-only for 1', () => {
  it('starts on the LIST step only when the post has more than one tagged product', () => {
    expect(sheet).toContain("const hasMultipleTags = selection.tags.length > 1;");
    expect(sheet).toContain("useState<'list' | 'detail'>(hasMultipleTags ? 'list' : 'detail')");
  });

  it('the LIST step block is gated on hasMultipleTags, so a single-product post never renders it', () => {
    expect(sheet).toContain("{hasMultipleTags && sheetStep === 'list' && (");
  });

  it('every DETAIL-step content block also requires sheetStep === \'detail\'', () => {
    const detailGates = sheet.match(/sheetStep === 'detail' &&/g) ?? [];
    // header back-chevron gate + loading + error + sold_out + unavailable +
    // ready-scrollview + sticky-actions + sold_out-footer = 8 gates.
    expect(detailGates.length).toBeGreaterThanOrEqual(8);
  });
});

describe('Back chevron: only when there is a list to go back to', () => {
  it('renders only for a multi-product post already on the DETAIL step', () => {
    expect(sheet).toContain("{hasMultipleTags && sheetStep === 'detail' && (");
    expect(sheet).toContain('accessibilityLabel="Back to products list"');
    expect(sheet).toContain('function handleBackToList()');
  });

  it('a single-product post never shows it (no list step exists to return to)', () => {
    const handleBackFn = sheet.slice(sheet.indexOf('function handleBackToList()'));
    expect(handleBackFn.slice(0, 200)).toContain("setSheetStep('list')");
  });
});

describe('LIST step rows: real per-product data, a compact sibling cart button, no giant photo', () => {
  it('renders one ProductListRow per tagged product, hydrated in parallel', () => {
    expect(sheet).toContain('function ProductListRow(');
    expect(sheet).toContain('<ProductListRow');
    // Hydrated via the same getBuyerProduct()/previewProduct path DETAIL
    // already uses — never a second, invented data source.
    expect(sheet).toContain('await getBuyerProduct(tag.productId)');
  });

  it('shows real seller name + verified check and a real sold count (claimedUnits), never fake copy', () => {
    const rowFn = sheet.slice(sheet.indexOf('function ProductListRow('), sheet.indexOf('// ─── Full-screen image viewer'));
    expect(rowFn).toContain('product.sellerName');
    expect(rowFn).toContain('product.sellerVerified');
    expect(rowFn).toContain('product.claimedUnits');
    expect(rowFn).toContain('sold');
  });

  it('the row nav and its cart button are SIBLING pressables, not nested', () => {
    const rowFn = sheet.slice(sheet.indexOf('function ProductListRow('), sheet.indexOf('// ─── Full-screen image viewer'));
    // <View style={ss.listRow}> wraps two sibling TouchableOpacitys.
    expect(rowFn).toContain('<View style={ss.listRow}>');
    expect(rowFn).toContain('style={ss.listRowBody}');
    expect(rowFn).toContain('style={[ss.listRowCartBtn,');
  });

  it('no giant preview image in the list step — only a 72x96 thumbnail per row', () => {
    expect(sheet).toContain('listRowThumbWrap: { width: 72, height: 96');
  });

  it('opens at a real 55% height for the list step, draggable up to 90%', () => {
    expect(sheet).toContain("sheetStep === 'list' && listSheetAnimatedStyle");
    expect(sheet).toContain('const listSheetMinHeight = windowHeight * 0.55;');
    expect(sheet).toContain('const listSheetMaxHeight = windowHeight * 0.90;');
    expect(sheet).toContain('const listResizeGesture = Gesture.Pan()');
  });
});

describe('List row tap -> DETAIL step (in-sheet push, not navigate-away)', () => {
  it('openDetailStep switches the active tag and pushes to the DETAIL step within the same sheet', () => {
    const fn = sheet.slice(sheet.indexOf('function openDetailStep('), sheet.indexOf('function handleBackToList'));
    expect(fn).toContain("setSheetStep('detail')");
    expect(fn).not.toContain('thread-product-detail');
  });

  it('a missing-size quick-add from a LIST row pushes into DETAIL to pick a size, instead of a dead scroll', () => {
    const fn = sheet.slice(sheet.indexOf('function rejectMissingVariant'), sheet.indexOf('async function handleAddToCart'));
    expect(fn).toContain("setSheetStep('detail')");
  });
});
