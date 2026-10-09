import { describe, expect, it } from 'vitest';
import {
  collectLocalImageUris, isDeviceLocalUri, mergeDrafts, withRemoteImageUris,
  type ServerDraftRow,
} from '@/lib/productDraftSync';
import type { ProductDraft } from '@/services/productTypes';

const T = (s: number) => new Date(Date.UTC(2026, 9, 1, 12, 0, s)).toISOString();

function local(id: string, savedAt: string, name = id): ProductDraft {
  return { id, isDraft: true, currentStep: 1, lastSavedAt: savedAt, name } as ProductDraft;
}
function server(id: string, updatedAt: string, name = id): ServerDraftRow {
  return { clientDraftId: id, updatedAt, data: { id, name, currentStep: 3 } };
}

describe('mergeDrafts', () => {
  it('adopts server-only drafts and caches them locally', () => {
    const r = mergeDrafts([], [server('draft_a', T(5), 'From phone')], {});
    expect(r.drafts).toHaveLength(1);
    expect(r.drafts[0]).toMatchObject({ id: 'draft_a', name: 'From phone', isDraft: true, currentStep: 3, lastSavedAt: T(5) });
    expect(r.cacheWrites.map(d => d.id)).toEqual(['draft_a']);
    expect(r.meta.draft_a).toEqual({ syncedAt: T(5) });
    expect(r.pushIds).toEqual([]);
  });

  it('server wins when newer; local wins (and is pushed) when newer', () => {
    const r = mergeDrafts(
      [local('draft_s', T(1), 'old local'), local('draft_l', T(9), 'new local')],
      [server('draft_s', T(2), 'new server'), server('draft_l', T(3), 'old server')],
      {},
    );
    const byId = Object.fromEntries(r.drafts.map(d => [d.id, d.name]));
    expect(byId).toEqual({ draft_s: 'new server', draft_l: 'new local' });
    expect(r.cacheWrites.map(d => d.id)).toEqual(['draft_s']);
    expect(r.pushIds).toEqual(['draft_l']);
  });

  it('keeps the local copy on a tie without rewriting the cache', () => {
    const r = mergeDrafts([local('draft_t', T(4), 'mine')], [server('draft_t', T(4), 'same save')], {});
    expect(r.drafts[0].name).toBe('mine');
    expect(r.cacheWrites).toEqual([]);
    expect(r.pushIds).toEqual([]);
    expect(r.meta.draft_t).toEqual({ syncedAt: T(4) });
  });

  it('pushes a never-synced local draft', () => {
    const r = mergeDrafts([local('draft_new', T(1))], [], {});
    expect(r.drafts.map(d => d.id)).toEqual(['draft_new']);
    expect(r.pushIds).toEqual(['draft_new']);
    expect(r.localDeletes).toEqual([]);
  });

  it('removes a synced, unchanged local draft that another device deleted', () => {
    const r = mergeDrafts([local('draft_gone', T(3))], [], { draft_gone: { syncedAt: T(3) } });
    expect(r.drafts).toEqual([]);
    expect(r.localDeletes).toEqual(['draft_gone']);
    expect(r.meta.draft_gone).toBeUndefined();
  });

  it('keeps (and re-pushes) a local draft edited after its last sync even if deleted elsewhere', () => {
    const r = mergeDrafts([local('draft_edit', T(8))], [], { draft_edit: { syncedAt: T(3) } });
    expect(r.drafts.map(d => d.id)).toEqual(['draft_edit']);
    expect(r.pushIds).toEqual(['draft_edit']);
  });

  it('hides a locally discarded draft still on the server and retries the delete', () => {
    const r = mergeDrafts([], [server('draft_x', T(2))], { draft_x: { deleted: true } });
    expect(r.drafts).toEqual([]);
    expect(r.cacheWrites).toEqual([]);
    expect(r.retryDeleteIds).toEqual(['draft_x']);
    expect(r.meta.draft_x).toEqual({ deleted: true });
  });

  it('clears a tombstone once the server copy is gone', () => {
    const r = mergeDrafts([], [], { draft_x: { deleted: true } });
    expect(r.meta).toEqual({});
    expect(r.retryDeleteIds).toEqual([]);
  });

  it('treats a draft saved again after a discard as live', () => {
    const r = mergeDrafts([local('draft_back', T(9))], [server('draft_back', T(2))], { draft_back: { deleted: true } });
    expect(r.drafts.map(d => d.id)).toEqual(['draft_back']);
    expect(r.pushIds).toEqual(['draft_back']);
    expect(r.retryDeleteIds).toEqual([]);
  });

  it('sorts newest first', () => {
    const r = mergeDrafts([local('draft_1', T(1))], [server('draft_3', T(3)), server('draft_2', T(2))], {});
    expect(r.drafts.map(d => d.id)).toEqual(['draft_3', 'draft_2', 'draft_1']);
  });
});

describe('draft image URIs', () => {
  it('detects device-local URIs only', () => {
    expect(isDeviceLocalUri('file:///var/a.jpg')).toBe(true);
    expect(isDeviceLocalUri('content://media/1')).toBe(true);
    expect(isDeviceLocalUri('ph://ABC')).toBe(true);
    expect(isDeviceLocalUri('blob:http://x/1')).toBe(true);
    expect(isDeviceLocalUri('https://cdn.example/a.jpg')).toBe(false);
    expect(isDeviceLocalUri('/objects/uploads/abc')).toBe(false);
    expect(isDeviceLocalUri(undefined)).toBe(false);
  });

  it('collects and swaps local media, cutout and size chart URIs', () => {
    const draft = {
      media: [
        { id: 'm1', uri: 'file:///a.jpg', cutoutUri: 'file:///a-cut.png', isCover: true, sortOrder: 0 },
        { id: 'm2', uri: 'https://cdn/b.jpg', isCover: false, sortOrder: 1 },
        { id: 'm3', uri: 'file:///a.jpg', isCover: false, sortOrder: 2 },
      ],
      sizeChartImageUrl: 'file:///chart.png',
    } as unknown as ProductDraft;
    expect(collectLocalImageUris(draft).sort()).toEqual(['file:///a-cut.png', 'file:///a.jpg', 'file:///chart.png']);

    const swapped = withRemoteImageUris(draft, { 'file:///a.jpg': '/objects/a', 'file:///chart.png': '/objects/chart' });
    expect(swapped.media!.map(m => m.uri)).toEqual(['/objects/a', 'https://cdn/b.jpg', '/objects/a']);
    // Not uploaded yet: stays local, retried on the next save.
    expect(swapped.media![0].cutoutUri).toBe('file:///a-cut.png');
    expect(swapped.sizeChartImageUrl).toBe('/objects/chart');
    // Input untouched.
    expect(draft.media![0].uri).toBe('file:///a.jpg');
  });
});
