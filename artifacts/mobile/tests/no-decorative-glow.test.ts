import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GRAD_CARD_GLOW } from '@/lib/theme';

const read = (rel: string) => readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

/** Less-AI pass items 59 + 69: the seller tab-bar swipe glow is the only glow. */
describe('no decorative glow', () => {
  it('glow washes resolve to transparent', () => {
    expect(GRAD_CARD_GLOW).toEqual(['transparent', 'transparent']);
    expect(read('contexts/AppThemeContext.tsx')).toContain("glowGradient: ['transparent', 'transparent']");
  });

  it('cards no longer cast an accent-coloured shadow', () => {
    expect(read('components/BrandthreadUI.tsx')).not.toMatch(/shadowColor: theme\.accent/);
  });

  it('no white or accent glow shadows on shared surfaces', () => {
    for (const rel of ['components/paywall/SellerPlanSelector.tsx', 'app/subscription.tsx', 'app/forgot-password.tsx', 'components/SupportChatBubble.tsx', 'components/web/WebAppShell.tsx']) {
      const src = read(rel);
      expect(src, rel).not.toMatch(/shadowColor: '#(fff|FFFFFF)'|shadowColor: (PURPLE|theme\.success|theme\.secondary)/);
    }
  });

  it('the seller tab-bar swipe glow is untouched', () => {
    expect(read('components/tab-bar/TabBarParts.tsx')).toContain('TabBarIndicator');
  });
});
