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
    expect(source.match(/accessibilityRole="button"/g)?.length).toBeGreaterThanOrEqual(4);
    expect(source).toContain('accessibilityRole="checkbox"');
    expect(source).toContain('accessibilityState={{ checked: isDefault, disabled: isDefault }}');
  });

  it('keeps icon and default-address targets at least 44 points tall and wide where needed', () => {
    const header = readFileSync(new URL('../components/layout/Header.tsx', import.meta.url), 'utf8');
    expect(header).toMatch(/iconBtn: \{[^}]*width: 44,[^}]*height: 44,/s);
    expect(source).toMatch(/actionBtn: \{ width: 44, height: 44,/);
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
  });
});