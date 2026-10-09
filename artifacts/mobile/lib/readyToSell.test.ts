import { describe, expect, it } from 'vitest';
import { READY_TO_SELL_STEPS, buildDemoReadyToSell, buildFreshReadyToSell, completedLabel } from './readyToSell';

describe('ready to sell', () => {
  it('has six steps in the server order, each with a title and a route', () => {
    const fresh = buildFreshReadyToSell();
    expect(fresh.steps.map((s) => s.id)).toEqual([
      'first_product', 'name_store', 'shipping_rates', 'payouts', 'customize_store', 'share_store',
    ]);
    for (const s of fresh.steps) {
      expect(READY_TO_SELL_STEPS[s.id].title).toBeTruthy();
      expect(READY_TO_SELL_STEPS[s.id].route.startsWith('/')).toBe(true);
    }
    expect(completedLabel(fresh)).toBe('0 / 6 completed');
  });

  it('demo is part-way through and never claims a sale', () => {
    const demo = buildDemoReadyToSell();
    expect(completedLabel(demo)).toBe('3 / 6 completed');
    expect(demo.hasSale).toBe(false);
  });
});
