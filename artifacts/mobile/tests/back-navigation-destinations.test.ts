import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  clearAnimationOverride,
  consumeAnimationOverride,
  setNextPushAnimationNone,
} from '../lib/navigationAnimationOverride';

const read = (rel: string) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

/**
 * "Back = black screen / jumps to a random page" (owner report). Each block
 * pins one root cause found by reproducing in the web harness at 390x844.
 */
describe('Studio menu → tile → back shows a real card, not an empty black menu', () => {
  const studio = read('components/SellerStudioRadialMenu.tsx');
  const openEffect = studio.slice(
    studio.indexOf('// Fresh opens start at the first card'),
    studio.indexOf('lastStepAtRef.current = 0;', studio.indexOf('// Fresh opens start at the first card')),
  );

  it('only resets the rendered card window on a fresh open', () => {
    // Back from Analytics/Payouts resumes the card on the UI thread; forcing
    // the JS window back to card 0 left the resumed card unmounted.
    const freshBranch = openEffect.slice(openEffect.indexOf('if (!resumeCardOnOpenRef.current) {'), openEffect.indexOf('resumeCardOnOpenRef.current = false;'));
    expect(freshBranch).toContain('setCardIndexJS(0);');
    expect(openEffect.split('setCardIndexJS(0);')).toHaveLength(2);
  });
});

describe('one-shot "no transition" override', () => {
  it('is dropped once a navigation commits without consuming it', () => {
    setNextPushAnimationNone();
    clearAnimationOverride();
    expect(consumeAnimationOverride('ios_from_right')).toBe('ios_from_right');
  });

  it('still applies to the push it was set for', () => {
    setNextPushAnimationNone();
    expect(consumeAnimationOverride('ios_from_right')).toBe('none');
    expect(consumeAnimationOverride('ios_from_right')).toBe('ios_from_right');
  });

  it('is cleared by the root layout on every committed navigation', () => {
    const layout = read('app/_layout.tsx');
    expect(layout).toContain('useEffect(() => clearAnimationOverride(), [navigationKey]);');
  });
});

describe('tab groups retrace history on back', () => {
  // Default 'firstRoute' sent back from a tab-level screen (Analytics,
  // Edit profile, Friends, Bag over a product/video) to Home/Dashboard.
  it.each(['app/(tabs)/_layout.tsx', 'app/(buyer)/_layout.tsx'])('%s uses backBehavior="history"', (file) => {
    expect(read(file)).toContain('backBehavior="history"');
  });
});

describe('buyer profile menu', () => {
  it('Orders opens the real orders tab, not a missing route', () => {
    const profile = read('app/(buyer)/profile.tsx');
    expect(profile).not.toContain("'/buyer-orders'");
    expect(profile).toContain("router.navigate('/(buyer)/orders' as never)");
    expect(fs.existsSync(path.join(__dirname, '..', 'app/(buyer)/orders.tsx'))).toBe(true);
  });
});
