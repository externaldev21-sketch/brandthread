/**
 * Photo slide editing helpers — focused unit tests.
 *
 * Tests:
 *  A. createPhotoSlide — correct initial shape
 *  B. updateSlideUploadState — state transitions, field updates
 *  C. updateSlideOverlays — per-slide overlay association
 *  D. removePhotoSlide — removal + index remapping implications
 *  E. slidesToComposePayload — ordering, uploads-only filter
 *  F. buildSlideOverlayMap — draft restoration helpers
 *  G. Per-slide overlay independence (switching slides doesn't bleed overlays)
 */
import { describe, expect, it } from 'vitest';
import {
  createPhotoSlide,
  updateSlideUploadState,
  updateSlideOverlays,
  removePhotoSlide,
  slidesToComposePayload,
  buildSlideOverlayMap,
  type EditablePhotoSlide,
  type TextOverlay,
  type SlideOverlayRecord,
} from '../videoEditing';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const makeOverlay = (id: string, text: string): TextOverlay => ({
  id, text, x: 0.5, y: 0.3,
  color: '#ffffff', fontStyle: 'classic', align: 'center',
  bgStyle: 'none', fontSize: 32,
});

const makeSlide = (id: string, uri = `file://${id}.jpg`): EditablePhotoSlide =>
  createPhotoSlide(id, uri, 'image/jpeg');

// ─── A. createPhotoSlide ──────────────────────────────────────────────────────

describe('createPhotoSlide', () => {
  it('creates a slide with idle uploadState and empty overlays', () => {
    const slide = createPhotoSlide('s1', 'file://img.jpg', 'image/jpeg');
    expect(slide.id).toBe('s1');
    expect(slide.uri).toBe('file://img.jpg');
    expect(slide.mimeType).toBe('image/jpeg');
    expect(slide.overlays).toEqual([]);
    expect(slide.uploadState).toBe('idle');
    expect(slide.objectPath).toBeUndefined();
    expect(slide.uploadError).toBeUndefined();
  });

  it('creates a slide without mimeType when omitted', () => {
    const slide = createPhotoSlide('s2', 'file://img2.jpg');
    expect(slide.mimeType).toBeUndefined();
  });
});

// ─── B. updateSlideUploadState ────────────────────────────────────────────────

describe('updateSlideUploadState', () => {
  const slides = [makeSlide('a'), makeSlide('b'), makeSlide('c')];

  it('sets uploading state without objectPath', () => {
    const result = updateSlideUploadState(slides, 'b', 'uploading');
    expect(result[1].uploadState).toBe('uploading');
    expect(result[1].objectPath).toBeUndefined();
  });

  it('sets uploaded state with objectPath', () => {
    const result = updateSlideUploadState(slides, 'b', 'uploaded', '/objects/uploads/b.jpg');
    expect(result[1].uploadState).toBe('uploaded');
    expect(result[1].objectPath).toBe('/objects/uploads/b.jpg');
  });

  it('sets error state with error message', () => {
    const result = updateSlideUploadState(slides, 'c', 'error', undefined, 'network timeout');
    expect(result[2].uploadState).toBe('error');
    expect(result[2].uploadError).toBe('network timeout');
  });

  it('does not mutate slides for unrelated ids', () => {
    const result = updateSlideUploadState(slides, 'a', 'uploading');
    expect(result[1].uploadState).toBe('idle');
    expect(result[2].uploadState).toBe('idle');
  });

  it('preserves slide order', () => {
    const result = updateSlideUploadState(slides, 'b', 'uploaded', '/objects/uploads/b.jpg');
    expect(result.map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('unknown id leaves all slides unchanged', () => {
    const result = updateSlideUploadState(slides, 'unknown', 'uploaded');
    result.forEach((s, i) => expect(s).toEqual(slides[i]));
  });
});

// ─── C. updateSlideOverlays — per-slide overlay association ───────────────────

describe('updateSlideOverlays', () => {
  const ov1 = makeOverlay('o1', 'Hello slide A');
  const ov2 = makeOverlay('o2', 'Hello slide B');

  it('associates overlays with the correct slide only', () => {
    const slides = [makeSlide('a'), makeSlide('b')];
    const result = updateSlideOverlays(slides, 'a', [ov1]);
    expect(result[0].overlays).toEqual([ov1]);
    expect(result[1].overlays).toEqual([]); // slide b untouched
  });

  it('replaces existing overlays for that slide', () => {
    const base = updateSlideOverlays([makeSlide('a')], 'a', [ov1]);
    const updated = updateSlideOverlays(base, 'a', [ov2]);
    expect(updated[0].overlays).toEqual([ov2]);
  });

  it('updating slide B overlays does not touch slide A overlays', () => {
    const slides = [makeSlide('a'), makeSlide('b')];
    const withA = updateSlideOverlays(slides, 'a', [ov1]);
    const withB = updateSlideOverlays(withA, 'b', [ov2]);
    expect(withB[0].overlays).toEqual([ov1]);
    expect(withB[1].overlays).toEqual([ov2]);
  });

  it('can clear overlays by passing empty array', () => {
    const base = updateSlideOverlays([makeSlide('a')], 'a', [ov1]);
    const cleared = updateSlideOverlays(base, 'a', []);
    expect(cleared[0].overlays).toEqual([]);
  });

  it('does not mutate the original slides array', () => {
    const slides = [makeSlide('a')];
    const snapshot = JSON.stringify(slides);
    updateSlideOverlays(slides, 'a', [ov1]);
    expect(JSON.stringify(slides)).toBe(snapshot);
  });
});

// ─── D. removePhotoSlide ──────────────────────────────────────────────────────

describe('removePhotoSlide', () => {
  it('removes slide by id', () => {
    const slides = [makeSlide('a'), makeSlide('b'), makeSlide('c')];
    const result = removePhotoSlide(slides, 'b');
    expect(result.map((s) => s.id)).toEqual(['a', 'c']);
  });

  it('preserves remaining slides in order', () => {
    const slides = [makeSlide('x'), makeSlide('y'), makeSlide('z')];
    const result = removePhotoSlide(slides, 'x');
    expect(result.map((s) => s.id)).toEqual(['y', 'z']);
  });

  it('removing a slide shrinks the array by exactly 1', () => {
    const slides = [makeSlide('a'), makeSlide('b')];
    expect(removePhotoSlide(slides, 'a')).toHaveLength(1);
  });

  it('unknown id leaves array unchanged', () => {
    const slides = [makeSlide('a'), makeSlide('b')];
    const result = removePhotoSlide(slides, 'missing');
    expect(result).toHaveLength(2);
  });

  it('index remapping: overlay map built from remaining slides has correct new indices', () => {
    // Simulate: 3 slides, remove index 1, overlays for old index 2 become index 1
    const slides = [makeSlide('a'), makeSlide('b'), makeSlide('c')];
    const withOverlays = updateSlideOverlays(slides, 'c', [makeOverlay('o1', 'C text')]);
    const after = removePhotoSlide(withOverlays, 'b');

    // after = [slide a (idx 0), slide c (idx 1)]
    // the SlideOverlayRecord for slide c should now be at index 1
    const overlayRecords: SlideOverlayRecord[] = after.map((s, idx) => ({
      slideIndex: idx,
      overlays: s.overlays,
    }));
    expect(overlayRecords[0].slideIndex).toBe(0);
    expect(overlayRecords[0].overlays).toHaveLength(0);
    expect(overlayRecords[1].slideIndex).toBe(1);
    expect(overlayRecords[1].overlays[0].text).toBe('C text');
  });
});

// ─── E. slidesToComposePayload ────────────────────────────────────────────────

describe('slidesToComposePayload', () => {
  it('excludes slides without objectPath (not yet uploaded)', () => {
    const slides = [
      makeSlide('a'),                           // no objectPath
      { ...makeSlide('b'), objectPath: '/objects/uploads/b.jpg', uploadState: 'uploaded' as const },
      makeSlide('c'),                           // no objectPath
    ];
    const payload = slidesToComposePayload(slides);
    expect(payload).toHaveLength(1);
    expect(payload[0].objectPath).toBe('/objects/uploads/b.jpg');
  });

  it('preserves original slide order in the payload', () => {
    const slides: EditablePhotoSlide[] = [
      { ...makeSlide('s1'), objectPath: '/objects/uploads/s1.jpg', uploadState: 'uploaded' },
      { ...makeSlide('s2'), objectPath: '/objects/uploads/s2.jpg', uploadState: 'uploaded' },
      { ...makeSlide('s3'), objectPath: '/objects/uploads/s3.jpg', uploadState: 'uploaded' },
    ];
    const payload = slidesToComposePayload(slides);
    expect(payload.map((p) => p.objectPath)).toEqual([
      '/objects/uploads/s1.jpg',
      '/objects/uploads/s2.jpg',
      '/objects/uploads/s3.jpg',
    ]);
  });

  it('includes overlays for each slide in payload', () => {
    const ov = makeOverlay('o1', 'Caption');
    const slides: EditablePhotoSlide[] = [
      { ...makeSlide('a'), objectPath: '/objects/uploads/a.jpg', uploadState: 'uploaded', overlays: [ov] },
    ];
    const payload = slidesToComposePayload(slides);
    expect(payload[0].overlays).toEqual([ov]);
  });

  it('returns empty array when no slides have been uploaded', () => {
    const slides = [makeSlide('a'), makeSlide('b')];
    expect(slidesToComposePayload(slides)).toHaveLength(0);
  });

  it('payload entry count matches uploaded slide count', () => {
    const slides: EditablePhotoSlide[] = [
      { ...makeSlide('s1'), objectPath: '/objects/uploads/s1.jpg', uploadState: 'uploaded' },
      makeSlide('s2'), // not uploaded
      { ...makeSlide('s3'), objectPath: '/objects/uploads/s3.jpg', uploadState: 'uploaded' },
    ];
    expect(slidesToComposePayload(slides)).toHaveLength(2);
  });
});

// ─── F. buildSlideOverlayMap — draft restoration ──────────────────────────────

describe('buildSlideOverlayMap', () => {
  const records: SlideOverlayRecord[] = [
    { slideIndex: 0, overlays: [makeOverlay('o0', 'Slide zero')] },
    { slideIndex: 2, overlays: [makeOverlay('o2', 'Slide two')] },
  ];

  it('builds a map keyed by slideIndex', () => {
    const map = buildSlideOverlayMap(records);
    expect(map.size).toBe(2);
    expect(map.get(0)).toEqual(records[0].overlays);
    expect(map.get(2)).toEqual(records[1].overlays);
  });

  it('returns undefined for indices not present', () => {
    const map = buildSlideOverlayMap(records);
    expect(map.get(1)).toBeUndefined();
  });

  it('empty records produce empty map', () => {
    const map = buildSlideOverlayMap([]);
    expect(map.size).toBe(0);
  });

  it('draft restoration: rebuilt slides get their overlays from the map', () => {
    // Simulate restoring 3 slides from mediaPaths + slideOverlays
    const restoredSlides = ['file://1.jpg', 'file://2.jpg', 'file://3.jpg']
      .map((uri, idx) => createPhotoSlide(`s${idx}`, uri));

    const savedRecords: SlideOverlayRecord[] = [
      { slideIndex: 0, overlays: [makeOverlay('a', 'First')] },
      { slideIndex: 2, overlays: [makeOverlay('c', 'Third')] },
    ];
    const map = buildSlideOverlayMap(savedRecords);

    const restored = restoredSlides.map((s, idx) =>
      updateSlideOverlays([s], s.id, map.get(idx) ?? [])[0],
    );

    expect(restored[0].overlays[0].text).toBe('First');
    expect(restored[1].overlays).toHaveLength(0);
    expect(restored[2].overlays[0].text).toBe('Third');
  });
});

// ─── G. Slide independence: switching slides doesn't bleed overlays ───────────

describe('per-slide overlay independence', () => {
  it('editing overlays on slide 0 does not affect slide 1', () => {
    let slides = [makeSlide('s0'), makeSlide('s1')];
    const ov0 = makeOverlay('x', 'Slide zero overlay');
    slides = updateSlideOverlays(slides, 's0', [ov0]);

    // Simulate user switching to slide 1 and adding an overlay
    const ov1 = makeOverlay('y', 'Slide one overlay');
    slides = updateSlideOverlays(slides, 's1', [ov1]);

    // Slide 0 must be unchanged
    expect(slides[0].overlays).toEqual([ov0]);
    expect(slides[1].overlays).toEqual([ov1]);
  });

  it('compose payload keeps overlays per slide in order', () => {
    let slides: EditablePhotoSlide[] = [
      { ...makeSlide('s0'), objectPath: '/objects/uploads/s0.jpg', uploadState: 'uploaded' },
      { ...makeSlide('s1'), objectPath: '/objects/uploads/s1.jpg', uploadState: 'uploaded' },
    ];
    slides = updateSlideOverlays(slides, 's0', [makeOverlay('o0', 'Slide A')]);
    slides = updateSlideOverlays(slides, 's1', [makeOverlay('o1', 'Slide B')]);

    const payload = slidesToComposePayload(slides);
    expect(payload[0].overlays[0].text).toBe('Slide A');
    expect(payload[1].overlays[0].text).toBe('Slide B');
  });

  it('moving overlay from slide 0 to slide 1 removes it from slide 0', () => {
    const ov = makeOverlay('mv', 'Moving overlay');
    let slides = [makeSlide('s0'), makeSlide('s1')];
    slides = updateSlideOverlays(slides, 's0', [ov]);

    // "Move" = remove from s0, add to s1
    slides = updateSlideOverlays(slides, 's0', []);
    slides = updateSlideOverlays(slides, 's1', [ov]);

    expect(slides[0].overlays).toHaveLength(0);
    expect(slides[1].overlays).toEqual([ov]);
  });
});
