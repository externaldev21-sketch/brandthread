import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const layoutSource = readFileSync(path.resolve(__dirname, '../app/_layout.tsx'), 'utf8');
const indexSource = readFileSync(path.resolve(__dirname, '../app/index.tsx'), 'utf8');

describe('development app preview routing', () => {
  it('defaults web previews to seller while preserving the buyer override', () => {
    expect(layoutSource).toContain(
      "if (!__DEV__ || Platform.OS !== 'web' || typeof window === 'undefined') return null;",
    );
    expect(layoutSource).toContain("return v === 'buyer' ? 'buyer' : 'seller';");
    expect(indexSource).toContain(
      "const effectivePreviewRole = previewRole === 'buyer' ? 'buyer' : 'seller';",
    );
    expect(indexSource).toContain(
      "effectivePreviewRole === 'buyer' ? '/(buyer)/' : '/(tabs)/'",
    );
  });
});