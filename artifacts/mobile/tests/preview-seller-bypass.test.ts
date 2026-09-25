import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const layoutSource = readFileSync(path.resolve(__dirname, '../app/_layout.tsx'), 'utf8');
const indexSource = readFileSync(path.resolve(__dirname, '../app/index.tsx'), 'utf8');

describe('development app preview routing', () => {
  it('only engages the web preview bypass when ?bt_preview is explicitly set', () => {
    expect(layoutSource).toContain(
      "if ((!__DEV__ && !NAVIGATION_ISOLATION_TEST) || Platform.OS !== 'web' || typeof window === 'undefined') return null;",
    );
    expect(layoutSource).toContain("if (v !== 'buyer' && v !== 'seller') return null;");
    expect(indexSource).toContain(
      "const effectivePreviewRole = Platform.OS === 'web'",
    );
    expect(indexSource).toContain(
      "previewRole === 'seller' || previewRole === 'buyer' ? previewRole : null",
    );
    expect(indexSource).toContain(
      "previewRole === 'seller' ? '/(tabs)' : '/(buyer)'",
    );
  });

  it('keeps the native dev bypass opt-in via EXPO_PUBLIC_DEV_BYPASS_ROLE, off by default', () => {
    const devBypassSource = readFileSync(path.resolve(__dirname, '../lib/devBypass.ts'), 'utf8');
    expect(devBypassSource).toContain('process.env.EXPO_PUBLIC_DEV_BYPASS_ROLE');
    expect(devBypassSource).not.toMatch(/DEV_BYPASS_ROLE[^=]*=\s*__DEV__\s*\?\s*'seller'/);
  });
});
