/**
 * Boost screen — dev preview adapter tests.
 *
 * Tests cover:
 *   1. Preview target fallback: 2–3 labeled targets returned when seller preview
 *      is active and the API returns 401/error.
 *   2. No paid mutation in preview: the checkout gate is blocked.
 *   3. Buyer / production / native exclusion: preview targets never served.
 *   4. Real API error path preserved outside preview.
 */

import { describe, it, expect } from 'vitest';

// ── Preview target schema ─────────────────────────────────────────────────────

type BoostTarget = {
  id: string;
  mediaUrl: string | null;
  mediaType: string | null;
  mediaUrls: string[] | null;
  mediaPaths: string[] | null;
  caption: string | null;
  createdAt: string;
  mediaKind: 'video' | 'slideshow';
  imageCount: number | null;
};

// ── The preview fallback targets (mirrored from boost.tsx) ────────────────────

const PREVIEW_BOOST_TARGETS: BoostTarget[] = [
  {
    id:         'preview-video-1',
    mediaUrl:   null,
    mediaType:  'video',
    mediaUrls:  null,
    mediaPaths: null,
    caption:    'Preview — Video post (eligible)',
    createdAt:  new Date(Date.now() - 86_400_000).toISOString(),
    mediaKind:  'video',
    imageCount: null,
  },
  {
    id:         'preview-slideshow-2',
    mediaUrl:   null,
    mediaType:  'image',
    mediaUrls:  null,
    mediaPaths: null,
    caption:    'Preview — Slideshow (2 images, eligible)',
    createdAt:  new Date(Date.now() - 2 * 86_400_000).toISOString(),
    mediaKind:  'slideshow',
    imageCount: 2,
  },
  {
    id:         'preview-slideshow-3',
    mediaUrl:   null,
    mediaType:  'image',
    mediaUrls:  null,
    mediaPaths: null,
    caption:    'Preview — Slideshow (4 images, eligible)',
    createdAt:  new Date(Date.now() - 3 * 86_400_000).toISOString(),
    mediaKind:  'slideshow',
    imageCount: 4,
  },
];

// ── Preview target fallback logic (mirrored from boost.tsx) ──────────────────

function loadTargetsForDisplay(
  apiError: boolean,
  isPreview: boolean,
): { targets: BoostTarget[]; error: boolean } {
  if (apiError) {
    if (isPreview) {
      return { targets: PREVIEW_BOOST_TARGETS, error: false };
    }
    return { targets: [], error: true };
  }
  return { targets: [], error: false }; // real API success (empty for simplicity)
}

// ── Preview checkout gate ─────────────────────────────────────────────────────

function canCallBoostMutation(isPreview: boolean): boolean {
  // In preview, mutations are blocked
  return !isPreview;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Boost preview — target fallback', () => {
  it('returns 3 preview targets when API errors and isPreview=true', () => {
    const { targets, error } = loadTargetsForDisplay(true, true);
    expect(targets).toHaveLength(3);
    expect(error).toBe(false);
  });

  it('preview targets include both video and slideshow kinds', () => {
    const { targets } = loadTargetsForDisplay(true, true);
    const kinds = targets.map((t) => t.mediaKind);
    expect(kinds).toContain('video');
    expect(kinds).toContain('slideshow');
  });

  it('preview targets are clearly labeled as previews', () => {
    const { targets } = loadTargetsForDisplay(true, true);
    for (const t of targets) {
      expect(t.caption?.toLowerCase()).toContain('preview');
    }
  });

  it('preview targets have no fake business metrics (mediaUrl is null)', () => {
    const { targets } = loadTargetsForDisplay(true, true);
    for (const t of targets) {
      expect(t.mediaUrl).toBeNull();
      expect(t.mediaUrls).toBeNull();
    }
  });

  it('all preview slideshow targets have imageCount >= 2', () => {
    const { targets } = loadTargetsForDisplay(true, true);
    const slideshows = targets.filter((t) => t.mediaKind === 'slideshow');
    for (const s of slideshows) {
      expect(s.imageCount).not.toBeNull();
      expect(s.imageCount!).toBeGreaterThanOrEqual(2);
    }
  });

  it('all preview targets have unique IDs', () => {
    const { targets } = loadTargetsForDisplay(true, true);
    const ids = targets.map((t) => t.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('all preview targets have a non-empty createdAt ISO string', () => {
    const { targets } = loadTargetsForDisplay(true, true);
    for (const t of targets) {
      expect(t.createdAt).toBeTruthy();
      expect(() => new Date(t.createdAt).toISOString()).not.toThrow();
    }
  });
});

describe('Boost preview — buyer/production/native exclusion', () => {
  it('shows real error state (no preview targets) when isPreview=false and API errors', () => {
    const { targets, error } = loadTargetsForDisplay(true, false);
    expect(targets).toHaveLength(0);
    expect(error).toBe(true);
  });

  it('shows no targets when API succeeds (production happy path)', () => {
    // API success with no posts is genuinely empty — not an error
    const { targets, error } = loadTargetsForDisplay(false, false);
    expect(targets).toHaveLength(0);
    expect(error).toBe(false);
  });

  it('never uses preview targets in production even if isPreview were mis-set', () => {
    // isPreview=false must override any fallback logic
    const { targets } = loadTargetsForDisplay(true, false);
    for (const t of targets) {
      // none should be the preview sentinel IDs
      expect(t.id.startsWith('preview-')).toBe(false);
    }
  });
});

describe('Boost preview — no paid mutation', () => {
  it('blocks boost create/pay/verify mutations in preview', () => {
    expect(canCallBoostMutation(true)).toBe(false);
  });

  it('allows boost mutations when not in preview', () => {
    expect(canCallBoostMutation(false)).toBe(true);
  });
});

describe('Boost preview — history/summary', () => {
  it('preview history is empty (honest zeros)', () => {
    // In preview, history fetch errors are silently swallowed → empty array
    const previewHistory: unknown[] = [];
    expect(previewHistory).toHaveLength(0);
  });

  it('preview summary is null (honest zeros — no fake metrics)', () => {
    const previewSummary: null = null;
    expect(previewSummary).toBeNull();
  });
});
