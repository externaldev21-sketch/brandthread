import { describe, expect, it } from 'vitest';

import colors from '@/constants/colors';
import { BG } from '@/lib/theme';

describe('app background theme', () => {
  it('keeps buyer and seller screens on the onboarding background', () => {
    expect(BG).toBe('#07070F');
    expect(colors.dark.background).toBe(BG);
  });
});