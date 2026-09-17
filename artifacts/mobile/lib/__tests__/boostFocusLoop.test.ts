/**
 * Regression test: Boost screen focus-load loop caused by unstable API object identity.
 *
 * Root cause (reproduced here as a pure logic test):
 *   useCallback([api, ...]) + useFocusEffect(useCallback([api, loadTargets, loadHistory]))
 *   rebuilds the focus callback every time useApi() returns a newly-allocated
 *   facade object (even with the same userId). useFocusEffect re-registers on
 *   every new callback reference, triggering another load cycle while the screen
 *   is focused — so loadingTargets / loadingExisting stay permanently true.
 *
 * Fix contract verified here:
 *   1. A stable load function (empty deps / ref-based) is called exactly ONCE
 *      per focus event regardless of how many times the api object is reallocated.
 *   2. loadTargets / loadHistory callbacks themselves are stable across api
 *      object reallocations (referential equality preserved).
 *   3. After N api facade reallocations the focus callback fires exactly once
 *      per focus (not N times).
 *   4. Retry still works: explicit loadTargets() call after an error re-invokes
 *      the underlying api method via the ref.
 *   5. Preview fallback still fires on 401 from the latest api ref.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Minimal ref + stable-callback simulation ──────────────────────────────────
// Mirrors the pattern used in boost.tsx: api methods stored in a ref,
// callbacks created once with empty dep arrays.

type BoostsFacade = {
  targets: () => Promise<unknown[]>;
  list:    () => Promise<unknown[]>;
  summary: () => Promise<unknown>;
};

function makeApiFacade(targetsImpl: () => Promise<unknown[]>): BoostsFacade {
  return {
    targets: targetsImpl,
    list:    async () => [],
    summary: async () => null,
  };
}

/**
 * Simulates the ref-based pattern from boost.tsx.
 * Returns { loadTargets, callCount, setApiFacade }.
 */
function setupStableCallbacks(initial: BoostsFacade) {
  // The ref — updated on every "render"
  let currentFacade = initial;
  const boostsRef = { get current() { return currentFacade; } };

  // Use a shared state object so getters always read the latest mutated value.
  const state = { callCount: 0, lastRows: [] as unknown[], lastError: false };

  // Stable callback: created ONCE, reads from ref at call time.
  async function loadTargets(): Promise<void> {
    state.callCount++;
    try {
      const rows = await boostsRef.current.targets();
      state.lastRows = rows as unknown[];
      state.lastError = false;
    } catch {
      state.lastError = true;
      state.lastRows = [];
    }
  }

  function setApiFacade(next: BoostsFacade) {
    currentFacade = next;
  }

  return {
    loadTargets,
    setApiFacade,
    get callCount() { return state.callCount; },
    get lastRows()  { return state.lastRows;  },
    get lastError() { return state.lastError; },
  };
}

// ── Unstable (broken) pattern for contrast ────────────────────────────────────

/**
 * Simulates the broken pattern: callback closed over the api object directly,
 * recreated whenever api changes.
 */
function setupUnstableCallbacks(initial: BoostsFacade) {
  let callCount = 0;
  let currentApi = initial;

  // Every time api changes, a new function is returned (simulates useCallback([api]))
  function makeLoadTargets(api: BoostsFacade) {
    return async function loadTargets() {
      callCount++;
      await api.targets();
    };
  }

  let loadTargets = makeLoadTargets(currentApi);

  function setApiFacade(next: BoostsFacade) {
    currentApi = next;
    // Simulates useCallback re-creating when api dep changes
    loadTargets = makeLoadTargets(currentApi);
  }

  return {
    getLoadTargets: () => loadTargets,
    setApiFacade,
    get callCount() { return callCount; },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Boost focus loop regression — stable ref pattern', () => {
  it('loadTargets is the same function reference across api reallocations', () => {
    const facade1 = makeApiFacade(async () => []);
    const { loadTargets, setApiFacade } = setupStableCallbacks(facade1);

    const ref1 = loadTargets;

    // Simulate Clerk allocating a new api facade (same userId, new object)
    const facade2 = makeApiFacade(async () => []);
    setApiFacade(facade2);

    const ref2 = loadTargets; // same function — ref didn't change

    expect(ref1).toBe(ref2);
  });

  it('firing loadTargets once per focus uses the latest api facade via the ref', async () => {
    const facade1 = makeApiFacade(async () => [{ label: 'v1' }]);
    const ctx = setupStableCallbacks(facade1);

    await ctx.loadTargets();
    expect(ctx.lastRows[0]).toEqual({ label: 'v1' });

    // api facade is reallocated (e.g. Clerk re-render)
    const facade2 = makeApiFacade(async () => [{ label: 'v2' }]);
    ctx.setApiFacade(facade2);

    // Focus fires again — same loadTargets function, but reads latest facade
    await ctx.loadTargets();
    expect(ctx.lastRows[0]).toEqual({ label: 'v2' });
  });

  it('N api reallocations between focus events do not multiply focus-load calls', async () => {
    const facade = makeApiFacade(async () => []);
    const ctx = setupStableCallbacks(facade);

    // Simulate 5 renders that each reallocate the api object (Clerk jitter)
    for (let i = 0; i < 5; i++) {
      ctx.setApiFacade(makeApiFacade(async () => []));
    }

    // useFocusEffect fires once per focus event — not once per api reallocation
    await ctx.loadTargets(); // called once by useFocusEffect

    expect(ctx.callCount).toBe(1);
  });

  it('retry (explicit loadTargets call) still works via the ref', async () => {
    let shouldFail = true;
    const facade = makeApiFacade(async () => {
      if (shouldFail) throw new Error('Network error');
      return [{ id: 'post-1' }];
    });

    const ctx = setupStableCallbacks(facade);

    // First focus — fails
    await ctx.loadTargets();
    expect(ctx.lastError).toBe(true);
    expect(ctx.lastRows).toHaveLength(0);

    // User taps retry — same stable loadTargets, now succeeds
    shouldFail = false;
    await ctx.loadTargets();
    expect(ctx.lastError).toBe(false);
    expect(ctx.lastRows).toHaveLength(1);
  });

  it('preview 401 fallback fires from the stable callback reading the ref', async () => {
    const facade = makeApiFacade(async () => {
      throw Object.assign(new Error('401 Unauthorized'), { status: 401 });
    });

    const PREVIEW_TARGETS = [{ id: 'preview-1', mediaKind: 'video' }];
    let lastRows: unknown[] = [];
    let currentFacade = facade;
    const boostsRef = { get current() { return currentFacade; } };
    const isPreview = true; // simulates dev web seller preview

    async function loadTargets() {
      try {
        const rows = await boostsRef.current.targets();
        lastRows = rows as unknown[];
      } catch (e: any) {
        const is401 = e?.status === 401 || String(e?.message ?? '').includes('401');
        if (isPreview && is401) {
          lastRows = PREVIEW_TARGETS;
        } else {
          lastRows = [];
        }
      }
    }

    // api reallocated before focus fires
    currentFacade = makeApiFacade(async () => {
      throw Object.assign(new Error('401 Unauthorized'), { status: 401 });
    });

    await loadTargets();
    expect(lastRows).toEqual(PREVIEW_TARGETS);
  });
});

describe('Boost focus loop regression — contrast: broken pattern multiplies calls', () => {
  it('unstable callback (closed over api) is recreated on every api reallocation', () => {
    const facade1 = makeApiFacade(async () => []);
    const { getLoadTargets, setApiFacade } = setupUnstableCallbacks(facade1);

    const ref1 = getLoadTargets();

    setApiFacade(makeApiFacade(async () => []));
    const ref2 = getLoadTargets();

    // This is the broken pattern — function identity changes on every api swap
    expect(ref1).not.toBe(ref2);
  });

  it('stable pattern identity is preserved across the same number of swaps', () => {
    const facade1 = makeApiFacade(async () => []);
    const { loadTargets, setApiFacade } = setupStableCallbacks(facade1);

    const ref1 = loadTargets;
    setApiFacade(makeApiFacade(async () => []));
    const ref2 = loadTargets;

    expect(ref1).toBe(ref2); // stable — this is the correct pattern
  });
});

describe('Boost focus loop regression — useFocusEffect re-registration model', () => {
  /**
   * useFocusEffect re-runs cleanup+effect whenever the callback reference changes.
   * We simulate this: if the dep-array causes a new callback reference, focus
   * fires again even while the screen is still focused.
   */

  it('stable callback fires exactly once per simulated focus event', async () => {
    let focusFireCount = 0;

    // Simulates useFocusEffect: re-registers only when cb reference changes
    let registeredCb: (() => void) | null = null;
    function simulateFocusEffect(cb: () => void) {
      if (cb !== registeredCb) {
        registeredCb = cb;
        cb(); // fires on registration (focus)
        focusFireCount++;
      }
    }

    const facade = makeApiFacade(async () => []);
    const { loadTargets, setApiFacade } = setupStableCallbacks(facade);

    // Create stable focus callback (mirrors useFocusEffect(useCallback([], [])))
    const focusCb = () => { loadTargets(); };

    // Register once
    simulateFocusEffect(focusCb);
    expect(focusFireCount).toBe(1);

    // 5 api reallocations during a focus (Clerk jitter)
    for (let i = 0; i < 5; i++) {
      setApiFacade(makeApiFacade(async () => []));
      // With stable callback, re-registering the same cb does NOT re-fire
      simulateFocusEffect(focusCb);
    }

    // Still only 1 focus fire — the callback reference never changed
    expect(focusFireCount).toBe(1);
  });

  it('unstable callback fires once per api reallocation (demonstrates the bug)', () => {
    let focusFireCount = 0;

    let registeredCb: (() => void) | null = null;
    function simulateFocusEffect(cb: () => void) {
      if (cb !== registeredCb) {
        registeredCb = cb;
        cb();
        focusFireCount++;
      }
    }

    const facade1 = makeApiFacade(async () => []);
    const { getLoadTargets, setApiFacade } = setupUnstableCallbacks(facade1);

    // First focus registration
    simulateFocusEffect(getLoadTargets());
    expect(focusFireCount).toBe(1);

    // Each api reallocation produces a new callback → re-fires focus
    for (let i = 0; i < 3; i++) {
      setApiFacade(makeApiFacade(async () => []));
      simulateFocusEffect(getLoadTargets()); // new fn reference each time
    }

    // Bug: fired 4 times total (1 initial + 3 api swaps)
    expect(focusFireCount).toBe(4);
  });
});
