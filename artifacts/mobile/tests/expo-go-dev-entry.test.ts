import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const layout = readFileSync(resolve(__dirname, '../app/_layout.tsx'), 'utf8');
const bypass = readFileSync(resolve(__dirname, '../lib/devBypass.ts'), 'utf8');
const entry = readFileSync(resolve(__dirname, '../app/index.tsx'), 'utf8');
const dashboard = readFileSync(resolve(__dirname, '../app/(tabs)/index.tsx'), 'utf8');
const orders = readFileSync(resolve(__dirname, '../app/(tabs)/orders.tsx'), 'utf8');
const theme = readFileSync(resolve(__dirname, '../contexts/AppThemeContext.tsx'), 'utf8');
const icons = readFileSync(resolve(__dirname, '../contexts/AppIconContext.tsx'), 'utf8');
const flags = readFileSync(resolve(__dirname, '../contexts/FeatureFlagContext.tsx'), 'utf8');
const subscription = readFileSync(resolve(__dirname, '../hooks/useSubscriptionPlan.ts'), 'utf8');
const dashboardContent = readFileSync(resolve(__dirname, '../components/SellerHomeCommerceDashboard.tsx'), 'utf8');

describe('Expo Go development entry', () => {
  it('waits for Clerk and routes new native testers through onboarding', () => {
    expect(bypass).toContain("DEV_BYPASS_ROLE: 'buyer' | 'seller' | null = null");
    expect(layout).not.toContain('if (DEV_BYPASS_ROLE');
    expect(layout).toContain('{PREVIEW_ROLE ? (');
    expect(layout).toContain('<ClerkLoaded>{appTree}</ClerkLoaded>');
    expect(layout).toContain("router.replace(splashSeen ? '/sign-in' : '/splash')");
    expect(layout).toContain("router.replace('/onboarding')");
    expect(entry).toContain("if (Platform.OS !== 'web') return");
  });

  it('never mounts seller dashboard requests without a native session', () => {
    expect(dashboard).toContain("(!isLoaded || !isSignedIn || !userId) && !isSellerDevPreview()");
    expect(dashboard.indexOf('return <View style={styles.root} />')).toBeLessThan(
      dashboard.indexOf('<StripeConnectWarning />'),
    );
    expect(dashboard).toContain('await api.auth.me()');
    expect(orders).toContain('if (!authLoaded || !isSignedIn || !userId) return');
    expect(orders).toContain('await api.orders.list()');
  });

  it('keeps signed-out review previews away from account-only requests', () => {
    expect(theme).toContain('if (!userId) return;');
    expect(icons).toContain('if (!userId) {');
    expect(flags).toContain('if (!isSignedIn) return;');
    expect(subscription).toContain('if (!isSignedIn || !userId) {');
    expect(dashboardContent).toContain('Design preview · no account');
  });
});