/**
 * Structure tests: the feed's action rail buttons stay solid-filled (never
 * outlined) and get distinct micro-animations — repost spins/morphs, save
 * drops/settles — each with haptics, on top of the existing like burst.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const feed = readFileSync(resolve(__dirname, '../app/(tabs)/feed.tsx'), 'utf8');
const engagementButton = readFileSync(resolve(__dirname, '../components/EngagementButton.tsx'), 'utf8');

describe('Action rail icons stay solid-filled', () => {
  it('like, repost, and save all render through FontAwesome solid glyphs', () => {
    expect(feed).toMatch(/icon="heart"\s*\n\s*solidIcon="heart"/);
    expect(feed).toMatch(/icon="repeat"\s*\n\s*solidIcon="retweet"/);
    expect(feed).toMatch(/icon="bookmark"\s*\n\s*solidIcon="bookmark"/);
  });

  it('comment and share use solid FontAwesome glyphs directly', () => {
    expect(feed).toContain('<FontAwesome name="commenting"');
    expect(feed).toContain('<FontAwesome name="share"');
  });
});

describe('Repost and save micro-animations', () => {
  it('repost spins a full turn on toggle, with haptics', () => {
    expect(feed).toContain('function spinRepost(');
    expect(feed).toContain('rotateAnim={repostSpin}');
    expect(feed).toMatch(/onPress=\{async \(\) => \{\s*spinRepost\(\);\s*Haptics\.impactAsync/);
  });

  it('save lifts then drops/settles on toggle, with haptics', () => {
    expect(feed).toContain('function dropSave(');
    expect(feed).toContain('translateYAnim={saveDrop}');
    expect(feed).toMatch(/onPress=\{async \(\) => \{\s*dropSave\(\);\s*Haptics\.impactAsync/);
  });

  it('EngagementButton composes rotate and translateY alongside the existing scale animation', () => {
    expect(engagementButton).toContain('rotateAnim?: Animated.Value');
    expect(engagementButton).toContain('translateYAnim?: Animated.Value');
    expect(engagementButton).toContain("outputRange: ['0deg', '360deg']");
    expect(engagementButton).toContain('outputRange: [0, -6, 0]');
  });
});
