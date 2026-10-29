/**
 * Payouts is a setup journey first (Dev: "it looks like this is already set
 * up when I click on it"). Source guards for app/payouts.tsx and its journey
 * view: no dead-end "unavailable" copy, the manage page only behind Stripe's
 * real state, and the Stripe return lands back on /payouts.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const screen = read('app/payouts.tsx');
const journey = read('components/payouts/PayoutSetupJourney.tsx');
const model = read('lib/payoutJourney.ts');

describe('Payouts setup journey', () => {
  it('has no "unavailable" dead-end copy on any state', () => {
    for (const src of [screen, journey, model]) {
      expect(src).not.toMatch(/['"`][^'"`]*\bunavailable\b[^'"`]*['"`]/i);
    }
  });

  it('only renders the manage page (balance hero) after the journey says so', () => {
    const gate = screen.indexOf('!showsManagePage(journey)');
    const hero = screen.indexOf('{/* Balance hero */}');
    expect(gate).toBeGreaterThan(-1);
    expect(hero).toBeGreaterThan(gate);
    // Loading shows a skeleton, not a manage page with placeholders.
    expect(screen).toContain("journeyLoad.kind === 'loading'");
  });

  it('launches the real hosted Stripe onboarding and handles the return', () => {
    expect(screen).toContain('api.seller.connect.onboard(');
    expect(screen).toContain("openAuthSessionAsync(data.url, PAYOUTS_RETURN_DEEP_LINK)");
    expect(screen).toContain("const PAYOUTS_RETURN_DEEP_LINK = 'brandthread://payouts'");
    expect(screen).toContain("returnUrl: `${here}?returned=1`");
    expect(screen).toContain("params.refresh !== '1'");
  });

  it('Pop-up mode sends its setup gate to this screen', () => {
    expect(read('app/popup-mode.tsx')).toContain("label=\"Set up payouts\" onPress={() => router.push('/payouts' as never)}");
  });
});
