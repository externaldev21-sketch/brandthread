/**
 * Source-structure test (last resort: the full dashboard pulls in dozens of
 * native-only modules and can't be rendered under the Node shim). When the
 * seller switches store, every store-scoped number must be dropped right
 * away — not only the analytics snapshot, top products and recent orders,
 * but also the To do counts ("N orders to ship"), the activity feed and the
 * new-seller flag. Otherwise, if the refetch for the new store fails, the
 * previous store's to-dos and activity stay on screen under the new store.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(join(__dirname, '..', 'SellerHomeCommerceDashboard.tsx'), 'utf8');

function storeSwitchHandler(): string {
  const start = source.indexOf('useEffect(() => subscribeStoreContext(() => {\n    // Drop the previous store');
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf('}), []);', start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('SellerHomeCommerceDashboard store switch', () => {
  it('clears every store-scoped section, not just analytics/products/orders', () => {
    const handler = storeSwitchHandler();
    for (const reset of [
      'setSnapshot(null)',
      'setTopProducts(null)',
      'setRecentOrders(null)',
      'setActionInputs(null)',
      'setActivityItems([])',
      'setEverSoldCount(null)',
      'setStoreContextTick(',
    ]) {
      expect(handler).toContain(reset);
    }
  });
});
