/**
 * Focused tests for the draft-saving and date-picker logic used in create-post.tsx.
 * These are pure-logic tests that do not depend on React Native rendering.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

// ─── Mock AsyncStorage ────────────────────────────────────────────────────────

const { storage } = vi.hoisted(() => ({
  storage: new Map<string, string>(),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem:    vi.fn(async (k: string) => storage.get(k) ?? null),
    setItem:    vi.fn(async (k: string, v: string) => { storage.set(k, v); }),
    removeItem: vi.fn(async (k: string) => { storage.delete(k); }),
    multiRemove:vi.fn(async (keys: string[]) => { keys.forEach(k => storage.delete(k)); }),
    getAllKeys:  vi.fn(async () => [...storage.keys()]),
  },
}));

// ─── Mock serviceRequest ──────────────────────────────────────────────────────

const mockServiceRequest = vi.fn();
vi.mock('@/lib/serviceConfig', () => ({
  serviceRequest: (...args: any[]) => mockServiceRequest(...args),
}));

import { initSocialService, createSellerPost, updateSellerPost } from './socialService';

const userId = 'test-seller-001';

beforeEach(() => {
  storage.clear();
  initSocialService(userId);
  mockServiceRequest.mockReset();
});

// ─── Draft save: createSellerPost ─────────────────────────────────────────────

describe('createSellerPost — draft flag', () => {
  it('sends isDraft=true to the API and returns a post with isDraft:true', async () => {
    const fakeApiPost = {
      id: 'post-draft-1',
      postStatus: 'draft',
      isDraft: true,
      caption: 'My draft',
      hashtags: [],
      styleTags: [],
      mediaUrls: [],
      contentType: 'video',
      aspectRatio: '9:16',
      visibility: { allowComments: true, allowReposts: true, showLikeCount: true },
      scheduledAt: null,
      productTags: [],
      likesCount: 0, commentsCount: 0, repostsCount: 0, savedCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    mockServiceRequest.mockResolvedValueOnce(fakeApiPost);

    const result = await createSellerPost({
      contentType: 'video',
      caption: 'My draft',
      hashtags: [],
      mediaUris: ['file://some/video.mp4'],
      isDraft: true,
    });

    // Verify the API was called with isDraft=true
    expect(mockServiceRequest).toHaveBeenCalledWith(
      '/api/posts',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"isDraft":true'),
      }),
    );

    // Verify the returned record is a draft
    expect(result.isDraft).toBe(true);
    expect(result.postStatus).toBe('draft');
  });

  it('does NOT include scheduledAt when saving a draft', async () => {
    const fakeApiPost = {
      id: 'post-draft-2',
      postStatus: 'draft', isDraft: true, caption: '',
      hashtags: [], styleTags: [], mediaUrls: [], contentType: 'video',
      aspectRatio: '9:16', visibility: { allowComments: true, allowReposts: true, showLikeCount: true },
      scheduledAt: null, productTags: [],
      likesCount: 0, commentsCount: 0, repostsCount: 0, savedCount: 0,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    mockServiceRequest.mockResolvedValueOnce(fakeApiPost);

    await createSellerPost({
      contentType: 'video', caption: '', hashtags: [],
      isDraft: true,
      scheduledAt: '2099-01-01T12:00:00.000Z', // should be suppressed
    });

    const body = JSON.parse(
      mockServiceRequest.mock.calls[0][1].body as string,
    );
    expect(body.scheduledAt).toBeNull();
  });
});

// ─── Draft save: updateSellerPost ─────────────────────────────────────────────

describe('updateSellerPost — draft flag on edit', () => {
  it('returns the updated post with postStatus=draft when isDraft patch is sent', async () => {
    const fakeUpdated = {
      id: 'post-edit-1',
      postStatus: 'draft', isDraft: true, caption: 'Updated draft',
      hashtags: [], styleTags: [], mediaUrls: [], contentType: 'video',
      aspectRatio: '9:16', visibility: { allowComments: true, allowReposts: true, showLikeCount: true },
      scheduledAt: null, productTags: [],
      likesCount: 0, commentsCount: 0, repostsCount: 0, savedCount: 0,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    mockServiceRequest.mockResolvedValueOnce(fakeUpdated);

    const result = await updateSellerPost('post-edit-1', {
      caption: 'Updated draft',
      isDraft: true,
      postStatus: 'draft',
    });

    expect(result.isDraft).toBe(true);
    expect(result.postStatus).toBe('draft');
  });
});

// ─── Date/time picker logic ───────────────────────────────────────────────────

describe('PickerState <-> ISO conversion', () => {
  // Replicate the pure functions from create-post.tsx for isolated testing

  function pickerStateToDate(s: {
    year: number; month: number; day: number;
    hour: number; minute: number; ampm: 'AM' | 'PM';
  }): Date {
    let h = s.hour % 12;
    if (s.ampm === 'PM') h += 12;
    return new Date(s.year, s.month, s.day, h, s.minute, 0, 0);
  }

  function isoFromPickerState(s: Parameters<typeof pickerStateToDate>[0]): string {
    return pickerStateToDate(s).toISOString();
  }

  function pickerStateFromISO(iso: string): {
    year: number; month: number; day: number;
    hour: number; minute: number; ampm: 'AM' | 'PM';
  } {
    const d = new Date(iso);
    let h = d.getHours();
    const ampm: 'AM' | 'PM' = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return {
      year: d.getFullYear(), month: d.getMonth(), day: d.getDate(),
      hour: h, minute: d.getMinutes(), ampm,
    };
  }

  it('converts a PM picker state to the correct Date', () => {
    const ps = { year: 2025, month: 5, day: 15, hour: 3, minute: 30, ampm: 'PM' as const };
    const d  = pickerStateToDate(ps);
    expect(d.getFullYear()).toBe(2025);
    expect(d.getMonth()).toBe(5); // June
    expect(d.getDate()).toBe(15);
    expect(d.getHours()).toBe(15); // 3 PM = 15:00
    expect(d.getMinutes()).toBe(30);
  });

  it('converts a 12 AM picker state correctly (midnight)', () => {
    const ps = { year: 2025, month: 0, day: 1, hour: 12, minute: 0, ampm: 'AM' as const };
    const d  = pickerStateToDate(ps);
    expect(d.getHours()).toBe(0); // midnight
  });

  it('converts a 12 PM picker state correctly (noon)', () => {
    const ps = { year: 2025, month: 0, day: 1, hour: 12, minute: 0, ampm: 'PM' as const };
    const d  = pickerStateToDate(ps);
    expect(d.getHours()).toBe(12);
  });

  it('round-trips an ISO string through pickerStateFromISO -> isoFromPickerState', () => {
    // Use a fixed future date to avoid locale/TZ surprises in seconds
    const original = new Date(2026, 3, 20, 14, 45, 0, 0); // 2:45 PM local
    const iso = original.toISOString();
    const ps  = pickerStateFromISO(iso);
    const back = pickerStateToDate(ps);

    expect(back.getFullYear()).toBe(original.getFullYear());
    expect(back.getMonth()).toBe(original.getMonth());
    expect(back.getDate()).toBe(original.getDate());
    expect(back.getHours()).toBe(original.getHours());
    expect(back.getMinutes()).toBe(original.getMinutes());
  });

  it('isoFromPickerState produces a valid ISO string', () => {
    const ps = { year: 2027, month: 11, day: 31, hour: 11, minute: 59, ampm: 'PM' as const };
    const iso = isoFromPickerState(ps);
    expect(() => new Date(iso)).not.toThrow();
    expect(new Date(iso).getTime()).toBeGreaterThan(0);
  });

  it('returns a future date for a future year', () => {
    const ps = { year: 2030, month: 0, day: 1, hour: 9, minute: 0, ampm: 'AM' as const };
    const d  = pickerStateToDate(ps);
    expect(d.getTime()).toBeGreaterThan(Date.now());
  });

  it('past AM/PM: recognises a past date', () => {
    const ps = { year: 2020, month: 0, day: 1, hour: 8, minute: 0, ampm: 'AM' as const };
    const d  = pickerStateToDate(ps);
    expect(d.getTime()).toBeLessThan(Date.now());
  });
});

// ─── Content tab param ────────────────────────────────────────────────────────

describe('content.tsx tab query-param validation', () => {
  const VALID_TABS = ['all', 'published', 'scheduled', 'draft', 'archived'];

  function resolveTab(param: string | undefined): string {
    return param && VALID_TABS.includes(param) ? param : 'all';
  }

  it('resolves "draft" param to "draft"', () => {
    expect(resolveTab('draft')).toBe('draft');
  });

  it('resolves "published" param to "published"', () => {
    expect(resolveTab('published')).toBe('published');
  });

  it('falls back to "all" for unknown param', () => {
    expect(resolveTab('invalid')).toBe('all');
  });

  it('falls back to "all" for undefined param', () => {
    expect(resolveTab(undefined)).toBe('all');
  });

  it('falls back to "all" for empty string', () => {
    expect(resolveTab('')).toBe('all');
  });

  it('all valid tabs resolve correctly', () => {
    VALID_TABS.forEach(t => {
      expect(resolveTab(t)).toBe(t);
    });
  });
});
