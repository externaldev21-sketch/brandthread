/**
 * brushLibrary.ts — the user's brush library: ordered brush sets + brushes,
 * with Procreate's set/brush operations (new set, rename / duplicate /
 * delete / share a set, new brush, duplicate / delete a brush). Pure
 * immutable updates; persistence lives in hooks/useBrushLibrary.ts.
 */

import { BRUSH_CATEGORIES, DEFAULT_BRUSH_PRESETS, type BrushPreset } from './brushPresets';

export interface BrushLibraryState {
  sets: string[];
  brushes: BrushPreset[];
}

export function defaultBrushLibrary(): BrushLibraryState {
  return { sets: [...BRUSH_CATEGORIES], brushes: DEFAULT_BRUSH_PRESETS.map(b => ({ ...b, params: { ...b.params } })) };
}

function uniqueName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  let n = 1;
  while (taken.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

let idCounter = 0;
export function newBrushId(prefix = 'brush'): string {
  idCounter = (idCounter + 1) % 1e6;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

export function brushesInSet(state: BrushLibraryState, set: string): BrushPreset[] {
  return state.brushes.filter(b => b.category === set);
}

/** Procreate's "New set": an empty "Untitled Set" at the top of the rail. Returns the new set's name. */
export function addSet(state: BrushLibraryState): { state: BrushLibraryState; set: string } {
  const set = uniqueName('Untitled Set', new Set(state.sets));
  return { state: { ...state, sets: [set, ...state.sets] }, set };
}

export function renameSet(state: BrushLibraryState, from: string, to: string): BrushLibraryState {
  const name = to.trim();
  if (!name || name === from || state.sets.includes(name)) return state;
  return {
    sets: state.sets.map(s => (s === from ? name : s)),
    brushes: state.brushes.map(b => (b.category === from ? { ...b, category: name } : b)),
  };
}

export function duplicateSet(state: BrushLibraryState, set: string): { state: BrushLibraryState; set: string } {
  const copyName = uniqueName(`${set} Copy`, new Set(state.sets));
  const idx = state.sets.indexOf(set);
  const sets = [...state.sets];
  sets.splice(idx + 1, 0, copyName);
  const copies = brushesInSet(state, set).map(b => ({ ...b, id: newBrushId(), category: copyName, params: { ...b.params } }));
  return { state: { sets, brushes: [...state.brushes, ...copies] }, set: copyName };
}

/** Deletes a set and its brushes. Refuses (returns the same state) if it would leave no brushes at all. */
export function deleteSet(state: BrushLibraryState, set: string): BrushLibraryState {
  const remaining = state.brushes.filter(b => b.category !== set);
  if (remaining.length === 0) return state;
  return { sets: state.sets.filter(s => s !== set), brushes: remaining };
}

/** "New brush": a copy of `basedOn` named "Untitled Brush" at the top of `set`. */
export function addBrush(state: BrushLibraryState, set: string, basedOn: BrushPreset): { state: BrushLibraryState; id: string } {
  const taken = new Set(state.brushes.map(b => b.name));
  const brush: BrushPreset = { id: newBrushId(), name: uniqueName('Untitled Brush', taken), category: set, params: { ...basedOn.params } };
  const firstIdx = state.brushes.findIndex(b => b.category === set);
  const brushes = [...state.brushes];
  brushes.splice(firstIdx === -1 ? brushes.length : firstIdx, 0, brush);
  return { state: { ...state, brushes }, id: brush.id };
}

export function duplicateBrushPreset(state: BrushLibraryState, id: string): { state: BrushLibraryState; id: string | null } {
  const idx = state.brushes.findIndex(b => b.id === id);
  if (idx === -1) return { state, id: null };
  const src = state.brushes[idx];
  const copy: BrushPreset = { ...src, id: newBrushId(), name: uniqueName(`${src.name} Copy`, new Set(state.brushes.map(b => b.name))), params: { ...src.params } };
  const brushes = [...state.brushes];
  brushes.splice(idx + 1, 0, copy);
  return { state: { ...state, brushes }, id: copy.id };
}

export function deleteBrushPreset(state: BrushLibraryState, id: string): BrushLibraryState {
  if (state.brushes.length <= 1) return state;
  return { ...state, brushes: state.brushes.filter(b => b.id !== id) };
}

/** Ensures loaded/persisted data is usable (unknown sets get a rail entry; empty → defaults). */
export function normalizeBrushLibrary(raw: unknown): BrushLibraryState {
  const def = defaultBrushLibrary();
  if (!raw || typeof raw !== 'object') return def;
  const r = raw as Partial<BrushLibraryState>;
  if (!Array.isArray(r.brushes) || r.brushes.length === 0 || !Array.isArray(r.sets)) return def;
  const brushes = r.brushes.filter(b => b && typeof b.id === 'string' && b.params && typeof b.params.tip === 'string');
  if (brushes.length === 0) return def;
  const sets = r.sets.filter(s => typeof s === 'string');
  for (const b of brushes) if (!sets.includes(b.category)) sets.push(b.category);
  return { sets, brushes };
}
