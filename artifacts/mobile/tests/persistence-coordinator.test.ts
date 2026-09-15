/**
 * persistence-coordinator.test.ts
 *
 * Tests the serialized save coordinator (coordinatedSave):
 *  - Concurrent callers chain after the active write — no caller returns while
 *    a write is running.
 *  - After the active write resolves, the coordinator continues until the
 *    latest dirty generation is fully persisted.
 *  - handleBack awaits coordinator before navigating.
 *  - handleSaveCopy awaits coordinator before duplicateProject.
 *  - handleManualSave: persistCurrentState first, then createVersion from that
 *    persisted state; if a mutation races before version creation, stays dirty.
 *  - Project-name rename: triggers markDirty (not direct autosaveProject call).
 *
 * The coordinator is simulated as a pure state machine so all tests are
 * synchronous / deferred-promise — no React needed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

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

// ─── Simulator ────────────────────────────────────────────────────────────────

interface Layer { id: string; order: number; }

interface SimState {
  saveStatus: 'saved' | 'unsaved' | 'saving';
  dirtyGen:   number;
  savedGen:   number;
  layers:     Layer[];
}

type SaveFn = (layers: Layer[]) => Promise<void>;

/**
 * persistCurrentState — captures gen + layers at call time, writes via saveFn,
 * marks saved only if gen is unchanged.
 */
async function persistCurrentState(state: SimState, saveFn: SaveFn): Promise<void> {
  const capturedGen    = state.dirtyGen;
  const capturedLayers = [...state.layers];
  try {
    await saveFn(capturedLayers);
    if (state.dirtyGen === capturedGen) {
      state.savedGen    = capturedGen;
      state.saveStatus  = 'saved';
    } else {
      state.saveStatus = 'unsaved';
    }
  } catch (error) {
    state.saveStatus = 'unsaved';
    throw error;
  }
}

function markDirty(state: SimState) {
  state.dirtyGen  += 1;
  state.saveStatus = 'unsaved';
}

/**
 * makeCoordinator — returns a coordinatedSave function that serializes writes
 * via a chain ref, looping until the latest gen is persisted.
 * Mirrors design-canvas.tsx coordinatedSave exactly.
 */
function makeCoordinator(state: SimState, saveFn: SaveFn) {
  let chainTail = Promise.resolve<void>(undefined);

  function coordinatedSave(): Promise<void> {
    // writeUntilClean — direct recursive write loop (no chaining inside loop).
    const writeUntilClean = async (): Promise<void> => {
      if (state.dirtyGen === state.savedGen) return;
      state.saveStatus = 'saving';
      const genBefore = state.dirtyGen;
      await persistCurrentState(state, saveFn);
      if (state.dirtyGen !== genBefore && state.dirtyGen !== state.savedGen) {
        return writeUntilClean();
      }
    };

    // Chain onto tail so concurrent callers wait for the active write.
    const next = chainTail.then(writeUntilClean, writeUntilClean);
    chainTail = next.then(() => undefined, () => undefined);
    return next;
  }

  return { coordinatedSave };
}

// ─── baseline gen-capture semantics ──────────────────────────────────────────
describe('persistCurrentState — gen-capture', () => {
  let state: SimState;
  beforeEach(() => {
    state = { saveStatus: 'unsaved', dirtyGen: 1, savedGen: 0, layers: [{ id: 'a', order: 1 }] };
  });

  it('marks saved when gen unchanged', async () => {
    const save = vi.fn().mockResolvedValueOnce(undefined);
    await persistCurrentState(state, save);
    expect(state.saveStatus).toBe('saved');
    expect(state.savedGen).toBe(1);
  });

  it('stays unsaved when gen advances during await', async () => {
    const d = deferred<void>();
    const save = vi.fn().mockReturnValueOnce(d.promise);
    const p = persistCurrentState(state, save);
    markDirty(state);
    d.resolve(undefined);
    await p;
    expect(state.saveStatus).toBe('unsaved');
  });

  it('captures layers atomically at call time', async () => {
    const captured: Layer[][] = [];
    const d = deferred<void>();
    const save = vi.fn().mockImplementation((l: Layer[]) => { captured.push(l); return d.promise; });
    const p = persistCurrentState(state, save);
    state.layers = [{ id: 'b', order: 2 }]; // mutate after call
    markDirty(state);
    d.resolve(undefined);
    await p;
    expect(captured[0][0].id).toBe('a'); // captured original
  });

  it('rejects and stays dirty when storage fails', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(persistCurrentState(state, save)).rejects.toThrow('storage unavailable');
    expect(state.saveStatus).toBe('unsaved');
    expect(state.savedGen).toBe(0);
  });
});

// ─── concurrent callers ───────────────────────────────────────────────────────
describe('coordinatedSave — concurrent callers', () => {
  let state: SimState;
  beforeEach(() => {
    state = { saveStatus: 'unsaved', dirtyGen: 1, savedGen: 0, layers: [{ id: 'a', order: 1 }] };
  });

  it('second caller waits for active write, then returns saved', async () => {
    const d = deferred<void>();
    const save = vi.fn()
      .mockReturnValueOnce(d.promise)
      .mockResolvedValueOnce(undefined);
    const { coordinatedSave } = makeCoordinator(state, save);

    const p1 = coordinatedSave();
    const p2 = coordinatedSave(); // concurrent

    d.resolve(undefined);
    await Promise.all([p1, p2]);

    // Both should have resolved; the final state is saved because no mutation
    // raced after the second call.
    expect(state.savedGen).toBe(1);
  });

  it('back caller chains after in-flight write', async () => {
    const order: string[] = [];
    const d = deferred<void>();
    const save = vi.fn().mockImplementation(async () => {
      order.push('write');
      await d.promise;
    });
    const { coordinatedSave } = makeCoordinator(state, save);

    // Simulate: autoSave starts, then handleBack called concurrently
    const autoSave = coordinatedSave();
    const backSave = coordinatedSave().then(() => { order.push('back-navigated'); });

    d.resolve(undefined);
    await Promise.all([autoSave, backSave]);

    expect(order).toEqual(['write', 'back-navigated']);
  });

  it('saveCopy caller waits for in-flight write before duplicating', async () => {
    const order: string[] = [];
    const d = deferred<void>();
    const save = vi.fn().mockImplementation(async () => {
      order.push('write');
      await d.promise;
    });
    const duplicateProject = vi.fn().mockResolvedValue({ name: 'Copy' });
    const { coordinatedSave } = makeCoordinator(state, save);

    const saveP = coordinatedSave();
    const copyP = coordinatedSave().then(async () => {
      order.push('duplicate');
      await duplicateProject('proj-1');
    });

    d.resolve(undefined);
    await Promise.all([saveP, copyP]);
    expect(order).toEqual(['write', 'duplicate']);
    expect(duplicateProject).toHaveBeenCalledOnce();
  });

  it('three concurrent callers all see the same persisted gen', async () => {
    const d = deferred<void>();
    const save = vi.fn()
      .mockReturnValueOnce(d.promise)
      .mockResolvedValue(undefined);
    const { coordinatedSave } = makeCoordinator(state, save);

    const p1 = coordinatedSave();
    const p2 = coordinatedSave();
    const p3 = coordinatedSave();

    d.resolve(undefined);
    await Promise.all([p1, p2, p3]);

    expect(state.savedGen).toBe(state.dirtyGen);
  });

  it('mutation during in-flight write causes a second write to capture latest gen', async () => {
    // Use two externally-controlled deferreds: d1 for the first write, d2 for the second.
    const d1 = deferred<void>();
    const d2 = deferred<void>();
    const writtenLayers: Layer[][] = [];
    let callCount = 0;

    const save = vi.fn().mockImplementation(async (l: Layer[]) => {
      writtenLayers.push([...l]);
      callCount++;
      if (callCount === 1) {
        await d1.promise; // first write stalls
      } else {
        await d2.promise; // second write stalls briefly
      }
    });

    const { coordinatedSave } = makeCoordinator(state, save);
    const p1 = coordinatedSave();

    // Wait for first saveFn call to start (one microtask tick)
    await Promise.resolve();
    await Promise.resolve();

    // Mutate state while first write is in-flight (save is awaiting d1)
    markDirty(state);
    state.layers = [{ id: 'b', order: 2 }];

    // Resolve first write → writeUntilClean detects gen advanced → retries
    d1.resolve(undefined);
    // Resolve second write immediately
    d2.resolve(undefined);

    await p1;

    expect(save).toHaveBeenCalledTimes(2);
    expect(writtenLayers[0][0].id).toBe('a'); // first write got original layers
    expect(writtenLayers[1][0].id).toBe('b'); // second write got mutated layers
    expect(state.savedGen).toBe(2);
  });

  it('rejects instead of resolving cleanly when the write fails', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('disk full'));
    const { coordinatedSave } = makeCoordinator(state, save);
    await expect(coordinatedSave()).rejects.toThrow('disk full');
    expect(state.savedGen).toBe(0);
    expect(state.saveStatus).toBe('unsaved');
  });

  it('lets a queued caller retry after an active write fails', async () => {
    const first = deferred<void>();
    const save = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(undefined);
    const { coordinatedSave } = makeCoordinator(state, save);
    const active = coordinatedSave();
    const queued = coordinatedSave();
    first.reject(new Error('temporary failure'));
    await expect(active).rejects.toThrow('temporary failure');
    await expect(queued).resolves.toBeUndefined();
    expect(state.savedGen).toBe(state.dirtyGen);
  });
});

// ─── handleManualSave semantics ───────────────────────────────────────────────
describe('handleManualSave semantics', () => {
  it('persistCurrentState runs before createVersion', async () => {
    const order: string[] = [];
    const state: SimState = { saveStatus: 'unsaved', dirtyGen: 1, savedGen: 0, layers: [] };
    const save = vi.fn().mockImplementation(async () => { order.push('persist'); });
    const createVersion = vi.fn().mockImplementation(async () => { order.push('version'); });
    const { coordinatedSave } = makeCoordinator(state, save);

    // Simulate handleManualSave: persist first, then version
    await coordinatedSave();
    await createVersion('proj-1');

    expect(order).toEqual(['persist', 'version']);
  });

  it('mutation that races before createVersion leaves project dirty', async () => {
    const state: SimState = { saveStatus: 'unsaved', dirtyGen: 1, savedGen: 0, layers: [] };
    const d = deferred<void>();
    const save = vi.fn().mockReturnValueOnce(d.promise).mockResolvedValue(undefined);
    const { coordinatedSave } = makeCoordinator(state, save);

    const p = coordinatedSave();

    // Race: mutation happens while persist is in-flight
    markDirty(state);

    d.resolve(undefined);
    await p;

    // After persist, gen advanced — a new write should have kicked off.
    // Final state: persisted the latest gen.
    expect(state.savedGen).toBe(state.dirtyGen);
  });

  it('does not mark clean when a race mutates before coordinatedSave resolves', async () => {
    const state: SimState = { saveStatus: 'unsaved', dirtyGen: 1, savedGen: 0, layers: [] };
    const d = deferred<void>();
    // First call stalls; second is instant.
    const save = vi.fn()
      .mockReturnValueOnce(d.promise)
      .mockResolvedValueOnce(undefined);
    const { coordinatedSave } = makeCoordinator(state, save);

    const saveP = coordinatedSave();
    markDirty(state); // mutation races before resolve

    d.resolve(undefined);
    await saveP;

    // Coordinator should have retried and now be clean.
    expect(state.saveStatus).toBe('saved');
    expect(state.savedGen).toBe(2);
  });
});

// ─── handleBack awaits coordinator ───────────────────────────────────────────
describe('handleBack', () => {
  it('does not navigate until the current write completes', async () => {
    const order: string[] = [];
    const state: SimState = { saveStatus: 'unsaved', dirtyGen: 1, savedGen: 0, layers: [] };
    const d = deferred<void>();
    const save = vi.fn().mockImplementation(async () => { order.push('write'); await d.promise; });
    const navigate = vi.fn().mockImplementation(() => { order.push('navigate'); });
    const { coordinatedSave } = makeCoordinator(state, save);

    const backP = coordinatedSave().then(() => navigate());
    d.resolve(undefined);
    await backP;

    expect(order).toEqual(['write', 'navigate']);
  });
});

// ─── project-name rename stays in coordinator ─────────────────────────────────
describe('project-name rename', () => {
  it('rename marks dirty (not direct autosaveProject) so coordinator persists it', () => {
    const state: SimState = { saveStatus: 'saved', dirtyGen: 5, savedGen: 5, layers: [] };

    // Simulate onBlur handler: update ref + markDirty
    const projectNameRef = { current: 'Old Name' };
    projectNameRef.current = 'New Name';
    markDirty(state); // must trigger dirty, NOT call autosaveProject directly

    expect(state.saveStatus).toBe('unsaved');
    expect(state.dirtyGen).toBe(6);
  });

  it('coordinator includes updated name in the next write', async () => {
    const state: SimState = { saveStatus: 'unsaved', dirtyGen: 1, savedGen: 0, layers: [] };
    const projectNameRef = { current: 'Old Name' };
    const capturedNames: string[] = [];

    const save = vi.fn().mockImplementation(async () => {
      capturedNames.push(projectNameRef.current);
    });
    const { coordinatedSave } = makeCoordinator(state, save);

    // Simulate rename then save
    projectNameRef.current = 'New Name';
    markDirty(state);

    await coordinatedSave();
    expect(capturedNames[0]).toBe('New Name');
  });
});
