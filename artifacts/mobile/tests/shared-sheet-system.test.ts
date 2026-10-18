/**
 * Shared sheet system (components/ui/useSheetTransition.ts + BottomSheet.tsx): motion spec, haptics,
 * look, and the surface colour helper. Source-level assertions for the
 * UI-thread parts (no Reanimated runtime under Vitest), plus a real unit test
 * for `sheetSurfaceColor`.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sheetSurfaceColor } from '../lib/sheetSurface';

const src = readFileSync(resolve(__dirname, '../components/ui/useSheetTransition.ts'), 'utf8');
const chrome = readFileSync(resolve(__dirname, '../components/ui/BottomSheet.tsx'), 'utf8');
const motion = readFileSync(resolve(__dirname, '../constants/motion.ts'), 'utf8');
const actionSheet = readFileSync(resolve(__dirname, '../components/ui/ActionSheet.tsx'), 'utf8');

describe('sheet motion spec', () => {
  it('opens on a fast, firm spring that never overshoots its resting position', () => {
    const spring = motion.slice(motion.indexOf('export const SHEET_SPRING'), motion.indexOf('} as const;', motion.indexOf('export const SHEET_SPRING')));
    expect(spring).toContain('stiffness: 300');
    const damping = Number(/damping: (\d+)/.exec(spring)?.[1]);
    expect(damping).toBeGreaterThanOrEqual(22);
    expect(damping).toBeLessThanOrEqual(26);
    expect(spring).toContain('overshootClamping: true');
  });

  it('dims the backdrop to 50% black', () => {
    expect(motion).toContain('export const SHEET_BACKDROP_OPACITY = 0.5;');
  });

  it('flick-dismisses on the spring carrying the finger velocity, and rubber-bands past rest', () => {
    expect(src).toContain('withSpring(closeDistance, { ...SHEET_SPRING, velocity: e.velocityY }');
    expect(src).toContain('e.velocityY > 800');
    expect(src).toContain('SHEET_RUBBER_BAND_LIMIT * (1 - 1 / (over / SHEET_RUBBER_BAND_LIMIT * 0.55 + 1))');
  });

  it('fires onClosed once: a swipe-dismiss followed by visible=false does not close twice', () => {
    expect(src).toContain('if (!openRef.current) return;');
    const finishClose = src.slice(src.indexOf('const finishClose'), src.indexOf('const dismissHaptic'));
    expect(finishClose).toContain('openRef.current = false;');
  });
});

describe('sheet haptics', () => {
  it('light on open and dismiss, selection tick on snap-back', () => {
    expect(src).toContain('if (!wasOpen && haptics) hapticLight();');
    expect(src).toContain('const dismissHaptic = useCallback(() => { if (haptics) hapticLight(); }');
    expect(src).toContain('const snapHaptic = useCallback(() => { if (haptics) hapticSelection(); }');
  });
});

describe('sheet look', () => {
  it('uses a 36x5 grabber at 40% of the text colour, 16pt top corners, 20pt gutter, 50pt pinned action', () => {
    expect(chrome).toContain('grabber: { width: 36, height: 5, borderRadius: 2.5 }');
    expect(chrome).toContain('backgroundColor: `${theme.text}66`');
    expect(chrome).toContain('export const SHEET_RADIUS = 16;');
    expect(chrome).toContain('export const SHEET_GUTTER = 20;');
    expect(chrome).toContain('export const SHEET_ACTION_HEIGHT = 50;');
  });

  it('pins the action above the keyboard, tracked per frame', () => {
    expect(chrome).toContain('const keyboard = useKeyboardHeight();');
    expect(chrome).toContain('Math.max(restingBottom, -keyboard.value + 8)');
  });

  it('lifts the pure-black Monochrome theme to the iOS elevated dark surface; other themes keep their card', () => {
    expect(sheetSurfaceColor({ card: '#000000', cardElevated: '#000000' })).toBe('#1C1C1E');
    expect(sheetSurfaceColor({ card: '#3B1B4B', cardElevated: '#3B1B4B' })).toBe('#3B1B4B');
    expect(sheetSurfaceColor({ card: '#292929', cardElevated: '#292929' })).toBe('#292929');
  });
});

describe('action sheet', () => {
  it('renders the themed iOS-style action sheet on every platform, not the OS alert', () => {
    const show = actionSheet.slice(actionSheet.indexOf('export function showActionSheet'));
    expect(show).not.toContain("Platform.OS !== 'web'");
    expect(show).toContain('presentActionSheet(title, message, buttons);');
  });

  it('runs on the shared engine and runs the tapped action only after the close finishes', () => {
    expect(actionSheet).toContain('useSheetTransition(visible, onClosed)');
    const onClosed = actionSheet.slice(actionSheet.indexOf('const onClosed'), actionSheet.indexOf('const {\n    modalVisible'));
    expect(onClosed).toContain('action?.();');
  });

  it('splits Cancel into its own group, like iOS', () => {
    expect(actionSheet).toContain("const cancel = buttons.find(b => b.style === 'cancel');");
    expect(actionSheet).toContain('styles.cancelGroup');
  });
});
