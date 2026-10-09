import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@expo/vector-icons', () => ({ Feather: { glyphMap: {} }, MaterialIcons: { glyphMap: {} } }));

import { ICON_MAP } from '@/lib/iconMap';

const require = createRequire(import.meta.url);
const featherGlyphs = require('@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Feather.json');
const materialGlyphs = require('@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/MaterialIcons.json');

/** SF Symbol names grouped by the SF Symbols release that added them. */
function sfSymbolsByRelease(): Map<string, number> {
  const typesFile = path.join(
    path.dirname(require.resolve('sf-symbols-typescript/package.json', { paths: [path.dirname(require.resolve('expo-symbols'))] })),
    'dist/index.d.ts',
  );
  const releases = new Map<string, number>();
  let release = 0;
  for (const line of readFileSync(typesFile, 'utf8').split('\n')) {
    const header = /type SFSymbols(\d+)_/.exec(line);
    if (header) release = Number(header[1]);
    const name = /\| '([^']+)'/.exec(line);
    if (name && !releases.has(name[1])) releases.set(name[1], release);
  }
  return releases;
}

describe('icon map (Feather → SF Symbols / Material)', () => {
  const entries = Object.entries(ICON_MAP);
  const sf = sfSymbolsByRelease();

  it('is keyed by real Feather names', () => {
    for (const [name] of entries) expect(featherGlyphs[name], name).toBeDefined();
  });

  it('only names Material icons that exist', () => {
    for (const [name, mapping] of entries) {
      if (mapping?.material) expect(materialGlyphs[mapping.material], `${name} → ${mapping.material}`).toBeDefined();
    }
  });

  it('only names SF Symbols available on iOS 15 (SF Symbols 3)', () => {
    for (const [name, mapping] of entries) {
      if (!mapping?.sf) continue;
      expect(sf.get(mapping.sf), `${name} → ${mapping.sf}`).toBeLessThanOrEqual(3);
    }
  });
});
