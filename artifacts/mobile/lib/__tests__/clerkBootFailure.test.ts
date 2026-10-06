import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-updates', () => ({ reloadAsync: vi.fn() }));
vi.mock('@/components/BootScreen', () => ({ default: () => null }));
vi.mock('@/components/branding/BrandthreadLogo', () => ({ default: () => null }));
vi.mock('@/components/BrandthreadUI', () => ({ PrimaryButton: () => null }));
vi.mock('@/contexts/AppThemeContext', () => ({ useAppTheme: () => ({ theme: {} }) }));
vi.mock('react-native', () => ({
  Platform: { OS: 'web' },
  StyleSheet: { create: (s: unknown) => s },
  Text: () => null,
  View: () => null,
}));

describe('isClerkScriptLoadFailure', () => {
  it('recognises clerk-js load failures', async () => {
    const { isClerkScriptLoadFailure } = await import('@/components/ClerkBootGate');
    expect(isClerkScriptLoadFailure({ code: 'failed_to_load_clerk_js', message: 'x' })).toBe(true);
    expect(isClerkScriptLoadFailure(new Error('Clerk: Failed to load Clerk JS (code="failed_to_load_clerk_js")'))).toBe(true);
    expect(isClerkScriptLoadFailure('Clerk: Failed to load Clerk')).toBe(true);
  });
  it('ignores everything else', async () => {
    const { isClerkScriptLoadFailure } = await import('@/components/ClerkBootGate');
    expect(isClerkScriptLoadFailure(new Error('Network request failed'))).toBe(false);
    expect(isClerkScriptLoadFailure(undefined)).toBe(false);
  });
});
