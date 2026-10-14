import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUYER_STEP_INDEX, DRAFT_VERSION } from '../lib/onboardingFlow';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('onboarding visual structure', () => {
  it('shows progress as a thin straight segmented bar, not the drawn thread', () => {
    const onboarding = read('app/onboarding.tsx');
    const bar = read('components/onboarding/SegmentedProgress.tsx');
    expect(onboarding).toContain('function StepDots');
    expect(onboarding).toContain('<SegmentedProgress');
    expect(onboarding).not.toMatch(/ThreadProgress|ThreadWeave|ThreadDraw|ThreadLogoStitch/);
    expect(bar).toContain("segment: { flex: 1, height: 2, borderRadius: 1 }");
    expect(bar).toContain('theme.muted');
  });

  it('has no icon-in-a-circle decorations, no feature checklists and no fake loader', () => {
    const onboarding = read('app/onboarding.tsx');
    expect(onboarding).not.toContain('bellBg');
    expect(onboarding).not.toContain('<Feather name="bell"');
    expect(onboarding).not.toContain('function LoadingAnimation');
    expect(onboarding).not.toMatch(/Curating your Thread|Mapping your brand workspace/);
    expect(onboarding).not.toMatch(/Thread — your personal brand feed|Analytics dashboard activated/);
    const accountType = read('app/account-type.tsx');
    expect(accountType).not.toContain('iconWrap');
    expect(accountType).not.toContain('bullets');
    expect(read('app/thread-explainer.tsx')).not.toContain('<View style={[styles.featureIconWrap');
  });

  it('never says "AI" in onboarding copy', () => {
    for (const file of ['app/onboarding.tsx', 'app/account-type.tsx', 'components/onboarding/BrandsToFollowStep.tsx']) {
      const copy = read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(copy).not.toMatch(/['">][^'"<>\n]*\bAI\b[^'"<>\n]*['"<]/);
    }
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

  it('buyer step 1 is account-type, after the Welcome opener, before Clerk account creation', () => {
    // Step ordering now lives in lib/onboardingFlow.ts (v7): 0=Welcome, 1=AccountType, 2=Auth.
    expect(BUYER_STEP_INDEX.WELCOME).toBe(0);
    expect(BUYER_STEP_INDEX.ACCOUNT_TYPE).toBe(1);
    expect(BUYER_STEP_INDEX.AUTH).toBe(2);
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

  it('buyer style interests are plain text chips with a solid-fill selected state', () => {
    const onboarding = read('app/onboarding.tsx');
    expect(onboarding).not.toContain('STYLE_INTERESTS_WITH_EMOJI');
    expect(onboarding).toContain('function StyleChip');
    expect(onboarding).not.toMatch(/\p{Extended_Pictographic}/u);
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
    // OAuth options are pill-shaped secondary buttons (onboarding restyle).
    expect(onboarding).toContain("oauthBtn:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, borderRadius: radius.md");
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

  it('draft version incremented to 7, migration lives in lib/onboardingFlow.ts', () => {
    const onboarding = read('app/onboarding.tsx');
    const flowModule = read('lib/onboardingFlow.ts');
    expect(DRAFT_VERSION).toBe(8);
    expect(flowModule).toContain('export const DRAFT_VERSION = 8');
    expect(flowModule).toContain('version === 5');
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
    // The old loader step is stepped over straight to Notifications.
    expect(onboarding).toContain('if (flow === \'buyer\' && next === BUYER_STEP_INDEX.LOADING) return BUYER_STEP_INDEX.NOTIFICATIONS;');
    expect(onboarding).toContain('if (flow === \'seller\' && next === SELLER_STEP_INDEX.LOADING) return SELLER_STEP_INDEX.NOTIFICATIONS;');
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
  it('does not navigate backward from the root Welcome step', () => {
    const onboarding = read('app/onboarding.tsx');
    expect(onboarding).toContain('if (!canGoBack(step)) return;');
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
