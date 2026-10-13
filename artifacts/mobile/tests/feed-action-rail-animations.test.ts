/**
 * Structure tests: the feed's action rail buttons stay solid-filled (never
 * outlined), and like / repost / save each get exactly one pop when the
 * action turns ON. No spin, drop, ring, rolling count or particles (Dev's
 * less-AI pass, items 77 / 82 / 87: an animation only exists if it tells
 * the user something happened).
 *
 * The rail lives in components/buyer-feed/RightActionRail.tsx; the pop
 * driver (popOnce) and its Animated.Values stay in app/(tabs)/feed.tsx and
 * are passed down as props.
 */
import { readFileSync } from 'node:fs';

import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const feed = readFileSync(resolve(__dirname, '../app/(tabs)/feed.tsx'), 'utf8');
const rail = readFileSync(resolve(__dirname, '../components/buyer-feed/RightActionRail.tsx'), 'utf8');
const engagementButton = readFileSync(resolve(__dirname, '../components/EngagementButton.tsx'), 'utf8');

describe('Action rail icons stay solid-filled', () => {
  it('like, repost, and save all render through FontAwesome solid glyphs', () => {
    expect(rail).toMatch(/icon="heart"\s*\n\s*solidIcon="heart"/);
    expect(rail).toMatch(/icon="repeat"\s*\n\s*solidIcon="retweet"/);
    expect(rail).toMatch(/icon="bookmark"\s*\n\s*solidIcon="bookmark"/);
  });

  it('comment and share use solid FontAwesome glyphs directly', () => {
    expect(rail).toContain('<FontAwesome name="commenting"');
    expect(rail).toContain('<FontAwesome name="share"');
  });
});

describe('One pop per action, only when it turns on', () => {
  it('repost and save pop once, and only when they turn on', () => {
    expect(feed).toContain('function popOnce(');
    expect(feed).toContain('onRepost={async () => { if (!engagement?.reposted) popOnce(repostScale); await onRepost(item.id); }}');
    expect(feed).toContain('onSave={async () => { if (!engagement?.saved) popOnce(saveScale); await onSave(item.id); }}');
  });

  it('the pop is a single 1 -> 1.15 -> 1, with no spin, drop or ring', () => {
    expect(feed).toMatch(/toValue: 1\.15, duration: 90/);
    for (const gone of ['spinRepost', 'dropSave', 'likeRing', 'repostSpin', 'saveDrop']) {
      expect(feed).not.toContain(gone);
      expect(rail).not.toContain(gone);
    }
  });

  it('the rail like pops once on like and never on unlike', () => {
    expect(engagementButton).toContain('if (tapSpring && !active) {');
    expect(engagementButton).not.toMatch(/withTiming\(0\.85/);
  });

  it('counts change instantly (no rolling digits)', () => {
    expect(engagementButton).not.toContain('<TickingCount');
    expect(engagementButton).toContain('{formatCount(value)}');
  });
});

describe('Double-tap heart', () => {
  it('appears at the tap point, not a fixed spot', () => {
    expect(feed).toContain('lastPressPoint.current = { x, y: evt.nativeEvent.locationY };');
    expect(feed).toContain('burstHeart(lastPressPoint.current);');
    expect(feed).toContain('left: heartBurstPoint.x - HEART_BURST_SIZE / 2, top: heartBurstPoint.y - HEART_BURST_SIZE / 2');
    expect(feed).not.toMatch(/heartBurst: \{[^}]*top: '38%'/);
  });

  it('plays one heart, no particle burst', () => {
    expect(feed).not.toContain('<HeartBurstParticles');
  });
});
