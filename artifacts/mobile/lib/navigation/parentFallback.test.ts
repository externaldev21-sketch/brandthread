import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PARENT_FALLBACK } from './parentFallback';

/**
 * Guards the back-navigation parent-fallback registry (see PARENT_FALLBACK's
 * own doc comment): every screen key must exist as a real route file, every
 * parent value must exist as a real route file, and the screen's own source
 * must actually pass that exact fallback to `goBackOr` — catching drift if
 * a screen's fallback is edited without updating this map, or vice versa.
 */

const ROOT = resolve(__dirname, '../..');
const APP_DIR = resolve(ROOT, 'app');

const GROUP_ROOT_RE = /^\([^)]+\)\/?$/;

function candidatesFor(route: string): string[] {
  const trimmed = route.replace(/^\//, '');
  if (trimmed === '' || GROUP_ROOT_RE.test(trimmed)) return [];
  const withoutGroup = trimmed.replace(/^\([^)]+\)\//, '');
  return [
    resolve(APP_DIR, `${trimmed}.tsx`),
    resolve(APP_DIR, `${trimmed}/index.tsx`),
    resolve(APP_DIR, `${withoutGroup}.tsx`),
    resolve(APP_DIR, `${withoutGroup}/index.tsx`),
  ];
}

function routeExists(route: string): boolean {
  // A trailing-slash group root (e.g. '/(tabs)/more' has no trailing slash
  // issue, but '/(buyer)/' itself does) always resolves via its layout.
  if (GROUP_ROOT_RE.test(route.replace(/^\//, ''))) return true;
  return candidatesFor(route).some((c) => existsSync(c));
}

describe('PARENT_FALLBACK map', () => {
  it('is non-empty', () => {
    expect(Object.keys(PARENT_FALLBACK).length).toBeGreaterThan(0);
  });

  for (const [screen, parent] of Object.entries(PARENT_FALLBACK)) {
    it(`${screen} exists as a route`, () => {
      expect(routeExists(screen)).toBe(true);
    });

    it(`${screen}'s parent (${parent}) exists as a route`, () => {
      expect(routeExists(parent)).toBe(true);
    });

    it(`${screen}'s source actually wires goBackOr(router, '${parent}')`, () => {
      const file = candidatesFor(screen).find((c) => existsSync(c));
      expect(file, `no source file found for ${screen}`).toBeTruthy();
      const src = readFileSync(file!, 'utf8');
      const expected = `goBackOr(router, '${parent}')`;
      const expectedDouble = `goBackOr(router, "${parent}")`;
      expect(
        src.includes(expected) || src.includes(expectedDouble),
        `${screen} does not call ${expected} anywhere in its source`,
      ).toBe(true);
    });
  }

  it('never maps a screen to itself', () => {
    for (const [screen, parent] of Object.entries(PARENT_FALLBACK)) {
      expect(parent, `${screen} maps to itself`).not.toBe(screen);
    }
  });

  it('never falls back to blanket "/"', () => {
    for (const parent of Object.values(PARENT_FALLBACK)) {
      expect(parent).not.toBe('/');
    }
  });
});
