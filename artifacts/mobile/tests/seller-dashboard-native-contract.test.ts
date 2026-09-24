import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const dashboard = readFileSync(new URL('../components/SellerHomeCommerceDashboard.tsx', import.meta.url), 'utf8');
const studio = readFileSync(new URL('../components/SellerStudioRadialMenu.tsx', import.meta.url), 'utf8');
const createFab = readFileSync(new URL('../components/SellerCreateFAB.tsx', import.meta.url), 'utf8');
const deviceFlow = readFileSync(new URL('./seller-dashboard.device.mjs', import.meta.url), 'utf8');
const packageJson = readFileSync(new URL('../package.json', import.meta.url), 'utf8');

describe('seller dashboard native interaction contract', () => {
  it('keeps the native ScrollView bounded and verifies that its content moves', () => {
    expect(dashboard).toContain('testID="seller-dashboard-scroll"');
    expect(dashboard).toContain('testID="seller-dashboard-scroll-position"');
    expect(dashboard).toContain('testID="seller-dashboard-scroll-end"');
    expect(dashboard).toContain('scrollView: { flex: 1 }');
    expect(deviceFlow).toContain("platformName: 'iOS'");
    expect(deviceFlow).toContain("await swipeDashboard()");
    expect(deviceFlow).toContain("await waitFor('Seller dashboard scroll end')");
    expect(deviceFlow).toContain('markerAfter.y >= markerBefore.y - 20');
  });

  it('keeps all six centered Studio actions, backdrop, close behavior, navigation, and gating in the device contract', () => {
    expect(studio).toContain('justifyContent: \'center\'');
    expect(studio).toContain('testID="seller-studio-menu-backdrop"');
    expect(studio).toContain('testID="seller-studio-menu-close"');
    expect(studio).toContain('GROWTH_PLAN_ENFORCEMENT_ENABLED');
    expect(studio).toContain("!hasPlan('growth')");
    expect(studio).toContain('setUpsellFeature(action.label)');
    expect(studio).toContain('router.push(action.route as never)');
    for (const label of [
      'Design Studio',
      'Mockup to Model',
      'Remove Background',
      'AI Design',
      'Create Ad',
      'AI Photoshoot',
    ]) {
      expect(deviceFlow).toContain(`'${label}'`);
    }
    expect(deviceFlow).toContain("await tap('Close Studio tools')");
    expect(deviceFlow).toContain("await tap('Dismiss Studio tools backdrop')");
    expect(deviceFlow).toContain("await tap('Design Studio')");
    expect(deviceFlow).toContain('await pressAndroidBack()');
  });

  it('keeps the floating create menu and every create destination covered', () => {
    expect(createFab).toContain('testID="seller-create-fab"');
    for (const route of ['/create-post', '/add-product', '/seller-drop-create', '/boost']) {
      expect(createFab).toContain(`route: '${route}'`);
    }
    expect(deviceFlow).toContain("for (const label of ['New post', 'New product', 'New drop', 'Start a boost'])");
    expect(deviceFlow).toContain("await tap('New post')");
    expect(deviceFlow).toContain('await verifyCreateRoutes()');
    expect(packageJson).toContain('"test:seller-dashboard:native"');
    expect(packageJson).toContain('"test:seller-dashboard:native:ci"');
    expect(packageJson).toContain('"test:seller-dashboard:android"');
    expect(packageJson).toContain('"test:seller-dashboard:android:ci"');
  });
});