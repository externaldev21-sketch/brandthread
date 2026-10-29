/**
 * Audit (chunk 09): profile-tab hooks must never show one profile's data on
 * another — a slow response for the previous profile may not land after the
 * profile changed.
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const h = vi.hoisted(() => ({
  tagged: new Map<string, Deferred<unknown[]>>(),
  reposts: new Map<string, Deferred<unknown[]>>(),
  videos: new Map<string, Deferred<unknown>>(),
  notes: [] as Array<Deferred<Array<{ authorId: string; text: string }>>>,
}));

vi.mock('@/hooks/useApi', () => {
  const api = {
    social: {
      tagged: (userId: string) => h.tagged.get(userId)!.promise,
      reposts: (userId: string) => h.reposts.get(userId)!.promise,
    },
  };
  return { useApi: () => api };
});
vi.mock('@/services/profileService', () => ({
  toTaggedItem: (row: { id: string }) => ({ id: row.id }),
  getCreatorVideosPage: (userId: string) => h.videos.get(userId)!.promise,
}));
vi.mock('@/services/socialService', () => ({
  getNotesForTray: () => { const d = h.notes[h.notes.length - 1]; return d.promise; },
}));
vi.mock('@/lib/devPreview', () => ({
  isPreviewDemoMode: () => false, isBuyerDevPreview: () => false, isSellerDevPreview: () => false,
}));
vi.mock('@/lib/previewNotes', () => ({
  getPreviewMyNote: () => null, getPreviewNotesForTray: () => [], isPreviewNotesEnabled: () => false,
}));
vi.mock('@/lib/officialAccount', () => ({ isOfficialAccountId: () => false }));
vi.mock('@/lib/previewOfficialAccount', () => ({ previewOfficialGrid: () => [] }));

import { useTaggedPosts } from '../useTaggedPosts';
import { useRepostedPosts } from '../useRepostedPosts';
import { useCreatorVideos } from '../useCreatorVideos';
import { useProfileNote } from '../useProfileNote';

async function flush() {
  await act(async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); });
}

let renderer: ReactTestRenderer | null = null;
afterEach(() => {
  act(() => { renderer?.unmount(); });
  renderer = null;
  h.tagged.clear(); h.reposts.clear(); h.videos.clear(); h.notes.length = 0;
});

describe.each([
  ['useTaggedPosts', useTaggedPosts, h.tagged],
  ['useRepostedPosts', useRepostedPosts, h.reposts],
] as const)('%s', (_name, useHook, store) => {
  it('ignores a slow response for the previous profile and never shows its rows', async () => {
    store.set('a', deferred());
    store.set('b', deferred());
    let latest: { items: Array<{ id: string }> } = { items: [] };
    function Probe({ userId }: { userId: string }) {
      latest = useHook(userId, true);
      return null;
    }
    await act(async () => { renderer = create(<Probe userId="a" />); });
    await act(async () => { renderer!.update(<Probe userId="b" />); });
    // B answers first, then A's stale response arrives.
    await act(async () => { store.get('b')!.resolve([{ id: 'b1' }]); });
    await flush();
    await act(async () => { store.get('a')!.resolve([{ id: 'a1' }]); });
    await flush();
    expect(latest.items.map((i) => i.id)).toEqual(['b1']);
  });

  it('clears the previous profile rows while the next profile loads', async () => {
    store.set('a', deferred());
    store.set('b', deferred());
    let latest: { items: Array<{ id: string }> } = { items: [] };
    function Probe({ userId }: { userId: string }) {
      latest = useHook(userId, true);
      return null;
    }
    await act(async () => { renderer = create(<Probe userId="a" />); });
    await act(async () => { store.get('a')!.resolve([{ id: 'a1' }]); });
    await flush();
    expect(latest.items.map((i) => i.id)).toEqual(['a1']);
    await act(async () => { renderer!.update(<Probe userId="b" />); });
    expect(latest.items).toEqual([]);
  });
});

describe('useCreatorVideos', () => {
  it('drops the previous profile page when the profile becomes unresolved', async () => {
    h.videos.set('a', deferred());
    let latest: { posts: Array<{ id: string }> } = { posts: [] };
    function Probe({ userId }: { userId: string | null }) {
      latest = useCreatorVideos(userId) as unknown as { posts: Array<{ id: string }> };
      return null;
    }
    await act(async () => { renderer = create(<Probe userId="a" />); });
    await act(async () => { renderer!.update(<Probe userId={null} />); });
    await act(async () => {
      h.videos.get('a')!.resolve({ posts: [{ id: 'a1' }], total: 1, hasMore: false, restricted: null, nextOffset: 1 });
    });
    await flush();
    expect(latest.posts).toEqual([]);
  });
});

describe('useProfileNote', () => {
  it('never shows the previous profile note on the next profile', async () => {
    h.notes.push(deferred());
    let latest: { text: string } | null = null;
    function Probe({ userId }: { userId: string }) {
      latest = useProfileNote({ userId, own: false, enabled: true });
      return null;
    }
    await act(async () => { renderer = create(<Probe userId="a" />); });
    await act(async () => { h.notes[0].resolve([{ authorId: 'a', text: 'A note' }, { authorId: 'b', text: 'B note' }]); });
    await flush();
    expect(latest).toEqual({ text: 'A note', onPress: undefined });
    // Switch to B; its tray load fails.
    h.notes.push(deferred());
    await act(async () => { renderer!.update(<Probe userId="b" />); });
    await act(async () => { h.notes[1].reject(new Error('offline')); });
    await flush();
    expect(latest).toBeNull();
  });
});
