/**
 * The app's store-website previews must show the same themes the website
 * renders: lib/storeSiteDesign.ts is a copy of the API server's catalog.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { STORE_SITE_FONTS, STORE_SITE_THEMES } from '@/lib/storeSiteDesign';

const SERVER = path.resolve(__dirname, '../../api-server/src/lib/growth/storeSiteDesign.ts');

describe('store website design catalog', () => {
  const source = readFileSync(SERVER, 'utf8');
  it('has the same themes, in the same order, with the same colours as the server', () => {
    const server = [...source.matchAll(/\{ key: "(\w+)",\s*label: "(\w+)",\s*bg: "(#\w+)", fg: "(#\w+)", muted: "(#\w+)", line: "(#\w+)", buttonBg: "(#\w+)", buttonFg: "(#\w+)" \}/g)]
      .map((m) => ({ key: m[1], label: m[2], bg: m[3], fg: m[4], muted: m[5], line: m[6], buttonBg: m[7], buttonFg: m[8] }));
    expect(server.length).toBeGreaterThanOrEqual(6);
    expect(STORE_SITE_THEMES).toEqual(server);
  });
  it('has the same fonts', () => {
    for (const f of STORE_SITE_FONTS) expect(source).toMatch(new RegExp(`${f.key}:\\s*\\{ label: "${f.label}"`));
  });
});
