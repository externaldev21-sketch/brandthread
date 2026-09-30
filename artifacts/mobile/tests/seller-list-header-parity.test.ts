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

  it('does not highlight the Products filter button when a visible status chip is selected', () => {
    expect(productsSource).toContain("filter !== 'all' && !filterPills.some(pill => pill.value === filter)");
    expect(productsSource).toContain("filterAccessibilityLabel={filter !== 'all' ? `Filter: ${filter}` : 'Filter products'}");
  });
});

describe('Title dropdown replaces the Alert.alert title menu', () => {
  it('neither screen opens the title menu via Alert.alert anymore (a no-op on web, an ugly system alert on native)', () => {
    for (const source of [ordersSource, productsSource]) {
      expect(source).not.toMatch(/onTitlePress=\{[\s\S]{0,80}Alert\.alert/);
    }
  });

  it('both screens pass SellerListHeader a titleMenu of real, working options', () => {
    expect(productsSource).toMatch(/titleMenu=\{\[/);
    expect(productsSource).toContain('All products');
    expect(productsSource).toContain('Collections');
    expect(ordersSource).toMatch(/titleMenu=\{\[/);
    expect(ordersSource).toContain('All orders');
    expect(ordersSource).toContain('Returns');
  });

  it('the shared header only renders the chevron/dropdown when a titleMenu is actually passed', () => {
    expect(headerSource).toMatch(/hasMenu\s*=\s*!!titleMenu/);
    expect(headerSource).toContain("Feather name=\"chevron-down\"");
    // The chevron branch must be conditional on hasMenu, not unconditional.
    const chevronIndex = headerSource.indexOf('chevron-down');
    const beforeChevron = headerSource.slice(0, chevronIndex);
    expect(beforeChevron).toMatch(/hasMenu\s*\?/);
  });
});

describe('Count row is hidden on an empty list', () => {
  it('Products only renders the count row when sortedProducts is non-empty', () => {
    expect(productsSource).toMatch(/sortedProducts\.length === 0 \? null/);
  });

  it('Orders only renders the count row when filtered is non-empty', () => {
    expect(ordersSource).toMatch(/filtered\.length > 0 && \(/);
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
