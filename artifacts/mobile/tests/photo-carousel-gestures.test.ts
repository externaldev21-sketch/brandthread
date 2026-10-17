import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('shared photo pager wiring', () => {
  const pager = read('components/media/ZoomablePhotoPager.tsx');
  it('uses the sticky per-touch lock, not a fresh direction per move', () => {
    expect(pager).toContain('panMoveDecision(');
    expect(pager).toContain('touchDownLock(');
    expect(pager).toContain('pinchTouchDecision(');
    expect(pager).not.toMatch(/decideDirection\(/);
    expect(pager).toMatch(/\.manualActivation\(true\)[\s\S]*\.manualActivation\(true\)/);
  });
  it('blocks the native parent scroll from both pan and pinch', () => {
    expect(pager).toContain('pan.blocksExternalGesture(parentScroll)');
    expect(pager).toContain('pinch.blocksExternalGesture(parentScroll)');
  });
  it('allows browser vertical scrolling until zoom owns the touch', () => {
    expect(read('components/media/ParentScrollGesture.tsx')).toContain('touchAction="pan-y"');
    expect(pager).toContain("touchAction={zoomed ? 'none' : 'pan-y'}");
  });
  it('waits for a measured pinch focal point rather than activating on pointer-add', () => {
    const pinch = pager.slice(pager.indexOf('const pinch = Gesture.Pinch()'), pager.indexOf('// Native parent scroll'));
    expect(pinch).toContain('.onTouchesMove');
    expect(pinch).not.toContain('.onTouchesDown');
  });
  it('does not let browser dot focus scroll the clipped paging surface', () => {
    expect(pager).toContain("overflow: 'clip' as ViewStyle['overflow']");
    expect(pager).toContain("Platform.OS === 'web' && WEB_NONSCROLL_CLIP");
  });
  it('cleans up canceled pinch, blur and deactivation; subscribes to shared index', () => {
    expect(pager).toMatch(/onFinalize\(\(_e, success\)/);
    expect(pager).toContain('useIsFocused');
    expect(pager).toContain('subscribeSlide(postId');
  });
  it('dots stop propagation and are tappable', () => {
    expect(pager).toContain('testID={`carousel-dot-${i}`}');
    expect(pager).toContain('e.stopPropagation?.()');
  });
  it('keeps feed dots outside the caption and sound hit areas', () => {
    expect(read('app/(tabs)/feed.tsx')).toContain('indicatorBottom={bottomClearance + CAPTION_BOTTOM_GAP + captionBlockHeight + 8}');
  });
  it('feed list and viewer scroll are wrapped in the native parent scope', () => {
    expect(read('app/(tabs)/feed.tsx')).toMatch(/<ParentScrollGestureScope><FlatList\s+ref=\{feedListRef\}/);
    expect(read('app/buyer-post-viewer.tsx')).toMatch(/<ParentScrollGestureScope>\s*<Animated\.ScrollView/);
  });
  it('zoom host is above nav and lifts only after the image paints', () => {
    const host = read('components/media/PhotoZoomHost.tsx');
    expect(host).toContain('zIndex: 9999');
    expect(host).toMatch(/onLoad=\{\(\) => \{ lifted\.value = true; \}\}/);
    expect(host).not.toContain('onLayout');
    expect(read('app/_layout.tsx')).toContain('<PhotoZoomHost />');
  });
  it('PostCarousel keeps web arrows (hidden while zoomed) and authored ratios', () => {
    const pc = read('components/social/PostCarousel.tsx');
    expect(pc).toContain('testID="carousel-prev"');
    expect(pc).toContain('testID="carousel-next"');
    expect(pc).toContain('!zoomed');
    expect(pc).toContain('parseAspect(aspectRatio)');
    expect(read('app/buyer-post-viewer.tsx')).toContain('aspectRatio={post?.aspectRatio}');
  });
});
