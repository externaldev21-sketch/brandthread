import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const themeIds = [
  'monochrome',
  'purple',
  'olive',
  'navy',
  'champagne',
  'black',
  'silver',
  'black-gold',
  'emerald-gold',
  'leopard-red',
  'maroon',
  'gold',
] as const;

function pngDimensions(path: string) {
  const image = readFileSync(path);
  expect(image.subarray(1, 4).toString('ascii')).toBe('PNG');
  return {
    width: image.readUInt32BE(16),
    height: image.readUInt32BE(20),
  };
}

describe('theme-matched app icons', () => {
  it('ships full-size iOS and Android source assets for every theme', () => {
    for (const id of themeIds) {
      for (const suffix of ['.png', '-android-foreground.png']) {
        const path = resolve(root, `assets/images/app-icons/${id}${suffix}`);
        expect(existsSync(path), path).toBe(true);
        expect(pngDimensions(path)).toEqual({ width: 1024, height: 1024 });
      }
    }
  });

  it('keeps every theme available behind the default-off native build gate', () => {
    const config = JSON.parse(readFileSync(resolve(root, 'app.json'), 'utf8'));
    const plugin = config.expo.plugins.find(
      (entry: unknown) => Array.isArray(entry) && entry[0] === './plugins/with-native-surfaces',
    );
    expect(plugin).toBeTruthy();
    expect(plugin[1].enabled).toBe(false);
    // Every theme icon, then the unlockable ones (lib/unlockableIcons.ts).
    expect(Object.keys(plugin[1].icons)).toEqual([...themeIds, 'brushed-silver', 'chrome'].map((id) => id.replaceAll('-', '_')));
    for (const entry of Object.values(plugin[1].icons) as Array<{ image: string; androidForegroundImage: string }>) {
      expect(existsSync(resolve(root, entry.image))).toBe(true);
      expect(existsSync(resolve(root, entry.androidForegroundImage))).toBe(true);
    }
    expect(config.expo.icon).toBe('./assets/images/app-icons/monochrome.png');
    expect(config.expo.android.adaptiveIcon.foregroundImage)
      .toBe('./assets/images/app-icons/monochrome-android-foreground.png');
  });

  it('keeps icon preference account-scoped and safe in Expo Go', () => {
    const context = readFileSync(resolve(root, 'contexts/AppIconContext.tsx'), 'utf8');
    expect(context).toContain("@brandthread/app-icon:${ICON_STORAGE_VERSION}:${userId ?? 'guest'}");
    expect(context).toContain("Constants.appOwnership !== 'expo'");
    expect(context).toContain("Constants.expoConfig?.extra?.nativeSurfacesBuildEnabled === false");
    expect(context).toContain("await import('expo-runtime-app-icon')");
    expect(context).not.toContain("import { setAppIcon } from 'expo-runtime-app-icon'");
    expect(context).toContain('const resolvedIconId = preference ?? theme.id');
    expect(context).toContain('appIconId: nextPreference');
  });

  it('replaces fake seasonal choices with theme-matched icon options', () => {
    const screen = readFileSync(resolve(root, 'app/appearance.tsx'), 'utf8');
    expect(screen).toContain('Follow app theme');
    expect(screen).toContain('APP_THEME_PRESETS.map');
    expect(screen).toContain('APPEARANCE_ICON_IMAGES');
    expect(screen).not.toMatch(/spring26|winter26|summer25|winter24/);
  });
});