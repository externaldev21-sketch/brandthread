import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('seller shell regressions', () => {
  it('uses one stable API hook implementation', () => {
    expect(read('hooks/useApi.ts')).toContain("export { useApi } from '@/lib/api'");
  });

  it('does not change dashboard layout height while scrolling', () => {
    const dashboard = read('app/(tabs)/index.tsx');
    expect(dashboard).not.toContain('dashboardScrollY');
    expect(dashboard).not.toContain('compactBalanceWrap');
  });

  it('does not cover Studio with an automatic tutorial or block standard tools on plan loading', () => {
    const studio = read('app/(tabs)/studio.tsx');
    expect(studio).not.toContain('SellerTutorialOverlay');
    expect(studio).not.toContain('if (planLoading) return');
    expect(studio).toContain('setUpsellVisible(false)');
    expect(studio.indexOf('router.push(tool.route as never)')).toBeLessThan(
      studio.indexOf('void markFeatureOpened(tool.id).catch'),
    );
  });

  it('fully unmounts the paywall portal while it is closed', () => {
    const modal = read('components/PlanUpsellModal.tsx');
    expect(modal).toContain('if (!visible) return null');
    expect(modal).toMatch(/<Modal\s+visible\s+transparent/);
  });

  it('ties every Growth paywall host to its route focus', () => {
    const manufacturerHub = read('app/manufacturer-hub.tsx');
    expect(manufacturerHub).toContain('return () => setUpsellVisible(false)');
  });
});