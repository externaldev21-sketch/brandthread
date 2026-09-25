import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const mobileRoot = path.resolve(__dirname, '..');

function read(relativePath: string) {
  return fs.readFileSync(path.join(mobileRoot, relativePath), 'utf8');
}

const setupDestinations = [
  ['verify_account', '/seller-verification', 'app/seller-verification.tsx'],
  ['connect_payments', '/payouts', 'app/payouts.tsx'],
  ['first_product', '/add-product', 'app/add-product.tsx'],
  ['shipping_rates', '/shipping', 'app/shipping.tsx'],
  ['customize_store', '/store-builder', 'app/store-builder.tsx'],
  ['connect_domain', '/store-domain', 'app/store-domain.tsx'],
  ['publish_store', '/store-publish', 'app/store-publish.tsx'],
  ['first_post', '/create-post', 'app/create-post.tsx'],
  ['connect_manufacturer', '/manufacturer-hub', 'app/manufacturer-hub.tsx'],
] as const;

describe('seller setup destination navigation', () => {
  it('maps all nine tasks to real route files', () => {
    const setupStore = read('lib/setupStore.ts');

    expect(setupDestinations).toHaveLength(9);
    for (const [id, route, file] of setupDestinations) {
      expect(setupStore).toContain(`id: '${id}'`);
      expect(setupStore).toContain(`route: '${route}'`);
      expect(fs.existsSync(path.join(mobileRoot, file))).toBe(true);
    }
  });

  it('replaces transparent checklist scenes from both launch surfaces', () => {
    // The dashboard's own "add first product" shortcut still replaces (not
    // pushes) into the setup origin; the full per-task checklist itself now
    // lives in the guided walkthrough sheet the dashboard's "Continue setup"
    // banner opens, rather than being duplicated inline in the dashboard.
    const dashboard = read('components/SellerHomeCommerceDashboard.tsx');
    const walkthrough = read('components/SetupWalkthroughSheet.tsx');
    const setup = read('app/setup.tsx');

    expect(dashboard).toContain('router.replace(withSellerSetupOrigin(task.route) as never)');
    expect(walkthrough).toContain('onPress={() => openTask(task)}');
    expect(setup).toContain('router.replace(withSellerSetupOrigin(task.route) as never)');
  });

  it('gives every destination an explicit seller-setup return path', () => {
    for (const [, , file] of setupDestinations) {
      const destination = read(file);

      expect(destination).toContain('isSellerSetupOrigin');
      expect(destination).toContain('SELLER_HOME_ROUTE');
      expect(destination).toContain('router.replace(SELLER_HOME_ROUTE as never)');
    }
  });

  it('returns product completion and post completion to the correct setup origin', () => {
    const addProduct = read('app/add-product.tsx');
    const createPost = read('app/create-post.tsx');

    expect(addProduct).toContain("{ text: 'Done', onPress: leaveProductFlow }");
    expect(createPost).toContain("(isSellerSetup ? SELLER_HOME_ROUTE : '/(tabs)/profile') as never");
  });

  it('routes all nine completion signals through the behavioral completion boundary', () => {
    const completionSignals = [
      ['app/seller-verification.tsx', "data?.verificationStatus === 'verified'", "completeSetupTaskWhen('verify_account'"],
      ['app/payouts.tsx', 'normalized?.connected && normalized.chargesEnabled && normalized.payoutsEnabled', "'connect_payments'"],
      ['app/add-product.tsx', '() => api.products.create(serverCreatePayload)', "'first_product'"],
      ['app/shipping.tsx', '() => api.shippingRates.create', "'shipping_rates'"],
      ['app/store-builder.tsx', "() => applyTheme(THREAD_THEME_ID, 'light')", "'customize_store'"],
      ['app/store-domain.tsx', "verificationStatus === 'verified'", "'connect_domain'"],
      ['app/store-publish.tsx', 'result.success', "'publish_store'"],
      ['app/create-post.tsx', "() => persistSellerPost(false)", "'first_post'"],
      ['app/manufacturer-hub.tsx', '() => saveManufacturer(mfg.id)', "'connect_manufacturer'"],
    ] as const;

    for (const [file, successSignal, completionSignal] of completionSignals) {
      const destination = read(file);
      expect(destination).toContain(successSignal);
      expect(destination).toContain(completionSignal);
    }
  });

  it('refreshes persisted progress whenever the checklist regains focus', () => {
    const setup = read('app/setup.tsx');

    expect(setup).toContain('useFocusEffect(useCallback(() => {');
    expect(setup).toContain('getSetupState().then(next => {');
  });
});