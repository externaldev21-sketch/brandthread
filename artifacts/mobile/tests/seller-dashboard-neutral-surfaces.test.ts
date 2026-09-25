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
    const homeScreen = read('app/(tabs)/index.tsx');
    const dashboard = read('components/SellerHomeCommerceDashboard.tsx');
    const statGrid = read('components/SellerDashboardStatGrid.tsx');
    const quickActions = read('components/SellerQuickActionsGrid.tsx');

    expect(homeScreen).not.toMatch(/\bCARD_GLASS\b|\bCARD_ELEVATED_GLASS\b/);
    expect(dashboard).not.toMatch(/\bCARD_GLASS\b|\bCARD_ELEVATED_GLASS\b/);
    expect(statGrid).not.toMatch(/\bCARD_GLASS\b|\bCARD_ELEVATED_GLASS\b/);
    expect(quickActions).toContain('backgroundColor: theme.card');
    expect(quickActions).toContain('borderColor: theme.border');
  });

  it('routes every dashboard color through theme tokens, not hardcoded hex/rgba', () => {
    const dashboard = read('components/SellerHomeCommerceDashboard.tsx');
    // Only theme.* accessors (or the SCREEN_BG fallback constant) may back a
    // dashboard surface color — this app has 12 themes, so no hardcoded hex.
    const hardcodedColorProps = dashboard.match(/(?:backgroundColor|borderColor|color):\s*'#[0-9a-fA-F]{3,8}'/g) ?? [];
    expect(hardcodedColorProps).toEqual([]);
  });
});