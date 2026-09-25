/**
 * undoModel.ts — command/patch-based undo/redo manager for the design canvas.
 *
 * Replaces ad-hoc "stringify the whole layer array" snapshotting with a small,
 * dedicated, generic history stack that:
 *   - records a `patch` (inverse pair of pure functions) per action, not a
 *     full-document diff, so history entries stay small and fast to apply
 *   - supports push / undo / redo
 *   - truncates the redo stack on any new push after an undo (branching)
 *   - is capped (bounded memory) with a configurable max depth — oldest
 *     entries are dropped, never entries still reachable via redo
 *   - exposes a monotonic `generation` counter that increments on every
 *     push/undo/redo, for wiring into autosave "has this state been saved
 *     since the last edit" tracking
 *
 * The manager is generic over the document type `T` (here, `DesignLayer[]`,
 * but it makes no assumption beyond structural equality via patches), so it
 * can be reused for other undoable state (e.g. canvas background) later.
 *
 * Convenience layer-array command builders (addLayer/deleteLayer/reorder/
 * updateLayer) are provided below the generic manager.
 */

import type { DesignLayer } from '../services/designTypes';

// ─── Generic command/patch model ─────────────────────────────────────────────

export interface UndoCommand<T> {
  /** Human-readable label, useful for debugging/telemetry. */
  label: string;
  /** Applies the command, returning the new state. Must be pure. */
  apply: (state: T) => T;
  /** Reverses the command, returning the prior state. Must be pure. */
  invert: (state: T) => T;
}

export interface UndoModelOptions {
  /** Maximum number of undo entries retained. Default 100. */
  maxHistory?: number;
}

export class UndoModel<T> {
  private undoStack: UndoCommand<T>[] = [];
  private redoStack: UndoCommand<T>[] = [];
  private readonly maxHistory: number;
  private _generation = 0;

  constructor(options: UndoModelOptions = {}) {
    this.maxHistory = options.maxHistory ?? 100;
  }

  /** Monotonic counter bumped on every push/undo/redo — wire to autosave dirty-tracking. */
  get generation(): number {
    return this._generation;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get undoDepth(): number {
    return this.undoStack.length;
  }

  get redoDepth(): number {
    return this.redoStack.length;
  }

  /**
   * push — records a command as already-applied by the caller (the caller is
   * responsible for computing/holding the new state; this manager only tracks
   * the ability to reverse/replay it). Truncates the redo stack (branching).
   */
  push(command: UndoCommand<T>): void {
    this.undoStack.push(command);
    if (this.undoStack.length > this.maxHistory) {
      // Drop the oldest entry — bounded memory. Entries still reachable via
      // redo are never dropped since they live in a separate stack.
      this.undoStack.shift();
    }
    this.redoStack = [];
    this._generation++;
  }

  /** undo — pops the most recent command, applies its inverse to `state`, returns the new state. */
  undo(state: T): T {
    const cmd = this.undoStack.pop();
    if (!cmd) return state;
    this.redoStack.push(cmd);
    this._generation++;
    return cmd.invert(state);
  }

  /** redo — pops the most recently undone command, re-applies it to `state`, returns the new state. */
  redo(state: T): T {
    const cmd = this.redoStack.pop();
    if (!cmd) return state;
    this.undoStack.push(cmd);
    this._generation++;
    return cmd.apply(state);
  }

  /** Clears both stacks (e.g. on project switch). Does not change `state`. */
  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this._generation++;
  }

  /** Snapshot of stack labels, oldest-first, for debug UI. */
  debugStackLabels(): { undo: string[]; redo: string[] } {
    return {
      undo: this.undoStack.map(c => c.label),
      redo: [...this.redoStack].reverse().map(c => c.label),
    };
  }
}

// ─── Layer-array command builders ────────────────────────────────────────────
//
// These build UndoCommand<DesignLayer[]> objects for the common editor
// mutations. Each `apply` recomputes from the ORIGINAL captured values
// (not from mutable closures) so commands remain safe to redo after being
// undone and to keep in history indefinitely.

function cloneLayer(l: DesignLayer): DesignLayer {
  return JSON.parse(JSON.stringify(l));
}

/** Command: append a new layer at the end of the array. */
export function addLayerCommand(layer: DesignLayer): UndoCommand<DesignLayer[]> {
  const snapshot = cloneLayer(layer);
  return {
    label: `Add layer "${layer.name}"`,
    apply: (layers) => [...layers, cloneLayer(snapshot)],
    invert: (layers) => layers.filter(l => l.id !== snapshot.id),
  };
}

/** Command: remove a layer by id. Captures it so undo can re-insert at its original index. */
export function deleteLayerCommand(layers: DesignLayer[], layerId: string): UndoCommand<DesignLayer[]> {
  const index = layers.findIndex(l => l.id === layerId);
  const removed = index >= 0 ? cloneLayer(layers[index]) : null;
  return {
    label: `Delete layer "${removed?.name ?? layerId}"`,
    apply: (state) => state.filter(l => l.id !== layerId),
    invert: (state) => {
      if (!removed) return state;
      const next = [...state];
      const insertAt = Math.min(index < 0 ? next.length : index, next.length);
      next.splice(insertAt, 0, cloneLayer(removed));
      return next;
    },
  };
}

/** Command: move a layer from one index to another (reorder / drag). */
export function reorderLayerCommand(fromIndex: number, toIndex: number): UndoCommand<DesignLayer[]> {
  const move = (state: DesignLayer[], from: number, to: number): DesignLayer[] => {
    if (from < 0 || from >= state.length || to < 0 || to >= state.length || from === to) return state;
    const next = [...state];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return next;
  };
  return {
    label: `Reorder layer ${fromIndex} → ${toIndex}`,
    apply: (state) => move(state, fromIndex, toIndex),
    invert: (state) => move(state, toIndex, fromIndex),
  };
}

/**
 * Command: change one or more properties on a layer (rename, opacity, visible,
 * locked, blendMode, transform, ...). Captures before/after snapshots of just
 * the touched layer so undo/redo are O(1) merges, not full clones of the array.
 */
export function updateLayerCommand(
  layers: DesignLayer[],
  layerId: string,
  patch: Partial<DesignLayer>,
): UndoCommand<DesignLayer[]> {
  const before = layers.find(l => l.id === layerId);
  const beforeSnapshot = before ? cloneLayer(before) : null;
  const afterSnapshot = before ? cloneLayer({ ...before, ...patch }) : null;
  return {
    label: `Update layer "${before?.name ?? layerId}"`,
    apply: (state) => afterSnapshot
      ? state.map(l => (l.id === layerId ? cloneLayer(afterSnapshot) : l))
      : state,
    invert: (state) => beforeSnapshot
      ? state.map(l => (l.id === layerId ? cloneLayer(beforeSnapshot) : l))
      : state,
  };
}

/** Command: duplicate an existing layer, inserting the copy immediately after it. */
export function duplicateLayerCommand(layers: DesignLayer[], layerId: string, newLayer: DesignLayer): UndoCommand<DesignLayer[]> {
  const index = layers.findIndex(l => l.id === layerId);
  const snapshot = cloneLayer(newLayer);
  return {
    label: `Duplicate layer "${newLayer.name}"`,
    apply: (state) => {
      const next = [...state];
      const insertAt = index >= 0 ? index + 1 : next.length;
      next.splice(insertAt, 0, cloneLayer(snapshot));
      return next;
    },
    invert: (state) => state.filter(l => l.id !== snapshot.id),
  };
}

/** Command: merge one layer down into the one below it, replacing both with `merged`. */
export function mergeLayersCommand(
  layers: DesignLayer[],
  topId: string,
  bottomId: string,
  merged: DesignLayer,
): UndoCommand<DesignLayer[]> {
  const topSnapshot = cloneLayer(layers.find(l => l.id === topId)!);
  const bottomSnapshot = cloneLayer(layers.find(l => l.id === bottomId)!);
  const mergedSnapshot = cloneLayer(merged);
  const bottomIndex = layers.findIndex(l => l.id === bottomId);
  return {
    label: `Merge layers "${topSnapshot.name}" + "${bottomSnapshot.name}"`,
    apply: (state) => {
      const withoutBoth = state.filter(l => l.id !== topId && l.id !== bottomId);
      // Recompute insertion point relative to the filtered array: count how
      // many of the layers BEFORE bottomIndex in the original array survive.
      const survivingBefore = state.slice(0, bottomIndex).filter(l => l.id !== topId && l.id !== bottomId).length;
      const insertAt = Math.min(survivingBefore, withoutBoth.length);
      const next = [...withoutBoth];
      next.splice(insertAt, 0, cloneLayer(mergedSnapshot));
      return next;
    },
    invert: (state) => {
      const mergedIndex = state.findIndex(l => l.id === mergedSnapshot.id);
      const next = state.filter(l => l.id !== mergedSnapshot.id);
      const insertAt = mergedIndex >= 0 ? Math.min(mergedIndex, next.length) : next.length;
      next.splice(insertAt, 0, cloneLayer(topSnapshot), cloneLayer(bottomSnapshot));
      return next;
    },
  };
}
