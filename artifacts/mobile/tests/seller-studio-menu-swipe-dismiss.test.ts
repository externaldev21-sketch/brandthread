/**
 * Guards for the Seller Studio full-screen page's dismiss behavior — Dev's
 * final call: a full-screen page (not a partial sheet), no "View store" pill
 * in the header (header content is the avatar + name + a close (X) — see
 * seller-studio-header.test.ts; Dev initially cut the X, then reversed:
 * "Dev changed his mind — X stays"). Closing works four ways: swiping down
 * anywhere, the X itself, Android back / web Escape (the Modal's own
 * onRequestClose), or tapping the Studio tab button again (see
 * seller-studio-tab-toggle.test.ts) — all on the same fast Reanimated
 * timeline (never a spring — a spring's overshoot reads as a bounce, not
 * the "swift and fast" slide Dev asked for). There is no backdrop anymore —
 * the page itself covers the whole screen, so there's no "tap outside"
 * affordance distinct from these.
 *  - dragging up past the resting position rubber-bands instead of
 *    hard-clamping;
 *  - a fast flick's release velocity shortens the close duration;
 *  - the card carousel has its OWN combined gesture (scrub horizontally,
 *    dismiss vertically, tap to open) — see
 *    seller-studio-card-carousel.test.ts for that one specifically.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const studio = readFileSync(resolve(process.cwd(), 'components/SellerStudioRadialMenu.tsx'), 'utf8');

describe('Seller Studio page close affordances — swipe, the X, Android back, and the tab toggle', () => {
  it('the close (X) button closes via the same cancelEnter/hapticDismiss/collapse path as the other close affordances', () => {
    expect(studio).toContain('testID="seller-studio-menu-close"');
    expect(studio).toContain('accessibilityLabel="Close Studio tools"');
    const closeBlock = studio.slice(studio.indexOf('testID="seller-studio-menu-close"') - 400, studio.indexOf('testID="seller-studio-menu-close"'));
    // Same close path as before; the only thing ahead of it is the first-time
    // coach's own "dismiss me first" guard (see seller-studio-menu-polish.test.ts).
    expect(closeBlock).toContain('cancelEnter(); hapticDismiss(); collapse();');
  });

  it('there is no separate backdrop layer anymore — the page itself fully covers the screen behind it', () => {
    expect(studio).not.toContain('testID="seller-studio-menu-backdrop"');
    expect(studio).not.toContain('testID="seller-studio-menu-dismiss"');
    expect(studio).not.toContain('backdropOpacity');
  });

  it('Android back and web Escape still close it via the Modal\'s own onRequestClose', () => {
    expect(studio).toContain('onRequestClose={() => { cancelEnter(); collapse(); }}');
  });
});

describe('Seller Studio page swipe-to-dismiss is UI-thread Reanimated + gesture-handler', () => {
  it('imports and drives translateY via react-native-reanimated', () => {
    expect(studio).toContain("from 'react-native-gesture-handler'");
    expect(studio).toContain('useSharedValue');
    expect(studio).toContain('useAnimatedStyle');
    expect(studio).not.toContain('PanResponder');
    // Never a spring for the page's own open/close transform — see file
    // header comment: a spring's overshoot reads as a bounce, not a slide.
    expect(studio).not.toMatch(/translateY\.value\s*=\s*withSpring/);
  });

  it('the header carries the dismiss gesture; the card area carries its own composed scrub+dismiss+tap gesture', () => {
    expect(studio).toContain('<GestureDetector gesture={dismissGesture}>');
    expect(studio).toContain('<GestureDetector gesture={cardAreaGesture}>');
  });

  it('rubber-bands upward drag instead of hard-clamping to 0', () => {
    expect(studio).toContain('function rubberBandUp');
    expect(studio).toContain("'worklet'");
    expect(studio).toContain('next >= 0 ? next : rubberBandUp(next)');
  });

  it('past the dismiss threshold, a flick\'s release velocity shortens the close duration', () => {
    expect(studio).toContain('e.translationY > pageHeight * 0.2 || e.velocityY > 800');
    expect(studio).toContain('const velocityMs = e.velocityY > 0 ? (remaining / e.velocityY) * 1000 : SHEET_CLOSE_MS;');
    expect(studio).toContain('Math.min(SHEET_CLOSE_MS, Math.max(90, velocityMs))');
  });

  it('open/close both animate on the shared SHEET_OPEN_MS/SHEET_CLOSE_MS/SHEET_EASING timeline', () => {
    expect(studio).toContain("from '@/constants/motion'");
    expect(studio).toContain('duration: SHEET_OPEN_MS, easing: SHEET_EASING');
    expect(studio).toContain('duration: SHEET_CLOSE_MS, easing: SHEET_EASING');
  });

  it('swipe-past-threshold dismiss fires a light haptic', () => {
    expect(studio).toContain('hapticDismiss');
    expect(studio).toContain('ImpactFeedbackStyle.Light');
    expect(studio).toContain('runOnJS(hapticDismiss)()');
  });
});
