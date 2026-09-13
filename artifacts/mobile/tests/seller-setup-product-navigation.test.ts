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
    const dashboard = read('app/(tabs)/index.tsx');
    const setup = read('app/setup.tsx');

    expect(dashboard).toContain('router.replace(withSellerSetupOrigin(task.route) as never)');
    expect(dashboard).toContain('onPress={task.completed ? undefined : () => openSetupTask(task)}');
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
});