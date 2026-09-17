import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const layoutSource = fs.readFileSync(
  path.resolve(__dirname, '../app/(tabs)/_layout.tsx'),
  'utf8',
);

describe('seller bottom navigation layout', () => {
  it('keeps the requested four center destinations', () => {
    expect(layoutSource).toContain("label: 'Dashboard'");
    expect(layoutSource).toContain("label: 'Products'");
    expect(layoutSource).toContain("label: 'Orders'");
    expect(layoutSource).toContain("label: 'Profile'");
  });

  it('places Studio and Brandthread AI in fixed side circles', () => {
    expect(layoutSource).toContain('testID="seller-bottom-menu"');
    expect(layoutSource).toContain('accessibilityLabel="Open Studio tools"');
    expect(layoutSource).toContain('testID="seller-bottom-ai"');
    expect(layoutSource).toContain('accessibilityLabel="Open Brandthread AI"');
    expect(layoutSource).toContain('<SellerStudioRadialMenu hideTrigger');
  });
});