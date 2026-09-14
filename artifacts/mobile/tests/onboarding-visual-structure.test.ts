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
});