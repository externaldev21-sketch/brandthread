import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DISMISS_DISTANCE, DISMISS_VELOCITY, backdropOpacityFor, shouldDismiss } from '@/lib/mediaDismiss';

const root = path.resolve(__dirname, '..');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');

describe('swipe down to close (item 53)', () => {
  it('closes past the distance or the fling speed, either direction', () => {
    expect(shouldDismiss(DISMISS_DISTANCE + 1, 0)).toBe(true);
    expect(shouldDismiss(-(DISMISS_DISTANCE + 1), 0)).toBe(true);
    expect(shouldDismiss(30, DISMISS_VELOCITY + 1)).toBe(true);
  });
  it('settles back on a short, slow drag', () => {
    expect(shouldDismiss(DISMISS_DISTANCE - 1, DISMISS_VELOCITY - 1)).toBe(false);
    expect(shouldDismiss(0, 0)).toBe(false);
  });
  it('thins the backdrop with the drag but never clears it', () => {
    expect(backdropOpacityFor(0)).toBe(1);
    expect(backdropOpacityFor(DISMISS_DISTANCE)).toBeCloseTo(2 / 3);
    expect(backdropOpacityFor(10_000)).toBe(0.2);
    expect(backdropOpacityFor(-60)).toBe(backdropOpacityFor(60));
  });
});

describe('PhotoViewer (item 52: pinch-zoom on product photos)', () => {
  const viewer = read('components/media/PhotoViewer.tsx');
  it('pinches around the fingers, pans while zoomed, double-taps, swipes down to close', () => {
    expect(viewer).toContain('Gesture.Pinch()');
    expect(viewer).toContain('e.focalX');
    expect(viewer).toContain('Gesture.Tap()');
    expect(viewer).toContain('.numberOfTaps(2)');
    expect(viewer).toContain('shouldDismiss(e.translationY, e.velocityY)');
    expect(viewer).toContain('scrollEnabled={!zoomed && images.length > 1}');
  });
  it('is Faire\'s image preview: black page, close top right, thumbnail strip, no counter or caption', () => {
    expect(viewer).toContain('accessibilityLabel="Close photo"');
    expect(viewer).toContain('styles.thumbBar');
    expect(viewer).not.toMatch(/\{index \+ 1\}\s*\/\s*\{images\.length\}/);
  });
});

describe('every full-screen media viewer closes with a swipe down', () => {
  it('product page photos open the PhotoViewer on tap', () => {
    const pdp = read('app/buyer-product-detail.tsx');
    expect(pdp).toContain("import { PhotoViewer } from '@/components/media/PhotoViewer';");
    expect(pdp).toContain('onOpen={() => setViewerIndex(index)} />');
  });
  it('the shop sheet and review photos use the PhotoViewer', () => {
    expect(read('components/ShopProductSheet.tsx')).toContain('<PhotoViewer visible images={imageUris} initialIndex={startIndex} onClose={onClose} />');
    expect(read('components/ProductReviewsSection.tsx')).toContain('<PhotoViewer visible images={photos} initialIndex={startIndex} onClose={onClose} />');
  });
  it('video messages and AI results are wrapped in SwipeDownToDismiss', () => {
    expect(read('components/chat/VideoMessageViewer.tsx')).toContain('<SwipeDownToDismiss onDismiss={onClose}');
    expect(read('components/ai-tools/AiResultViewer.tsx')).toContain('<SwipeDownToDismiss onDismiss={onClose}>');
  });
});
