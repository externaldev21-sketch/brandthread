import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DRAFT_VERSION } from '../lib/onboardingFlow';

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

  it('drafts are keyed per Clerk user and store the step id (v9)', () => {
    const onboarding = read('app/onboarding.tsx');
    expect(DRAFT_VERSION).toBe(9);
    expect(onboarding).toContain("const DRAFT_KEY_PREFIX = 'onboarding_draft:';");
    expect(onboarding).toContain('version: DRAFT_VERSION, ownerId: user!.id, step,');
  });

  it('has no back button on the first signed-in step (no going back into sign-up)', () => {
    const flow = read('lib/onboardingFlow.ts');
    expect(flow).toContain('return i > 0 ? steps[i - 1].id : null;');
  });
});
