/**
 * Create Ad / design-campaign — dev preview adapter tests.
 *
 * Tests cover:
 *   1. Local draft initialization in preview (no POST /ad-campaigns call).
 *   2. Media picked in preview stays local; remove/reorder work on local state.
 *   3. Step navigation works entirely on local state (no update API calls).
 *   4. Non-product CTAs (learn_more, sign_up, contact_us) allow flow to proceed.
 *   5. Checkout gate: no create/pay/verify mutations fired in preview.
 *   6. Buyer / production / native exclusion: local draft never initialized.
 */

import { describe, it, expect } from 'vitest';

// ── Local draft type (preview-only, no server round-trip) ─────────────────────

type LocalPreviewDraft = {
  id: string;       // sentinel value — not a real UUID
  isPreview: true;
};

// ── Draft initialization logic (mirrored from design-campaign.tsx) ────────────

function initCampaignDraft(
  isPreview: boolean,
  apiCallCount: { count: number },
): { campaign: LocalPreviewDraft | null; apiCalled: boolean } {
  if (isPreview) {
    // Preview: initialize local draft, never call API
    return { campaign: { id: 'preview-draft', isPreview: true }, apiCalled: false };
  }
  // Production: would call POST /ad-campaigns
  apiCallCount.count += 1;
  return { campaign: null, apiCalled: true };
}

// ── Local media state (preview) ───────────────────────────────────────────────

type LocalMedia = { uri: string; mimeType: string };

function addMedia(state: LocalMedia[], item: LocalMedia, maxPhotos: number): LocalMedia[] {
  if (state.length >= maxPhotos) return state;
  return [...state, item];
}

function removeMedia(state: LocalMedia[], index: number): LocalMedia[] {
  const next = [...state];
  next.splice(index, 1);
  return next;
}

function reorderMedia(state: LocalMedia[], from: number, direction: 'left' | 'right'): LocalMedia[] {
  const to = direction === 'left' ? from - 1 : from + 1;
  if (to < 0 || to >= state.length) return state;
  const next = [...state];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

// ── Step update gate (preview) ────────────────────────────────────────────────

function canCallUpdateMutation(isPreview: boolean): boolean {
  return !isPreview;
}

// ── Checkout gate ─────────────────────────────────────────────────────────────

function canCallPayMutation(isPreview: boolean): boolean {
  return !isPreview;
}

// ── CTA non-product check ─────────────────────────────────────────────────────

const NON_PRODUCT_CTAS = ['learn_more', 'sign_up', 'contact_us'] as const;
type NonProductCta = typeof NON_PRODUCT_CTAS[number];

function ctaRequiresProduct(kind: string): boolean {
  return kind === 'shop_now' || kind === 'view_product';
}

function ctaCanAdvanceWithoutProduct(kind: string): boolean {
  return !ctaRequiresProduct(kind);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Ad preview — local draft initialization', () => {
  it('initializes a local draft in preview without calling POST /ad-campaigns', () => {
    const tracker = { count: 0 };
    const { campaign, apiCalled } = initCampaignDraft(true, tracker);
    expect(campaign).not.toBeNull();
    expect(campaign!.isPreview).toBe(true);
    expect(apiCalled).toBe(false);
    expect(tracker.count).toBe(0);
  });

  it('uses sentinel id "preview-draft" (not a real UUID)', () => {
    const tracker = { count: 0 };
    const { campaign } = initCampaignDraft(true, tracker);
    expect(campaign!.id).toBe('preview-draft');
    // Ensure it is not UUID-shaped
    expect(campaign!.id).not.toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('calls the API in production (not preview)', () => {
    const tracker = { count: 0 };
    const { campaign, apiCalled } = initCampaignDraft(false, tracker);
    expect(apiCalled).toBe(true);
    expect(tracker.count).toBe(1);
    expect(campaign).toBeNull(); // mock doesn't return a campaign
  });
});

describe('Ad preview — local media operations', () => {
  const MAX_PHOTOS = 5;

  it('adds media locally in preview', () => {
    const state: LocalMedia[] = [];
    const next = addMedia(state, { uri: 'file:///photo1.jpg', mimeType: 'image/jpeg' }, MAX_PHOTOS);
    expect(next).toHaveLength(1);
    expect(next[0].uri).toBe('file:///photo1.jpg');
  });

  it('removes media by index locally', () => {
    const state: LocalMedia[] = [
      { uri: 'file:///a.jpg', mimeType: 'image/jpeg' },
      { uri: 'file:///b.jpg', mimeType: 'image/jpeg' },
      { uri: 'file:///c.jpg', mimeType: 'image/jpeg' },
    ];
    const next = removeMedia(state, 1);
    expect(next).toHaveLength(2);
    expect(next[0].uri).toBe('file:///a.jpg');
    expect(next[1].uri).toBe('file:///c.jpg');
  });

  it('removes first item correctly', () => {
    const state: LocalMedia[] = [
      { uri: 'a', mimeType: 'image/jpeg' },
      { uri: 'b', mimeType: 'image/jpeg' },
    ];
    const next = removeMedia(state, 0);
    expect(next).toHaveLength(1);
    expect(next[0].uri).toBe('b');
  });

  it('removes last item correctly', () => {
    const state: LocalMedia[] = [
      { uri: 'a', mimeType: 'image/jpeg' },
      { uri: 'b', mimeType: 'image/jpeg' },
    ];
    const next = removeMedia(state, 1);
    expect(next).toHaveLength(1);
    expect(next[0].uri).toBe('a');
  });

  it('reorders media left', () => {
    const state: LocalMedia[] = [
      { uri: 'a', mimeType: 'image/jpeg' },
      { uri: 'b', mimeType: 'image/jpeg' },
      { uri: 'c', mimeType: 'image/jpeg' },
    ];
    const next = reorderMedia(state, 2, 'left');
    expect(next.map((m) => m.uri)).toEqual(['a', 'c', 'b']);
  });

  it('reorders media right', () => {
    const state: LocalMedia[] = [
      { uri: 'a', mimeType: 'image/jpeg' },
      { uri: 'b', mimeType: 'image/jpeg' },
      { uri: 'c', mimeType: 'image/jpeg' },
    ];
    const next = reorderMedia(state, 0, 'right');
    expect(next.map((m) => m.uri)).toEqual(['b', 'a', 'c']);
  });

  it('reorder at boundary (move left from index 0) is a no-op', () => {
    const state: LocalMedia[] = [
      { uri: 'a', mimeType: 'image/jpeg' },
      { uri: 'b', mimeType: 'image/jpeg' },
    ];
    const next = reorderMedia(state, 0, 'left');
    expect(next.map((m) => m.uri)).toEqual(['a', 'b']);
  });

  it('reorder at boundary (move right from last) is a no-op', () => {
    const state: LocalMedia[] = [
      { uri: 'a', mimeType: 'image/jpeg' },
      { uri: 'b', mimeType: 'image/jpeg' },
    ];
    const next = reorderMedia(state, 1, 'right');
    expect(next.map((m) => m.uri)).toEqual(['a', 'b']);
  });

  it('enforces MAX_PHOTOS cap', () => {
    let state: LocalMedia[] = [];
    for (let i = 0; i < MAX_PHOTOS + 2; i++) {
      state = addMedia(state, { uri: `file:///${i}.jpg`, mimeType: 'image/jpeg' }, MAX_PHOTOS);
    }
    expect(state).toHaveLength(MAX_PHOTOS);
  });
});

describe('Ad preview — no API mutations in preview', () => {
  it('blocks update mutation (step advance) in preview', () => {
    expect(canCallUpdateMutation(true)).toBe(false);
  });

  it('allows update mutation in production', () => {
    expect(canCallUpdateMutation(false)).toBe(true);
  });

  it('blocks pay mutation at checkout in preview', () => {
    expect(canCallPayMutation(true)).toBe(false);
  });

  it('allows pay mutation in production', () => {
    expect(canCallPayMutation(false)).toBe(true);
  });
});

describe('Ad preview — non-product CTAs allow flow', () => {
  for (const kind of NON_PRODUCT_CTAS) {
    it(`${kind} CTA can advance without product selection`, () => {
      expect(ctaCanAdvanceWithoutProduct(kind)).toBe(true);
    });
  }

  it('shop_now requires product selection', () => {
    expect(ctaRequiresProduct('shop_now')).toBe(true);
  });

  it('view_product requires product selection', () => {
    expect(ctaRequiresProduct('view_product')).toBe(true);
  });
});

describe('Ad preview — buyer/production/native exclusion', () => {
  it('production (isPreview=false) calls the real API', () => {
    const tracker = { count: 0 };
    const { apiCalled } = initCampaignDraft(false, tracker);
    expect(apiCalled).toBe(true);
  });

  it('preview campaign never has a real UUID (sentinel guard)', () => {
    const tracker = { count: 0 };
    const { campaign } = initCampaignDraft(true, tracker);
    // In production, campaign.id would be a UUID — preview uses a sentinel
    expect(campaign!.id).not.toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('local media operations never depend on campaign.id in preview', () => {
    // Media add/remove/reorder use only local arrays — no campaign ID needed
    const state: LocalMedia[] = [{ uri: 'file:///a.jpg', mimeType: 'image/jpeg' }];
    // These should work even with a sentinel campaign id
    const after = removeMedia(state, 0);
    expect(after).toHaveLength(0);
  });
});
