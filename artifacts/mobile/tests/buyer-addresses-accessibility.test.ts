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
});
