import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DRAFT_VERSION } from '../lib/onboardingFlow';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('onboarding visual structure', () => {
  it('every step shares one layout: bare back chevron, left-aligned title1, one input, button under it', () => {
    const onboarding = read('app/onboarding.tsx');
    const screen = read('components/onboarding/steps/StepScreen.tsx');
    expect(onboarding).toContain('<Icon name="chevron-left" size={24}');
    expect(onboarding).not.toContain('ThreadWeave');
    expect(onboarding).not.toContain('StepDots');
    expect(screen).toContain('title: { ...TEXT.title1 }');
    expect(screen).toContain("import { Button } from '@/components/ui';");
  });

  it('inputs and choice rows sit on the one solid #1C1C1E fill (no translucent overlays, no gradient footers)', () => {
    const onboarding = read('app/onboarding.tsx');
    const seller = read('components/onboarding/steps/SellerSteps.tsx');
    const accountType = read('app/account-type.tsx');
    expect(onboarding).toContain("import { Icon, Input } from '@/components/ui';");
    expect(seller).toContain('backgroundColor: FILL_ELEVATED');
    expect(onboarding).not.toContain('LinearGradient');
    expect(accountType).not.toContain('LinearGradient');
  });

  it('seller questions follow Shopify: cards with checkbox/radio, a thin progress bar, Next plus equal Skip all / Skip', () => {
    const seller = read('components/onboarding/steps/SellerSteps.tsx');
    expect(seller).toContain('label="Skip all"');
    expect(seller).toContain('label="Skip"');
    expect(seller).toContain("skipBtn: { flex: 1 }");
    expect(seller).toContain("accessibilityRole={multi ? 'checkbox' : 'radio'}");
    expect(seller).toContain('accessibilityRole="progressbar"');
  });

  it('splash is a logo-only auto-advancing screen with no CTA button', () => {
    const splash = read('app/splash.tsx');
    // No "Get started" button text
    expect(splash).not.toContain('Get started');
    // Has auto-advance timer
    expect(splash).toContain('setTimeout(continueForward');
    // No ctaWrap or cta style (no explicit CTA)
    expect(splash).not.toContain('ctaWrap');
  });

  it('thread explainer screen exists and routes buyers to the feed', () => {
    const explainer = read('app/thread-explainer.tsx');
    const layout = read('app/_layout.tsx');
    expect(explainer).toContain('thread_explainer_seen:');
    expect(explainer).toContain("ownerId !== userId || role !== 'buyer'");
    expect(explainer).toContain("router.replace('/(buyer)/'");
    expect(explainer).toContain('Enter the Thread');
    expect(layout).toContain("threadExplainerSeen === false");
    expect(layout).toContain("router.replace('/thread-explainer'");
  });

  it('draft version is 9 and step ids (not indexes) are stored', () => {
    const flowModule = read('lib/onboardingFlow.ts');
    expect(DRAFT_VERSION).toBe(9);
    expect(flowModule).toContain('export const DRAFT_VERSION = 9');
    expect(flowModule).toContain('version === 5');
    expect(read('lib/onboardingDraft.ts')).toContain("export const PENDING_DRAFT_KEY = 'onboarding_pending_draft'");
  });

  it('uses one 230ms transition for every step', () => {
    const onboarding = read('app/onboarding.tsx');
    expect(onboarding).toContain('transitionProgress.setValue(0);\n    setStepError(null);\n    setStepId(next);\n    requestAnimationFrame');
    expect(onboarding).toContain('duration: 230');
    expect(onboarding).not.toContain('duration: 220');
  });

  it('does not navigate backward from the Welcome opener, nor back into account steps', () => {
    const onboarding = read('app/onboarding.tsx');
    expect(onboarding).toContain("const fullBleed = stepId === 'WELCOME';");
    expect(read('lib/onboardingFlow.ts')).toContain('if (ctx.accountReady && current === firstStepAfterAccount(flow, ctx)) return null;');
  });

  it('keeps the native beta transition probe development-only and release-required', () => {
    const onboarding = read('app/onboarding.tsx');
    const packageJson = read('package.json');
    const deviceCheck = read('tests/onboarding-transitions.device.mjs');
    const betaGuide = read('docs/mobile-beta-validation.md');

    expect(onboarding).toContain("__DEV__ && (deviceFlow === 'buyer' || deviceFlow === 'seller')");
    expect(deviceCheck).toContain("NATIVE_ONBOARDING_REQUIRED === '1'");
    expect(deviceCheck).toContain('appium/start_recording_screen');
    expect(packageJson).toContain('"test:onboarding:native:ci"');
    expect(betaGuide).toContain('pnpm run test:onboarding:native:ci');
  });
});
