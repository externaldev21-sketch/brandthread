/**
 * Guards for the Seller Studio full-screen page's dismiss behavior — Dev's
 * final layout call: a full-screen page (not a partial sheet), closed by
 * swiping down anywhere or tapping the close (X) button, both on the same
 * fast Reanimated timeline (never a spring — a spring's overshoot reads as
 * a bounce, not the "swift and fast" slide Dev asked for). There is no
 * backdrop anymore — the page itself covers the whole screen, so there's no
 * "tap outside" affordance distinct from the close button.
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

describe('Seller Studio page has a real close (X) button — Dev\'s final layout call', () => {
  it('a close button exists, with its own testID/accessibilityLabel and haptic', () => {
    expect(studio).toContain('testID="seller-studio-menu-close"');
    expect(studio).toContain('accessibilityLabel="Close Studio tools"');
    expect(studio).toContain('cancelEnterFill(); hapticDismiss(); collapse();');
  });

  it('there is no separate backdrop layer anymore — the page itself fully covers the screen behind it', () => {
    expect(studio).not.toContain('testID="seller-studio-menu-backdrop"');
    expect(studio).not.toContain('testID="seller-studio-menu-dismiss"');
    expect(studio).not.toContain('backdropOpacity');
  });

  it('Android back and web Escape still close it via the Modal\'s own onRequestClose', () => {
    expect(studio).toContain('onRequestClose={() => { cancelEnterFill(); collapse(); }}');
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

  it('close-button dismiss and swipe-past-threshold dismiss both fire a light haptic', () => {
    expect(studio).toContain('hapticDismiss');
    expect(studio).toContain('ImpactFeedbackStyle.Light');
    expect(studio).toContain('cancelEnterFill(); hapticDismiss(); collapse();');
    expect(studio).toContain('runOnJS(hapticDismiss)()');
  });
});
