import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), 'utf8');

describe('navigation scene isolation', () => {
  it('gives every root-stack scene an opaque background plane behind transparent content', () => {
    const rootLayout = read('app/_layout.tsx');
    const layoutStart = rootLayout.indexOf('screenLayout={({ children }) => (');
    const stackOptions = rootLayout.indexOf('screenOptions={{', layoutStart);

    expect(layoutStart).toBeGreaterThan(-1);
    expect(rootLayout.slice(layoutStart, stackOptions)).toContain(
      '<IsolatedStackScene>{children}</IsolatedStackScene>',
    );
    expect(rootLayout).toContain("style={{ flex: 1, backgroundColor: '#0A0A0B' }}");
    expect(rootLayout).toContain('{isFocused ? <AnimatedGradientBackground /> : null}');
  });

  it('removes inactive buyer and seller tabs from the native view hierarchy', () => {
    for (const layout of ['app/(buyer)/_layout.tsx', 'app/(tabs)/_layout.tsx']) {
      const source = read(layout);
      expect(source).toContain('detachInactiveScreens');
      expect(source).toContain('freezeOnBlur: true');
    }
  });

  it('returns a completed seller live stream to the real seller root', () => {
    const sellerLive = read('app/seller-live.tsx');

    expect(sellerLive).toContain("router.dismissTo('/(tabs)/'");
    expect(sellerLive).not.toContain('/(seller)/(tabs)/home');
  });
});