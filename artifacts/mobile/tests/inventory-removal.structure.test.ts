/**
 * Guards the "fold inventory into Products" removal: the old multi-warehouse
 * screens/services are gone, and nothing in the app still links to them.
 * Mirrors tests/seller-core-navigation-targets.test.ts's source-scanning
 * approach, scoped to this specific migration.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');

const REMOVED_FILES = [
  'app/inventory.tsx',
  'app/inventory-detail.tsx',
  'app/inventory-adjust.tsx',
  'app/inventory-transfer.tsx',
  'app/inventory-incoming.tsx',
  'app/inventory-count.tsx',
  'app/inventory-location.tsx',
  'app/analytics-inventory.tsx',
  'services/inventoryService.ts',
  'services/inventoryTypes.ts',
];

describe('Inventory folded into Products — the old screens/service are gone', () => {
  for (const rel of REMOVED_FILES) {
    it(`${rel} no longer exists`, () => {
      expect(existsSync(resolve(ROOT, rel))).toBe(false);
    });
  }
});

// Every .ts/.tsx file under app/, components/, lib/ (excluding tests and
// node_modules) — a broad sweep so a stray link from anywhere new can't
// slip back in unnoticed.
function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue;
      collectSourceFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const DEAD_ROUTE_PATTERNS: [string, RegExp][] = [
  ["'/inventory'", /['"`]\/inventory['"`]/],
  ["'/inventory-detail'", /['"`]\/inventory-detail\b/],
  ["'/inventory-adjust'", /['"`]\/inventory-adjust\b/],
  ["'/inventory-transfer'", /['"`]\/inventory-transfer\b/],
  ["'/inventory-incoming'", /['"`]\/inventory-incoming\b/],
  ["'/inventory-count'", /['"`]\/inventory-count\b/],
  ["'/inventory-location'", /['"`]\/inventory-location\b/],
  ["'/analytics-inventory'", /['"`]\/analytics-inventory\b/],
  ["services/inventoryService import", /from ['"`]@\/services\/inventoryService['"`]/],
  ["services/inventoryTypes import", /from ['"`]@\/services\/inventoryTypes['"`]/],
];

describe('No remaining source file references a removed inventory route or service', () => {
  const files = [
    ...collectSourceFiles(resolve(ROOT, 'app')),
    ...collectSourceFiles(resolve(ROOT, 'components')),
    ...collectSourceFiles(resolve(ROOT, 'lib')),
    ...collectSourceFiles(resolve(ROOT, 'services')),
  ];

  it('scans a non-trivial number of files (sanity check)', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  for (const [label, pattern] of DEAD_ROUTE_PATTERNS) {
    it(`nothing references ${label}`, () => {
      const offenders: string[] = [];
      for (const file of files) {
        const text = readFileSync(file, 'utf8');
        if (pattern.test(text)) offenders.push(file.replace(ROOT + '/', ''));
      }
      expect(offenders).toEqual([]);
    });
  }
});

describe('Products absorbed the entry points inventory used to own', () => {
  const productsSource = readFileSync(resolve(ROOT, 'app/(tabs)/products.tsx'), 'utf8');
  const productDetailSource = readFileSync(resolve(ROOT, 'app/product-detail.tsx'), 'utf8');
  const moreSource = readFileSync(resolve(ROOT, 'app/(tabs)/more.tsx'), 'utf8');
  const dashboardActionSource = readFileSync(resolve(ROOT, 'components/SellerDashboardActionNeeded.tsx'), 'utf8');

  it('the Products list shows a Low Stock / Out of Stock filter row and search', () => {
    expect(productsSource).toContain("'Low Stock'");
    expect(productsSource).toContain("'Out of Stock'");
    expect(productsSource).toContain('<SearchBar');
  });

  it('the Products list uses the shared ScreenHeader, not a bespoke title row', () => {
    expect(productsSource).toContain('<ScreenHeader');
    expect(productsSource).toContain('title="Products"');
  });

  it('tapping a product card stock opens the quick stock editor', () => {
    expect(productsSource).toContain('<StockEditorSheet');
    expect(productsSource).toContain('onEditStock={openStockEditor}');
  });

  it('product-detail\'s Inventory tab edits stock directly via productService (no inventoryService import)', () => {
    expect(productDetailSource).toContain('adjustVariantStock');
    expect(productDetailSource).toContain('setVariantStock');
    expect(productDetailSource).not.toMatch(/from ['"`]@\/services\/inventoryService['"`]/);
  });

  it('the More menu no longer lists a separate Inventory item', () => {
    expect(moreSource).not.toContain("label: 'Inventory'");
  });

  it('the dashboard low-stock row deep-links into Products, not the removed screen', () => {
    expect(dashboardActionSource).toContain("'/(tabs)/products?filter=low-stock'");
  });
});
