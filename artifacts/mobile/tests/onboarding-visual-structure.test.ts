/**
 * Locks in the onboarding look (SSENSE type and spacing, Grailed's fields and
 * buttons) and keeps the "looks AI-made" list out of every onboarding screen:
 * illustrations, icon-in-a-circle headers, gradients and glow, emoji,
 * welcome-confetti copy, progress dots + "Step X of Y" + back + skip at once,
 * and more than one filled button per screen.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

const ONBOARDING_SCREENS = [
  'app/onboarding.tsx',
  'app/splash.tsx',
  'components/onboarding/kit.tsx',
  'components/onboarding/SignUpStep.tsx',
  'components/onboarding/ProfileStep.tsx',
  'components/onboarding/NotificationsStep.tsx',
];

describe('onboarding visual rules', () => {
  it.each(ONBOARDING_SCREENS)('%s has no gradients, glow, thread art or reveal choreography', (file) => {
    const src = read(file);
    expect(src).not.toMatch(/LinearGradient|heroGradient|primaryGradient|<Glow|ThreadDraw|ThreadWeave|ThreadProgress|ThreadLogoStitch|<Reveal|StitchAccent/);
    expect(src).not.toMatch(/shadowRadius|shadowOpacity|elevation:/);
  });

  it.each(ONBOARDING_SCREENS)('%s has no emoji and no exclamation marks in copy', (file) => {
    const src = read(file);
    expect(src).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(src).not.toMatch(/'[^'\n]*[A-Za-z]![^'\n]*'/);
  });

  it('never says "Welcome to Brandthread" and has no fake setup loader', () => {
    const src = read('app/onboarding.tsx');
    expect(src).not.toMatch(/Welcome to/i);
    expect(src).not.toContain('LoadingAnimation');
    expect(src).not.toContain('Curating your Thread');
  });

  it('the counter is "01 / 04" text, not dots, and there is no "Step X of Y" copy', () => {
    const kit = read('components/onboarding/kit.tsx');
    expect(kit).toContain("const pad = (n: number) => String(n).padStart(2, '0');");
    expect(kit).toContain('{pad(current)} / {pad(total)}');
    for (const file of ONBOARDING_SCREENS) expect(read(file)).not.toMatch(/>\s*Step \{/);
  });

  it('uses the system font: no Inter family anywhere in the new screens', () => {
    for (const file of ONBOARDING_SCREENS) expect(read(file)).not.toContain('Inter_');
  });

  it('buttons are square and full width; the filled one is the only primary', () => {
    const kit = read('components/onboarding/kit.tsx');
    expect(kit).toMatch(/button: \{ height: 52,[^}]*borderRadius: 0/);
    expect(kit).toContain("variant?: 'primary' | 'outline'");
    // Sign up: the first visible way in is filled, the rest are outlines.
    expect(read('components/onboarding/SignUpStep.tsx')).toContain("variant={i === 0 ? 'primary' : 'outline'}");
  });

  it('the buyer/seller choice is two plain radio rows on the Sign up screen', () => {
    const signUp = read('components/onboarding/SignUpStep.tsx');
    expect(signUp).toContain('<ChoiceRow label="Shop"');
    expect(signUp).toContain('<ChoiceRow label="Sell"');
    expect(read('app/account-type.tsx')).not.toContain('bullets');
  });

  it('splash is the wordmark alone and auto-advances with no button', () => {
    const splash = read('app/splash.tsx');
    expect(splash).toContain('BRANDTHREAD');
    expect(splash).not.toContain('BrandthreadLogo');
    expect(splash).toContain('setTimeout(continueForward');
    expect(splash).not.toMatch(/Get started|Pressable|Button/);
  });

  it('the cold-start intro is a plain fade, not a choreographed sequence', () => {
    const intro = read('components/splash/AppIntroSplash.tsx').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(intro).not.toMatch(/withSpring|withRepeat|sweep|streak|WordmarkLetter|hapticLight/);
    expect(intro).toContain('withTiming(0, { duration: 200');
  });

  it('notifications screen is SSENSE 1:1: one CONTINUE that raises the system prompt', () => {
    const src = read('components/onboarding/NotificationsStep.tsx');
    expect(src).toContain("Enable notifications{'\\n'}thank us later");
    expect(src).toContain('Notifications.requestPermissionsAsync()');
    expect((src.match(/<SquareButton/g) ?? []).length).toBe(1);
    expect(src).not.toContain('Not now');
  });

  it('removed screens stay removed', () => {
    const dir = readdirSync(resolve(process.cwd(), 'components/onboarding'));
    expect(dir).not.toContain('WelcomeStep.tsx');
    const src = read('app/onboarding.tsx');
    expect(src).not.toMatch(/SuccessScreen|SellerPreviewStep|STYLE_INTERESTS|BRAND_STAGES|SELLER_GOALS/);
  });
});

describe('onboarding transitions', () => {
  it('uses one short native-driver transition for every step', () => {
    const onboarding = read('app/onboarding.tsx');
    expect(onboarding).toContain('function transitionTo(next: number, dir: 1 | -1, initiatedAt = performance.now())');
    expect(onboarding).toContain('transitionProgress.setValue(0);\n    setStep(next);\n    requestAnimationFrame');
    expect(onboarding).toContain('duration: 200');
    expect(onboarding).toContain('useNativeDriver: true');
  });

  it('keeps flow storage and draft persistence off the transition path', () => {
    const onboarding = read('app/onboarding.tsx');
    expect(onboarding).toContain('void AsyncStorage.multiSet([');
    expect(onboarding).toContain('const timer = setTimeout(() => {\n      saveDraft().catch(() => {});\n    }, 350);');
  });

  it('delays name-field focus until the incoming screen transition completes', () => {
    const onboarding = read('app/onboarding.tsx');
    expect(onboarding).toContain('firstNameInputRef.current?.focus()');
    expect(onboarding).toContain('}, 260);');
  });

  it('keeps the native transition probe development-only', () => {
    const onboarding = read('app/onboarding.tsx');
    expect(onboarding).toContain("__DEV__ && (deviceFlow === 'buyer' || deviceFlow === 'seller')");
    expect(onboarding).toContain('testID="onboarding-transition-metric"');
    expect(onboarding).toContain('accessibilityLabel="Complete auth device probe"');
  });
});

describe('resume and draft', () => {
  it('persists the chosen flow before auth and resumes it after the postAuth remount', () => {
    const onboarding = read('app/onboarding.tsx');
    expect(onboarding).toContain("const PENDING_FLOW_KEY = 'onboarding_pending_flow';");
    expect(onboarding).toContain('[PENDING_FLOW_KEY, chosen]');
    expect(onboarding).toContain("setStep(isSignedIn && postAuth === '1' ? BUYER_STEP_INDEX.PROFILE : 0);");
    expect(onboarding).toContain('restoreDraftStep(draft.flow, draft.step ?? 0, draft.version)');
  });
});
