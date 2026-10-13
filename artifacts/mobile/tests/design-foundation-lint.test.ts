import { describe, expect, it } from 'vitest';
import { findViolations, readBaseline, scanSource, scanTree } from '../scripts/lint/design-foundation.mjs';

describe('design foundation lint (BRANDTHREAD_DESIGN.md)', () => {
  it('counts Feather imports, uppercase labels and wide tracking', () => {
    const source = [
      "import { Feather, Ionicons } from '@expo/vector-icons';",
      "import { MaterialIcons } from '@expo/vector-icons';",
      "const a = { textTransform: 'uppercase', letterSpacing: 0.8 };",
      'const b = { letterSpacing: 0.2 };',
      'const c = { letterSpacing: -0.4 };',
      'const d = { letterSpacing: 1 };',
    ].join('\n');
    expect(scanSource(source)).toEqual({ feather: 1, uppercase: 1, letterSpacing: 2 });
  });

  it('flags only counts above the per-file baseline', () => {
    const baseline = { 'old.tsx': { feather: 1 } };
    expect(findViolations({ 'old.tsx': { feather: 1 } }, baseline)).toEqual([]);
    expect(findViolations({ 'old.tsx': { feather: 2 } }, baseline)).toHaveLength(1);
    expect(findViolations({ 'new.tsx': { uppercase: 1 } }, baseline)).toEqual([
      { file: 'new.tsx', rule: 'uppercase', count: 1, allowed: 0 },
    ]);
  });

  it('finds no new tells in the app source', () => {
    expect(findViolations(scanTree(), readBaseline())).toEqual([]);
  });
});
