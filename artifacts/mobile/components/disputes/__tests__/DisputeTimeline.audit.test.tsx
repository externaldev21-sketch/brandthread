/**
 * DisputeTimeline refetches when the parent bumps `refreshKey` (e.g. right
 * after evidence is submitted). If the older request answers AFTER the newer
 * one, it used to overwrite the fresh steps with the stale ones ("Evidence
 * due" current again after submitting).
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const timeline = vi.fn();
const api = { disputes: { timeline } };
vi.mock('@/lib/api', () => ({ useApi: () => api }));
vi.mock('@/hooks/useColors', () => ({ useColors: () => ({ foreground: '#fff', background: '#000', border: '#333', card: '#111', mutedForeground: '#888' }) }));
vi.mock('@/components/ui/Icon', () => ({ Icon: () => null }));
vi.mock('@/components/ui/RetryRow', () => ({ RetryRow: () => null }));

import { DisputeTimeline } from '../DisputeTimeline';

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

const step = (key: string, state: string) => ({ key, label: key, state, at: null, detail: null });
const states = (r: ReactTestRenderer) =>
  r.root.findAll((n) => typeof n.props.testID === 'string' && n.props.testID.startsWith('dispute-step-') && typeof n.type === 'string')
    .map((n) => n.props.testID);

describe('DisputeTimeline stale responses', () => {
  it('keeps the newest timeline when an older request resolves last', async () => {
    const first = deferred<{ steps: unknown[] }>();
    const second = deferred<{ steps: unknown[] }>();
    timeline.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    let r!: ReactTestRenderer;
    await act(async () => { r = create(<DisputeTimeline disputeId="d1" refreshKey={0} />); });
    await act(async () => { r.update(<DisputeTimeline disputeId="d1" refreshKey={1} />); });

    await act(async () => { second.resolve({ steps: [step('fresh', 'done')] }); });
    await act(async () => { first.resolve({ steps: [step('stale', 'current')] }); });

    expect(states(r)).toEqual(['dispute-step-fresh']);
  });
});
