import { describe, it, expect } from 'vitest';
import {
  BrushDef, nextBrushId, groupBrushesByCategory, duplicateBrush, deleteBrush, nextActiveBrushAfterDelete,
} from '../lib/brushLibraryModel';

function mk(id: string, name: string, category: string): BrushDef {
  return { id, name, category, widthMult: 1, opacityMult: 1, linecap: 'round' };
}

const SAMPLE: BrushDef[] = [
  mk('b1', 'HB Pencil', 'Sketching'),
  mk('b2', '6B Pencil', 'Sketching'),
  mk('b3', 'Studio Pen', 'Inking'),
  mk('b4', 'Dry Ink', 'Inking'),
  mk('b5', 'Flat Brush', 'Painting'),
];

describe('nextBrushId', () => {
  it('finds the next numeric id after the highest existing one', () => {
    expect(nextBrushId(SAMPLE)).toBe('b6');
  });

  it('starts at b1 for an empty library', () => {
    expect(nextBrushId([])).toBe('b1');
  });

  it('ignores non-numeric or malformed ids', () => {
    expect(nextBrushId([mk('custom', 'X', 'Y')])).toBe('b1');
  });
});

describe('groupBrushesByCategory', () => {
  it('groups in first-seen category order', () => {
    const groups = groupBrushesByCategory(SAMPLE);
    expect(groups.map(g => g.category)).toEqual(['Sketching', 'Inking', 'Painting']);
    expect(groups[0].brushes.map(b => b.id)).toEqual(['b1', 'b2']);
    expect(groups[1].brushes.map(b => b.id)).toEqual(['b3', 'b4']);
    expect(groups[2].brushes.map(b => b.id)).toEqual(['b5']);
  });

  it('returns an empty array for an empty library', () => {
    expect(groupBrushesByCategory([])).toEqual([]);
  });
});

describe('duplicateBrush', () => {
  it('inserts a copy immediately after the original with a "Copy" suffix', () => {
    const { brushes, newId } = duplicateBrush(SAMPLE, 'b1');
    expect(newId).toBe('b6');
    expect(brushes.map(b => b.id)).toEqual(['b1', 'b6', 'b2', 'b3', 'b4', 'b5']);
    expect(brushes[1].name).toBe('HB Pencil Copy');
    expect(brushes[1].category).toBe('Sketching');
  });

  it('de-duplicates the copy name with a counter if "Copy" is already taken', () => {
    const withCopy = [...SAMPLE, mk('b9', 'HB Pencil Copy', 'Sketching')];
    const { brushes } = duplicateBrush(withCopy, 'b1');
    const names = brushes.map(b => b.name);
    expect(names).toContain('HB Pencil Copy 2');
  });

  it('is a no-op (returns the same array) for an unknown id', () => {
    const { brushes, newId } = duplicateBrush(SAMPLE, 'nope');
    expect(brushes).toBe(SAMPLE);
    expect(newId).toBeNull();
  });

  it('preserves all other brush properties on the copy', () => {
    const { brushes } = duplicateBrush(SAMPLE, 'b5');
    const copy = brushes.find(b => b.name === 'Flat Brush Copy')!;
    const original = SAMPLE.find(b => b.id === 'b5')!;
    expect(copy.widthMult).toBe(original.widthMult);
    expect(copy.opacityMult).toBe(original.opacityMult);
    expect(copy.linecap).toBe(original.linecap);
  });
});

describe('deleteBrush', () => {
  it('removes the brush by id', () => {
    const { brushes, deleted } = deleteBrush(SAMPLE, 'b3');
    expect(deleted).toBe(true);
    expect(brushes.map(b => b.id)).toEqual(['b1', 'b2', 'b4', 'b5']);
  });

  it('refuses to delete the last remaining brush', () => {
    const { brushes, deleted } = deleteBrush([mk('b1', 'Only', 'X')], 'b1');
    expect(deleted).toBe(false);
    expect(brushes).toEqual([mk('b1', 'Only', 'X')]);
  });

  it('is a no-op for an unknown id (but still "succeeds" trivially since length is unchanged)', () => {
    const { brushes, deleted } = deleteBrush(SAMPLE, 'nope');
    expect(deleted).toBe(false);
    expect(brushes).toEqual(SAMPLE);
  });
});

describe('nextActiveBrushAfterDelete', () => {
  it('picks another brush in the same category when one remains', () => {
    const after = deleteBrush(SAMPLE, 'b1').brushes;
    expect(nextActiveBrushAfterDelete(SAMPLE, 'b1', after)).toBe('b2');
  });

  it('picks the closest brush in the same category by original position', () => {
    const threeInCategory = [...SAMPLE, mk('b6', 'Technical', 'Sketching')]; // Sketching: b1,b2,b6
    const after = deleteBrush(threeInCategory, 'b2').brushes;
    // b2 removed; same-category candidates are b1 (dist 1) and b6 (dist 4) -> b1 wins.
    expect(nextActiveBrushAfterDelete(threeInCategory, 'b2', after)).toBe('b1');
  });

  it('falls back to the first remaining brush overall when the category is now empty', () => {
    const soleInCategory = SAMPLE.filter(b => b.id !== 'b2'); // Sketching now only has b1
    const after = deleteBrush(soleInCategory, 'b1').brushes;
    expect(nextActiveBrushAfterDelete(soleInCategory, 'b1', after)).toBe(after[0].id);
  });
});
