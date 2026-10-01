import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL_ITEMS } from '@/lib/sellerControlCenter';

const studio = readFileSync(resolve(process.cwd(), 'components/SellerStudioRadialMenu.tsx'), 'utf8');

/**
 * Dev: "No two cards may share the same icon" — caught Customers and
 * Community both using Feather's 'users' glyph. Community now uses 'hash'
 * instead. This test derives the live CARD_ORDER list straight from source
 * (not a hand-copied list that could drift) so a future addition reusing an
 * existing card's icon fails immediately, regardless of which two collide.
 */
describe('Studio carousel: every card has a distinct icon', () => {
  it('no two ids in CARD_ORDER resolve to the same Feather icon', () => {
    const orderBlock = studio.slice(studio.indexOf('const CARD_ORDER = ['), studio.indexOf('];', studio.indexOf('const CARD_ORDER = [')));
    const cardOrderIds = Array.from(orderBlock.matchAll(/'([a-z0-9-]+)'/g), (m) => m[1]);
    expect(cardOrderIds.length).toBeGreaterThan(0);

    const byId = new Map(ALL_ITEMS.map((item) => [item.id, item]));
    const iconToIds = new Map<string, string[]>();
    for (const id of cardOrderIds) {
      const item = byId.get(id);
      expect(item, `CARD_ORDER references unknown id "${id}"`).toBeDefined();
      const icon = item!.icon;
      iconToIds.set(icon, [...(iconToIds.get(icon) ?? []), id]);
    }

    const duplicates = Array.from(iconToIds.entries()).filter(([, ids]) => ids.length > 1);
    expect(duplicates, `duplicate icons across Studio cards: ${duplicates.map(([icon, ids]) => `"${icon}" used by ${ids.join(', ')}`).join('; ')}`).toEqual([]);
  });
});
