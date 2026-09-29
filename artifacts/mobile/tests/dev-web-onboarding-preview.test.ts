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

  it('walks preview users through account type and post-auth onboarding steps', () => {
    const onboarding = read('../app/onboarding.tsx');

    expect(onboarding).toContain("const isDevWebPreviewUser = __DEV__ && Platform.OS === 'web' && previewUser === '1';");
    expect(onboarding).toContain("selectedFlow === 'buyer' ? BUYER_STEP_INDEX.NAME : SELLER_STEP_INDEX.NAME");
    expect(onboarding).toContain("window.location.assign('/?bt_preview=buyer')");
    expect(onboarding).toContain("window.location.assign('/?bt_preview=seller')");
  });

  it('keeps the account form scrollable without the light browser scrollbar', () => {
    const onboarding = read('../app/onboarding.tsx');
    expect(onboarding).toMatch(/contentContainerStyle=\{ssa\.scroll\}[\s\S]*?showsVerticalScrollIndicator=\{false\}/);
  });
});