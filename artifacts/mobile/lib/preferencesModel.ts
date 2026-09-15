/**
 * preferencesModel.ts — Preferences data model + persistence helpers.
 *
 * Covers the sixth "Preferences" Actions tab:
 *   - Brush cursor toggle (show circle at touch point, sized to brush)
 *   - QuickMenu assignments (up to 6 slots; opened via long-press on canvas)
 *   - Pressure curve (draggable control points; maps raw force → effective size)
 *   - Session timer + total time per project (paused on background/unmount)
 *
 * Persisted in project.canvas (as DesignCanvasWithPrefs) so it travels with
 * the project and survives app restart.
 */

// ─── Brush cursor ─────────────────────────────────────────────────────────────

export type BrushCursorMode = 'none' | 'circle' | 'crosshair';

// ─── QuickMenu ────────────────────────────────────────────────────────────────

export type QuickMenuAction =
  | 'undo'  | 'redo'
  | 'brush' | 'eraser' | 'smudge'
  | 'select' | 'transform'
  | 'add_layer' | 'delete_layer' | 'duplicate_layer'
  | 'copy' | 'paste' | 'cut'
  | 'flip_x' | 'flip_y'
  | 'color_picker'
  | 'adjustments'
  | 'none';

export const QUICK_MENU_SLOT_COUNT = 6;

export const QUICK_MENU_DEFAULT_SLOTS: QuickMenuAction[] = [
  'undo', 'redo', 'brush', 'eraser', 'copy', 'paste',
];

export const QUICK_MENU_ALL_ACTIONS: { key: QuickMenuAction; label: string }[] = [
  { key: 'undo',            label: 'Undo' },
  { key: 'redo',            label: 'Redo' },
  { key: 'brush',           label: 'Brush' },
  { key: 'eraser',          label: 'Eraser' },
  { key: 'smudge',          label: 'Smudge' },
  { key: 'select',          label: 'Selection' },
  { key: 'transform',       label: 'Transform' },
  { key: 'add_layer',       label: 'Add Layer' },
  { key: 'delete_layer',    label: 'Delete Layer' },
  { key: 'duplicate_layer', label: 'Duplicate Layer' },
  { key: 'copy',            label: 'Copy' },
  { key: 'paste',           label: 'Paste' },
  { key: 'cut',             label: 'Cut' },
  { key: 'flip_x',          label: 'Flip Horizontal' },
  { key: 'flip_y',          label: 'Flip Vertical' },
  { key: 'color_picker',    label: 'Color Picker' },
  { key: 'adjustments',     label: 'Adjustments' },
  { key: 'none',            label: '(empty)' },
];

// ─── Pressure curve ───────────────────────────────────────────────────────────

/** One control point on the pressure → brush-width curve.  Both axes [0,1]. */
export interface PressurePoint {
  force: number; // raw touch force [0,1]
  size:  number; // effective brush-size multiplier [0,1]
}

/** Default linear pressure curve (no mapping). */
export const DEFAULT_PRESSURE_CURVE: PressurePoint[] = [
  { force: 0, size: 0.2 },
  { force: 1, size: 1.0 },
];

/**
 * samplePressureCurve — evaluates the piecewise-linear pressure curve at a
 * given raw force value.  Returns an effective size multiplier [0,1].
 *
 * On devices without pressure support (force is undefined or 0), we use a
 * deterministic fallback: return the midpoint sample value (maps 0.5 input).
 */
export function samplePressureCurve(
  points: PressurePoint[],
  force: number | undefined,
): number {
  const f = typeof force === 'number' && force > 0 ? force : 0.5;
  const sorted = [...points].sort((a, b) => a.force - b.force);
  if (sorted.length === 0) return f;
  if (f <= sorted[0].force) return sorted[0].size;
  if (f >= sorted[sorted.length - 1].force) return sorted[sorted.length - 1].size;
  for (let i = 0; i < sorted.length - 1; i++) {
    const p0 = sorted[i], p1 = sorted[i + 1];
    if (f >= p0.force && f <= p1.force) {
      const frac = (f - p0.force) / (p1.force - p0.force);
      return p0.size + frac * (p1.size - p0.size);
    }
  }
  return f;
}

// ─── Session timer ────────────────────────────────────────────────────────────

/** Persisted design-time tracking (seconds). */
export interface DesignTimerState {
  /** Total accumulated design time in seconds (persisted across sessions). */
  totalSeconds: number;
  /** Session start timestamp (ms since epoch); null when paused. */
  sessionStartMs: number | null;
  /** Accumulated seconds for the current session so far (before latest resume). */
  sessionAccumSec: number;
}

export function defaultTimerState(): DesignTimerState {
  return { totalSeconds: 0, sessionStartMs: null, sessionAccumSec: 0 };
}

/** Return the current session seconds (running + accumulated). */
export function currentSessionSeconds(state: DesignTimerState): number {
  const extra = state.sessionStartMs !== null
    ? (Date.now() - state.sessionStartMs) / 1000
    : 0;
  return state.sessionAccumSec + extra;
}

/** Start (or resume) the timer. */
export function timerResume(state: DesignTimerState): DesignTimerState {
  if (state.sessionStartMs !== null) return state; // already running
  return { ...state, sessionStartMs: Date.now() };
}

/** Pause the timer and accumulate elapsed time. */
export function timerPause(state: DesignTimerState): DesignTimerState {
  if (state.sessionStartMs === null) return state; // already paused
  const elapsed = (Date.now() - state.sessionStartMs) / 1000;
  return {
    ...state,
    sessionStartMs:   null,
    sessionAccumSec:  state.sessionAccumSec + elapsed,
    totalSeconds:     state.totalSeconds    + elapsed,
  };
}

/** Format seconds as "Xh Ym" or "Ym Zs". */
export function formatDuration(sec: number): string {
  const total = Math.round(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// ─── Top-level Preferences ────────────────────────────────────────────────────

export interface DesignPreferences {
  brushCursor: BrushCursorMode;
  quickMenuSlots: QuickMenuAction[];
  pressureCurve: PressurePoint[];
  timer: DesignTimerState;
}

export function defaultPreferences(): DesignPreferences {
  return {
    brushCursor:    'circle',
    quickMenuSlots: [...QUICK_MENU_DEFAULT_SLOTS],
    pressureCurve:  [...DEFAULT_PRESSURE_CURVE],
    timer:          defaultTimerState(),
  };
}
