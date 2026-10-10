import { describe, expect, it } from 'vitest';
import { buildDemoLaunchChecklist, getReadyRows, type LaunchChecklistResponse, type LaunchStepId } from './launchChecklist';

const ALL: LaunchStepId[] = ['name_handle', 'logo_banner', 'accent', 'socials', 'first_product', 'shipping', 'preview', 'publish', 'payouts'];
const make = (done: LaunchStepId[]): LaunchChecklistResponse => ({
  steps: ALL.map((id) => ({ id, done: done.includes(id) })),
  doneCount: done.length, total: ALL.length, complete: false, handle: null, dismissed: false,
});

describe('Get ready to sell (Shopify order)', () => {
  it("has Dev's six rows in order, payouts after the first product", () => {
    expect(getReadyRows(make([])).map((r) => r.title)).toEqual([
      'Add your first product', 'Name your store', 'Set your shipping rates', 'Set up payouts', 'Customize your store', 'Share your store',
    ]);
  });
  it('every row opens a real screen', () => {
    const routes = getReadyRows(make([])).map((r) => r.route);
    expect(routes).toEqual(['/add-product', '/store-setup-name', '/shipping', '/payouts', '/store-setup-brand', '/launch-publish']);
  });
  it('payouts is done only when Stripe says so', () => {
    expect(getReadyRows(make(['payouts'])).find((r) => r.id === 'payouts')!.done).toBe(true);
    expect(getReadyRows(make([])).find((r) => r.id === 'payouts')!.done).toBe(false);
  });
  it('customize needs logo, banner and color; share opens the share screen once published', () => {
    expect(getReadyRows(make(['logo_banner'])).find((r) => r.id === 'customize')!.done).toBe(false);
    expect(getReadyRows(make(['logo_banner', 'accent'])).find((r) => r.id === 'customize')!.done).toBe(true);
    const share = getReadyRows(make(['publish'])).find((r) => r.id === 'share')!;
    expect(share).toMatchObject({ done: true, route: '/share-store' });
  });
  it('demo data (demo=1) includes the shipping flag', () => {
    expect(buildDemoLaunchChecklist().steps.map((s) => s.id)).toContain('shipping');
  });
});
