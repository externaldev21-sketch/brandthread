import { describe, it, expect } from 'vitest';
import {
  UndoModel,
  addLayerCommand,
  deleteLayerCommand,
  reorderLayerCommand,
  updateLayerCommand,
  duplicateLayerCommand,
  mergeLayersCommand,
} from '../lib/undoModel';
import type { DesignLayer } from '../services/designTypes';

function makeLayer(id: string, name: string, order: number): DesignLayer {
  const now = new Date().toISOString();
  return {
    id, name, type: 'drawing', visible: true, locked: false, order,
    transform: { x: 0, y: 0, width: 100, height: 100, rotation: 0, scaleX: 1, scaleY: 1 },
    data: { kind: 'drawing', paths: [] },
    opacity: 1, createdAt: now, updatedAt: now,
  };
}

describe('UndoModel — generic push/undo/redo', () => {
  it('starts with no undo/redo available', () => {
    const model = new UndoModel<number>();
    expect(model.canUndo).toBe(false);
    expect(model.canRedo).toBe(false);
    expect(model.generation).toBe(0);
  });

  it('push then undo reverses the applied change', () => {
    const model = new UndoModel<number>();
    let state = 0;
    const cmd = { label: 'add 5', apply: (s: number) => s + 5, invert: (s: number) => s - 5 };
    state = cmd.apply(state);
    model.push(cmd);
    expect(state).toBe(5);
    expect(model.canUndo).toBe(true);
    state = model.undo(state);
    expect(state).toBe(0);
    expect(model.canUndo).toBe(false);
    expect(model.canRedo).toBe(true);
  });

  it('redo re-applies an undone command', () => {
    const model = new UndoModel<number>();
    let state = 0;
    const cmd = { label: 'add 5', apply: (s: number) => s + 5, invert: (s: number) => s - 5 };
    state = cmd.apply(state);
    model.push(cmd);
    state = model.undo(state);
    state = model.redo(state);
    expect(state).toBe(5);
    expect(model.canRedo).toBe(false);
  });

  it('undo/redo on an empty stack is a no-op', () => {
    const model = new UndoModel<number>();
    expect(model.undo(42)).toBe(42);
    expect(model.redo(42)).toBe(42);
  });

  it('multiple pushes undo in LIFO order', () => {
    const model = new UndoModel<number>();
    let state = 0;
    for (const n of [1, 2, 3]) {
      const cmd = { label: `add ${n}`, apply: (s: number) => s + n, invert: (s: number) => s - n };
      state = cmd.apply(state);
      model.push(cmd);
    }
    expect(state).toBe(6);
    state = model.undo(state);
    expect(state).toBe(3); // undid +3
    state = model.undo(state);
    expect(state).toBe(1); // undid +2
    state = model.undo(state);
    expect(state).toBe(0); // undid +1
    expect(model.canUndo).toBe(false);
  });

  it('branching: a new push after undo truncates the redo stack', () => {
    const model = new UndoModel<number>();
    let state = 0;
    const cmdA = { label: 'A', apply: (s: number) => s + 1, invert: (s: number) => s - 1 };
    const cmdB = { label: 'B', apply: (s: number) => s + 2, invert: (s: number) => s - 2 };
    const cmdC = { label: 'C', apply: (s: number) => s + 100, invert: (s: number) => s - 100 };

    state = cmdA.apply(state); model.push(cmdA);
    state = cmdB.apply(state); model.push(cmdB);
    expect(state).toBe(3);

    state = model.undo(state); // back to 1, redo has [B]
    expect(state).toBe(1);
    expect(model.canRedo).toBe(true);

    // New action branches away from B
    state = cmdC.apply(state); model.push(cmdC);
    expect(state).toBe(101);
    expect(model.canRedo).toBe(false); // B is gone

    state = model.undo(state);
    expect(state).toBe(1); // back before C, and NOT B
  });

  it('generation increments on push/undo/redo and never decrements', () => {
    const model = new UndoModel<number>();
    const cmd = { label: 'x', apply: (s: number) => s + 1, invert: (s: number) => s - 1 };
    const g0 = model.generation;
    model.push(cmd);
    const g1 = model.generation;
    expect(g1).toBeGreaterThan(g0);
    model.undo(1);
    const g2 = model.generation;
    expect(g2).toBeGreaterThan(g1);
    model.redo(0);
    const g3 = model.generation;
    expect(g3).toBeGreaterThan(g2);
  });

  it('caps history at maxHistory, dropping oldest undo entries', () => {
    const model = new UndoModel<number>({ maxHistory: 3 });
    let state = 0;
    for (let i = 1; i <= 5; i++) {
      const cmd = { label: `#${i}`, apply: (s: number) => s + 1, invert: (s: number) => s - 1 };
      state = cmd.apply(state);
      model.push(cmd);
    }
    expect(state).toBe(5);
    expect(model.undoDepth).toBe(3);
    // Undo 3 times (the max retained) — should land on 2, NOT 0, because the
    // two oldest pushes (#1, #2) were evicted and are no longer reversible.
    state = model.undo(state);
    state = model.undo(state);
    state = model.undo(state);
    expect(state).toBe(2);
    expect(model.canUndo).toBe(false);
  });

  it('clear() empties both stacks without touching external state', () => {
    const model = new UndoModel<number>();
    const cmd = { label: 'x', apply: (s: number) => s + 1, invert: (s: number) => s - 1 };
    model.push(cmd);
    model.undo(1);
    expect(model.canRedo).toBe(true);
    model.clear();
    expect(model.canUndo).toBe(false);
    expect(model.canRedo).toBe(false);
  });
});

describe('UndoModel — layer-array command builders', () => {
  it('addLayerCommand: apply appends, invert removes by id', () => {
    let layers: DesignLayer[] = [makeLayer('a', 'A', 0)];
    const newLayer = makeLayer('b', 'B', 1);
    const cmd = addLayerCommand(newLayer);
    layers = cmd.apply(layers);
    expect(layers.map(l => l.id)).toEqual(['a', 'b']);
    layers = cmd.invert(layers);
    expect(layers.map(l => l.id)).toEqual(['a']);
  });

  it('deleteLayerCommand: apply removes, invert restores at original index', () => {
    let layers: DesignLayer[] = [makeLayer('a', 'A', 0), makeLayer('b', 'B', 1), makeLayer('c', 'C', 2)];
    const cmd = deleteLayerCommand(layers, 'b');
    layers = cmd.apply(layers);
    expect(layers.map(l => l.id)).toEqual(['a', 'c']);
    layers = cmd.invert(layers);
    expect(layers.map(l => l.id)).toEqual(['a', 'b', 'c']);
  });

  it('reorderLayerCommand: apply moves, invert moves back', () => {
    let layers: DesignLayer[] = [makeLayer('a', 'A', 0), makeLayer('b', 'B', 1), makeLayer('c', 'C', 2)];
    const cmd = reorderLayerCommand(0, 2);
    layers = cmd.apply(layers);
    expect(layers.map(l => l.id)).toEqual(['b', 'c', 'a']);
    layers = cmd.invert(layers);
    expect(layers.map(l => l.id)).toEqual(['a', 'b', 'c']);
  });

  it('updateLayerCommand: apply patches, invert restores original property values', () => {
    let layers: DesignLayer[] = [makeLayer('a', 'A', 0)];
    const cmd = updateLayerCommand(layers, 'a', { name: 'Renamed', opacity: 0.5, locked: true });
    layers = cmd.apply(layers);
    expect(layers[0].name).toBe('Renamed');
    expect(layers[0].opacity).toBe(0.5);
    expect(layers[0].locked).toBe(true);
    layers = cmd.invert(layers);
    expect(layers[0].name).toBe('A');
    expect(layers[0].opacity).toBe(1);
    expect(layers[0].locked).toBe(false);
  });

  it('duplicateLayerCommand: apply inserts copy right after source, invert removes it', () => {
    let layers: DesignLayer[] = [makeLayer('a', 'A', 0), makeLayer('b', 'B', 1)];
    const copy = { ...makeLayer('a_copy', 'A copy', 1) };
    const cmd = duplicateLayerCommand(layers, 'a', copy);
    layers = cmd.apply(layers);
    expect(layers.map(l => l.id)).toEqual(['a', 'a_copy', 'b']);
    layers = cmd.invert(layers);
    expect(layers.map(l => l.id)).toEqual(['a', 'b']);
  });

  it('mergeLayersCommand: apply collapses two layers into one at the bottom layer\'s slot, invert restores both', () => {
    let layers: DesignLayer[] = [makeLayer('top', 'Top', 2), makeLayer('bottom', 'Bottom', 1), makeLayer('other', 'Other', 0)];
    const merged = makeLayer('merged', 'Top (merged)', 1);
    const cmd = mergeLayersCommand(layers, 'top', 'bottom', merged);
    layers = cmd.apply(layers);
    expect(layers.map(l => l.id)).toEqual(['merged', 'other']);
    layers = cmd.invert(layers);
    expect(layers.map(l => l.id)).toEqual(['top', 'bottom', 'other']);
  });

  it('full workflow: push several layer commands through UndoModel and undo/redo the sequence', () => {
    const model = new UndoModel<DesignLayer[]>();
    let layers: DesignLayer[] = [makeLayer('a', 'A', 0)];

    const addB = addLayerCommand(makeLayer('b', 'B', 1));
    layers = addB.apply(layers);
    model.push(addB);

    const renameA = updateLayerCommand(layers, 'a', { name: 'Alpha' });
    layers = renameA.apply(layers);
    model.push(renameA);

    const delB = deleteLayerCommand(layers, 'b');
    layers = delB.apply(layers);
    model.push(delB);

    expect(layers.map(l => l.id)).toEqual(['a']);
    expect(layers[0].name).toBe('Alpha');

    // Undo the delete -> b comes back
    layers = model.undo(layers);
    expect(layers.map(l => l.id)).toEqual(['a', 'b']);

    // Undo the rename -> back to 'A'
    layers = model.undo(layers);
    expect(layers.find(l => l.id === 'a')!.name).toBe('A');

    // Undo the add -> b gone again
    layers = model.undo(layers);
    expect(layers.map(l => l.id)).toEqual(['a']);
    expect(model.canUndo).toBe(false);

    // Redo everything back
    layers = model.redo(layers);
    layers = model.redo(layers);
    layers = model.redo(layers);
    expect(layers.map(l => l.id)).toEqual(['a']);
    expect(layers[0].name).toBe('Alpha');
    expect(model.canRedo).toBe(false);
  });

  it('interacts correctly with an autosave-style generation watcher', () => {
    const model = new UndoModel<DesignLayer[]>();
    let lastSavedGeneration = model.generation;
    let layers: DesignLayer[] = [makeLayer('a', 'A', 0)];

    const isDirty = () => model.generation !== lastSavedGeneration;
    expect(isDirty()).toBe(false);

    const addB = addLayerCommand(makeLayer('b', 'B', 1));
    layers = addB.apply(layers);
    model.push(addB);
    expect(isDirty()).toBe(true);

    // Autosave runs, records the generation it saved at.
    lastSavedGeneration = model.generation;
    expect(isDirty()).toBe(false);

    // Undo also counts as a change that needs (re-)saving.
    layers = model.undo(layers);
    expect(isDirty()).toBe(true);
  });
});
