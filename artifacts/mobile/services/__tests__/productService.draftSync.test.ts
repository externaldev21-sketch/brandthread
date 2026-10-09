/**
 * Product drafts: local-first saves with background sync to
 * /api/product-drafts, server+local merge on list, delete on both sides.
 * The server here is a tiny in-memory fake with the real route's rules
 * (last-write-wins, 409 with the server copy on a stale write).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const storage = new Map<string, string>();
  const server = new Map<string, { clientDraftId: string; data: any; updatedAt: string }>();
  const state = { token: true, demo: false, uploadFails: false, offline: false };
  const calls: string[] = [];
  const uploads: string[] = [];
  class FakeApiError extends Error {
    constructor(public status: number, public body: string) { super(body); }
  }
  async function serviceRequest(path: string, options: RequestInit = {}) {
    const method = options.method ?? 'GET';
    calls.push(`${method} ${path}`);
    if (state.offline) throw new FakeApiError(0, 'offline');
    const m = path.match(/^\/api\/product-drafts(?:\/([^/?]+))?$/);
    if (!m) throw new FakeApiError(404, '{}');
    const id = m[1] ? decodeURIComponent(m[1]) : undefined;
    if (!id && method === 'GET') return { drafts: [...server.values()] };
    if (method === 'GET') {
      const row = server.get(id!);
      if (!row) throw new FakeApiError(404, '{}');
      return { draft: row };
    }
    if (method === 'DELETE') { server.delete(id!); return { ok: true }; }
    const body = JSON.parse(String(options.body));
    const existing = server.get(id!);
    if (existing && Date.parse(existing.updatedAt) > Date.parse(body.updatedAt)) {
      throw new FakeApiError(409, JSON.stringify({ code: 'DRAFT_STALE', draft: existing }));
    }
    const row = { clientDraftId: id!, data: body.data, updatedAt: body.updatedAt };
    server.set(id!, row);
    return { draft: row };
  }
  return { storage, server, state, calls, uploads, serviceRequest };
});

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => h.storage.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => { h.storage.set(k, v); }),
    removeItem: vi.fn(async (k: string) => { h.storage.delete(k); }),
    multiGet: vi.fn(async (ks: string[]) => ks.map(k => [k, h.storage.get(k) ?? null])),
    multiSet: vi.fn(async (pairs: [string, string][]) => { pairs.forEach(([k, v]) => h.storage.set(k, v)); }),
    multiRemove: vi.fn(async (ks: string[]) => { ks.forEach(k => h.storage.delete(k)); }),
    getAllKeys: vi.fn(async () => [...h.storage.keys()]),
  },
}));

vi.mock('@/lib/serviceConfig', () => ({
  serviceRequest: vi.fn(h.serviceRequest),
  hasServiceToken: vi.fn(async () => h.state.token),
  serviceUploadProductImage: vi.fn(async ({ uri }: { uri: string }) => {
    h.uploads.push(uri);
    if (h.state.uploadFails) throw new Error('upload failed');
    return `/objects/${uri.split('/').pop()}`;
  }),
}));
vi.mock('@/lib/devPreview', () => ({ isPreviewDemoMode: () => h.state.demo }));
vi.mock('@/lib/money',() => ({ centsAtBasisPoints: vi.fn(() => 0) }));

import { deleteDraft, initProductService, listDrafts, loadDraft, saveDraft } from '@/services/productService';
import type { ProductDraft } from '@/services/productTypes';

const UID = 'seller-sync';
const flush = () => new Promise(r => setTimeout(r, 20));

function draft(id: string, extra: Partial<ProductDraft> = {}): ProductDraft {
  return { id, isDraft: true, currentStep: 1, lastSavedAt: '', name: id, ...extra } as ProductDraft;
}
const localKey = (id: string) => `@brandthread/draft_${UID}_${id}`;

beforeEach(() => {
  h.storage.clear();
  h.server.clear();
  h.calls.length = 0;
  h.uploads.length = 0;
  Object.assign(h.state, { token: true, demo: false, uploadFails: false, offline: false });
  initProductService(null);
  initProductService(UID);
});

describe('product draft sync', () => {
  it('saves locally at once and pushes to the server in the background', async () => {
    await saveDraft(draft('draft_a', { name: 'Hoodie' }));
    expect(JSON.parse(h.storage.get(localKey('draft_a'))!).name).toBe('Hoodie');
    await flush();
    expect(h.server.get('draft_a')?.data.name).toBe('Hoodie');
  });

  it('uploads local images before the PUT and reuses the upload on the next save', async () => {
    const media = [{ id: 'm1', uri: 'file:///photo.jpg', isCover: true, sortOrder: 0 }] as any;
    await saveDraft(draft('draft_img', { media }));
    await flush();
    expect(h.server.get('draft_img')!.data.media[0].uri).toBe('/objects/photo.jpg');
    // Local copy keeps the device URI (it still resolves here).
    expect(JSON.parse(h.storage.get(localKey('draft_img'))!).media[0].uri).toBe('file:///photo.jpg');

    await saveDraft(draft('draft_img', { media, name: 'v2' }));
    await flush();
    expect(h.uploads).toEqual(['file:///photo.jpg']);
    expect(h.server.get('draft_img')!.data.name).toBe('v2');
  });

  it('keeps the local URI and still syncs when an upload fails, retrying next save', async () => {
    h.state.uploadFails = true;
    const media = [{ id: 'm1', uri: 'file:///x.jpg', isCover: true, sortOrder: 0 }] as any;
    await saveDraft(draft('draft_up', { media }));
    await flush();
    expect(h.server.get('draft_up')!.data.media[0].uri).toBe('file:///x.jpg');
    h.state.uploadFails = false;
    await saveDraft(draft('draft_up', { media }));
    await flush();
    expect(h.server.get('draft_up')!.data.media[0].uri).toBe('/objects/x.jpg');
  });

  it('lists drafts from another device and caches them for resume', async () => {
    h.server.set('draft_remote', {
      clientDraftId: 'draft_remote', updatedAt: '2026-10-01T10:00:00.000Z',
      data: { id: 'draft_remote', name: 'From my phone', currentStep: 2 },
    });
    const list = await listDrafts();
    expect(list.map(d => d.name)).toEqual(['From my phone']);
    expect(h.storage.has(localKey('draft_remote'))).toBe(true);
    expect((await loadDraft('draft_remote'))?.name).toBe('From my phone');
  });

  it('loadDraft falls back to the server for a draft_ id missing locally, never for product ids', async () => {
    h.server.set('draft_only', { clientDraftId: 'draft_only', updatedAt: '2026-10-01T10:00:00.000Z', data: { name: 'Server' } });
    expect((await loadDraft('draft_only'))?.name).toBe('Server');
    h.calls.length = 0;
    expect(await loadDraft('3f1c1a2e-0000-4000-8000-000000000000')).toBeNull();
    expect(h.calls).toEqual([]);
  });

  it('a stale push takes the newer server copy locally', async () => {
    h.server.set('draft_c', {
      clientDraftId: 'draft_c', updatedAt: '2999-01-01T00:00:00.000Z', data: { id: 'draft_c', name: 'Newer elsewhere' },
    });
    await saveDraft(draft('draft_c', { name: 'Older here' }));
    await flush();
    expect(JSON.parse(h.storage.get(localKey('draft_c'))!).name).toBe('Newer elsewhere');
    expect(h.server.get('draft_c')!.data.name).toBe('Newer elsewhere');
  });

  it('deletes on both sides, and an offline discard does not come back', async () => {
    await saveDraft(draft('draft_d'));
    await flush();
    h.state.offline = true;
    await deleteDraft('draft_d');
    await flush();
    expect(h.storage.has(localKey('draft_d'))).toBe(false);
    expect(h.server.has('draft_d')).toBe(true);

    h.state.offline = false;
    expect(await listDrafts()).toEqual([]); // tombstone hides it, retries delete
    await flush();
    expect(h.server.has('draft_d')).toBe(false);
  });

  it('removes a local draft that another device published/discarded', async () => {
    await saveDraft(draft('draft_e'));
    await flush();
    h.server.delete('draft_e');
    expect(await listDrafts()).toEqual([]);
    expect(h.storage.has(localKey('draft_e'))).toBe(false);
  });

  it('stays local-only when signed out', async () => {
    h.state.token = false;
    await saveDraft(draft('draft_f'));
    expect((await listDrafts()).map(d => d.id)).toEqual(['draft_f']);
    await deleteDraft('draft_f');
    await flush();
    expect(h.calls).toEqual([]);
  });

  it('stays local-only in the demo overlay', async () => {
    h.state.demo = true;
    await saveDraft(draft('draft_g'));
    expect((await listDrafts()).map(d => d.id)).toEqual(['draft_g']);
    await flush();
    expect(h.calls).toEqual([]);
  });

  it('falls back to the local cache when the server is unreachable', async () => {
    h.state.offline = true;
    await saveDraft(draft('draft_h'));
    expect((await listDrafts()).map(d => d.id)).toEqual(['draft_h']);
    h.state.offline = false;
    await listDrafts(); // pushes the never-synced draft
    await flush();
    expect(h.server.has('draft_h')).toBe(true);
  });
});
