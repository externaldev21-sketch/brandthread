import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');
const SCAN_DIRS = ['app', 'components', 'contexts', 'lib', 'hooks', 'services'];
const FORBIDDEN = /from\s+['"]@react-navigation\/native['"]/;

function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...collectSourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) {
      files.push(full);
    }
  }
  return files;
}

/**
 * expo-router (~57, this app's version) vendors its OWN copy of React
 * Navigation's core internals (see node_modules/expo-router/build/
 * react-navigation/...) — its actual running NavigationContainer, theme
 * context, and navigation objects are built from that vendored copy, not
 * from the top-level @react-navigation/native package. Importing hooks/
 * components directly from '@react-navigation/native' talks to a DIFFERENT
 * module instance than the one expo-router actually renders with:
 *   - useNavigation() throws "Couldn't find a navigation object. Is your
 *     component inside NavigationContainer?" even though one visibly wraps
 *     the app (verified live: app/(buyer)/edit-profile.tsx and
 *     app/edit-profile.tsx crashed into the ErrorBoundary on open).
 *   - ThemeProvider/DarkTheme from the wrong instance never reaches
 *     expo-router's own screens, so their background/card colors silently
 *     fall back to React Navigation's built-in default theme — which is
 *     white. This was a real contributor to the white-strip/flash bug this
 *     PR otherwise fixes at the native-window level.
 * expo-router re-exports the same API (useNavigation, ThemeProvider,
 * DarkTheme, DefaultTheme, useTheme, and the Theme type) from 'expo-router'
 * itself — screens should import from there instead, with no
 * `@react-navigation/*` install required.
 */
describe('no direct @react-navigation/native imports in app code', () => {
  it('every app/components/contexts/lib/hooks/services file imports navigation APIs from expo-router instead', () => {
    const offenders: string[] = [];
    for (const dir of SCAN_DIRS) {
      const dirPath = join(ROOT, dir);
      try {
        statSync(dirPath);
      } catch {
        continue;
      }
      for (const file of collectSourceFiles(dirPath)) {
        const source = readFileSync(file, 'utf8');
        if (FORBIDDEN.test(source)) {
          offenders.push(file.replace(`${ROOT}/`, ''));
        }
      }
    }
    expect(offenders, `Import navigation APIs from 'expo-router' instead of '@react-navigation/native' in: ${offenders.join(', ')}`).toEqual([]);
  });
});
