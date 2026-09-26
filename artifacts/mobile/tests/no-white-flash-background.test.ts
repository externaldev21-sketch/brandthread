import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (relativePath: string) =>
  readFileSync(resolve(__dirname, '..', relativePath), 'utf8');

/**
 * Guards against the "white strip/flash" class of bug: a moment where the OS
 * default (white) background shows through instead of the app's active
 * theme. Every layer that can show through must be explicitly painted with
 * a themed color — see app/_layout.tsx's RuntimeThemeShell comment for the
 * full explanation of why each of these matters.
 */
describe('no white-flash background regressions', () => {
  it('paints the native root window/root view background on every theme change', () => {
    const layout = read('app/_layout.tsx');
    expect(layout).toContain("import * as SystemUI from 'expo-system-ui'");
    expect(layout).toContain('SystemUI.setBackgroundColorAsync(background)');
    // Also set once at module load, before the themed effect can run, so the
    // very first native frames aren't the OS default either.
    expect(layout).toMatch(/SystemUI\.setBackgroundColorAsync\('#0A0A0B'\)/);
  });

  it('sets the Android navigation bar icon style for every one of the (all-dark) 12 themes', () => {
    const layout = read('app/_layout.tsx');
    expect(layout).toContain("import * as NavigationBar from 'expo-navigation-bar'");
    expect(layout).toContain("NavigationBar.setStyle('light')");
  });

  it('configures a themed (non-white) default Android navigation bar in app.json', () => {
    const appJson = JSON.parse(read('app.json'));
    const navBar = appJson.expo?.androidNavigationBar;
    expect(navBar, 'expo.androidNavigationBar must be configured').toBeTruthy();
    expect(navBar.backgroundColor).toMatch(/^#[0-9A-Fa-f]{6,8}$/);
    expect(navBar.backgroundColor.toUpperCase()).not.toBe('#FFFFFF');
  });

  it('keeps the splash background dark, matching the native module-load default', () => {
    const appJson = JSON.parse(read('app.json'));
    const splashPlugin = (appJson.expo?.plugins ?? []).find(
      (p: unknown) => Array.isArray(p) && p[0] === 'expo-splash-screen',
    );
    expect(splashPlugin, 'expo-splash-screen plugin config not found').toBeTruthy();
    const backgroundColor = splashPlugin[1]?.backgroundColor;
    expect(backgroundColor).toBeTruthy();
    expect(String(backgroundColor).toUpperCase()).not.toBe('#FFFFFF');
  });

  it('paints the web document background reactively (persisted theme, not a fixed hardcode)', () => {
    const layout = read('app/_layout.tsx');
    expect(layout).toContain("document.body.style.backgroundColor = '#0A0A0B'");
    expect(layout).toContain('peekPersistedTheme(AsyncStorage)');
    expect(layout).toContain('document.body.style.backgroundColor = persisted.background');
  });

  it('gives every root/nested navigator a themed scene background — none can fall through to white', () => {
    const rootLayout = read('app/_layout.tsx');
    const tabsLayout = read('app/(tabs)/_layout.tsx');
    const buyerLayout = read('app/(buyer)/_layout.tsx');

    // Root Stack: every screen defaults to (and individual entries repeat)
    // a themed/transparent contentStyle, never left unset (which native-stack
    // would otherwise paint white on some platforms/transitions).
    expect(rootLayout).toContain('contentStyle: OPAQUE_SCREEN_CONTENT');
    expect(rootLayout).toMatch(/OPAQUE_SCREEN_CONTENT = \{ backgroundColor: 'transparent' \}/);

    // Nested (tabs) and (buyer) Tabs navigators each set their own themed
    // sceneStyle — a root Stack.Screen's contentStyle does not cascade into
    // a nested navigator's own screens.
    expect(tabsLayout).toContain('sceneStyle: { backgroundColor: theme.background }');
    expect(buyerLayout).toContain('sceneStyle: { backgroundColor: colors.background }');
  });

  it('gives the WebAppShell column and backdrop an explicit themed background (no unpainted gap around it)', () => {
    const shell = read('components/web/WebAppShell.tsx');
    expect(shell).toContain('backgroundColor: background');
  });
});
