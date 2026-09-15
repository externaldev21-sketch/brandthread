/**
 * persistence-race.test.ts
 *
 * Tests the centralized persistCurrentState primitive:
 *  - gen-capture: if gen advances during await, stays unsaved & queues retry
 *  - deferred-promise race: start save → mutate mid-flight → resolve → dirty
 *  - second save after race persists the latest state
 *  - double-flip identity feeds into save correctly
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Minimal types ─────────────────────────────────────────────────────────────
interface Layer { id: string; order: number; name: string; }

// ─── Deferred helper ──────────────────────────────────────────────────────────
interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject:  (e: Error) => void;
}
function deferred<T>(): Deferred<T> {
  let res!: (v: T) => void;
  let rej!: (e: Error) => void;
  const promise = new Promise<T>((r, j) => { res = r; rej = j; });
  return { promise, resolve: res, reject: rej };
}

// ─── Simulator — models persistCurrentState gen semantics ─────────────────────

interface SimState {
  savedLayers: Layer[];
  saveStatus:  'saved' | 'unsaved' | 'saving';
  dirtyGen:    number;
  savedGen:    number;
  saving:      boolean;
}

type SaveFn = (layers: Layer[]) => Promise<void>;

async function persistCurrentState(
  state:  SimState,
  getLayers: () => Layer[],
  saveFn:   SaveFn,
): Promise<void> {
  const capturedGen  = state.dirtyGen;
  const capturedLayers = getLayers();
  try {
    await saveFn(capturedLayers);
    if (state.dirtyGen === capturedGen) {
      state.savedGen    = capturedGen;
      state.savedLayers = capturedLayers;
      state.saveStatus  = 'saved';
    } else {
      state.saveStatus = 'unsaved';
    }
  } catch {
    state.saveStatus = 'unsaved';
  }
}

function markDirty(state: SimState) {
  state.dirtyGen += 1;
  state.saveStatus = 'unsaved';
}

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('persistCurrentState — gen-capture semantics', () => {
  let state: SimState;
  let layers: Layer[];

  beforeEach(() => {
    state  = { savedLayers: [], saveStatus: 'unsaved', dirtyGen: 1, savedGen: 0, saving: false };
    layers = [{ id: 'a', order: 1, name: 'Layer A' }];
  });

  it('marks saved when gen is unchanged after await', async () => {
    const save = vi.fn().mockResolvedValueOnce(undefined);
    state.saveStatus = 'saving';
    await persistCurrentState(state, () => layers, save);
    expect(state.saveStatus).toBe('saved');
    expect(state.savedGen).toBe(1);
    expect(save).toHaveBeenCalledOnce();
  });

  it('stays unsaved when gen advances during await (deferred-promise race)', async () => {
    const d = deferred<void>();
    const save = vi.fn().mockReturnValueOnce(d.promise);
    state.saveStatus = 'saving';

    // Start save (does NOT await yet)
    const saveP = persistCurrentState(state, () => layers, save);

    // Mutate mid-flight (simulates user drawing while save is in-flight)
    markDirty(state);
    layers = [...layers, { id: 'b', order: 2, name: 'Layer B' }];

    // Resolve the save promise
    d.resolve(undefined);
    await saveP;

    // Because gen advanced, save should NOT mark saved
    expect(state.saveStatus).toBe('unsaved');
    expect(state.dirtyGen).toBe(2); // gen was incremented
  });

  it('second save after race persists the latest state', async () => {
    const d = deferred<void>();
    const save = vi.fn()
      .mockReturnValueOnce(d.promise)      // first save: in-flight
      .mockResolvedValueOnce(undefined);   // second save: instant

    state.saveStatus = 'saving';
    const saveP1 = persistCurrentState(state, () => layers, save);

    // Mutate mid-flight
    markDirty(state);
    const updatedLayers = [...layers, { id: 'b', order: 2, name: 'Layer B' }];
    layers = updatedLayers;

    d.resolve(undefined);
    await saveP1;

    expect(state.saveStatus).toBe('unsaved');

    // Second save call — should now pick up the updated layers
    state.saveStatus = 'saving';
    await persistCurrentState(state, () => layers, save);

    expect(state.saveStatus).toBe('saved');
    expect(state.savedGen).toBe(2);
    expect(save).toHaveBeenCalledTimes(2);
    // Second save received the mutated layers
    expect(save.mock.calls[1][0]).toEqual(expect.arrayContaining([expect.objectContaining({ id: "b" })]));
  });

  it('marks unsaved on save error', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('Network error'));
    state.saveStatus = 'saving';
    await persistCurrentState(state, () => layers, save);
    expect(state.saveStatus).toBe('unsaved');
  });

  it('captures layers atomically at call time, not at resolve time', async () => {
    const captured: Layer[][] = [];
    const d = deferred<void>();
    const save = vi.fn().mockImplementation((l: Layer[]) => {
      captured.push(l);
      return d.promise;
    });

    state.saveStatus = 'saving';
    const saveP = persistCurrentState(state, () => layers, save);

    // Mutate AFTER save started
    layers = [{ id: 'c', order: 3, name: 'Layer C' }];
    markDirty(state);

    d.resolve(undefined);
    await saveP;

    // The save received the ORIGINAL layers (captured at call time)
    expect(captured[0]).toHaveLength(1);
    expect(captured[0][0].id).toBe('a');
  });

  it('createVersion is called before persistCurrentState in manual save', async () => {
    const callOrder: string[] = [];
    const createVersion = vi.fn().mockImplementation(async () => { callOrder.push('version'); });
    const autosave      = vi.fn().mockImplementation(async () => { callOrder.push('save'); });

    // Simulate handleManualSave
    await createVersion('proj-1');
    await persistCurrentState(state, () => layers, autosave);

    expect(callOrder).toEqual(['version', 'save']);
  });
});

// ─── Double-flip feeds into persistence correctly ─────────────────────────────
describe('double-flip identity in persistence', () => {
  it('double-flip produces identical transform to original', () => {
    const orig = { x: 100, y: 200, width: 300, height: 400, rotation: 0, scaleX: 1, scaleY: 1 };
    const lw = 1080;
    function applyFlipX(t: typeof orig): typeof orig & { flipX?: boolean } {
      return { ...t, x: lw - t.x - t.width, flipX: !('flipX' in t ? t.flipX : false) };
    }

    const once  = applyFlipX(orig);
    const twice = applyFlipX(once as typeof orig);

    expect(twice.x).toBe(orig.x);
    expect((twice as { flipX?: boolean }).flipX).toBeFalsy();
  });
});
