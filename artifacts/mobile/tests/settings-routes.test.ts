import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { BUYER_SETTINGS_CATALOG, SELLER_SETTINGS_CATALOG } from '../services/settingsCatalog';

const APP_DIR = resolve(__dirname, '..', 'app');

/**
 * Every settings row with a `route` must resolve to a real expo-router file,
 * for both the buyer hub and the seller hub. Rows without a route use an
 * `action` (sign-out, delete-account, account-scope) or are a placeholder
 * slot (Thread Cash) and are exempt.
 */
function routeExists(route: string): boolean {
  const [path] = route.split('?');
  const trimmed = path.replace(/^\//, '');
  return (
    existsSync(resolve(APP_DIR, `${trimmed}.tsx`)) ||
    existsSync(resolve(APP_DIR, trimmed, 'index.tsx'))
  );
}

describe.each([
  ['buyer', BUYER_SETTINGS_CATALOG],
  ['seller', SELLER_SETTINGS_CATALOG],
] as const)('%s settings catalog', (_label, catalog) => {
  const items = catalog.flatMap((group) => group.items);

  it('gives every row either a route, an action, or a "soon" slot', () => {
    for (const item of items) {
      expect(item.route || item.action || item.soon, item.label).toBeTruthy();
    }
  });

  it('routes every navigable row to a screen that exists on disk', () => {
    for (const item of items) {
      if (!item.route) continue;
      expect(routeExists(item.route), `${item.label} -> ${item.route}`).toBe(true);
    }
  });
});
