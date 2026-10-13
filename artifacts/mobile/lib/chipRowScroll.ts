/**
 * Scroll math for components/ui/ChipRow — kept pure so it can be unit-tested
 * without a renderer.
 */

export interface ChipFrame {
  /** x of the chip inside the scroll content (includes the leading inset). */
  x: number;
  width: number;
}

/**
 * Offset that centres `chip` in a viewport of `viewportWidth`, clamped so the
 * row never scrolls past either end of its content. Returns 0 when the content
 * fits without scrolling.
 */
export function chipCenterOffset(chip: ChipFrame, viewportWidth: number, contentWidth: number): number {
  const maxOffset = Math.max(0, contentWidth - viewportWidth);
  if (maxOffset === 0 || viewportWidth <= 0) return 0;
  const centred = chip.x + chip.width / 2 - viewportWidth / 2;
  return Math.min(maxOffset, Math.max(0, Math.round(centred)));
}
