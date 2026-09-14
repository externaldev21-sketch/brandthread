import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('seller Profile tab navigation', () => {
  it('uses the seller route group instead of the ambiguous /profile URL', () => {
    const layout = readFileSync(resolve(process.cwd(), 'app/(tabs)/_layout.tsx'), 'utf8');

    expect(layout).toContain("route.name === 'profile'");
    expect(layout).toContain("router.replace('/(tabs)/profile')");
  });
});