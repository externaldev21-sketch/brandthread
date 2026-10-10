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

  it('pushes (never replaces) into a task with an explicit origin from every launch surface', () => {
    // docs/NAVIGATION.md: a task flow is PUSHED over the screen that opened
    // it, carrying `from=<origin>`, so its Cancel/Back pops to that exact
    // scene. replace() used to drop the dashboard from the stack and force
    // the exit onto a generic tabs index (wrong tab / Studio menu bug).
    const dashboard = read('components/SellerHomeCommerceDashboard.tsx');
    const walkthrough = read('components/SetupWalkthroughSheet.tsx');
    const setup = read('app/setup.tsx');

    expect(dashboard).toContain("router.push(withOrigin(task.route, 'dashboard') as never)");
    expect(dashboard).toContain("nav(withOrigin('/add-product', 'dashboard'))");
    expect(dashboard).not.toContain('router.replace(withSellerSetupOrigin');
    expect(walkthrough).toContain('onPress={() => openTask(task)}');
    expect(walkthrough).toContain("router.push(withOrigin(task.route, 'dashboard') as never)");
    expect(setup).toContain("router.push(withOrigin(task.route, 'setup') as never)");
    expect(setup).not.toContain('router.replace(');
  });

  it('gives every destination a pop-first exit that never hard-routes to a tabs index', () => {
    for (const [, , file] of setupDestinations) {
      const destination = read(file);

      expect(destination).toContain('leaveSetupFlow(router, ');
      expect(destination).not.toContain('router.replace(SELLER_HOME_ROUTE as never)');
      expect(destination).not.toContain("router.replace('/(tabs)/'");
    }
  });

  it('returns product completion and post completion to the correct setup origin', () => {
    const addProduct = read('app/add-product.tsx');
    const createPost = read('app/create-post.tsx');

    // "Product published!" moved from a native Alert to the shared
    // SuccessSheet (components/ui/SuccessSheet.tsx) — its secondary action
    // still returns to the seller-setup origin via leaveProductFlow.
    // Done is the second button, or a text button under "Share store" after a first publish.
    expect(addProduct).toContain("{ label: 'Done', onPress: () => { setPublishSuccess(null); leaveProductFlow(); } }");
    expect(createPost).toContain('leaveSetupFlow(router, params.from);');
    expect(createPost).toContain('onDiscard={leave}');
  });

  it('routes all nine completion signals through the behavioral completion boundary', () => {
    const completionSignals = [
      ['app/seller-verification.tsx', "data?.verificationStatus === 'verified'", "completeSetupTaskWhen('verify_account'"],
      ['app/payouts.tsx', 'normalized?.connected && normalized.chargesEnabled && normalized.payoutsEnabled', "'connect_payments'"],
      ['app/add-product.tsx', '() => api.products.create(serverCreatePayload)', "'first_product'"],
      ['app/shipping.tsx', '() => api.shippingZones.create(payload)', "'shipping_rates'"],
      ['app/store-builder.tsx', "() => applyTheme(THREAD_THEME_ID, 'light')", "'customize_store'"],
      ['app/store-domain.tsx', "verificationStatus === 'verified'", "'connect_domain'"],
      ['app/store-publish.tsx', 'result.success', "'publish_store'"],
      ['app/create-post.tsx', "completeSetupTaskAfter('first_post', run)", "'first_post'"],
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