/**
 * Guards for the Seller Studio menu's swipe-down-to-dismiss rewrite:
 *  - no close (X) button anywhere (Dev: "since you're adding that
 *    mechanism, you can remove the X") — swipe-down and tap-outside are
 *    the only dismiss affordances, both on the same fast Reanimated
 *    timeline (never a spring — a spring's overshoot reads as a bounce,
 *    not the "swift and fast" slide Dev asked for);
 *  - the swipe gesture wraps the whole sheet (not just the handle) via
 *    react-native-gesture-handler + Reanimated, on the UI thread;
 *  - dragging up past the resting position rubber-bands instead of
 *    hard-clamping;
 *  - a fast flick's release velocity shortens the close duration;
 *  - the feature-grid items are a plain icon + label, never a background
 *    tile or border behind them (Binance Features-sheet reskin, Dev's call).
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
    // The contract's own assertion must be the negative ("not.toContain"),
    // never a positive requirement that the close testID/tap still exists.
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

  it('the pan gesture wraps the whole sheet, not just the handle', () => {
    const sheetBlock = studio.slice(studio.indexOf('{/* Sheet'), studio.indexOf('{/* ── Add-a-pin picker'));
    expect(sheetBlock).toContain('<GestureDetector gesture={panGesture}>');
    // The ScrollView (ScrollView content) is inside that same GestureDetector,
    // not spun off into its own un-gestured wrapper — this is what lets a
    // swipe started anywhere on the sheet (not just the SheetHandle) dismiss it.
    expect(sheetBlock.indexOf('<GestureDetector')).toBeLessThan(sheetBlock.indexOf('<ScrollView'));
    expect(sheetBlock.lastIndexOf('</GestureDetector>')).toBeGreaterThan(sheetBlock.lastIndexOf('</ScrollView>'));
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

describe('Seller Studio menu feature-grid items have no tile or border behind the icon', () => {
  it('gridIconWrap and gridItem carry no backgroundColor or border', () => {
    const iconWrapBlock = studio.slice(studio.indexOf('gridIconWrap: {'), studio.indexOf('gridIconWrap: {') + 200);
    const itemBlock = studio.slice(studio.indexOf('gridItem: {'), studio.indexOf('gridItem: {') + 200);
    expect(iconWrapBlock).not.toContain('backgroundColor');
    expect(iconWrapBlock).not.toContain('borderWidth');
    expect(itemBlock).not.toContain('backgroundColor');
    expect(itemBlock).not.toContain('borderWidth');
  });

  it('icons render at 26pt in white (theme.text), not a themed accent tint', () => {
    expect(studio).toContain('<Feather name={item.icon as any} size={26} color={theme.text} />');
  });
});
