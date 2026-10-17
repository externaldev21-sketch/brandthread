import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(path.resolve(__dirname, '../app/onboarding.tsx'), 'utf8');

describe('onboarding "Never miss what matters" step', () => {
  it('Continue requests notification permission for both flows before advancing', () => {
    expect(source).toMatch(/requestOnboardingPushPermission\(user\?\.id, api\)/);
    expect(source).toContain('void enableNotificationsAndContinue(BUYER_STEP_INDEX.SUCCESS)');
    expect(source).toContain('void enableNotificationsAndContinue(SELLER_STEP_INDEX.SUCCESS)');
  });

  it('always advances, even when the request fails or is denied', () => {
    const fn = source.slice(source.indexOf('async function enableNotificationsAndContinue'));
    const body = fn.slice(0, fn.indexOf('\n  }\n') + 4);
    expect(body).toMatch(/finally \{[\s\S]*transitionTo\(next, 1\)/);
  });

  it('"Not now" still skips without prompting', () => {
    expect(source).toContain('onSkip={() => transitionTo(BUYER_STEP_INDEX.SUCCESS, 1)}');
    expect(source).toContain('onSkip={() => transitionTo(SELLER_STEP_INDEX.SUCCESS, 1)}');
  });
});
