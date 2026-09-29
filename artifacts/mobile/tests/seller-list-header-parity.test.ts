/**
 * Orders and Products must share one header component (components/
 * SellerListHeader.tsx) with identical metrics — no separate, taller
 * bespoke header on Products, and no grey background band behind the
 * chip row on either screen.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');
const ordersSource = readFileSync(resolve(ROOT, 'app/(tabs)/orders.tsx'), 'utf8');
const productsSource = readFileSync(resolve(ROOT, 'app/(tabs)/products.tsx'), 'utf8');
const headerSource = readFileSync(resolve(ROOT, 'components/SellerListHeader.tsx'), 'utf8');

describe('Orders and Products share one SellerListHeader', () => {
  it('both screens render <SellerListHeader', () => {
    expect(ordersSource).toContain('<SellerListHeader');
    expect(productsSource).toContain('<SellerListHeader');
  });

  it('both screens share the same count-row style (sellerListCountRowStyles), not ad-hoc styles', () => {
    expect(ordersSource).toContain('sellerListCountRowStyles');
    expect(productsSource).toContain('sellerListCountRowStyles');
  });

  it('neither screen wraps the header in its own distinct background color (the grey-band bug)', () => {
    // The bug: a wrapper like `backgroundColor: palette.surface` or a
    // `header: { backgroundColor: BG }` style around the header, which
    // reads as a lighter band against the screen's own (different) root
    // background. SellerListHeader itself must stay transparent too.
    for (const source of [ordersSource, productsSource]) {
      expect(source).not.toMatch(/backgroundColor:\s*(palette\.surface|BG)\s*[,}]/);
    }
    expect(headerSource).not.toMatch(/backgroundColor:\s*theme\.surface/);
  });

  it('the shared header itself defines the standard metrics (44pt title row, 36px controls)', () => {
    expect(headerSource).toContain('minHeight: 44');
    expect(headerSource).toMatch(/height:\s*36/);
  });
});

describe('Products empty state has no preview wording', () => {
  it('never mentions "preview" anywhere near the empty-state copy', () => {
    const emptyCopySection = productsSource.slice(
      productsSource.indexOf('emptyCopy'),
      productsSource.indexOf('emptyCopy') + 1500,
    );
    expect(emptyCopySection.toLowerCase()).not.toContain('preview');
  });

  it('uses the requested "No products yet" copy with the Add your first product action', () => {
    expect(productsSource).toContain('No products yet');
    expect(productsSource).toContain('Add your first product to start selling.');
    expect(productsSource).toContain("actionLabel=\"Add your first product\"");
  });
});
