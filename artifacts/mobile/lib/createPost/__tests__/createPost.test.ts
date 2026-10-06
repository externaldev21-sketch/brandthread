import { describe, expect, it, vi } from 'vitest';
import { uploadChunked, type ChunkedTransport } from '../chunkedUpload';
import { clampSlideCrop, slideCropToRect } from '../crop';
import { MAX_SLIDES_BY_MODE, CREATE_MODES_BY_ROLE } from '@/constants/postLimits';

function fakeTransport(opts: { failFirst?: number; already?: number[] } = {}) {
  const puts: number[] = [];
  let failures = opts.failFirst ?? 0;
  const transport: ChunkedTransport = {
    start: vi.fn(async () => ({ uploadId: 'u1', chunkSize: 4, totalChunks: 3 })),
    status: vi.fn(async () => ({ received: opts.already ?? [], chunkSize: 4, totalChunks: 3 })),
    putChunk: vi.fn(async (_id, index, _chunk, onBytes) => {
      if (failures > 0) { failures -= 1; throw new Error('net'); }
      onBytes(4); puts.push(index);
    }),
    complete: vi.fn(async () => ({ objectPath: '/objects/uploads/x', contentType: 'video/mp4', size: 10 })),
  };
  return { transport, puts };
}
const blob = new Blob([new Uint8Array(10)]);
const store = () => { const m = new Map<string, string>(); return { m, get: async (k: string) => m.get(k) ?? null, set: async (k: string, v: string | null) => { v ? m.set(k, v) : m.delete(k); } }; };

describe('uploadChunked', () => {
  it('sends every chunk, reports monotonic progress and completes', async () => {
    const { transport, puts } = fakeTransport();
    const seen: number[] = [];
    const result = await uploadChunked({ transport, blob, contentType: 'video/mp4', onProgress: (p) => seen.push(p), backoffMs: () => 0 });
    expect(puts.sort()).toEqual([0, 1, 2]);
    expect(result.objectPath).toBe('/objects/uploads/x');
    expect(seen[seen.length - 1]).toBe(1);
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);
  });
  it('retries a failed chunk', async () => {
    const { transport, puts } = fakeTransport({ failFirst: 2 });
    await uploadChunked({ transport, blob, contentType: 'video/mp4', backoffMs: () => 0 });
    expect(puts.sort()).toEqual([0, 1, 2]);
  });
  it('resumes: skips chunks the server already holds', async () => {
    const { transport, puts } = fakeTransport({ already: [0, 1] });
    const rs = store(); rs.m.set('k', 'u1');
    await uploadChunked({ transport, blob, contentType: 'video/mp4', resumeKey: 'k', resumeStore: rs, backoffMs: () => 0 });
    expect(puts).toEqual([2]);
    expect(transport.start).not.toHaveBeenCalled();
    expect(rs.m.has('k')).toBe(false);
  });
});

describe('slide crop', () => {
  it('centres at zoom 1 and never leaves the source', () => {
    const r = slideCropToRect({ zoom: 1, cx: 0.5, cy: 0.5 }, 4000, 3000, 1);
    expect(r.width).toBeCloseTo(0.75); expect(r.height).toBeCloseTo(1); expect(r.x).toBeCloseTo(0.125);
    const c = clampSlideCrop({ zoom: 2, cx: 0, cy: 1 }, 4000, 3000, 9 / 16);
    const rr = slideCropToRect(c, 4000, 3000, 9 / 16);
    expect(rr.x).toBeGreaterThanOrEqual(0); expect(rr.y + rr.height).toBeLessThanOrEqual(1.0000001);
  });
});

describe('limits', () => {
  it('POST 14, THREAD 30; buyers never get THREAD', () => {
    expect(MAX_SLIDES_BY_MODE).toEqual({ thread: 30, post: 14 });
    expect(CREATE_MODES_BY_ROLE.buyer).not.toContain('thread');
    expect(CREATE_MODES_BY_ROLE.buyer).not.toContain('live');
  });
});

import { FILTER_PRESETS, isNeutral, matchingPreset, NO_ADJUST, previewFilter } from '../adjust';
describe('adjust', () => {
  it('neutral has no preview filter; presets round-trip', () => {
    expect(previewFilter(NO_ADJUST)).toBeUndefined();
    expect(isNeutral(NO_ADJUST)).toBe(true);
    for (const p of FILTER_PRESETS) expect(matchingPreset(p.adjust)).toBe(p.id);
    expect(previewFilter({ ...NO_ADJUST, brightness: 50 })).toBe('brightness(1.250)');
  });
});
