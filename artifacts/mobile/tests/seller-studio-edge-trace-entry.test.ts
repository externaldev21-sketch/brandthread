import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const studio = readFileSync(resolve(process.cwd(), 'components/SellerStudioRadialMenu.tsx'), 'utf8');

/**
 * Dev, replacing the earlier pill/Cancel/Continue button entirely: "the
 * button's making the page look tacky." New mechanism: when a card locks, a
 * thin white light traces clockwise around the card's full edge from
 * top-center, completing in AUTO_ENTER_MS while the cover pushes in and
 * brightens; when the trace closes, the cover zooms through (fast scale +
 * fade) into the destination. Cancel = any touch, or scrubbing to another
 * card: the trace retracts and the push/zoom eases back. See
 * seller-studio-card-carousel.test.ts for the underlying lock/tap/flick
 * gesture wiring this builds on (unchanged by this pass).
 */
describe('Studio edge-trace entry: lock -> trace -> zoom-through, replacing the old pill', () => {
  it('there is no pill/Cancel/Continue button left anywhere in the component', () => {
    expect(studio).not.toContain('fillProgress');
    expect(studio).not.toContain('enterButton');
    expect(studio).not.toContain('cancelLink');
    expect(studio).not.toContain("'hidden' | 'counting' | 'cancelled'");
    expect(studio).not.toContain('Entering page');
    expect(studio).not.toContain('seller-studio-enter-cancel');
    expect(studio).not.toContain('seller-studio-enter-button');
  });

  it('the edge-trace path starts and ends at top-center, drawn clockwise (M cx,top ... A ... back to cx,top)', () => {
    const pathBlock = studio.slice(studio.indexOf('const tracePath = useMemo'), studio.indexOf('const traceAnimatedProps'));
    expect(pathBlock).toContain('`M ${cx} ${top}`');
    expect(pathBlock).toContain('`L ${cx} ${top}`'); // closes back at top-center
    // Every arc sweeps clockwise (sweep-flag 1) — "0 0 1" in each `A r r ...` command.
    const arcCount = (pathBlock.match(/A \$\{r\} \$\{r\} 0 0 1/g) ?? []).length;
    expect(arcCount).toBe(4);
  });

  it('the trace rectangle is inset from the card edges so the full stroke paints on-screen (Dev: the trace was drawn exactly on the card edges, clipping the left/right strokes behind the device frame)', () => {
    const pathBlock = studio.slice(studio.indexOf('const tracePath = useMemo'), studio.indexOf('const traceAnimatedProps'));
    expect(pathBlock).toContain('const left = TRACE_INSET');
    expect(pathBlock).toContain('const right = w - TRACE_INSET');
    expect(pathBlock).toContain('const top = TRACE_INSET');
    expect(pathBlock).toContain('const bottom = h - TRACE_INSET');
    expect(studio).toMatch(/const TRACE_INSET = \d+/);
  });

  it('the trace runs at NO_REDUCE_MOTION over exactly AUTO_ENTER_MS — a real cancel window, not decoration', () => {
    expect(studio).toContain('traceProgress.value = withTiming(1, { duration: AUTO_ENTER_MS, easing: Easing.linear, ...NO_REDUCE_MOTION }');
  });

  it('the title never fades or slides during the zoom-through burst — rendered outside the scaled card layer, with its own punch/flash in sync with the burst', () => {
    // Dev (superseding an earlier fade-out fix): the title must stay fully
    // visible and readable through the whole burst, all the way to
    // navigation. No fade-related style survives on the label.
    expect(studio).not.toContain('cardLabelFadeStyle');
    // The label is a sibling of the scaled `card` View, not a child of it —
    // its own wrapper only ever translates (never scales) with the carousel.
    const carouselCardBody = studio.slice(studio.indexOf('function CarouselCard('), studio.indexOf('const windowStart ='));
    expect(carouselCardBody).toContain('const labelAnchorStyle = useAnimatedStyle');
    expect(carouselCardBody).toContain('const labelPunchStyle = useAnimatedStyle');
    // The label's JSX sits in its own Animated.View (cardLabelLayer), after
    // and separate from the `card` Animated.View that carries cardStyle's scale.
    const renderBlock = carouselCardBody.slice(carouselCardBody.indexOf('return ('));
    expect(renderBlock).toContain('styles.cardLabelLayer');
    expect(renderBlock).toContain('<Animated.Text style={[styles.cardLabel, labelPunchStyle]}');
    // labelAnchorStyle only ever applies translateX (the carousel's own
    // horizontal offset) — no scale, so cardStyle's zoom-through burst can
    // never move or resize it.
    const anchorStyleStart = carouselCardBody.indexOf('const labelAnchorStyle = useAnimatedStyle');
    const anchorStyleBody = carouselCardBody.slice(anchorStyleStart, carouselCardBody.indexOf('});', anchorStyleStart) + 3);
    expect(anchorStyleBody).toContain('transform: [{ translateX: distance * cardSpacing }]');
    expect(anchorStyleBody).not.toContain('scale');
  });

  it('the title snap (scale punch + letter-spacing/brightness flash) fires in the same instant as the zoom-through burst, and resets on cancel', () => {
    const fnBody = studio.slice(studio.indexOf('const triggerZoomEnter = useCallback'), studio.indexOf('}, [reduceMotion, fireEnterHaptic'));
    const burstIdx = fnBody.indexOf('zoomScale.value = withTiming(ZOOM_THROUGH_SCALE');
    const punchIdx = fnBody.indexOf('labelPunchScale.value = withSequence(');
    const flashIdx = fnBody.indexOf('labelFlash.value = withSequence(');
    expect(burstIdx).toBeGreaterThan(-1);
    expect(punchIdx).toBeGreaterThan(burstIdx);
    expect(flashIdx).toBeGreaterThan(punchIdx);
    expect(fnBody).toContain('withTiming(1.12, { duration: 70, easing: Easing.out(Easing.quad) })');
    expect(fnBody).toContain('withSpring(1, { damping: 10, stiffness: 180, mass: 0.4 })');
    // retractEnter (shared by both cancel paths) resets both back to rest.
    const retractBody = studio.slice(studio.indexOf('function retractEnter('), studio.indexOf('// ─── Per-card signature micro-animations'));
    expect(retractBody).toContain('labelPunchScale.value = 1;');
    expect(retractBody).toContain('labelFlash.value = 0;');
  });

  it('locking a card starts entering=true and the trace, and only pushes/brightens the cover when NOT Reduce Motion', () => {
    const endBlock = studio.slice(studio.indexOf('.onEnd((e) => {', studio.indexOf('const cardAreaPan =')), studio.indexOf('}), [cardIndex, gestureStartIndex, translateY, dragStartY, cardGestureAxis, landedPulse,'));
    const horizontalBranch = endBlock.slice(endBlock.indexOf("cardGestureAxis.value === 'horizontal'"));
    expect(horizontalBranch).toContain("runOnJS(setEntering)(true);");
    expect(horizontalBranch).toContain('if (!reduceMotion) {');
    expect(horizontalBranch).toContain('zoomScale.value = withTiming(PUSH_IN_SCALE, { duration: AUTO_ENTER_MS');
  });

  it('the trace completing on its own triggers triggerZoomEnter: a firmer haptic, then zoom-through + fade (or, under Reduce Motion, just the fade), then navigate', () => {
    const fnBody = studio.slice(studio.indexOf('const triggerZoomEnter = useCallback'), studio.indexOf('}, [reduceMotion, fireEnterHaptic'));
    expect(fnBody).toContain('fireEnterHaptic();');
    expect(fnBody).toContain('if (reduceMotion) {');
    expect(fnBody).toContain('zoomScale.value = withTiming(ZOOM_THROUGH_SCALE,');
    expect(fnBody).toContain('runOnJS(openCurrentItem)({ skipHaptic: true });');
    // The reduceMotion branch must return before ever touching zoomScale.
    const reduceIdx = fnBody.indexOf('if (reduceMotion) {');
    const returnIdx = fnBody.indexOf('return;', reduceIdx);
    const zoomIdx = fnBody.indexOf('zoomScale.value = withTiming(ZOOM_THROUGH_SCALE');
    expect(returnIdx).toBeLessThan(zoomIdx);
  });

  it('fireEnterHaptic uses a distinct notification (not a plain impact) — firmer than the lock tick', () => {
    expect(studio).toContain('const fireEnterHaptic = useCallback(() => {\n    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)');
  });

  it('commitAndOpen skips its own generic haptic when invoked from the trace-completion path, so entering never double-buzzes', () => {
    const fnBody = studio.slice(studio.indexOf('const commitAndOpen = useCallback'), studio.indexOf('}, [translateY, traceProgress, zoomScale, enterFade, planLoading'));
    expect(fnBody).toContain('if (!opts?.skipHaptic) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});');
  });

  it('cancel = a touch anywhere (card area onBegin, header onStart) retracts the trace and eases the zoom back — never a hard cut', () => {
    expect(studio).toContain('function retractEnter(');
    const retractBody = studio.slice(studio.indexOf('function retractEnter('), studio.indexOf('// ─── Per-card signature micro-animations'));
    expect(retractBody).toContain('cancelAnimation(traceProgress);');
    expect(retractBody).toContain("traceProgress.value = withTiming(0, { duration: 180");
    expect(retractBody).toContain("zoomScale.value = withTiming(1, { duration: 180");
    expect(retractBody).toContain('enterFade.value = 0;');
    // Both gesture entry points call it.
    const beginBlock = studio.slice(studio.indexOf('const cardAreaPan ='), studio.indexOf('.onUpdate(', studio.indexOf('const cardAreaPan =')));
    expect(beginBlock).toContain('retractEnter(traceProgress, zoomScale, enterFade, labelPunchScale, labelFlash, labelExit);');
    const dismissStartBlock = studio.slice(studio.indexOf('const dismissGesture ='), studio.indexOf('.onUpdate(', studio.indexOf('const dismissGesture =')));
    expect(dismissStartBlock).toContain('retractEnter(traceProgress, zoomScale, enterFade, labelPunchScale, labelFlash, labelExit);');
  });

  it('a tap or upward flick still opens instantly, unaffected by the trace mechanism (they call openCurrentItem directly, no skipHaptic)', () => {
    const tapBlock = studio.slice(studio.indexOf('const tapGesture ='), studio.indexOf('const cardAreaGesture ='));
    expect(tapBlock).toContain('runOnJS(openCurrentItem)();');
  });

  it('the whole page resets entering/trace/zoom state fresh every time it opens', () => {
    const resetStart = studio.indexOf('if (open) {');
    const resetBlock = studio.slice(resetStart, studio.indexOf('}, [open]);', resetStart));
    expect(resetBlock).toContain('cancelAnimation(traceProgress);');
    expect(resetBlock).toContain('traceProgress.value = 0;');
    expect(resetBlock).toContain('zoomScale.value = 1;');
    expect(resetBlock).toContain('enterFade.value = 0;');
    expect(resetBlock).toContain('setEntering(false);');
  });
});
