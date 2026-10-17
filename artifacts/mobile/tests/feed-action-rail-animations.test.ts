/**
 * Structure tests: the feed's action rail buttons stay solid-filled (never
 * outlined) and keep their micro-animations — the like bump + ring and the
 * save drop/settle — each with haptics, on top of the double-tap burst.
 *
 * The rail lives in components/buyer-feed/RightActionRail.tsx and renders
 * once above the pager; the animation-driving functions (bumpRailHeart/
 * dropRailSave) and their Animated.Values live in app/(tabs)/feed.tsx.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const feed = readFileSync(resolve(__dirname, '../app/(tabs)/feed.tsx'), 'utf8');
const rail = readFileSync(resolve(__dirname, '../components/buyer-feed/RightActionRail.tsx'), 'utf8');

describe('Action rail icons stay solid-filled', () => {
  it('like, comment, save and share all render solid FontAwesome glyphs', () => {
    expect(rail).toMatch(/icon="heart"/);
    expect(rail).toMatch(/icon="commenting"/);
    expect(rail).toMatch(/icon="bookmark"/);
    expect(rail).toMatch(/icon="share"/);
    expect(rail).toContain('<FontAwesome name={icon}');
  });

  it('has no repost button (repost lives in the share sheet)', () => {
    expect(rail).not.toMatch(/onRepost|repost-btn|retweet/);
  });
});

describe('Like and save micro-animations', () => {
  // The rail renders once above the pager (ThreadRailOverlay in feed.tsx);
  // its Animated.Values are created once in FeedScreen and shared with the
  // double-tap gesture inside each page.
  it('like bumps the heart and flashes the ring, with haptics', () => {
    expect(feed).toContain('function bumpRailHeart(');
    expect(feed).toContain('onLike={async () => { bumpRailHeart(anims); await onLike(item.id); }}');
    expect(rail).toContain('scale={anims.heartScale}');
    expect(rail).toContain("onPress={() => { hapticLight(); void onLike(); }}");
  });

  it('double-tap like bumps the same rail heart', () => {
    expect(feed).toContain('bumpRailHeart(railAnims);');
  });

  it('save lifts then drops/settles on toggle, with haptics', () => {
    expect(feed).toContain('function dropRailSave(');
    expect(feed).toContain('onSave={async () => { dropRailSave(anims); await onSave(item.id); }}');
    expect(rail).toContain('scale={anims.saveScale}');
    expect(rail).toContain('outputRange: [0, -6, 0]');
    expect(rail).toContain("onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); void onSave(); }}");
  });
});
