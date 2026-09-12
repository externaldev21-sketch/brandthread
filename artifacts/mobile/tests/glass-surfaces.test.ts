import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import colors from '@/constants/colors';
import { CARD_GLASS, CARD_ELEVATED_GLASS, SURFACE_GLASS, SKELETON_GLASS } from '@/lib/theme';

const appPath = (relativePath: string) => resolve(process.cwd(), 'app', relativePath);
const compPath = (relativePath: string) => resolve(process.cwd(), 'components', relativePath);

describe('glass surfaces and translucency', () => {
  it('defines translucent glass tokens in theme.ts', () => {
    expect(CARD_GLASS).toContain('rgba');
    expect(CARD_ELEVATED_GLASS).toContain('rgba');
    expect(SURFACE_GLASS).toContain('rgba');
    expect(SKELETON_GLASS).toContain('rgba');
  });

  it('mirrors translucent treatments in colors.ts', () => {
    expect(colors.dark.card).toContain('rgba');
    expect(colors.dark.input).toContain('rgba');
    expect(colors.dark.secondary).toContain('rgba');
    expect(colors.dark.muted).toContain('rgba');
  });

  it('uses glass tokens for LoadingSkeletons', () => {
    const brandthreadUI = readFileSync(compPath('BrandthreadUI.tsx'), 'utf8');
    expect(brandthreadUI).toContain('backgroundColor: SKELETON_GLASS');
    expect(brandthreadUI).not.toMatch(/backgroundColor: CARD,[ \n]*borderRadius: RADIUS.md,[ \n]*opacity: anim/);
  });

  it('uses glass tokens for tab bars', () => {
    const sellerLayout = readFileSync(appPath('(tabs)/_layout.tsx'), 'utf8');
    const buyerLayout = readFileSync(appPath('(buyer)/_layout.tsx'), 'utf8');
    
    expect(sellerLayout).toContain('backgroundColor: SURFACE_GLASS');
    expect(buyerLayout).toContain('pillBg       = \'rgba(12, 12, 23, 0.65)\'');
  });

  it('uses transparent overlays for product loading', () => {
    const products = readFileSync(appPath('(tabs)/products.tsx'), 'utf8');
    expect(products).toContain('backgroundColor: SCREEN_BG');
    expect(products).not.toContain('position: \'absolute\', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: BG');
  });
});
