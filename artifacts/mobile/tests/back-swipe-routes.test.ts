/**
 * Every pushed screen keeps the interactive edge back-swipe (native stack
 * `gestureEnabled`). Only flows where a swipe back would lose work or skip a
 * required step may turn it off — this allowlist is the whole set.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const layout = readFileSync(path.resolve(import.meta.dirname, '../app/_layout.tsx'), 'utf8');

const ALLOWED_NO_GESTURE = new Set([
  'onboarding', // linear sign-up steps
  'access-code', // gate before the app
  'thread-explainer', // first-run explainer
  'thread-checkout', // full-screen checkout cover over the Shop sheet
  'seller-live', // a live broadcast must be ended explicitly
]);

describe('interactive back-swipe on pushed screens', () => {
  it('the stack enables the gesture by default', () => {
    const defaults = layout.slice(layout.indexOf('screenOptions={{'), layout.indexOf('screenOptions={{') + 600);
    expect(defaults).toContain('gestureEnabled: true');
  });

  it('only allowlisted screens disable it', () => {
    const disabled = [...layout.matchAll(/<Stack\.Screen name="([^"]+)"[^>]*gestureEnabled: false/g)].map((m) => m[1]);
    expect(disabled.filter((name) => !ALLOWED_NO_GESTURE.has(name))).toEqual([]);
  });

  it('pushed product and legal pages slide in (and back) instead of fading', () => {
    for (const name of ['thread-product-detail', 'privacy', 'terms', 'community-guidelines', 'seller-agreement', 'refund-policy']) {
      const line = layout.split('\n').find((l) => l.includes(`<Stack.Screen name="${name}"`));
      expect(line, name).toContain("animation: 'ios_from_right'");
    }
  });
});
