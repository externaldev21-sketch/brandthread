import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const layoutSource = readFileSync(path.resolve(__dirname, '../app/_layout.tsx'), 'utf8');
const indexSource = readFileSync(path.resolve(__dirname, '../app/index.tsx'), 'utf8');

describe('development app preview routing', () => {
  it('starts the default web preview in onboarding and preserves explicit dashboard shortcuts', () => {
    expect(layoutSource).toContain(
      "if ((!__DEV__ && !NAVIGATION_ISOLATION_TEST) || Platform.OS !== 'web' || typeof window === 'undefined') return null;",
    );
    expect(layoutSource).toContain("return v === 'buyer' || v === 'seller' ? v : null;");
    expect(layoutSource).toContain('const DEV_WEB_ONBOARDING_PREVIEW =');
    expect(indexSource).toContain(
      "const effectivePreviewRole = Platform.OS === 'web'",
    );
    expect(indexSource).toContain(
      "previewRole === 'buyer' ? '/(buyer)' : '/(tabs)'",
    );
    expect(indexSource).toContain(
      "previewRole === 'buyer' || previewRole === 'seller' ? previewRole : null",
    );
  });
});