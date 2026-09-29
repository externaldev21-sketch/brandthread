import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../app/buyer-addresses.tsx', import.meta.url), 'utf8');

describe('buyer shipping-address accessibility contract', () => {
  it('keeps every address action named for screen readers', () => {
    expect(source).toContain("backAccessibilityLabel={showForm ? 'Close address form' : 'Go back'}");
    expect(source).toContain('accessibilityLabel={`Edit ${addr.label} address`}');
    expect(source).toContain('accessibilityLabel={`Delete ${addr.label} address`}');
    expect(source).toContain('accessibilityLabel={`Set ${addr.label} as default address`}');
    expect(source).toContain('accessibilityLabel="Retry loading saved addresses"');
  });

  it('keeps roles and checked state on address actions', () => {
    const button = readFileSync(new URL('../components/ui/Button.tsx', import.meta.url), 'utf8');
    const iconButton = readFileSync(new URL('../components/ui/IconButton.tsx', import.meta.url), 'utf8');
    const header = readFileSync(new URL('../components/ScreenHeader.tsx', import.meta.url), 'utf8');
    expect(button).toContain('accessibilityRole="button"');
    expect(iconButton).toContain('accessibilityRole="button"');
    expect(header).toContain('accessibilityRole="button"');
    expect(source).toContain('accessibilityRole="checkbox"');
    expect(source).toContain('accessibilityState={{ checked: isDefault, disabled: isDefault }}');
  });

  it('keeps icon and default-address targets at least 44 points tall and wide where needed', () => {
    const header = readFileSync(new URL('../components/layout/Header.tsx', import.meta.url), 'utf8');
    const iconButton = readFileSync(new URL('../components/ui/IconButton.tsx', import.meta.url), 'utf8');
    const tokens = readFileSync(new URL('../lib/theme.ts', import.meta.url), 'utf8');
    expect(header).toMatch(/iconBtn: \{[^}]*width: 44,[^}]*height: 44,/s);
    expect(iconButton).toContain('hit: { width: COMP.iconBtn, height: COMP.iconBtn');
    expect(tokens).toMatch(/iconBtn:\s+44,/);
    expect(source).toMatch(/makeDefaultBtn: \{ minHeight: 44,/);
    expect(source).toMatch(/defaultToggle: \{ minHeight: 44,/);
  });

  it('ships an Appium check for both native accessibility trees', () => {
    const deviceCheck = readFileSync(
      new URL('./buyer-addresses.device.mjs', import.meta.url),
      'utf8',
    );
    expect(deviceCheck).toContain("NATIVE_BUYER_ADDRESSES_PLATFORM");
    expect(deviceCheck).toContain("['ios', 'android'].includes(platform)");
    expect(deviceCheck).toContain("assertSourceOrder(initialSource");
    expect(deviceCheck).toContain("platform === 'ios' ? 'value' : 'checked'");
    expect(deviceCheck).toContain("Retry loading saved addresses");
    expect(deviceCheck).toContain("signInDisposableBuyer");
    expect(deviceCheck).toContain("NATIVE_BUYER_ADDRESSES_DISPOSABLE_ACCOUNT must be JSON");
  });

  it('keeps repository-owned release fixture lifecycle commands', () => {
    const wrapper = readFileSync(
      new URL('./run-buyer-addresses-release-check.mjs', import.meta.url),
      'utf8',
    );
    const fixture = readFileSync(
      new URL('./buyer-addresses-release-fixture.mjs', import.meta.url),
      'utf8',
    );
    expect(wrapper).toContain('prepareBuyerAddressFixture');
    expect(wrapper).toContain('armBuyerAddressFailure');
    expect(wrapper).toContain('cleanupBuyerAddressFixture');
    expect(wrapper).not.toContain('PREPARE_COMMAND');
    expect(fixture).toContain('/buyer-addresses/prepare');
    expect(fixture).toContain('/buyer-addresses/arm-failure');
    expect(fixture).toContain('/buyer-addresses/cleanup');
    expect(fixture).toContain('revokeSessions');
  });

  it('runs credential-safe fixture checks on a schedule without approving a release', () => {
    const workflow = readFileSync(
      new URL('../../../.github/workflows/mobile-shipping-address-accessibility.yml', import.meta.url),
      'utf8',
    );
    const wrapper = readFileSync(
      new URL('./run-buyer-addresses-release-check.mjs', import.meta.url),
      'utf8',
    );
    const deviceCheck = readFileSync(
      new URL('./buyer-addresses.device.mjs', import.meta.url),
      'utf8',
    );
    expect(workflow).toContain('schedule:');
    expect(workflow).toContain("if: github.event_name != 'schedule'");
    expect(workflow).toContain('buyer-addresses-accessibility/ios/**/*');
    expect(workflow).toContain('buyer-addresses-accessibility/android/**/*');
    expect(wrapper).toContain('fixture-lifecycle.json');
    expect(wrapper).toContain('oneShotRecoveryVerified');
    expect(wrapper).toContain('cleanupVerified');
    expect(deviceCheck).toContain('failure-page-source.xml');
    expect(deviceCheck).toContain('[REDACTED_PASSWORD]');
  });
});