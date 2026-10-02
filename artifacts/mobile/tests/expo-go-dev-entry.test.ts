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
  it('uses native dev-role routing while retaining web preview and normal auth gates', () => {
    expect(bypass).toContain("DEV_BYPASS_ROLE: 'buyer' | 'seller' | null =");
    expect(bypass).toContain("DEV_SELLER_PREVIEW ? 'seller' : null");
    expect(layout).toContain("DEV_BYPASS_ROLE === 'seller'");
    expect(layout).toContain('{PREVIEW_SESSION_ROLE || DEV_BYPASS_ROLE ? (');
    expect(layout).toContain('<ClerkLoaded>{appTree}</ClerkLoaded>');
    expect(layout).toContain("router.replace(splashSeen ? '/sign-in' : '/splash')");
    expect(layout).toContain("router.replace('/onboarding')");
    expect(entry).toContain("if (Platform.OS === 'web') {");
    expect(entry).toContain('effectivePreviewRole = DEV_BYPASS_ROLE;');
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

  it('keeps seller demo data local and account-only services behind signed-in guards', () => {
    expect(theme).toContain('if (!userId) return;');
    expect(icons).toContain('if (!userId) {');
    expect(flags).toContain('if (!isSignedIn) return;');
    expect(subscription).toContain('if (!isSignedIn || !userId) {');
    expect(dashboardContent).toContain('if (sellerPreview) {');
    expect(dashboardContent).toContain('const previewOrders = isPreviewDemoMode() ? allPreviewSellerOrders() : [];');
  });
});