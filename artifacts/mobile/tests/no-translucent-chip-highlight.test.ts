import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (relativePath: string) => readFileSync(resolve(__dirname, '..', relativePath), 'utf8');

/**
 * Guards against the "light translucent circle/pill highlight behind a
 * selected/pressed tab" look (named example: the active tab in a
 * Follows/Messages/Requests-style row) — selected chips/pills must use a
 * solid theme.accent fill with theme.onAccent text, not a translucent
 * theme.accentDim wash.
 */
describe('no translucent selected-chip highlight', () => {
  it('Chip fills the selected state solid instead of a translucent accentDim wash', () => {
    const chip = read('components/ui/Chip.tsx');
    expect(chip).toContain("backgroundColor: selected ? theme.accent : palette.card");
    expect(chip).not.toMatch(/backgroundColor:\s*selected\s*\?\s*theme\.accentDim/);
  });

  it('FilterChip fills the active state solid instead of a translucent accentDim wash', () => {
    const ui = read('components/BrandthreadUI.tsx');
    expect(ui).toContain("active && [fcS.active, { backgroundColor: theme.accent, borderColor: theme.accent }]");
    expect(ui).not.toMatch(/backgroundColor:\s*theme\.accentDim,\s*borderColor:\s*theme\.accent \+ '88'/);
  });
});
