/**
 * Structure tests: the buyer feed shows the first-time gesture coach once
 * per account, dismissible by any tap, listing the four gestures.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const feed = readFileSync(resolve(__dirname, '../app/(tabs)/feed.tsx'), 'utf8');
const guide = readFileSync(resolve(__dirname, '../components/FeedGestureGuide.tsx'), 'utf8');

describe('Feed gesture guide wiring', () => {
  it('is checked once per account, only on the buyer surface, after auth has settled', () => {
    expect(feed).toContain('if (!isBuyerSurface || !authSettled || gestureGuideShownRef.current) return;');
    expect(feed).toContain('hasSeenFeedGestureGuide(userId, api)');
    expect(feed).toContain('{isBuyerSurface && (');
    expect(feed).toContain('<FeedGestureGuide visible={showGestureGuide} onDismiss={dismissGestureGuide} />');
  });

  it('marks itself seen the moment it is shown (not only on dismiss), server-side and locally', () => {
    const show = feed.indexOf('setShowGestureGuide(true);');
    const mark = feed.indexOf('markFeedGestureGuideSeen(userId, api)', show);
    expect(show).toBeGreaterThan(-1);
    expect(mark - show).toBeLessThan(80);
  });
});

describe('Feed gesture guide content', () => {
  it('dismisses on any tap', () => {
    expect(guide).toContain('onPress={onDismiss}');
    expect(guide).toContain('Tap to keep watching');
  });

  it('lists all four gestures', () => {
    expect(guide).toContain("title: 'Swipe up'");
    expect(guide).toContain("title: 'Double tap'");
    expect(guide).toContain("title: 'Hold the right side'");
    expect(guide).toContain("title: 'Drag the bar'");
  });

  it('hides the feed behind it: near-opaque black backdrop, white "Keep watching" button', () => {
    expect(guide).toContain("backgroundColor: 'rgba(0,0,0,0.94)'");
    expect(guide).not.toContain('<BlurView');
    expect(guide).toContain('Keep watching');
    expect(guide).toContain("backgroundColor: '#FFFFFF'");
  });
});
