import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

describe('saved product alert toggles', () => {
  it('the Saved row sheet carries both per-item alert switches, wired to the PATCH helper', () => {
    const src = read('app/buyer-saved.tsx');
    expect(src).toContain('title="Price drop alerts"');
    expect(src).toContain('title="Back in stock alerts"');
    expect(src).toContain("toggleAlert(actionsFor, 'notifyOnPriceDrop', next)");
    expect(src).toContain("toggleAlert(actionsFor, 'notifyOnBackInStock', next)");
    expect(src).toContain('setSavedItemAlerts(item.targetId, { [key]: next })');
  });

  it('seller product Analytics shows the saves & alert reach row', () => {
    expect(read('app/product-detail.tsx')).toContain('<ProductSaveStatsRow productId={product.id} />');
  });
});

describe('setSavedItemAlerts', () => {
  it('PATCHes only the toggles it is given', () => {
    const src = read('services/socialService.ts');
    expect(src).toMatch(/export async function setSavedItemAlerts[\s\S]*?method: 'PATCH', body: JSON\.stringify\(alerts\)/);
  });
});
