import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const mobileRoot = path.resolve(__dirname, '..');

function read(relativePath: string) {
  return fs.readFileSync(path.join(mobileRoot, relativePath), 'utf8');
}

describe('seller dashboard neutral glass surfaces', () => {
  it('defines desaturated graphite glass tokens', () => {
    const theme = read('lib/theme.ts');

    expect(theme).toContain("SELLER_DASHBOARD_GLASS = 'rgba(16, 16, 16, 0.54)'");
    expect(theme).toContain("SELLER_DASHBOARD_GLASS_ELEVATED = 'rgba(26, 26, 26, 0.68)'");
  });

  it('keeps dashboard-owned panels off the blue-violet surface tokens', () => {
    const dashboard = read('app/(tabs)/index.tsx');
    const kpiGrid = read('components/SellerDashboardKPIGrid.tsx');
    const quickActions = read('components/SellerQuickActionsGrid.tsx');

    expect(dashboard).not.toMatch(/\bCARD_GLASS\b|\bCARD_ELEVATED_GLASS\b/);
    expect(kpiGrid).not.toMatch(/\bCARD_GLASS\b|\bCARD_ELEVATED_GLASS\b/);
    expect(quickActions).toContain('backgroundColor: theme.card');
    expect(quickActions).toContain('borderColor: theme.border');
  });
});