import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DRAFT_VERSION, prevProfileStep } from '../lib/onboardingFlow';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('onboarding visual structure (launch rebuild)', () => {
  it('uses a thin rounded Depop progress bar, never dots or a thread', () => {
    const kit = read('components/onboarding/launch/kit.tsx');
    expect(kit).toContain('track: { width: \'100%\', maxWidth: 240, height: 6, borderRadius: 3');
    const onboarding = read('app/onboarding.tsx');
    expect(onboarding).not.toContain('StepDots');
    expect(onboarding).not.toContain('ThreadProgress');
  });

  it('builds every step from the shared kit (outlined fields, full-width pills)', () => {
    const kit = read('components/onboarding/launch/kit.tsx');
    expect(kit).toContain('pill: { height: 52, borderRadius: 26');
    expect(kit).toContain('field: {');
    for (const file of ['AuthScreens', 'ProfileScreens']) {
      expect(read(`components/onboarding/launch/${file}.tsx`)).toContain("from './kit'");
    }
  });

  it('splash is the logo alone, auto-advancing, with no CTA and no decoration', () => {
    const splash = read('app/splash.tsx');
    expect(splash).not.toContain('Get started');
    expect(splash).toContain('setTimeout(continueForward');
    expect(splash).not.toContain('ctaWrap');
    expect(splash).not.toContain('ThreadDraw');
  });

  it('thread explainer screen exists and routes buyers to the feed', () => {
    const explainer = read('app/thread-explainer.tsx');
    const layout = read('app/_layout.tsx');
    expect(explainer).toContain('thread_explainer_seen:');
    expect(explainer).toContain("router.replace('/(buyer)/'");
    expect(layout).toContain('threadExplainerSeen === false');
  });

  it('drafts are keyed per Clerk user and store the current step-id format', () => {
    const onboarding = read('app/onboarding.tsx');
    expect(DRAFT_VERSION).toBe(10);
    expect(onboarding).toContain("const DRAFT_KEY_PREFIX = 'onboarding_draft:';");
    expect(onboarding).toContain('version: DRAFT_VERSION, ownerId: user!.id, step,');
  });

  it('has no back button on the first signed-in step (no going back into sign-up)', () => {
    const flow = read('lib/onboardingFlow.ts');
    expect(flow).toContain('return i > 0 ? steps[i - 1].id : null;');
  });

  it('the buyer-or-seller step has a visible back control (it used to have none)', () => {
    // Shop/Sell is the ROLE step; its header back walks to the step before it,
    // and for sellers the store steps walk back to it.
    expect(prevProfileStep('ROLE', null)).toBe('NOTIFICATIONS');
    expect(prevProfileStep('ROLE', 'seller')).toBe('NOTIFICATIONS');
    const onboarding = read('app/onboarding.tsx');
    expect(onboarding).toContain("case 'STORE': return 'ROLE';");
    expect(onboarding).toMatch(/<RoleScreen [^\n]*onBack=\{onBack\}/);
    expect(read('components/onboarding/launch/ProfileScreens.tsx')).toContain('testID="onboarding-role"\n      header={<OnbHeader progress={progress} onBack={onBack} />}');
  });

  it('pre-account answers survive a reload in the device-scoped pending draft', () => {
    const onboarding = read('app/onboarding.tsx');
    expect(onboarding).toContain('AsyncStorage.setItem(PENDING_DRAFT_KEY');
    expect(onboarding).toContain('parsePendingSignUp(await AsyncStorage.getItem(PENDING_DRAFT_KEY))');
    // Cleared on sign-out so it never reaches the next person on the device.
    expect(read('app/_layout.tsx')).toContain("'onboarding_pending_draft'");
  });

  it('buyers see one welcome headline: the explainer\'s, never a second one in onboarding', () => {
    expect(read('app/thread-explainer.tsx')).toContain("Welcome to{'\\n'}the Thread.");
    for (const file of ['app/onboarding.tsx', 'components/onboarding/launch/ProfileScreens.tsx', 'components/onboarding/launch/AuthScreens.tsx']) {
      expect(read(file)).not.toMatch(/>\s*Welcome to/);
    }
  });
});
