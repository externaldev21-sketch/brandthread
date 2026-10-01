/**
 * brushLibraryModel.ts — pure, dependency-free logic behind the Brush
 * Library's full-screen two-pane rebuild (left: category sidebar, right:
 * brush grid, swipe-left for Share/Duplicate/Delete). Kept free of any
 * react-native/expo import so it can be unit-tested under vitest without
 * tripping the Flow-type parse failure those imports cause there.
 */

export interface BrushDef {
  id: string;
  name: string;
  category: string;
  widthMult: number;
  opacityMult: number;
  linecap: 'round' | 'square' | 'butt';
}

/** Stable brush ids ("b1", "b2", ...) so duplicate/delete don't depend on array position. */
export function nextBrushId(brushes: BrushDef[]): string {
  let max = 0;
  for (const b of brushes) {
    const m = /^b(\d+)$/.exec(b.id);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `b${max + 1}`;
}

/** Groups brushes by category, preserving first-seen category order (matches the sidebar's order). */
export function groupBrushesByCategory(brushes: BrushDef[]): { category: string; brushes: BrushDef[] }[] {
  const order: string[] = [];
  const map = new Map<string, BrushDef[]>();
  for (const b of brushes) {
    if (!map.has(b.category)) { map.set(b.category, []); order.push(b.category); }
    map.get(b.category)!.push(b);
  }
  return order.map(category => ({ category, brushes: map.get(category)! }));
}

/**
 * Duplicate a brush, inserting the copy immediately after the original
 * with a "<Name> Copy" name (de-duplicated with a counter if that name is
 * already taken, matching the familiar "Copy", "Copy 2", "Copy 3" pattern).
 * Returns the unchanged array if `id` isn't found.
 */
export function duplicateBrush(brushes: BrushDef[], id: string): { brushes: BrushDef[]; newId: string | null } {
  const idx = brushes.findIndex(b => b.id === id);
  if (idx === -1) return { brushes, newId: null };
  const original = brushes[idx];
  let baseName = `${original.name} Copy`;
  let n = 2;
  const existingNames = new Set(brushes.map(b => b.name));
  let name = baseName;
  while (existingNames.has(name)) { name = `${baseName} ${n}`; n += 1; }
  const copy: BrushDef = { ...original, id: nextBrushId(brushes), name };
  const next = [...brushes.slice(0, idx + 1), copy, ...brushes.slice(idx + 1)];
  return { brushes: next, newId: copy.id };
}

/**
 * Delete a brush by id. Refuses to delete the very last brush in the whole
 * library (there must always be at least one brush to draw with) and
 * returns `deleted: false` in that case rather than silently no-op'ing, so
 * the caller can surface why nothing happened.
 */
export function deleteBrush(brushes: BrushDef[], id: string): { brushes: BrushDef[]; deleted: boolean } {
  if (brushes.length <= 1) return { brushes, deleted: false };
  const next = brushes.filter(b => b.id !== id);
  return { brushes: next, deleted: next.length !== brushes.length };
}

/**
 * After deleting the currently-active brush, pick a sensible replacement:
 * prefer the next brush in the same category, then the previous one in
 * that category, then just the first brush overall.
 */
export function nextActiveBrushAfterDelete(before: BrushDef[], deletedId: string, after: BrushDef[]): string {
  if (after.length === 0) return deletedId; // caller's deleteBrush already refuses this case
  const deletedIdx = before.findIndex(b => b.id === deletedId);
  const deleted = before[deletedIdx];
  if (deleted) {
    const sameCategory = after.filter(b => b.category === deleted.category);
    if (sameCategory.length > 0) {
      // Closest by original index within the category.
      const candidates = before.filter(b => b.category === deleted.category && b.id !== deletedId);
      if (candidates.length > 0) {
        // The one that was closest (by index) to the deleted brush.
        let best = candidates[0];
        let bestDist = Math.abs(before.indexOf(best) - deletedIdx);
        for (const c of candidates) {
          const dist = Math.abs(before.indexOf(c) - deletedIdx);
          if (dist < bestDist) { best = c; bestDist = dist; }
        }
        return best.id;
      }
    }
  }
  return after[0].id;
}
