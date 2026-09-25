/**
 * Structure tests for the buyer feed's video gestures — scrubbing and
 * press-and-hold 2x speed. This file is a single large component with no
 * render-test harness for expo-video/haptics, so (matching this repo's
 * existing convention for feed.tsx — see buyer-thread-chrome.test.ts) these
 * assert on the source directly rather than mounting it.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const feed = readFileSync(resolve(__dirname, '../app/(tabs)/feed.tsx'), 'utf8');

describe('Scrubbable video progress bar', () => {
  it('drives seeking from a PanResponder, not just a static display bar', () => {
    expect(feed).toContain('function ScrubProgressBar(');
    expect(feed).toContain('PanResponder.create(');
    expect(feed).toContain('onPanResponderGrant');
    expect(feed).toContain('onPanResponderMove');
    expect(feed).toContain('onPanResponderRelease');
  });

  it('seeks the real player, not just a local preview value', () => {
    expect(feed).toContain('player.currentTime = fraction * duration');
  });

  it('thickens the bar while dragging', () => {
    expect(feed).toMatch(/thickness.*=.*useRef\(new Animated\.Value\(3\)\)/);
    expect(feed).toContain("Animated.timing(thickness, { toValue: 7");
    expect(feed).toContain("Animated.timing(thickness, { toValue: 3");
  });

  it('shows a time bubble only while dragging, with current/total time', () => {
    expect(feed).toContain('formatPlaybackTime(');
    expect(feed).toContain('{dragging && (');
    expect(feed).toContain('styles.scrubBubble');
    expect(feed).toContain('{formatPlaybackTime(shown * duration)} / {formatPlaybackTime(duration)}');
  });

  it('shows a round thumb on the track while dragging', () => {
    expect(feed).toContain('styles.scrubThumb');
    expect(feed).toContain('thumbScale');
  });

  it('gives haptic feedback on grab and release, plus a tick every few percent while dragging', () => {
    expect(feed).toMatch(/onPanResponderGrant: \(evt\) => \{\s*setDragging\(true\);[\s\S]*?hapticLight\(\);/);
    expect(feed).toMatch(/onPanResponderRelease: \(\) => \{\s*setDragging\(false\);\s*hapticLight\(\);/);
    expect(feed).toContain('hapticSelection();');
  });

  it('pauses the real player for the duration of the drag and resumes on release unless the post was already paused', () => {
    expect(feed).toContain('player.pause();');
    expect(feed).toContain('if (!externallyPaused) player.play();');
    expect(feed).toContain('externallyPaused={paused}');
  });
});

describe('Press-and-hold 2x speed / hold-to-pause', () => {
  it('detects which side of the video was pressed', () => {
    expect(feed).toContain('function handlePressIn(');
    expect(feed).toContain('x > pageWidth * 0.6');
  });

  it('sets 2x on the right side and pauses elsewhere while held', () => {
    expect(feed).toContain('setSpeedActive(true)');
    expect(feed).toContain('setHoldPaused(true)');
  });

  it('always restores 1x / resumes on release, distinct from the tap-toggle pause state', () => {
    expect(feed).toContain('function handlePressOut(');
    expect(feed).toContain('setSpeedActive(false)');
    expect(feed).toContain('if (holdPaused) setHoldPaused(false)');
    // The video's actual paused prop combines both so releasing a hold never
    // fights a separate manual tap-to-pause.
    expect(feed).toContain('paused={paused || holdPaused}');
  });

  it('applies the rate to the real player', () => {
    expect(feed).toContain('rate={speedActive ? 2 : 1}');
    expect(feed).toContain('player.playbackRate = rate;');
  });

  it('shows a small "2x" pill while active', () => {
    expect(feed).toContain('styles.speedPill');
    expect(feed).toMatch(/<Text style=\{styles\.speedPillText\}>2x<\/Text>/);
  });

  it('a quick tap still falls through to the existing single/double-tap handling', () => {
    expect(feed).toContain('function handleQuickTap(');
    expect(feed).toContain('handleQuickTap();');
  });
});
