import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const studio = readFileSync(resolve(process.cwd(), 'components/SellerStudioRadialMenu.tsx'), 'utf8');
const hints = readFileSync(resolve(process.cwd(), 'components/StudioMenuHints.tsx'), 'utf8');

/**
 * Studio menu polish pass (on top of #677's title snap):
 *  1. Title exit motion — slide up + slow→fast tremor over the last
 *     ~400ms of the push-in/zoom-through, ending as the page disappears;
 *     Reduce Motion keeps the slide, drops the tremor.
 *  2. The bottom row of position dots is gone entirely.
 *  3. First-time swipe coach (black ~70% scrim, hand glyph, "Swipe to
 *     switch"), per-account via the first-run tips system, dismissed by a
 *     tap or the first swipe (which still goes through); every open in
 *     &demo=1.
 *  4. Persistent tiny ‹ › edge chevrons replacing the dots.
 *  5. Edge-trace corners concentric with the device's display corners.
 */
describe('Studio title exit motion', () => {
  it('is driven by one UI-thread shared value armed at lock time with a delay so it ends exactly with the destination fade', () => {
    expect(studio).toContain('const labelExit = useSharedValue(0);');
    expect(studio).toContain('const exitDelayMs = AUTO_ENTER_MS + (reduceMotion ? REDUCED_MOTION_FADE_MS : ZOOM_BURST_MS) - TITLE_EXIT_MS;');
    expect(studio).toContain('labelExit.value = withDelay(\n          exitDelayMs,\n          withTiming(1, { duration: TITLE_EXIT_MS, easing: Easing.linear, ...NO_REDUCE_MOTION }),\n          ReduceMotion.Never,\n        );');
    // The burst/fade durations the delay is computed from are the real ones.
    expect(studio).toContain('const ZOOM_BURST_MS = 220;');
    expect(studio).toContain('const REDUCED_MOTION_FADE_MS = 180;');
    expect(studio).toContain('withTiming(ZOOM_THROUGH_SCALE, { duration: ZOOM_BURST_MS');
    expect(studio).toContain('enterFade.value = withTiming(1, { duration: ZOOM_BURST_MS');
    expect(studio).toContain('enterFade.value = withTiming(1, { duration: REDUCED_MOTION_FADE_MS');
  });

  it('runs over the last ~350-450ms, lifts ~10-14px and tremors 1→2.5px with a rising frequency', () => {
    expect(studio).toMatch(/const TITLE_EXIT_MS = (3[5-9]\d|4[0-4]\d|450);/);
    expect(studio).toMatch(/const TITLE_EXIT_LIFT_PX = 1[0-4];/);
    expect(studio).toContain('const TITLE_TREMOR_AMP_MIN = 1;');
    expect(studio).toContain('const TITLE_TREMOR_AMP_MAX = 2.5;');
    const hzMin = Number(/const TITLE_TREMOR_HZ_MIN = (\d+);/.exec(studio)?.[1]);
    const hzMax = Number(/const TITLE_TREMOR_HZ_MAX = (\d+);/.exec(studio)?.[1]);
    expect(hzMax).toBeGreaterThan(hzMin);
  });

  it('maps labelExit to transforms in the label style only (never the scaled card), tremor skipped under Reduce Motion, slide kept', () => {
    const styleBody = studio.slice(studio.indexOf('const labelPunchStyle = useAnimatedStyle'), studio.indexOf('const contentStyle = useAnimatedStyle'));
    expect(styleBody).toContain('const exit = isCurrent ? labelExit.value : 0;');
    expect(styleBody).toContain('const lift = -TITLE_EXIT_LIFT_PX * (1 - (1 - exit) * (1 - exit));');
    expect(styleBody).toContain('if (!reduceMotion && exit > 0) {');
    expect(styleBody).toContain('{ translateY: lift + tremorY }');
    expect(styleBody).toContain('{ translateX: tremorX }');
    // The phase is the integral of a rising frequency (a chirp), not a fixed sine.
    expect(styleBody).toContain('0.5 * (TITLE_TREMOR_HZ_MAX - TITLE_TREMOR_HZ_MIN) * seconds * exit * exit');
    // #677's title still never touches the scaled card layer.
    const cardStyleBody = studio.slice(studio.indexOf('const cardStyle = useAnimatedStyle'), studio.indexOf('const pushBrightenStyle'));
    expect(cardStyleBody).not.toContain('labelExit');
  });

  it('every cancel path eases the exit back and the page resets it on open', () => {
    const retractBody = studio.slice(studio.indexOf('function retractEnter('), studio.indexOf('// ─── Per-card signature micro-animations'));
    expect(retractBody).toContain('cancelAnimation(labelExit);');
    expect(retractBody).toContain('labelExit.value = withTiming(0, { duration: 120');
    const cancelEnterBody = studio.slice(studio.indexOf('const cancelEnter = useCallback'), studio.indexOf('}, [traceProgress, zoomScale, enterFade, labelExit]);'));
    expect(cancelEnterBody).toContain('labelExit.value = 0;');
    const openReset = studio.slice(studio.indexOf('// Reset to the first card every time the page opens fresh'), studio.indexOf('}, [open]);'));
    expect(openReset).toContain('labelExit.value = 0;');
  });
});

describe('Studio position dots removed', () => {
  it('no dots row, dot styles or dots testID remain anywhere in the component', () => {
    expect(studio).not.toContain('seller-studio-position-dots');
    expect(studio).not.toContain('dotsRow');
    expect(studio).not.toContain('dotActive');
  });
});

describe('Studio first-time swipe coach', () => {
  it('uses the per-account first-run tips system (user-scoped AsyncStorage key + server), and shows every open in &demo=1', () => {
    expect(studio).toContain("useFirstRunTip('studio-menu-swipe-coach', { contentReady: open })");
    expect(studio).toContain('const coachDemoEveryOpen = isPreviewDemoMode();');
    expect(studio).toContain('const coachVisible = open && (coachTip.visible || (coachDemoEveryOpen && !coachDemoDismissed));');
    expect(studio).toContain('setCoachDemoDismissed(false);'); // reset on each open
    // The earlier fullscreen guide rendered OUTSIDE the Modal is gone.
    expect(studio).not.toContain('variant="fullscreen"');
    expect(studio).not.toContain('STUDIO_MENU_SCRUB_ROWS');
  });

  it('renders inside the Modal page, above header and X, never intercepting touches', () => {
    const page = studio.slice(studio.indexOf('<Modal'), studio.indexOf('</Modal>'));
    expect(page).toContain('<StudioSwipeCoach visible={coachVisible} reduceMotion={reduceMotion} />');
    expect(hints).toContain('testID="seller-studio-swipe-coach"');
    const coachRender = hints.slice(hints.indexOf('testID="seller-studio-swipe-coach"') - 400, hints.indexOf('testID="seller-studio-swipe-coach"'));
    expect(coachRender).toContain('pointerEvents="none"');
  });

  it('is dismissed by a tap (which then does NOT open the card) or the first swipe (which still goes through), and the X under the scrim dismisses it instead of closing', () => {
    const tapBlock = studio.slice(studio.indexOf('const tapGesture ='), studio.indexOf('const cardAreaGesture ='));
    expect(tapBlock).toContain('if (coachActive.value) {\n        coachActive.value = false;\n        runOnJS(dismissCoach)();\n        return;\n      }\n      runOnJS(openCurrentItem)();');
    const panUpdate = studio.slice(studio.indexOf('.onUpdate((e) => {', studio.indexOf('const cardAreaPan =')), studio.indexOf('.onEnd((e) => {', studio.indexOf('const cardAreaPan =')));
    expect(panUpdate).toContain('if (coachActive.value) {\n            coachActive.value = false;\n            runOnJS(dismissCoach)();\n          }');
    // The swipe still scrubs — the index update follows the dismiss in the same handler.
    expect(panUpdate.indexOf('runOnJS(dismissCoach)()')).toBeLessThan(panUpdate.indexOf('indexForDrag(gestureStartIndex.value'));
    expect(studio).toContain('if (coachVisible) { dismissCoach(); return; }');
  });

  it('black ~70% scrim, 200ms fade in/out, 2-4 words of Inter copy, white/silver only', () => {
    expect(hints).toContain("COACH_SCRIM_COLOR = 'rgba(0,0,0,0.7)'");
    expect(hints).toContain('COACH_FADE_MS = 200');
    const words = /COACH_COPY = '([^']+)'/.exec(hints)?.[1] ?? '';
    expect(words.split(' ').length).toBeGreaterThanOrEqual(2);
    expect(words.split(' ').length).toBeLessThanOrEqual(4);
    expect(hints).toContain('fontFamily: FONT.semibold');
    expect(hints).not.toMatch(/#(?!FFFFFF|C7CDD5)[0-9a-fA-F]{6}\b/);
  });
});

describe('Studio edge chevrons', () => {
  it('tiny (7-9px), silver ~35% idle, ~90% in the drag direction, pinned 8px inside the safe area, never intercepting touches', () => {
    expect(hints).toMatch(/EDGE_CHEVRON_SIZE = [7-9];/);
    expect(hints).toContain('EDGE_CHEVRON_IDLE_OPACITY = 0.35');
    expect(hints).toContain('EDGE_CHEVRON_ACTIVE_OPACITY = 0.9');
    expect(hints).toContain('const EDGE_INSET = 8;');
    expect(hints).toContain('{ left: insetLeft + EDGE_INSET }');
    expect(hints).toContain('{ right: insetRight + EDGE_INSET }');
    expect(hints).toContain('testID="seller-studio-edge-chevrons"');
    expect(hints).toContain('testID={`seller-studio-edge-chevron-${side}`}');
    const chevronsRender = hints.slice(hints.indexOf('export function StudioEdgeChevrons'), hints.indexOf('// ─── First-time swipe coach'));
    expect(chevronsRender).toContain('<View style={StyleSheet.absoluteFill} pointerEvents="none"');
  });

  it('idle: drift 2-3px outward and back every ~4s (skipped under Reduce Motion); drag: brighten + stretch toward the drag direction, the other fades', () => {
    expect(hints).toMatch(/EDGE_CHEVRON_IDLE_DRIFT_PX = (2(\.\d+)?|3);/);
    expect(hints).toContain('EDGE_CHEVRON_IDLE_PERIOD_MS = 4000');
    expect(hints).toContain('if (reduceMotion) { idle.value = 0; return; }');
    expect(hints).toContain("const toward = side === 'right' ? -dragX.value : dragX.value;");
    expect(hints).toContain('{ scaleX: 1 + EDGE_CHEVRON_MAX_STRETCH * progress }');
    expect(hints).toContain('EDGE_CHEVRON_IDLE_OPACITY * (1 - away)');
  });

  it('hides ‹ on the first card and › on the last (the list does not loop), fed by the live carousel index and drag from the menu', () => {
    expect(hints).toContain("? interpolate(cardIndex.value, [0, 0.5], [0, 1], Extrapolation.CLAMP)");
    expect(hints).toContain(": interpolate(last - cardIndex.value, [0, 0.5], [0, 1], Extrapolation.CLAMP)");
    expect(studio).toContain('const scrubDragX = useSharedValue(0);');
    expect(studio).toContain('scrubDragX.value = e.translationX;');
    expect(studio).toContain('dragX={scrubDragX}');
    expect(studio).toContain('cardIndex={cardIndex}');
    expect(studio).toContain('cardCount={CARD_ITEMS.length}');
  });
});

describe('Studio edge-trace corners follow the device display corner radius', () => {
  it('radius = display corner radius − TRACE_INSET, recomputed from window size + insets (rotation / split view)', () => {
    expect(studio).not.toContain('const TRACE_CORNER_RADIUS');
    expect(studio).toContain("getDisplayCornerRadius({ width: windowWidth, height: screenHeight, insets, platform: Platform.OS })");
    expect(studio).toContain('[windowWidth, screenHeight, insets],');
    expect(studio).toContain('const r = insetOutlineCornerRadius(displayCornerRadius, TRACE_INSET, right - left, bottom - top);');
    expect(studio).toContain('}, [cardAreaSize, displayCornerRadius]);');
  });

  it('the inset clears the stroke (no blur filter is applied, so strokeWidth/2 is the whole requirement)', () => {
    const inset = Number(/const TRACE_INSET = (\d+);/.exec(studio)?.[1]);
    const stroke = Number(/const TRACE_STROKE_WIDTH = (\d+);/.exec(studio)?.[1]);
    expect(inset).toBeGreaterThanOrEqual(stroke / 2);
    expect(studio).toContain('strokeWidth={TRACE_STROKE_WIDTH}');
    expect(studio).not.toContain('feGaussianBlur');
  });
});
