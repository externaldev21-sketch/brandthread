/**
 * Less-AI pass, forms (items 101, 103, 104, 105, 106, 108). One reference
 * flow throughout: Depop "Listing an item"
 * (https://mobbin.com/flows/9f6278f3-41a4-4e03-9e3f-0db7cc5bcac7) — "$ 0.00"
 * price fields, "(optional)" after optional labels and no asterisks, the
 * primary button pinned at the bottom, "Add photos (Up to N)".
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, name);
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (/\.tsx$/.test(name) && !/\.test\./.test(name)) out.push(rel);
  }
  return out;
}

describe('106: required fields carry no asterisk', () => {
  it('no field label in app/ or components/ ends with "*"', () => {
    const offenders: string[] = [];
    const label = /(?:label=["'{`]|label: ['"`]|fieldLabel\}>)([^"'`<]{1,60}?)\s?\*\s*["'`<]/g;
    for (const file of [...walk('app'), ...walk('components')]) {
      const src = read(file);
      for (const m of src.matchAll(label)) offenders.push(`${file}: ${m[1]} *`);
    }
    expect(offenders).toEqual([]);
  });

  it('FormInput marks optional fields "(optional)" through a prop', () => {
    const ui = read('components/BrandthreadUI.tsx');
    expect(ui).toContain('optional?: boolean;');
    expect(ui).toContain("{optional ? <Text style={fiS.optional}> (optional)</Text> : null}");
  });
});

describe('104: inline errors appear on blur, not while typing', () => {
  const ui = read('components/BrandthreadUI.tsx');
  it('a field-level validate only shows once the field has been left', () => {
    expect(ui).toContain('const shownError = error || (touched && validate ? validate(value) : null) || null;');
    expect(ui).toContain('setTouched(true);');
  });
  it('is used on the product price and the manufacturer invite', () => {
    expect(read('app/add-product.tsx')).toContain("validate={v => (parseFloat(v) > 0 ? null : 'Add a price')}");
    expect(read('app/invite-manufacturer.tsx')).toContain("'Enter a full email, like name@factory.com'");
  });
});

describe('103: live price formatting', () => {
  const ui = read('components/BrandthreadUI.tsx');
  it('FormInput price fields show "$", group as you type, pad on blur after typing', () => {
    expect(ui).toContain('value={price ? displayPriceInput(value) : value}');
    expect(ui).toContain('onChange(sanitizePriceInput(text))');
    expect(ui).toContain('if (price && typedRef.current) {');
  });
  it('every seller price input goes through the price helpers', () => {
    const add = read('app/add-product.tsx');
    expect(add.match(/\n\s+price\n|\sprice \/>|\sprice$/gm)?.length ?? 0).toBeGreaterThanOrEqual(5);
    expect(add).toContain('value={displayPriceInput(bulkPrice)}');
    expect(add).toContain('value={displayPriceInput(v.price)}');
    expect(read('app/discounts.tsx')).toContain('value={displayPriceInput(fixedValue)}');
    expect(read('app/discounts.tsx')).toContain('value={displayPriceInput(minOrder)}');
    expect(read('app/product-bundle-edit.tsx')).toContain('value={displayPriceInput(priceStr)}');
    expect(read('app/(tabs)/products.tsx')).toMatch(/label="New price"\s+price/);
  });
  it('a shipping tier rate is no longer re-formatted to "5.00" on the first keystroke', () => {
    const shipping = read('app/shipping.tsx');
    expect(shipping).toContain('tierRateDraft?.index === i ? displayPriceInput(tierRateDraft.text)');
    expect(shipping).toContain('onBlur={() => setTierRateDraft(null)}');
  });
});

describe('101: keyboard types', () => {
  it('the 2FA code field opens the number pad', () => {
    expect(read('app/disable-two-factor.tsx')).toMatch(/textContentType="oneTimeCode"\s+keyboardType="number-pad"/);
  });
});

describe('105: primary button pinned above the keyboard', () => {
  it('uses KeyboardStickyView with a plain-footer fallback', () => {
    const footer = read('components/KeyboardStickyFooter.tsx');
    expect(footer).toContain('KeyboardStickyView');
    expect(footer).toContain('return Sticky ? <Sticky');
  });
  it('the discount and bundle editors pin their save button outside the scroll view', () => {
    for (const file of ['app/discounts.tsx', 'app/product-bundle-edit.tsx']) {
      const src = read(file);
      const footerAt = src.indexOf('<KeyboardStickyFooter');
      expect(footerAt).toBeGreaterThan(0);
      expect(src.lastIndexOf('</ScrollView>', footerAt)).toBeGreaterThan(0);
      expect(src.slice(footerAt, footerAt + 400)).toContain('<PrimaryButton');
    }
  });
});

describe('108: native multi-select photo picker', () => {
  it('limits the picker to the photos left and keeps the tap order', () => {
    const add = read('app/add-product.tsx');
    expect(add).toContain('selectionLimit: room,');
    expect(add).toContain('orderedSelection: true,');
    expect(add.indexOf('if (room === 0)')).toBeLessThan(add.indexOf('selectionLimit: room,'));
  });
});
