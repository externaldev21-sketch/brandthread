import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('seller demo navigation', () => {
  it('mounts the actual seller screens instead of a route-wide placeholder', () => {
    const root = readFileSync(join(__dirname, '../app/_layout.tsx'), 'utf8');
    const tabs = readFileSync(join(__dirname, '../app/(tabs)/_layout.tsx'), 'utf8');

    expect(root).toContain('<IsolatedStackScene>{children}</IsolatedStackScene>');
    expect(root).not.toContain('SellerPreviewRouteGate');
    expect(tabs).not.toContain('SellerPreviewRouteGate');
  });

  it('keeps signed-out demo handling within the web-only preview role', () => {
    const preview = readFileSync(join(__dirname, '../lib/devPreview.ts'), 'utf8');
    expect(preview).toContain("Platform.OS !== 'web'");
    expect(preview).toContain('!__DEV__');
  });
});