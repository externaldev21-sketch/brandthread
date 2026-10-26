import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const logoSizes = (src: string) => [...src.matchAll(/<BrandthreadLogo size=\{([^}]+)\}/g)].map(m => m[1]);

// Owner ask: the logo a little smaller app-wide (~15-20%), onboarding left big.
describe('Brandthread logo render sizes', () => {
  it.each([
    ['app/sign-in.tsx', ['30', '30', '30', '30', '30']],
    ['app/forgot-password.tsx', ['30']],
    ['app/splash.tsx', ['126']],
    ['components/BootScreen.tsx', ['126']],
    ['components/ClerkBootGate.tsx', ['80']],
    ['components/ClerkLoadErrorBoundary.tsx', ['80']],
    ['components/AIBrainFAB.tsx', ['18']],
    ['app/c/[collectionId].tsx', ['18']],
    ['app/ai-brain.tsx', ['15', 'isTablet ? 54 : 44', '15']],
  ])('%s renders the slightly smaller mark', (file, sizes) => {
    expect(logoSizes(read(file))).toEqual(sizes);
  });

  it('shrinks the QR share-card centre logo', () => {
    expect(read('components/ShareProfileSheet.tsx')).toContain('logoSize={QR_SIZE * 0.17}');
  });

  it('keeps onboarding logos at their original size', () => {
    expect(logoSizes(read('components/onboarding/WelcomeStep.tsx'))).toEqual(['40']);
    expect(logoSizes(read('app/thread-explainer.tsx'))).toEqual(['48']);
    expect(read('components/splash/AppIntroSplash.tsx')).toContain('const LOGO_BOX = 132;');
  });
});
