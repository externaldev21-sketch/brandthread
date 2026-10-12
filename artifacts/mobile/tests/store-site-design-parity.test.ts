/**
 * The app's store previews must show the same presets the store renders:
 * lib/storeSiteDesign.ts is a copy of the API server's catalog.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { STORE_SITE_THEMES, storeSiteTheme } from '@/lib/storeSiteDesign';

const SERVER = path.resolve(__dirname, '../../api-server/src/lib/growth/storeSiteDesign.ts');

describe('store design presets', () => {
  const source = readFileSync(SERVER, 'utf8');
  it('has the same presets, in the same order, with the same colours as the server', () => {
    const server = [...source.matchAll(/\{ key: "(\w+)",\s*label: "(\w+)",\s*bg: "(#\w+)", fg: "(#\w+)", muted: "(#\w+)", line: "(#\w+)", card: "(#\w+)", buttonBg: "(#\w+)", buttonFg: "(#\w+)" \}/g)]
      .map((m) => ({ key: m[1], label: m[2], bg: m[3], fg: m[4], muted: m[5], line: m[6], card: m[7], buttonBg: m[8], buttonFg: m[9] }));
    expect(server.length).toBeGreaterThanOrEqual(3);
    expect(STORE_SITE_THEMES).toEqual(server);
  });
  it('maps the same older theme keys', () => {
    const legacy = source.match(/LEGACY_THEMES: Record<string, string> = (\{[^}]+\})/)?.[1];
    expect(legacy).toBeTruthy();
    for (const [from, to] of Object.entries(JSON.parse(legacy!.replace(/(\w+):/g, '"$1":')) as Record<string, string>)) {
      expect(storeSiteTheme(from).key, from).toBe(to);
    }
  });
});
