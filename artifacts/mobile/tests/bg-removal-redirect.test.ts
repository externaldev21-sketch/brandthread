/**
 * Audit workstream F, item 7. There were two implementations of background
 * removal: app/bg-removal.tsx (an old, separate screen with its own upload/
 * removal flow) and app/design-bg-removal.tsx (the current one, already
 * linked from more.tsx, (tabs)/studio.tsx, and lib/sellerControlCenter.ts).
 * ai-studio.tsx was still linking to the old route. Fixed ai-studio.tsx to
 * link to /design-bg-removal directly, and turned app/bg-removal.tsx into a
 * plain redirect (matching the established app/ai-assistant.tsx pattern)
 * for any stale deep link that still targets /bg-removal.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');

describe('bg-removal route de-duplication', () => {
  it('app/bg-removal.tsx is a plain Redirect to /design-bg-removal, not a second implementation', () => {
    const src = readFileSync(resolve(ROOT, 'app/bg-removal.tsx'), 'utf8');
    expect(src).toContain("import { Redirect } from 'expo-router';");
    expect(src).toContain('<Redirect href="/design-bg-removal" />');
    // Guards against this file quietly regrowing its own upload/removal
    // flow again instead of staying a redirect.
    expect(src).not.toContain('api.bgRemoval');
  });

  it('ai-studio.tsx links Background Removal to /design-bg-removal, not the old /bg-removal route', () => {
    const src = readFileSync(resolve(ROOT, 'app/ai-studio.tsx'), 'utf8');
    expect(src).not.toContain("router.push('/bg-removal'");
    expect(src).toContain("router.push('/design-bg-removal'");
  });

  it('every other known in-app link to background removal already points at /design-bg-removal', () => {
    const studioSrc = readFileSync(resolve(ROOT, 'app/(tabs)/studio.tsx'), 'utf8');
    const controlCenterSrc = readFileSync(resolve(ROOT, 'lib/sellerControlCenter.ts'), 'utf8');
    expect(studioSrc).toContain("'remove-bg': '/design-bg-removal'");
    expect(controlCenterSrc).toMatch(/'remove-bg':\s*'\/design-bg-removal'/);
  });
});
