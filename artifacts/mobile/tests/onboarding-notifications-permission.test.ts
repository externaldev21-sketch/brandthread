import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(path.resolve(__dirname, '../app/onboarding.tsx'), 'utf8');

describe('contextual notification permission stays outside onboarding', () => {
  it('neither signup flow requests native permission', () => {
    expect(source).not.toContain('requestOnboardingPushPermission');
    expect(source).not.toContain('requestPermissionsAsync');
  });

  it('finishes the account without awaiting notification permission', () => {
    expect(source).toContain('api.auth.completeOnboarding');
    expect(source).not.toContain('enableNotificationsAndContinue');
  });

  it('keeps the normal buyer and seller destinations without a push step', () => {
    expect(source).toContain("router.replace('/(buyer)/'");
    expect(source).toContain("router.replace('/(tabs)/'");
    expect(source).not.toContain('<NotificationsStep');
  });
});
