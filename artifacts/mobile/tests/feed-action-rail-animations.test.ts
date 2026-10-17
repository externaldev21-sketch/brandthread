/**
 * Structure tests: the rail uses one filled SVG family, with a cutout
 * filled bookmark with a silver saved state. The rebuild uses UI-thread heart pop/shrink,
 * repost rotation and bookmark bounce, not the retired icon-font driver.
 */
import { readFileSync } from 'node:fs';

import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const feed = readFileSync(resolve(__dirname, '../app/(tabs)/feed.tsx'), 'utf8');
const rail = readFileSync(resolve(__dirname, '../components/buyer-feed/RightActionRail.tsx'), 'utf8');
const engagementButton = readFileSync(resolve(__dirname, '../components/EngagementButton.tsx'), 'utf8');
const glyph = readFileSync(resolve(__dirname, '../components/buyer-feed/RailGlyph.tsx'), 'utf8');
const burst = readFileSync(resolve(__dirname, '../components/buyer-feed/TapHeartBurst.tsx'), 'utf8');

describe('Action rail icons share one filled SVG family', () => {
  it('like, repost and save use the same custom filled SVG family', () => {
    for (const name of ['heart', 'repost']) expect(rail).toContain(`glyph="${name}"`);
    expect(rail).toContain('glyph="bookmark" count={saveCount} active={saved} activeColor={SILVER}');
    expect(glyph).toContain('fillRule="evenodd"');
    expect(glyph).toContain('react-native-svg');
    expect(rail).not.toContain('FontAwesome');
  });

  it('comment and share use the same glyph renderer', () => {
    expect(rail).toContain('glyph="comment"');
    expect(rail).toContain('glyph="share"');
    expect(rail).toContain('<RailGlyph');
  });
});

describe('One pop per action, only when it turns on', () => {
  it('repost and save forward exactly one action; the rail owns animation', () => {
    expect(feed).toContain('onRepost={() => onRepost(item.id)}');
    expect(feed).toContain('onSave={() => onSave(item.id)}');
    expect(rail).toContain('if (prev.current === active) return;');
  });

  it('animation runs in Reanimated and skips motion when requested', () => {
    expect(rail).toContain("from 'react-native-reanimated'");
    expect(rail).toContain('useAnimatedStyle');
    expect(rail).toContain("if (reduceMotion || kind === 'none') return;");
    for (const gone of ['spinRepost', 'dropSave', 'likeRing', 'repostSpin', 'saveDrop']) {
      expect(feed).not.toContain(gone);
      expect(rail).not.toContain(gone);
    }
  });

  it('heart has both the approved like pop and unlike shrink', () => {
    expect(rail).toContain('withSpring(1.25');
    expect(rail).toContain('withTiming(0.82');
  });

  it('counts change instantly (no rolling digits)', () => {
    expect(engagementButton).not.toContain('<TickingCount');
    expect(rail).toContain('const text = formatRailCount(count);');
    expect(rail).toContain("return '0';");
  });
});

describe('Double-tap heart', () => {
  it('appears at the tap point, not a fixed spot', () => {
    expect(feed).toContain('lastPressPoint.current = { x: evt.nativeEvent.locationX, y: evt.nativeEvent.locationY };');
    expect(feed).toContain('burstHeart(lastPressPoint.current);');
    expect(feed).toContain('<TapHeartBurst point={heartBurstPoint}');
    expect(burst).toContain('point.x - 48');
    expect(burst).toContain('point.y - 48');
    expect(burst).toContain('rise.value = withTiming(-64');
    expect(feed).not.toMatch(/heartBurst: \{[^}]*top: '38%'/);
  });

  it('plays one heart, no particle burst', () => {
    expect(feed).not.toContain('<HeartBurstParticles');
  });
});
