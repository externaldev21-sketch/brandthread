import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');
const SCAN_DIRS = ['app', 'components'];
// BrandthreadUI.tsx is HapticSwitch's own implementation file — it's the
// one place allowed to reference react-native's Switch type at all (it
// still imports `SwitchProps` for HapticSwitch's prop shape, but no longer
// renders `<Switch>` itself — see the component's own doc comment).
const EXCLUDED_PATH_PARTS = ['/components/BrandthreadUI.tsx'];

/**
 * Every toggle in the app must render through components/BrandthreadUI.tsx's
 * HapticSwitch, never react-native's own <Switch> directly. Two reasons:
 *
 *  1. Brand/behavior consistency — HapticSwitch owns the app's fixed
 *     51×31/27px switch look (green ON track+knob, light OFF track+knob,
 *     haptic-on-toggle, 200ms crossfade), which a raw <Switch> wouldn't get.
 *  2. The bug this rule guards against: react-native's <Switch> with custom
 *     colors renders fine on iOS/Android but breaks on web (react-native-web
 *     draws the thumb oversized relative to a thin custom-colored track, so
 *     it hangs off the end instead of sliding inside it) — see the Add
 *     Product screenshot this was filed from. HapticSwitch draws its own
 *     track+thumb instead of delegating to any platform's native component,
 *     so it can't regress this way again; a direct <Switch> import bypasses
 *     that fix entirely.
 *
 * Static heuristic: flags any file (outside the exclusion above) that
 * imports `Switch` from 'react-native'.
 */
function listSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return listSourceFiles(full);
    return full.endsWith('.tsx') || full.endsWith('.ts') ? [full] : [];
  });
}

const SWITCH_IMPORT_RE = /import\s*\{[^}]*\bSwitch\b[^}]*\}\s*from\s*['"]react-native['"]/;

describe('no direct react-native Switch imports — every toggle goes through HapticSwitch', () => {
  it('no app/ or components/ file (other than BrandthreadUI.tsx) imports Switch from react-native', () => {
    const offenders: string[] = [];
    for (const dir of SCAN_DIRS) {
      for (const file of listSourceFiles(resolve(ROOT, dir))) {
        const relative = file.replace(`${ROOT}/`, '');
        if (EXCLUDED_PATH_PARTS.some((part) => file.includes(part))) continue;
        const src = readFileSync(file, 'utf8');
        if (SWITCH_IMPORT_RE.test(src)) offenders.push(relative);
      }
    }
    expect(offenders, `import HapticSwitch from '@/components/BrandthreadUI' instead of react-native's Switch in: ${offenders.join(', ')}`).toEqual([]);
  });
});
