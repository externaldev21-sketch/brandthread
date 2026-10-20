import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(path.resolve(__dirname, '../app/onboarding.tsx'), 'utf8');

describe('notification permission remains explicit and optional in the launch flow', () => {
  it('only requests native permission from the existing opt-in button, never automatically on entry', () => {
    expect(source).not.toContain('requestOnboardingPushPermission');
    const start = source.indexOf('async function turnOnNotifications()');
    const end = source.indexOf('function continueFromRole()', start);
    const optIn = source.slice(start, end);
    expect(optIn).toContain('Notifications.requestPermissionsAsync()');
    expect(source.slice(0, start) + source.slice(end)).not.toContain('requestPermissionsAsync');
    expect(source).toContain('onTurnOn={() => { void turnOnNotifications(); }}');
    expect(optIn.indexOf("advance('NOTIFICATIONS')")).toBeLessThan(optIn.indexOf('await Notifications.getPermissionsAsync()'));
  });

  it('finishes the account without awaiting notification permission', () => {
    expect(source).toContain('api.auth.completeOnboarding');
    expect(source).not.toContain('enableNotificationsAndContinue');
  });

  it('keeps the buyer explainer and seller dashboard destinations, with a skippable opt-in', () => {
    expect(source).toContain("router.replace('/thread-explainer'");
    expect(source).toContain("router.replace('/(tabs)/'");
    expect(source).toContain("onSkip={() => advance('NOTIFICATIONS')}");
  });
});
