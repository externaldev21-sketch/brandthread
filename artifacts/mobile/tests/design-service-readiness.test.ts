/**
 * design-service-readiness.test.ts — the cold-load identity race fix in
 * services/designService.ts.
 *
 * Reproduces the real bug sequence: a screen reads a project BEFORE the app
 * shell has scoped storage to the signed-in user (initDesignService +
 * markDesignIdentityResolved). Without whenDesignServiceReady() the read
 * hits the 'anon' namespace and returns null for a project that exists;
 * with it, the read waits for the mark and finds the project.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('react-native', () => ({
  Platform: { OS: 'ios', select: (obj: Record<string, unknown>) => obj.ios ?? obj.default },
}));

const store: Record<string, string> = {};
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: (key: string) => Promise.resolve(store[key] ?? null),
    setItem: (key: string, value: string) => { store[key] = value; return Promise.resolve(); },
    removeItem: (key: string) => { delete store[key]; return Promise.resolve(); },
    clear: () => { Object.keys(store).forEach(k => delete store[k]); return Promise.resolve(); },
  },
}));
vi.mock('expo-crypto', () => ({ randomUUID: () => `test-${Math.random().toString(36).slice(2)}` }));
vi.mock('@/lib/serviceConfig', () => ({ serviceRequest: vi.fn(() => Promise.reject(new Error('offline'))) }));
vi.mock('@/lib/imageDimensions', () => ({ getImageDimensions: () => Promise.resolve({ width: 1, height: 1 }) }));
vi.mock('@/lib/designCloudImageCache', () => ({
  cacheDesignCloudImage: (_p: string, _o: string, uri: string) => Promise.resolve(uri),
  readRetainedDesignUploadAsset: () => Promise.resolve(new Uint8Array()),
  removeRetainedDesignUploadAsset: () => Promise.resolve(),
  retainDesignUploadAsset: (uri: string) => Promise.resolve(uri),
}));

import {
  initDesignService, markDesignIdentityResolved, isDesignIdentityResolved,
  whenDesignServiceReady, __resetDesignIdentityForTests, DESIGN_READY_TIMEOUT_MS,
  createProject, getProject,
} from '../services/designService';

beforeEach(() => {
  Object.keys(store).forEach(k => delete store[k]);
  __resetDesignIdentityForTests();
  initDesignService(null); // what the app shell does on first mount, before Clerk resolves
});

describe('whenDesignServiceReady', () => {
  it('is pending until the shell marks identity resolved, then resolves', async () => {
    expect(isDesignIdentityResolved()).toBe(false);
    let settled = false;
    const p = whenDesignServiceReady().then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    markDesignIdentityResolved();
    await p;
    expect(settled).toBe(true);
    expect(isDesignIdentityResolved()).toBe(true);
  });

  it('resolves immediately once already marked', async () => {
    markDesignIdentityResolved();
    const start = Date.now();
    await whenDesignServiceReady();
    expect(Date.now() - start).toBeLessThan(50);
  });

  it('is bounded: falls through (with a warning) after the timeout so no screen can hang', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      let settled = false;
      const p = whenDesignServiceReady(1000).then(() => { settled = true; });
      await vi.advanceTimersByTimeAsync(999);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await p;
      expect(settled).toBe(true);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(DESIGN_READY_TIMEOUT_MS).toBeGreaterThan(1000);
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });
});

describe('cold-load read of a saved project', () => {
  it('REPRODUCES the bug without the gate: reading before the shell scopes storage returns null', async () => {
    // The project was saved while signed in as user_a.
    initDesignService('user_a');
    const proj = await createProject('canvas', 'Saved earlier', { width: 100, height: 100 });

    // Cold reload: the module starts over as 'anon' and the screen reads first.
    initDesignService(null);
    expect(await getProject(proj.id)).toBeNull();

    // Then the shell scopes storage — too late for that read.
    initDesignService('user_a');
    expect((await getProject(proj.id))?.name).toBe('Saved earlier');
  });

  it('FIXED with the gate: the read waits for the shell and finds the project', async () => {
    initDesignService('user_a');
    const proj = await createProject('canvas', 'Saved earlier', { width: 100, height: 100 });

    initDesignService(null);
    __resetDesignIdentityForTests();
    // The screen's effect (what design-mockup-preview / design-export / design-canvas now do).
    const screenRead = whenDesignServiceReady().then(() => getProject(proj.id));

    // The shell's effect runs afterwards.
    initDesignService('user_a');
    markDesignIdentityResolved();

    expect((await screenRead)?.name).toBe('Saved earlier');
  });
});
