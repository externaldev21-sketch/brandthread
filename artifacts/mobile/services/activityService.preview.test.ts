/**
 * Activity read state in the dev-web preview (?bt_preview=buyer|seller):
 * no backend, so mark-read / mark-all / the unread badge fall back to the
 * in-memory seeded-feed state in lib/previewActivity.ts. That module pulls in
 * bundled image assets vitest can't load, so it's mocked with the same
 * contract here; outside the preview every call still hits the real API.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const preview = vi.hoisted(() => ({
  enabled: false,
  seedServed: false,
  read: new Set<string>(),
  seedUnread: ['preview-act-a', 'preview-act-b', 'preview-act-c'],
}));

vi.mock('@/lib/serviceConfig', () => ({ serviceRequest: vi.fn() }));
vi.mock('@/services/socialService', () => ({ subscribeSocial: () => () => {} }));
vi.mock('@/lib/previewActivity', () => ({
  isPreviewActivityEnabled: () => preview.enabled,
  isPreviewActivitySeedServed: () => preview.seedServed,
  isPreviewActivityId: (id: string) => id.startsWith('preview-act-'),
  markPreviewActivityRead: (ids: Iterable<string>) => { for (const id of ids) preview.read.add(id); },
  markAllPreviewActivityRead: () => { for (const id of preview.seedUnread) preview.read.add(id); },
  previewUnreadActivityCount: () => preview.seedUnread.filter((id) => !preview.read.has(id)).length,
}));

import { serviceRequest } from '@/lib/serviceConfig';
import {
  getUnreadActivityCount,
  markActivityRead,
  markAllActivityRead,
  subscribeActivity,
  subscribeUnreadOverride,
} from './activityService';

const request = vi.mocked(serviceRequest);

beforeEach(() => {
  request.mockReset();
  preview.enabled = false;
  preview.seedServed = false;
  preview.read.clear();
});

describe('activity read state — real API', () => {
  it('uses the server count and never the preview fallback', async () => {
    request.mockResolvedValue({ count: 4 });
    expect(await getUnreadActivityCount()).toBe(4);
    request.mockRejectedValue(new Error('offline'));
    expect(await getUnreadActivityCount()).toBe(0);
  });

  it('mark all read hits PATCH read-all, broadcasts, and surfaces a failure', async () => {
    const listener = vi.fn();
    const stop = subscribeActivity(listener);
    request.mockResolvedValue({ ok: true });
    await markAllActivityRead();
    expect(request).toHaveBeenCalledWith('/api/buyer/notifications/read-all', expect.objectContaining({ method: 'PATCH' }));
    expect(listener).toHaveBeenCalled();
    request.mockRejectedValue(new Error('offline'));
    await expect(markAllActivityRead()).rejects.toThrow('offline');
    stop();
  });

  it('zeroes every badge before the request lands, and refetches if it fails', async () => {
    const override = vi.fn();
    const change = vi.fn();
    const stopOverride = subscribeUnreadOverride(override);
    const stopChange = subscribeActivity(change);
    let settle: (v: unknown) => void = () => {};
    request.mockReturnValue(new Promise((resolve) => { settle = resolve; }));
    const pending = markAllActivityRead();
    expect(override).toHaveBeenCalledWith(0); // before the PATCH resolves
    expect(change).not.toHaveBeenCalled();
    settle({ ok: true });
    await pending;
    expect(change).toHaveBeenCalledTimes(1);

    request.mockRejectedValue(new Error('offline'));
    await expect(markAllActivityRead()).rejects.toThrow('offline');
    expect(change).toHaveBeenCalledTimes(2); // failure → badges refetch the true count
    stopOverride();
    stopChange();
  });
});

describe('activity read state — dev-web preview', () => {
  beforeEach(() => { preview.enabled = true; preview.seedServed = true; });

  it('badge counts the seeded unread rows when the API has nothing', async () => {
    request.mockRejectedValue(new Error('401'));
    expect(await getUnreadActivityCount()).toBe(3);
    request.mockResolvedValue({ count: 0 });
    expect(await getUnreadActivityCount()).toBe(3);
  });

  it('marking a seeded row read updates the badge without a network call', async () => {
    const listener = vi.fn();
    const stop = subscribeActivity(listener);
    await markActivityRead('preview-act-a');
    expect(request).not.toHaveBeenCalled();
    expect(listener).toHaveBeenCalled();
    request.mockRejectedValue(new Error('401'));
    expect(await getUnreadActivityCount()).toBe(2);
    stop();
  });

  it('mark all read clears the preview badge and does not report a false failure', async () => {
    request.mockRejectedValue(new Error('401'));
    await expect(markAllActivityRead()).resolves.toBeUndefined();
    expect(await getUnreadActivityCount()).toBe(0);
  });
});
