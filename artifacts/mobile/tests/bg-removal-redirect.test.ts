/**
 * Audit workstream F, item 7. There were two implementations of background
 * removal: app/bg-removal.tsx (an old, separate screen with its own upload/
 * removal flow) and app/design-bg-removal.tsx (the current one, already
 * linked from more.tsx, (tabs)/studio.tsx, and lib/sellerControlCenter.ts).
 * ai-studio.tsx was still linking to the old route. Fixed ai-studio.tsx to
 * link to /design-bg-removal directly. The old /bg-removal path now redirects
 * through lib/navigation/legacyRoutes (the screen file is gone).
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveLegacyRoute } from '../lib/navigation/legacyRoutes';

const ROOT = resolve(__dirname, '..');

describe('bg-removal route de-duplication', () => {
  it('/bg-removal has no screen of its own and redirects to /design-bg-removal', () => {
    expect(existsSync(resolve(ROOT, 'app/bg-removal.tsx'))).toBe(false);
    expect(resolveLegacyRoute('/bg-removal')).toBe('/design-bg-removal');
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
