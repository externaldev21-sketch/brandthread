import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const studio = readFileSync(resolve(process.cwd(), 'components/SellerStudioRadialMenu.tsx'), 'utf8');

/**
 * The incoming edge-trace replaces the old Cancel/Continue pill, but keeps
 * the useful cancellation contract: touching cancels the current entry,
 * and locking again (even the same card) starts a new full-duration window.
 */
describe('Studio auto-enter cancellation: edge-trace retracts and re-arms', () => {
  it('a new touch retracts the trace and eases the cover back instead of cutting it off', () => {
    const retractBody = studio.slice(
      studio.indexOf('function retractEnter('),
      studio.indexOf('// ─── Per-card signature micro-animations'),
    );
    expect(retractBody).toContain('cancelAnimation(traceProgress);');
    expect(retractBody).toContain('cancelAnimation(zoomScale);');
    expect(retractBody).toContain('cancelAnimation(enterFade);');
    expect(retractBody).toContain('traceProgress.value = withTiming(0, { duration: 180');
    expect(retractBody).toContain('zoomScale.value = withTiming(1, { duration: 180');
    expect(retractBody).toContain('enterFade.value = 0;');
  });

  it('touching the card area or header cancels the current entry and clears the live announcement', () => {
    const cardAreaPan = studio.slice(studio.indexOf('const cardAreaPan ='), studio.indexOf('const tapGesture ='));
    const cardBegin = cardAreaPan.slice(cardAreaPan.indexOf('.onBegin(() => {'), cardAreaPan.indexOf('.onUpdate('));
    const dismissGesture = studio.slice(studio.indexOf('const dismissGesture ='), studio.indexOf('const cardAreaPan ='));
    const headerStart = dismissGesture.slice(dismissGesture.indexOf('.onStart(() => {'), dismissGesture.indexOf('.onUpdate('));

    expect(cardBegin).toContain('retractEnter(traceProgress, zoomScale, enterFade);');
    expect(cardBegin).toContain('runOnJS(setEntering)(false);');
    expect(headerStart).toContain('retractEnter(traceProgress, zoomScale, enterFade);');
    expect(headerStart).toContain('runOnJS(setEntering)(false);');
  });

  it('every horizontal lock starts a new full-duration trace from zero, including after cancelling the same card', () => {
    const endBlock = studio.slice(
      studio.indexOf('.onEnd((e) => {', studio.indexOf('const cardAreaPan =')),
      studio.indexOf('}), [cardIndex, gestureStartIndex, translateY, dragStartY, cardGestureAxis, landedPulse,'),
    );
    const horizontalBranch = endBlock.slice(endBlock.indexOf("cardGestureAxis.value === 'horizontal'"));
    const traceResetIndex = horizontalBranch.indexOf('traceProgress.value = 0;');
    const traceStartIndex = horizontalBranch.indexOf('traceProgress.value = withTiming(1,');

    expect(horizontalBranch).toContain('runOnJS(setEntering)(true);');
    expect(traceResetIndex).toBeGreaterThan(-1);
    expect(traceStartIndex).toBeGreaterThan(traceResetIndex);
    expect(horizontalBranch).toContain('duration: AUTO_ENTER_MS');
    expect(studio).toContain('const AUTO_ENTER_MS = 1500;');
  });

  it('opening the menu clears stale trace and zoom state while preserving the return-selection branch', () => {
    const start = studio.indexOf('if (open) {', studio.indexOf('// Fresh opens'));
    const resetBlock = studio.slice(start, studio.indexOf('}, [open]);', start));

    expect(resetBlock).toContain('if (!resumeCardOnOpenRef.current)');
    expect(resetBlock).toContain('cancelAnimation(traceProgress);');
    expect(resetBlock).toContain('traceProgress.value = 0;');
    expect(resetBlock).toContain('zoomScale.value = 1;');
    expect(resetBlock).toContain('enterFade.value = 0;');
    expect(resetBlock).toContain('setEntering(false);');
  });
});
