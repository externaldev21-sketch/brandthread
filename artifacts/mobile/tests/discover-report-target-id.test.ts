import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/services/socialService', () => ({ getBlockedUsers: vi.fn(), getMutedUsers: vi.fn() }));
vi.mock('@/lib/previewCatalog', () => ({ isPreviewCatalogEnabled: () => false }));
vi.mock('@/lib/guestMutedWords', () => ({ matchesGuestMutedWords: () => false, readGuestMutedWords: async () => [] }));
vi.mock('@/lib/previewDiscover', () => ({
  getPreviewDiscoverPosts: () => [], getPreviewBrandCards: () => [], getPreviewDiscoverPeople: () => [], getPreviewDrops: () => [],
}));

import { discoverPostTargetId } from '@/lib/discoverFeed';

const read = (path: string) => readFileSync(resolve(__dirname, '..', path), 'utf8');
const POST = '3f1c2a4e-9b7d-4c1e-8a2f-0d5e6b7c8d9e';

describe('Discover report target id', () => {
  it('strips the source namespace so /api/reports gets the real post id', () => {
    expect(discoverPostTargetId(`trend_${POST}`)).toBe(POST);
    expect(discoverPostTargetId(`friend_${POST}`)).toBe(POST);
    expect(discoverPostTargetId(POST)).toBe(POST);
  });

  it('Discover and Search report the bare post id', () => {
    for (const file of ['app/(buyer)/discover.tsx', 'app/buyer-search.tsx']) {
      expect(read(file), file).toContain('targetId: discoverPostTargetId(safetyMenuPost.id)');
    }
  });
});
