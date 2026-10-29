/**
 * Audit regression: useProductDraw had no guard against a response for the
 * previous productId landing after the id changed — the old product's draw
 * replaced the new one's.
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { state, api } = vi.hoisted(() => {
  const state = vi.fn();
  return { state, api: { productDraws: { state, entry: vi.fn(async () => ({ entry: null })) } } };
});
vi.mock('@/lib/api', () => ({ useApi: () => api }));
vi.mock('@clerk/expo', () => ({ useAuth: () => ({ isSignedIn: false }) }));
vi.mock('@/lib/drawPhase', () => ({ drawPhase: () => ({ kind: 'upcoming' }) }));

const { useProductDraw } = await import('./useProductDraw');

let latest: ReturnType<typeof useProductDraw> | null = null;
function Probe({ id }: { id: string }) { latest = useProductDraw(id); return null; }

const drawFor = (id: string) => ({
  serverNow: new Date().toISOString(),
  draw: { productId: id, seedHash: `seed-${id}`, drawnAt: null, status: 'closed', opensAt: '2020-01-01T00:00:00Z', closesAt: '2020-01-02T00:00:00Z' },
});

describe('useProductDraw — product change', () => {
  it("ignores the previous product's late response", async () => {
    let resolveOld!: (v: unknown) => void;
    state.mockImplementationOnce(() => new Promise((res) => { resolveOld = res; }));
    state.mockImplementationOnce(async () => drawFor('p2'));
    let r!: ReactTestRenderer;
    await act(async () => { r = create(<Probe id="p1" />); });
    await act(async () => { r.update(<Probe id="p2" />); });
    expect(latest?.draw?.productId).toBe('p2');
    await act(async () => { resolveOld(drawFor('p1')); });
    expect(latest?.draw?.productId).toBe('p2');
    r.unmount();
  });

  it("drops the previous product's draw when the new product's request fails", async () => {
    state.mockImplementationOnce(async () => drawFor('p1'));
    let r!: ReactTestRenderer;
    await act(async () => { r = create(<Probe id="p1" />); });
    expect(latest?.draw?.productId).toBe('p1');
    let rejectNew!: (e: unknown) => void;
    state.mockImplementationOnce(() => new Promise((_, rej) => { rejectNew = rej; }));
    await act(async () => { r.update(<Probe id="p2" />); });
    expect(latest?.draw).toBeNull();
    await act(async () => { rejectNew(new Error('offline')); });
    expect(latest?.draw).toBeNull();
    r.unmount();
  });
});
