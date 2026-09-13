import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const mobileRoot = path.resolve(__dirname, '..');

function read(relativePath: string) {
  return fs.readFileSync(path.join(mobileRoot, relativePath), 'utf8');
}

describe('seller setup product navigation', () => {
  it('replaces the transparent seller tab scene when opening the first-product task', () => {
    const dashboard = read('app/(tabs)/index.tsx');

    expect(dashboard).toContain("task.id === 'first_product'");
    expect(dashboard).toContain("router.replace('/add-product?from=seller-setup' as never)");
    expect(dashboard).toContain('onPress={task.completed ? undefined : () => openSetupTask(task)}');
  });

  it('returns every setup-launched product exit to seller Home', () => {
    const addProduct = read('app/add-product.tsx');

    expect(addProduct).toContain("const launchedFromSellerSetup = params.from === 'seller-setup'");
    expect(addProduct).toContain("router.replace('/(tabs)/' as never)");
    expect(addProduct).toContain("{ text: 'Done', onPress: leaveProductFlow }");
  });
});