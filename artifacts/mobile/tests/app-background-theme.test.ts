import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import colors from '@/constants/colors';
import { BG, SCREEN_BG } from '@/lib/theme';

const appPath = (relativePath: string) => resolve(process.cwd(), 'app', relativePath);

function routeFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const absolutePath = resolve(directory, entry);
    if (statSync(absolutePath).isDirectory()) return routeFiles(absolutePath);
    return absolutePath.endsWith('.tsx') ? [absolutePath] : [];
  });
}

describe('app background theme', () => {
  it('keeps buyer and seller screens on the onboarding background', () => {
    expect(BG).toBe('#07070F');
    expect(colors.dark.background).toBe(BG);
    expect(SCREEN_BG).toBe('transparent');
  });

  it('mounts one shared animated background behind the root stack', () => {
    const rootLayout = readFileSync(appPath('_layout.tsx'), 'utf8');

    expect(rootLayout).toContain("import AnimatedGradientBackground from '@/components/branding/AnimatedGradientBackground'");
    expect(rootLayout).toContain('<AnimatedGradientBackground />');
    expect(rootLayout).toContain("contentStyle: { backgroundColor: 'transparent' }");
    expect(rootLayout).toContain('<NavigationThemeProvider value={TRANSPARENT_NAVIGATION_THEME}>');

    for (const route of ['sign-in.tsx', 'onboarding.tsx', 'splash.tsx', 'forgot-password.tsx', 'account-type.tsx']) {
      const source = readFileSync(appPath(route), 'utf8');
      expect(source).not.toContain('AnimatedGradientBackground');
    }
  });

  it('keeps buyer and seller navigation scenes transparent', () => {
    const sellerLayout = readFileSync(appPath('(tabs)/_layout.tsx'), 'utf8');
    const buyerLayout = readFileSync(appPath('(buyer)/_layout.tsx'), 'utf8');
    const sellerHome = readFileSync(appPath('(tabs)/index.tsx'), 'utf8');
    const buyerInbox = readFileSync(appPath('(buyer)/inbox.tsx'), 'utf8');

    expect(sellerLayout).toContain("sceneStyle: { backgroundColor: 'transparent' }");
    expect(buyerLayout).toContain("sceneStyle: { backgroundColor: 'transparent' }");
    expect(sellerHome).toContain('backgroundColor: SCREEN_BG');
    expect(buyerInbox).toContain('backgroundColor: SCREEN_BG');
  });

  it('does not leave opaque colors on full-screen route roots', () => {
    const routeRootPattern = /\b(?:root|page|container|scroll|screen|loadWrap|loadingWrap|center|safeArea|layout):\s*\{[^}\n]*\bbackgroundColor:\s*(?:BG|colors\.background|['"]#07070F['"])/gm;
    const inlineRootPattern = /<(?:View|KeyboardAvoidingView)[^>]*style=\{?\[[^\]]*(?:\.root|\.container|\.page)[^\]]*,\s*\{\s*backgroundColor:\s*(?:BG|colors\.background|['"]#07070F['"])/g;
    const fullFlexPattern = /<(?:View|KeyboardAvoidingView) style=\{\{\s*flex:\s*1,\s*backgroundColor:\s*(?:BG|colors\.background|['"]#07070F['"])/g;
    // These routes intentionally keep a dark media/modal canvas opaque.
    const immersiveRoutes = new Set(['camera-capture.tsx', 'product-import.tsx']);
    const offenders = routeFiles(resolve(process.cwd(), 'app'))
      .filter((file) => !file.endsWith('_layout.tsx') && !immersiveRoutes.has(file.split('/').pop() ?? ''))
      .flatMap((file) => {
        const source = readFileSync(file, 'utf8');
        const hasOpaqueRoot = [routeRootPattern, inlineRootPattern, fullFlexPattern].some((pattern) => {
          pattern.lastIndex = 0;
          return pattern.test(source);
        });
        return hasOpaqueRoot
          ? [file]
          : [];
      });

    expect(offenders).toEqual([]);
  });
});