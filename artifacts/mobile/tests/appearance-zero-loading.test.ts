import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

/**
 * Appearance (app/appearance.tsx) must never show a loading/fade/pop-in
 * state for its icon and theme thumbnails: they're bundled locally and
 * preloaded at app start, so the first paint should already be final.
 */
describe('appearance screen has zero loading states', () => {
  it('renders every thumbnail with expo-image, no fade, memory-disk cache', () => {
    const screen = readFileSync(resolve(root, 'app/appearance.tsx'), 'utf8');
    expect(screen).toContain("from 'expo-image'");
    expect(screen).not.toMatch(/from 'react-native'[^;]*\bImage\b/);
    expect(screen).not.toContain('ActivityIndicator');
    expect(screen).not.toContain('LoadingSkeleton');
    expect((screen.match(/transition=\{0\}/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect((screen.match(/cachePolicy="memory-disk"/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it('preloads all icon/theme assets on mount as a defensive backstop', () => {
    const screen = readFileSync(resolve(root, 'app/appearance.tsx'), 'utf8');
    expect(screen).toContain('preloadAppearanceAssets');
  });

  it('bundles every icon and theme image as a local require() asset', () => {
    const assets = readFileSync(resolve(root, 'lib/appearanceAssets.ts'), 'utf8');
    expect(assets).not.toMatch(/https?:\/\//);
    expect(assets).toContain("require('../assets/images/app-icons/");
    expect(assets).toContain("require('../assets/images/themes/");
    expect(assets).toContain('Asset.loadAsync');
  });

  it('preloads Appearance assets at app start, without gating app-ready', () => {
    const layout = readFileSync(resolve(root, 'app/_layout.tsx'), 'utf8');
    expect(layout).toContain("from '@/lib/appearanceAssets'");
    expect(layout).toContain('void preloadAppearanceAssets()');
  });
});
