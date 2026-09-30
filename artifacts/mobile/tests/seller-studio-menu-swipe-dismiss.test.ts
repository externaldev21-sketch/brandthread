/**
 * Guards for the Seller Studio menu's swipe-down-to-dismiss behavior,
 * carried over unchanged through the card-carousel redesign:
 *  - no close (X) button anywhere — swipe-down and tap-outside are the
 *    only dismiss affordances, both on the same fast Reanimated timeline
 *    (never a spring — a spring's overshoot reads as a bounce, not the
 *    "swift and fast" slide Dev asked for);
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
const contract = readFileSync(resolve(process.cwd(), 'tests/seller-dashboard-native-contract.test.ts'), 'utf8');
const deviceFlow = readFileSync(resolve(process.cwd(), 'tests/seller-dashboard.device.mjs'), 'utf8');

describe('Seller Studio menu has no close (X) button', () => {
  it('no close testID, accessibility label, or close-button style block remain', () => {
    expect(studio).not.toContain('testID="seller-studio-menu-close"');
    expect(studio).not.toContain('Close Studio tools');
    expect(studio).not.toContain('closeButtonTop');
  });

  it('the device contract and device flow were updated off the removed close button', () => {
    expect(contract).toContain('expect(studio).not.toContain(\'testID="seller-studio-menu-close"\')');
    expect(contract).toContain("expect(deviceFlow).not.toContain(\"await tap('Close Studio tools')\")");
    expect(deviceFlow).not.toContain("await tap('Close Studio tools')");
    // Android back and web Escape still close it via the Modal's own
    // onRequestClose — untouched by this change.
    expect(studio).toContain('onRequestClose={() => collapse()}');
    expect(deviceFlow).toContain('await pressAndroidBack()');
    // iOS device flow now swipes instead of tapping a close button.
    expect(deviceFlow).toContain('await swipeDownToCloseStudio()');
  });
});

describe('Seller Studio menu swipe-to-dismiss is UI-thread Reanimated + gesture-handler', () => {
  it('imports and drives translateY/backdropOpacity via react-native-reanimated', () => {
    expect(studio).toContain("from 'react-native-gesture-handler'");
    expect(studio).toContain('useSharedValue');
    expect(studio).toContain('useAnimatedStyle');
    expect(studio).not.toContain('PanResponder');
    // Never a spring for the sheet's own open/close transform — see file
    // header comment: a spring's overshoot reads as a bounce, not a slide.
    expect(studio).not.toMatch(/translateY\.value\s*=\s*withSpring/);
  });

  it('the handle/header carries the dismiss gesture; the card area carries its own composed scrub+dismiss+tap gesture', () => {
    expect(studio).toContain('<GestureDetector gesture={dismissGesture}>');
    expect(studio).toContain('<GestureDetector gesture={cardAreaGesture}>');
  });

  it('rubber-bands upward drag instead of hard-clamping to 0', () => {
    expect(studio).toContain('function rubberBandUp');
    expect(studio).toContain("'worklet'");
    expect(studio).toContain('next >= 0 ? next : rubberBandUp(next)');
  });

  it('past the dismiss threshold, a flick\'s release velocity shortens the close duration', () => {
    expect(studio).toContain('e.translationY > sheetHeight * 0.25 || e.velocityY > 800');
    expect(studio).toContain('const velocityMs = e.velocityY > 0 ? (remaining / e.velocityY) * 1000 : SHEET_CLOSE_MS;');
    expect(studio).toContain('Math.min(SHEET_CLOSE_MS, Math.max(90, velocityMs))');
  });

  it('open/close both animate on the shared SHEET_OPEN_MS/SHEET_CLOSE_MS/SHEET_EASING timeline', () => {
    expect(studio).toContain("from '@/constants/motion'");
    expect(studio).toContain('duration: SHEET_OPEN_MS, easing: SHEET_EASING');
    expect(studio).toContain('duration: SHEET_CLOSE_MS, easing: SHEET_EASING');
  });

  it('backdrop-tap dismiss and swipe-past-threshold dismiss both fire a light haptic', () => {
    expect(studio).toContain('hapticDismiss');
    expect(studio).toContain('ImpactFeedbackStyle.Light');
    expect(studio).toContain('onPress={() => { hapticDismiss(); collapse(); }}');
    expect(studio).toContain('runOnJS(hapticDismiss)()');
  });
});
