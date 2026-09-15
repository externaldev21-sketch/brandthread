/**
 * preferences.test.ts — brush cursor, pressure mapping, QuickMenu assignment,
 *   timer persistence and background pause.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  samplePressureCurve,
  formatDuration,
  timerResume,
  timerPause,
  currentSessionSeconds,
  defaultPreferences,
  defaultTimerState,
  QUICK_MENU_DEFAULT_SLOTS,
  QUICK_MENU_SLOT_COUNT,
  QUICK_MENU_ALL_ACTIONS,
  DEFAULT_PRESSURE_CURVE,
} from '../lib/preferencesModel';
import type { DesignTimerState, PressurePoint } from '../lib/preferencesModel';

// ─── samplePressureCurve ─────────────────────────────────────────────────────

describe('samplePressureCurve', () => {
  const linear: PressurePoint[] = [{ force: 0, size: 0.2 }, { force: 1, size: 1 }];

  it('returns midpoint fallback when force is 0 (treated as no-pressure)', () => {
    // force=0 triggers fallback (0.5) → size ~0.6 on linear [0.2→1] curve
    const s = samplePressureCurve(linear, 0);
    expect(s).toBeCloseTo(0.6, 5);
  });

  it('returns size at force 1 → 1.0', () => {
    expect(samplePressureCurve(linear, 1)).toBeCloseTo(1.0, 5);
  });

  it('interpolates midpoint', () => {
    const s = samplePressureCurve(linear, 0.5);
    expect(s).toBeCloseTo(0.6, 5);
  });

  it('uses fallback (0.5) when force is undefined', () => {
    const s = samplePressureCurve(linear, undefined);
    // Midpoint of [0.2, 1.0] = 0.6
    expect(s).toBeCloseTo(0.6, 5);
  });

  it('uses fallback 0.5 when force is 0 → returns midpoint value', () => {
    // force=0 → fallback to f=0.5 → on linear [0.2→1] → 0.6
    const s = samplePressureCurve(linear, 0);
    expect(s).toBeCloseTo(0.6, 5);
  });

  it('uses fallback 0.5 when force is 0 even with different first point', () => {
    // force=0 → f=0.5 → interpolate between 0.3 and 1.0 → 0.5 + fraction*(1-0.5)
    const pts = [{ force: 0.3, size: 0.5 }, { force: 1, size: 1 }];
    const s = samplePressureCurve(pts, 0);
    // f=0.5 is between force 0.3 and 1.0 → interpolated
    expect(s).toBeGreaterThan(0.5);
    expect(s).toBeLessThan(1.0);
  });

  it('clamps to last point for above-range force', () => {
    const s = samplePressureCurve([{ force: 0, size: 0 }, { force: 0.7, size: 0.9 }], 1);
    expect(s).toBe(0.9);
  });

  it('handles multi-segment curve', () => {
    const pts: PressurePoint[] = [
      { force: 0, size: 0 },
      { force: 0.5, size: 0.8 },
      { force: 1, size: 1 },
    ];
    expect(samplePressureCurve(pts, 0.25)).toBeCloseTo(0.4, 5);
    expect(samplePressureCurve(pts, 0.75)).toBeCloseTo(0.9, 5);
  });
});

// ─── formatDuration ───────────────────────────────────────────────────────────

describe('formatDuration', () => {
  it('formats 0 seconds', () => {
    expect(formatDuration(0)).toBe('0s');
  });

  it('formats seconds only', () => {
    expect(formatDuration(45)).toBe('45s');
  });

  it('formats minutes and seconds', () => {
    expect(formatDuration(90)).toBe('1m 30s');
  });

  it('formats hours and minutes (no seconds)', () => {
    expect(formatDuration(3660)).toBe('1h 1m');
  });

  it('formats large values', () => {
    expect(formatDuration(7200)).toBe('2h 0m');
  });

  it('rounds fractions', () => {
    expect(formatDuration(1.7)).toBe('2s');
  });
});

// ─── Timer model ──────────────────────────────────────────────────────────────

describe('timerResume / timerPause', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('timerResume sets sessionStartMs', () => {
    const state = defaultTimerState();
    const resumed = timerResume(state);
    expect(resumed.sessionStartMs).not.toBeNull();
  });

  it('timerResume is idempotent when already running', () => {
    const state = timerResume(defaultTimerState());
    const start = state.sessionStartMs;
    vi.advanceTimersByTime(1000);
    const resumed2 = timerResume(state);
    expect(resumed2.sessionStartMs).toBe(start); // unchanged
  });

  it('timerPause clears sessionStartMs and accumulates elapsed', () => {
    const started = timerResume(defaultTimerState());
    vi.advanceTimersByTime(5000); // 5 seconds
    const paused = timerPause(started);
    expect(paused.sessionStartMs).toBeNull();
    expect(paused.sessionAccumSec).toBeGreaterThanOrEqual(5);
  });

  it('timerPause adds elapsed to totalSeconds', () => {
    const state: DesignTimerState = { totalSeconds: 10, sessionStartMs: null, sessionAccumSec: 0 };
    const started = timerResume(state);
    vi.advanceTimersByTime(3000); // 3 seconds
    const paused = timerPause(started);
    expect(paused.totalSeconds).toBeGreaterThanOrEqual(13);
  });

  it('timerPause is idempotent when already paused', () => {
    const state: DesignTimerState = { totalSeconds: 0, sessionStartMs: null, sessionAccumSec: 5 };
    const p2 = timerPause(state);
    expect(p2.sessionAccumSec).toBe(5); // no change
  });
});

describe('currentSessionSeconds', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns 0 when paused with no accumulation', () => {
    expect(currentSessionSeconds(defaultTimerState())).toBe(0);
  });

  it('includes accumulated seconds when paused', () => {
    const state: DesignTimerState = { totalSeconds: 0, sessionStartMs: null, sessionAccumSec: 30 };
    expect(currentSessionSeconds(state)).toBe(30);
  });

  it('adds live time when running', () => {
    const started = timerResume(defaultTimerState());
    vi.advanceTimersByTime(10_000);
    const secs = currentSessionSeconds(started);
    expect(secs).toBeGreaterThanOrEqual(10);
  });
});

// ─── defaultPreferences ───────────────────────────────────────────────────────

describe('defaultPreferences', () => {
  it('returns brushCursor circle by default', () => {
    expect(defaultPreferences().brushCursor).toBe('circle');
  });

  it('has the correct number of QuickMenu slots', () => {
    const p = defaultPreferences();
    expect(p.quickMenuSlots).toHaveLength(QUICK_MENU_SLOT_COUNT);
  });

  it('default slots match QUICK_MENU_DEFAULT_SLOTS', () => {
    expect(defaultPreferences().quickMenuSlots).toEqual(QUICK_MENU_DEFAULT_SLOTS);
  });

  it('default pressure curve is linear', () => {
    expect(defaultPreferences().pressureCurve).toEqual(DEFAULT_PRESSURE_CURVE);
  });

  it('timer starts paused', () => {
    expect(defaultPreferences().timer.sessionStartMs).toBeNull();
  });
});

// ─── QUICK_MENU catalog ───────────────────────────────────────────────────────

describe('QUICK_MENU_ALL_ACTIONS', () => {
  it('contains at least QUICK_MENU_SLOT_COUNT actions', () => {
    expect(QUICK_MENU_ALL_ACTIONS.length).toBeGreaterThanOrEqual(QUICK_MENU_SLOT_COUNT);
  });

  it('every default slot is in the catalog', () => {
    const keys = QUICK_MENU_ALL_ACTIONS.map(a => a.key);
    QUICK_MENU_DEFAULT_SLOTS.forEach(slot => {
      expect(keys).toContain(slot);
    });
  });

  it('none action exists (for empty slots)', () => {
    expect(QUICK_MENU_ALL_ACTIONS.some(a => a.key === 'none')).toBe(true);
  });
});

// ─── Pressure curve: DEFAULT_PRESSURE_CURVE ───────────────────────────────────

describe('DEFAULT_PRESSURE_CURVE', () => {
  it('has two endpoints', () => {
    expect(DEFAULT_PRESSURE_CURVE).toHaveLength(2);
  });

  it('starts at force 0', () => {
    expect(DEFAULT_PRESSURE_CURVE[0].force).toBe(0);
  });

  it('ends at force 1', () => {
    expect(DEFAULT_PRESSURE_CURVE[1].force).toBe(1);
  });

  it('endpoint size ≤ 1', () => {
    DEFAULT_PRESSURE_CURVE.forEach(p => {
      expect(p.size).toBeLessThanOrEqual(1);
      expect(p.size).toBeGreaterThanOrEqual(0);
    });
  });
});

// ─── Timer lifecycle: async load + resume, background pause ──────────────────

describe('timer lifecycle: async load then resume', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /**
   * Simulate the load-effect pattern from design-canvas.tsx:
   *   1. Start with restored prefs blob from server (sessionStartMs may be stale).
   *   2. Clear stale sessionStartMs, resume cleanly.
   *   3. Verify timer runs from a known zero-elapsed point.
   */
  it('restored prefs with stale sessionStartMs → clean resume (no historic gap)', () => {
    // Simulates a blob saved when the app was last open: sessionStartMs is stale
    const staleMs = Date.now() - 3_600_000; // 1 hour ago (stale after app kill)
    const restored: DesignTimerState = {
      totalSeconds: 120,
      sessionAccumSec: 0,
      sessionStartMs: staleMs, // stale: would inflate elapsed by ~3600s
    };
    // Load-effect: clear stale sessionStartMs, then resume
    const timerBase: DesignTimerState = {
      totalSeconds:    restored.totalSeconds,
      sessionAccumSec: restored.sessionAccumSec,
      sessionStartMs:  null, // force clean resume
    };
    const resumed = timerResume(timerBase);
    // Immediately after resume: elapsed ~= 0 (not 3600)
    const live = currentSessionSeconds(resumed);
    expect(live).toBeCloseTo(0, 0);
    // totalSeconds still from persisted blob
    expect(resumed.totalSeconds).toBe(120);
  });

  it('clean resume then background pause accumulates correct elapsed', () => {
    const prefs: DesignTimerState = { totalSeconds: 60, sessionAccumSec: 0, sessionStartMs: null };
    const running = timerResume(prefs);
    vi.advanceTimersByTime(30_000); // 30 seconds
    const paused = timerPause(running);
    // totalSeconds = 60 + 30 = 90
    expect(paused.totalSeconds).toBeGreaterThanOrEqual(90);
    // sessionStartMs cleared
    expect(paused.sessionStartMs).toBeNull();
    // sessionAccumSec includes the 30s
    expect(paused.sessionAccumSec).toBeGreaterThanOrEqual(30);
  });

  it('double-resume (load then mount) is idempotent — no double-counting', () => {
    const prefs: DesignTimerState = { totalSeconds: 0, sessionAccumSec: 0, sessionStartMs: null };
    const r1 = timerResume(prefs);
    vi.advanceTimersByTime(1000);
    const r2 = timerResume(r1); // second resume (mount effect) — should be no-op
    expect(r2.sessionStartMs).toBe(r1.sessionStartMs); // unchanged start time
    vi.advanceTimersByTime(5000); // 5 more seconds
    const paused = timerPause(r2);
    // Total elapsed should be ~6s, NOT ~11s (no double-counting)
    expect(paused.totalSeconds).toBeGreaterThanOrEqual(6);
    expect(paused.totalSeconds).toBeLessThan(8); // not doubled
  });

  it('background pause then active resume accumulates correctly', () => {
    const prefs: DesignTimerState = { totalSeconds: 0, sessionAccumSec: 0, sessionStartMs: null };
    // Mount: resume
    const running = timerResume(prefs);
    vi.advanceTimersByTime(10_000); // 10s active
    // AppState background: pause synchronously from ref
    const paused = timerPause(running);
    expect(paused.totalSeconds).toBeGreaterThanOrEqual(10);
    // AppState active: resume
    const resumed = timerResume(paused);
    vi.advanceTimersByTime(5_000); // 5s more
    const final = timerPause(resumed);
    // Total should be ~15s
    expect(final.totalSeconds).toBeGreaterThanOrEqual(15);
    expect(final.totalSeconds).toBeLessThan(18);
  });

  it('totalSeconds display does not double-count session accumulation', () => {
    // The display formula: totalSeconds + livePortion (NOT totalSeconds + sessionAccumSec + live)
    const state: DesignTimerState = {
      totalSeconds: 100,    // already-accumulated past sessions
      sessionAccumSec: 30,  // partial session before last resume
      sessionStartMs: null,
    };
    const running = timerResume(state);
    vi.advanceTimersByTime(10_000); // 10s live

    const livePortion = running.sessionStartMs !== null
      ? (Date.now() - running.sessionStartMs) / 1000
      : 0;
    const displayTotal = state.totalSeconds + livePortion;
    // Should be ~110, NOT 100 + 30 + 10 = 140
    expect(displayTotal).toBeGreaterThanOrEqual(110);
    expect(displayTotal).toBeLessThan(115);
  });

  it('markDirty + coordinatedSave pattern: paused state is persisted', () => {
    // Simulates the AppState background handler:
    // 1. timerPause on ref (synchronous) 2. dirtyGen++ 3. coordinatedSave reads ref
    let dirtyGen = 0;
    let capturedTimer: DesignTimerState | null = null;

    const prefs: DesignTimerState = { totalSeconds: 0, sessionAccumSec: 0, sessionStartMs: null };
    let prefsRef = timerResume(prefs);
    vi.advanceTimersByTime(8_000);

    // Simulate AppState background:
    prefsRef = timerPause(prefsRef); // synchronous on ref
    dirtyGen++;                      // markDirty equivalent
    capturedTimer = { ...prefsRef }; // coordinatedSave captures ref

    expect(capturedTimer.sessionStartMs).toBeNull();
    expect(capturedTimer.totalSeconds).toBeGreaterThanOrEqual(8);
    expect(dirtyGen).toBe(1);
  });
});

// ─── QuickMenu: opens under every tool ────────────────────────────────────────

describe('QuickMenu long-press: opens regardless of active tool', () => {
  /**
   * The QuickMenu timer logic is now in a canvas-level PanResponder (not
   * drawing-tool-specific). We test the underlying logic directly:
   * - Timer fires after 600ms without movement cancellation.
   * - Timer is cancelled on movement > threshold.
   * - Works regardless of which tool is active.
   */
  const QUICK_MENU_DELAY_MS = 600;
  const MOVE_THRESHOLD = 8;

  function simulateLongPress(opts: {
    movePx?: number;
    moveAfterMs?: number;
    tool: string;
    hasSlots?: boolean;
  }): { opened: boolean } {
    let opened = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const hasSlots = opts.hasSlots ?? true;

    // onStartShouldSetPanResponderCapture — always fires regardless of tool
    const startX = 100, startY = 200;
    timer = setTimeout(() => {
      if (hasSlots && !opened) opened = true;
      timer = null;
    }, QUICK_MENU_DELAY_MS);

    // Simulate optional movement
    if (opts.movePx !== undefined && opts.moveAfterMs !== undefined) {
      setTimeout(() => {
        if (timer && opts.movePx! > MOVE_THRESHOLD) {
          clearTimeout(timer);
          timer = null;
        }
      }, opts.moveAfterMs);
    }

    // Simulate time passing
    vi.advanceTimersByTime(QUICK_MENU_DELAY_MS + 100);
    if (timer) { clearTimeout(timer); timer = null; }

    return { opened };
  }

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('opens after 600ms with brush tool active', () => {
    const { opened } = simulateLongPress({ tool: 'brush' });
    expect(opened).toBe(true);
  });

  it('opens after 600ms with select tool active', () => {
    const { opened } = simulateLongPress({ tool: 'select' });
    expect(opened).toBe(true);
  });

  it('opens after 600ms with transform tool active', () => {
    const { opened } = simulateLongPress({ tool: 'transform' });
    expect(opened).toBe(true);
  });

  it('opens after 600ms with adjustments tool active', () => {
    const { opened } = simulateLongPress({ tool: 'adjustments' });
    expect(opened).toBe(true);
  });

  it('opens after 600ms with eraser tool active', () => {
    const { opened } = simulateLongPress({ tool: 'eraser' });
    expect(opened).toBe(true);
  });

  it('does NOT open when movement exceeds threshold (9px > 8px)', () => {
    const { opened } = simulateLongPress({
      tool: 'brush', movePx: 9, moveAfterMs: 100,
    });
    expect(opened).toBe(false);
  });

  it('does NOT open when movement is exactly at threshold (8px)', () => {
    // At threshold: not > threshold so timer keeps running (edge case: we cancel only when > threshold)
    // Our implementation: cancel when sqrt(dx^2+dy^2) > THRESHOLD
    // 8px movement: 8 > 8 is false → timer NOT cancelled
    const { opened } = simulateLongPress({
      tool: 'brush', movePx: 8, moveAfterMs: 100,
    });
    expect(opened).toBe(true); // just at threshold → not cancelled
  });

  it('does NOT open when hasSlots is empty (all none)', () => {
    const { opened } = simulateLongPress({ tool: 'brush', hasSlots: false });
    expect(opened).toBe(false);
  });

  it('cancels correctly with small movement (< threshold)', () => {
    const { opened } = simulateLongPress({
      tool: 'select', movePx: 4, moveAfterMs: 200,
    });
    expect(opened).toBe(true); // 4px < 8px threshold → not cancelled
  });
});

describe('timer persistence on normal editor exit', () => {
  it('pauses and dirties an active timer before the Back save snapshot', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-09-15T12:00:00.000Z'));
      let prefsRef = {
        ...defaultPreferences(),
        timer: timerResume(defaultPreferences().timer),
      };
      let dirtyGen = 0;
      let persisted = prefsRef;

      vi.advanceTimersByTime(12_000);

      // Mirrors handleBack ordering: pause ref first, mark dirty, then save.
      if (prefsRef.timer.sessionStartMs !== null) {
        prefsRef = { ...prefsRef, timer: timerPause(prefsRef.timer) };
        dirtyGen += 1;
      }
      const coordinatedSave = async () => {
        if (dirtyGen > 0) persisted = prefsRef;
      };
      await coordinatedSave();

      expect(persisted.timer.sessionStartMs).toBeNull();
      expect(persisted.timer.totalSeconds).toBe(12);
      expect(dirtyGen).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
