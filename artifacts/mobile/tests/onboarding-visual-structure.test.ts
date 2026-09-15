import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('onboarding visual structure', () => {
  it('uses compact progress dots with the original progress colors', () => {
    const onboarding = read('app/onboarding.tsx');
    expect(onboarding).toContain('function StepDots');
    expect(onboarding).not.toContain('function GradientBar');
    expect(onboarding).toContain("backgroundColor: 'rgba(255,255,255,0.08)'");
    expect(onboarding).toContain('colors={theme.heroGradient}');
  });

  it('uses hairline default borders for onboarding inputs and choices', () => {
    const onboarding = read('app/onboarding.tsx');
    expect(onboarding.match(/borderWidth: StyleSheet\.hairlineWidth/g)?.length).toBeGreaterThanOrEqual(5);
  });

  it('uses reduced-chrome cards in account type and seller plans', () => {
    expect(read('app/account-type.tsx')).toContain('borderWidth: StyleSheet.hairlineWidth');
    expect(read('components/onboarding/SellerPlanRecommendationStep.tsx')).toContain(
      'borderWidth: StyleSheet.hairlineWidth',
    );
  });

  it('buyer step 0 is account-type (role choice before Clerk account creation)', () => {
    const onboarding = read('app/onboarding.tsx');
    // ACCOUNT_TYPE is now step 0 in v6 order
    expect(onboarding).toContain('ACCOUNT_TYPE: 0');
    // AUTH is step 1 in the new buyer ordering
    expect(onboarding).toContain('AUTH: 1,');
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

  it('buyer style interests use emoji and solid-fill selected state with checkmark', () => {
    const onboarding = read('app/onboarding.tsx');
    // Emoji data present
    expect(onboarding).toContain('STYLE_INTERESTS_WITH_EMOJI');
    // StyleChip with emoji prop
    expect(onboarding).toContain('function StyleChip');
    // Feather check icon rendered when selected
    expect(onboarding).toContain('name="check"');
    // Solid fill selected state (backgroundColor on selected chip)
    expect(onboarding).toContain('backgroundColor: theme.accentDim');
  });

  it('uses one shared account form for buyer and seller with the seller field structure', () => {
    const onboarding = read('app/onboarding.tsx');
    expect(onboarding).toContain('function SharedAuthStep');
    expect(onboarding.match(/<SharedAuthStep/g)?.length).toBe(2);
    expect(onboarding).not.toContain('<BuyerAuthStep');
    expect(onboarding).not.toContain('<SellerAuthStep');
    expect(onboarding).toContain('First name');
    expect(onboarding).toContain('Last name');
    expect(onboarding).toContain('Confirm password');
    expect(onboarding).toContain('formFirstName');
    expect(onboarding).toContain('formLastName');
    expect(onboarding).toContain('confirmPassword');
    expect(onboarding).toContain('passwordsMatch');
    expect(onboarding).toContain('Continue with Google');
    expect(onboarding).toContain('Continue with Apple');
    expect(onboarding).toContain('<Text style={ssa.divText}>or</Text>');
    expect(onboarding).toContain('disabled={!!oauthLoading || loading}');
    expect(onboarding).not.toContain('disabled={!!oauthLoading || loading || !isUsernameValid}');
    expect(onboarding).toContain("oauthBtn:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, borderRadius: 14");
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

  it('draft version incremented to 6 and v5 migration exists', () => {
    const onboarding = read('app/onboarding.tsx');
    expect(onboarding).toContain('DRAFT_VERSION = 6');
    expect(onboarding).toContain('version === 5');
    expect(onboarding).toContain("PENDING_FLOW_KEY = 'onboarding_pending_flow'");
    expect(onboarding).toContain('[PENDING_FLOW_KEY, selectedFlow]');
  });

  it('uses one immediate native-driver transition for every onboarding step', () => {
    const onboarding = read('app/onboarding.tsx');
    expect(onboarding).toContain('function transitionTo(next: number, dir: 1 | -1, initiatedAt = performance.now())');
    expect(onboarding).toContain('transitionProgress.setValue(0);\n    setStep(next);\n    requestAnimationFrame');
    expect(onboarding).toContain('duration: 230');
    expect(onboarding).toContain('useNativeDriver: true');
    expect(onboarding).not.toContain('duration: 220');
    expect(onboarding).not.toContain('isAuthStep ? sm.interactiveStepWrap');
    expect(onboarding).toContain('onDone={() => transitionTo(BUYER_STEP_INDEX.NOTIFICATIONS, 1)}');
    expect(onboarding).toContain('onDone={() => transitionTo(SELLER_STEP_INDEX.NOTIFICATIONS, 1)}');
  });

  it('keeps account-type storage and draft persistence off the transition path', () => {
    const onboarding = read('app/onboarding.tsx');
    expect(onboarding).toContain('void AsyncStorage.multiSet([');
    expect(onboarding).toContain('const timer = setTimeout(() => {\n      saveDraft().catch(() => {});\n    }, 350);');
  });

  it('delays name-field focus until the incoming screen transition completes', () => {
    const onboarding = read('app/onboarding.tsx');
    expect(onboarding).toContain('firstNameInputRef.current?.focus()');
    expect(onboarding).toContain('brandNameInputRef.current?.focus()');
    expect(onboarding).toContain('}, 260);');
  });
  it('does not navigate backward from the root account-type step', () => {
    const onboarding = read('app/onboarding.tsx');
    expect(onboarding).toContain('if (step === 0) return;');
    expect(onboarding).toContain('{!isAccountTypeStep && (');
    expect(onboarding).not.toContain("if (step === 0) { router.back(); return; }");
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
