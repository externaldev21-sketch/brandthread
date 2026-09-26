/**
 * Structure tests: the feed's action rail buttons stay solid-filled (never
 * outlined) and get distinct micro-animations — repost spins/morphs, save
 * drops/settles — each with haptics, on top of the existing like burst.
 *
 * The rail itself moved into its own component as part of the buyer feed
 * presentation-layer rebuild (see components/buyer-feed/RightActionRail.tsx);
 * the animation-driving functions (spinRepost/dropSave/bumpHeart) and their
 * Animated.Values stayed in app/(tabs)/feed.tsx and are passed down as props.
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

describe('Repost and save micro-animations', () => {
  it('repost spins a full turn on toggle, with haptics', () => {
    expect(feed).toContain('function spinRepost(');
    expect(rail).toContain('rotateAnim={repostSpin}');
    expect(rail).toContain('onPress={async () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); await onRepost(); }}');
    expect(feed).toContain('onRepost={async () => { spinRepost(); await onRepost(item.id); }}');
  });

  it('save lifts then drops/settles on toggle, with haptics', () => {
    expect(feed).toContain('function dropSave(');
    expect(rail).toContain('translateYAnim={saveDrop}');
    expect(rail).toContain('onPress={async () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); await onSave(); }}');
    expect(feed).toContain('onSave={async () => { dropSave(); await onSave(item.id); }}');
  });

  it('EngagementButton composes rotate and translateY alongside the existing scale animation', () => {
    expect(engagementButton).toContain('rotateAnim?: Animated.Value');
    expect(engagementButton).toContain('translateYAnim?: Animated.Value');
    expect(engagementButton).toContain("outputRange: ['0deg', '360deg']");
    expect(engagementButton).toContain('outputRange: [0, -6, 0]');
  });
});
