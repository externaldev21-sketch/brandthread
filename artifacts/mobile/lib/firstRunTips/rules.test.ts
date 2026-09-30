import { describe, expect, it } from 'vitest';
import { isAuthFlowRoute, isFirstRunTipsPreviewForceShow, isPreviewWithoutTipsForce } from './rules';

describe('isAuthFlowRoute — first-run tips never show during auth/onboarding', () => {
  it('excludes sign-in, sign-up, onboarding, and account-type routes', () => {
    expect(isAuthFlowRoute('/sign-in')).toBe(true);
    expect(isAuthFlowRoute('/sign-up')).toBe(true);
    expect(isAuthFlowRoute('/onboarding')).toBe(true);
    expect(isAuthFlowRoute('/account-type')).toBe(true);
    expect(isAuthFlowRoute('/manufacturer-onboard')).toBe(true);
  });

  it('does not exclude the settings-only account-type screen, or ordinary screens', () => {
    expect(isAuthFlowRoute('/account-type-settings')).toBe(false);
    expect(isAuthFlowRoute('/(tabs)/index')).toBe(false);
    expect(isAuthFlowRoute('/design-mockup-to-model')).toBe(false);
  });

  it('handles null/undefined pathnames safely', () => {
    expect(isAuthFlowRoute(null)).toBe(false);
    expect(isAuthFlowRoute(undefined)).toBe(false);
  });
});

describe('isFirstRunTipsPreviewForceShow — Dev’s &tips=1 preview override', () => {
  it('is false with no query string', () => {
    expect(isFirstRunTipsPreviewForceShow('')).toBe(false);
  });

  it('is false with bt_preview alone (no tips=1)', () => {
    expect(isFirstRunTipsPreviewForceShow('?bt_preview=seller')).toBe(false);
  });

  it('is true only when tips=1 is explicitly present', () => {
    expect(isFirstRunTipsPreviewForceShow('?bt_preview=seller&tips=1')).toBe(true);
    expect(isFirstRunTipsPreviewForceShow('?tips=1')).toBe(true);
  });

  it('is false for any other tips value', () => {
    expect(isFirstRunTipsPreviewForceShow('?tips=0')).toBe(false);
    expect(isFirstRunTipsPreviewForceShow('?tips=true')).toBe(false);
  });
});

describe('isPreviewWithoutTipsForce — plain preview never shows tips unless &tips=1', () => {
  it('suppresses tips when in preview without &tips=1', () => {
    expect(isPreviewWithoutTipsForce(true, '?bt_preview=seller')).toBe(true);
  });

  it('does not suppress when &tips=1 is present', () => {
    expect(isPreviewWithoutTipsForce(true, '?bt_preview=seller&tips=1')).toBe(false);
  });

  it('is always false outside of preview, regardless of tips=1', () => {
    expect(isPreviewWithoutTipsForce(false, '')).toBe(false);
    expect(isPreviewWithoutTipsForce(false, '?tips=1')).toBe(false);
  });
});
