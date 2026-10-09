/**
 * Ratchet lint against "navigate after a guessed delay":
 *
 *   setTimeout(() => router.push('/x'), 0)      // wait for a sheet to close
 *   setTimeout(() => goBackOr(router), 300)     // wait for something to settle
 *
 * A fixed delay is a race: too short and the push lands while a Modal is
 * still dismissing (iOS drops or glitches modal routes presented then), too
 * long and the app feels sluggish. Use the real signal instead:
 *  - closing a Modal/sheet first → hooks/useAfterModalDismiss (Modal onDismiss)
 *  - after a screen transition → navigation.addListener('transitionEnd')
 *  - after layout → onLayout / onContentSizeChange / requestAnimationFrame
 *
 * The allowlist below holds the remaining call sites where the delay is a
 * deliberate on-screen dwell (a success toast / "call ended" state the user
 * is meant to read, or an animation that should be seen before the route
 * swaps). It can only shrink: adding a file needs a reason in the same
 * change, and `-t stale` fails as soon as an entry stops being needed.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '..');
const SCAN_DIRS = ['app', 'components', 'lib', 'services', 'hooks', 'contexts'];

/** file (relative to artifacts/mobile) → number of allowed delayed navigations. */
const ALLOWLIST: Record<string, number> = {
  // "Call ended" state is shown for 1.5s before leaving the call screen.
  'app/call-screen.tsx': 1,
  // "Profile updated" toast gets a beat on screen before going back.
  'app/edit-profile.tsx': 1,
  'app/(buyer)/edit-profile.tsx': 1,
  // Mode pill slide is seen before the root route swaps.
  'components/ModeSwitcher.tsx': 1,
};

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '__tests__') continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
      continue;
    }
    if (/\.(tsx?|jsx?)$/.test(entry) && !/\.(test|spec)\./.test(entry)) out.push(full);
  }
  return out;
}

function rel(full: string): string {
  return path.relative(ROOT, full).split(path.sep).join('/');
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|[^:'"`])\/\/.*$/, '$1'))
    .join('\n');
}

/**
 * A setTimeout whose inline callback navigates in its first statement:
 * `setTimeout(() => router.push(..))`, `setTimeout(() => { router.replace(..) })`,
 * `setTimeout(() => goBackOr(router))`, `setTimeout(() => navigation.navigate(..))`.
 */
const DELAYED_NAV_RE =
  /setTimeout\(\s*(?:async\s*)?\(\s*\)\s*=>\s*\{?\s*(?:void\s+)?(?:router\.|goBackOr\(|navigation\.(?:navigate|push|replace|goBack|dispatch)\b)/g;

function countDelayedNavigations(source: string): number {
  return (stripComments(source).match(DELAYED_NAV_RE) ?? []).length;
}

function scan(): Map<string, number> {
  const hits = new Map<string, number>();
  for (const dir of SCAN_DIRS) {
    for (const file of walk(path.join(ROOT, dir))) {
      const n = countDelayedNavigations(readFileSync(file, 'utf8'));
      if (n > 0) hits.set(rel(file), n);
    }
  }
  return hits;
}

describe('no-delayed-navigation lint', () => {
  const hits = scan();

  it('detects the patterns it is meant to catch', () => {
    expect(countDelayedNavigations("setTimeout(() => router.push('/x' as never), 0);")).toBe(1);
    expect(countDelayedNavigations('setTimeout(() => {\n  router.replace(target);\n}, 150);')).toBe(1);
    expect(countDelayedNavigations('setTimeout(() => goBackOr(router), 500);')).toBe(1);
    expect(countDelayedNavigations("setTimeout(() => navigation.navigate('Home'), 300);")).toBe(1);
    expect(countDelayedNavigations('// setTimeout(() => router.back(), 10);')).toBe(0);
    expect(countDelayedNavigations('setTimeout(() => setToast(null), 2000);')).toBe(0);
  });

  it('adds no new setTimeout-then-navigate call sites', () => {
    const offenders = [...hits.entries()]
      .filter(([file, n]) => n > (ALLOWLIST[file] ?? 0))
      .map(([file, n]) => `${file}: ${n} delayed navigation(s), allowed ${ALLOWLIST[file] ?? 0}`);
    expect(
      offenders,
      'Navigate on a real signal (Modal onDismiss via hooks/useAfterModalDismiss, transitionEnd, onLayout) instead of a fixed setTimeout delay.',
    ).toEqual([]);
  });

  it('has no stale allowlist entries', () => {
    const stale = Object.entries(ALLOWLIST)
      .filter(([file, n]) => (hits.get(file) ?? 0) < n)
      .map(([file, n]) => `${file}: allowlisted ${n}, found ${hits.get(file) ?? 0} — lower or remove the entry`);
    expect(stale).toEqual([]);
  });
});
