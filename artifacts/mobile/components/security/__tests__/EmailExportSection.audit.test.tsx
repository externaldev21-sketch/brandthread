/**
 * Audit (chunk 09): while an export is being prepared the section polls every
 * 5s. One failed poll used to stop polling for good (nothing changed, so the
 * effect never re-armed) — "Preparing your file" then never updated.
 */
import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ list: vi.fn() }));

vi.mock('@/lib/api', () => {
  const api = { dataExportJobs: { list: h.list, create: vi.fn(), link: vi.fn() } };
  return { useApi: () => api };
});
vi.mock('@/hooks/useColors', () => ({ useColors: () => ({ mutedForeground: '#888', foreground: '#fff' }) }));
vi.mock('@/lib/devPreview', () => ({ isBuyerDevPreview: () => false, isSellerDevPreview: () => false }));
vi.mock('@/components/ui', () => ({ Button: () => null, Card: (props: any) => props.children }));
vi.mock('@/lib/safety', () => ({ apiErrorCode: () => null, apiErrorMessage: (_e: unknown, f: string) => f }));

import { EmailExportSection } from '../EmailExportSection';

afterEach(() => { vi.useRealTimers(); h.list.mockReset(); });

const running = { jobs: [{ id: 'j1', status: 'running', emailed: false, expiresAt: null, downloadable: false }], emailEnabled: true, nextRequestAt: null };
const ready = { jobs: [{ id: 'j1', status: 'ready', emailed: true, expiresAt: '2026-11-05T00:00:00Z', downloadable: true }], emailEnabled: true, nextRequestAt: null };

describe('EmailExportSection polling', () => {
  it('keeps polling after a failed poll', async () => {
    vi.useFakeTimers();
    h.list
      .mockResolvedValueOnce(running)
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(ready);
    let r!: ReturnType<typeof create>;
    await act(async () => { r = create(<EmailExportSection categories={['orders']} />); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(h.list).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); }); // fails
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); }); // must retry
    expect(h.list).toHaveBeenCalledTimes(3);
    act(() => { r.unmount(); });
  });
});
