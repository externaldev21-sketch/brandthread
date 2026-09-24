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
  it('is checked once per account and only on the buyer surface', () => {
    expect(feed).toContain('if (!isBuyerSurface) return;');
    expect(feed).toContain('hasSeenFeedGestureGuide(userId)');
    expect(feed).toContain('{isBuyerSurface && (');
    expect(feed).toContain('<FeedGestureGuide visible={showGestureGuide} onDismiss={dismissGestureGuide} />');
  });

  it('marks itself seen on dismiss so it never shows again for that account', () => {
    expect(feed).toContain('markFeedGestureGuideSeen(userId)');
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

  it('dims/blurs the feed behind it', () => {
    expect(guide).toContain('<BlurView');
    expect(guide).toContain('styles.dim');
  });
});
