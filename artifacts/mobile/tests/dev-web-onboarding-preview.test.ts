import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(path.resolve(__dirname, file), 'utf8');

describe('dev web onboarding walkthrough', () => {
  it('shows auth before onboarding and offers a preview-only continuation', () => {
    const splash = read('../app/splash.tsx');
    const signIn = read('../app/sign-in.tsx');

    expect(splash).toContain("const next = __DEV__ && Platform.OS === 'web' ? '/sign-in' : '/onboarding';");
    expect(signIn).toContain("const showPreviewUser = __DEV__ && Platform.OS === 'web' && !isAddAccount;");
    expect(signIn).toContain('testID="continue-as-preview-user"');
    expect(signIn).toContain("router.replace('/onboarding?previewUser=1' as never)");
  });

  it('walks preview users past account creation into the post-auth onboarding steps', () => {
    const onboarding = read('../app/onboarding.tsx');
    const signUp = read('../components/onboarding/SignUpStep.tsx');

    expect(onboarding).toContain("const isDevWebPreviewUser = __DEV__ && Platform.OS === 'web' && previewUser === '1';");
    expect(onboarding).toContain('skipAuth={isDevWebPreviewUser}');
    expect(signUp).toContain('if ((isSignedIn && !allowSignedInAccountCreation) || skipAuth) {');
    expect(onboarding).toContain('onContinueSignedIn={() => transitionTo(BUYER_STEP_INDEX.PROFILE, 1)}');
    expect(onboarding).toContain("window.location.assign('/?bt_preview=buyer')");
    expect(onboarding).toContain("window.location.assign('/?bt_preview=seller')");
  });

  it('keeps every onboarding screen scrollable without the light browser scrollbar', () => {
    const kit = read('../components/onboarding/kit.tsx');
    expect(kit).toMatch(/contentContainerStyle: \[s\.content, contentStyle\][\s\S]*?showsVerticalScrollIndicator: false/);
  });
});