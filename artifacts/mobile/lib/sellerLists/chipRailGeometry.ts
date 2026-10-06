/** Pure geometry for components/ChipRail.tsx (unit-tested without React Native). */

/** Page gutter the first chip sits on and the last chip keeps after it. */
export const CHIP_RAIL_GUTTER = 16;

/** Leading-edge snap offsets: each chip's x minus the gutter, first is 0. */
export function chipSnapOffsets(layouts: readonly { x: number }[]): number[] {
  return layouts.map((l) => Math.max(0, Math.round(l.x - CHIP_RAIL_GUTTER)));
}

/** Scroll offset that centres a chip, clamped to the scrollable range. */
export function chipCenterOffset(
  chip: { x: number; width: number },
  viewportWidth: number,
  contentWidth: number,
): number {
  const max = Math.max(0, contentWidth - viewportWidth);
  const centred = chip.x + chip.width / 2 - viewportWidth / 2;
  return Math.round(Math.min(max, Math.max(0, centred)));
}

/** A chip's count badge only renders when there is something to count. */
export function visibleChipCount(count: number | undefined): number | undefined {
  return count ? count : undefined;
}
