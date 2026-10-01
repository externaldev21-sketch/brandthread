import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { activeCaptionSegment } from '@/lib/captionSegments';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('activeCaptionSegment', () => {
  const segments = [
    { start: 0, end: 2, text: 'one' },
    { start: 3, end: 5, text: 'two' },
  ];
  it('returns the segment covering the time', () => {
    expect(activeCaptionSegment(segments, 0)?.text).toBe('one');
    expect(activeCaptionSegment(segments, 1.99)?.text).toBe('one');
    expect(activeCaptionSegment(segments, 4)?.text).toBe('two');
  });
  it('returns null between cues, after the end, and for no segments', () => {
    expect(activeCaptionSegment(segments, 2)).toBeNull();
    expect(activeCaptionSegment(segments, 2.5)).toBeNull();
    expect(activeCaptionSegment(segments, 5)).toBeNull();
    expect(activeCaptionSegment([], 1)).toBeNull();
  });
});

describe('autoCaptions wiring', () => {
  it('is a feature flag that defaults to off', () => {
    const src = read('contexts/FeatureFlagContext.tsx');
    expect(src).toMatch(/\| 'autoCaptions'/);
    expect(src).toMatch(/autoCaptions: false/);
  });

  it('shows the overlay and CC toggle in the post viewer only behind the flag and a ready track', () => {
    const src = read('app/buyer-post-viewer.tsx');
    expect(src).toContain("useFeatureFlag('autoCaptions')");
    expect(src).toMatch(/captionTrack \? \(\s*<TouchableOpacity[\s\S]*testID="captions-toggle"/);
    expect(src).toContain('CaptionsOverlay');
  });

  it('keeps the overlay monochrome: solid black pill, white text', () => {
    const src = read('components/social/CaptionsOverlay.tsx');
    expect(src).toContain("backgroundColor: '#000000'");
    expect(src).toContain("color: '#FFFFFF'");
    expect(src).not.toMatch(/rgba\(|opacity|#[0-9a-f]{8}\b/i);
  });

  it('offers owner-only generate/edit entry and registers the edit screen', () => {
    expect(read('app/buyer-post-viewer.tsx')).toMatch(/isOwner && postType === 'video' && captionsFlag/);
    expect(read('app/_layout.tsx')).toContain('name="post-captions-edit"');
  });
});
