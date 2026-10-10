/**
 * layersPanelModel.ts — pure math for components/design-studio/LayersPanel.tsx:
 * drag-to-reorder target index, swipe-to-reveal translateX clamping/open
 * decision, and the blend-mode letter shown on each row. Kept dependency-free
 * (no react-native import) so it can be unit tested directly with vitest,
 * the same reasoning as lib/transformModel.ts.
 */
import type { BlendModeKind } from '@/services/designTypes';

/** The single letter shown on each Layers row for its blend mode. */
export function blendLetter(mode: BlendModeKind | undefined): string {
  return (mode ?? 'normal').charAt(0).toUpperCase();
}

/**
 * Pure reorder-target math for the drag handle. `dy` is the cumulative
 * vertical drag distance since grant; rows are `rowHeight` tall, so every
 * full row's worth of drag shifts the target index by one, clamped to the
 * displayed list's bounds.
 */
export function computeDragTargetIndex(startIndex: number, dy: number, rowHeight: number, listLength: number): number {
  const shift = Math.round(dy / rowHeight);
  return Math.max(0, Math.min(listLength - 1, startIndex + shift));
}

/**
 * Pure swipe clamp math for the Lock/Duplicate/Delete reveal. `base` is the
 * row's translateX when the gesture started (0 if it was closed,
 * -actionsWidth if it was already open); `dx` is the cumulative horizontal
 * drag since grant.
 */
export function clampSwipeTranslateX(base: number, dx: number, actionsWidth: number): number {
  return Math.max(-actionsWidth, Math.min(0, base + dx));
}

/** Pure swipe-open/close decision made on release. */
export function shouldSwipeOpen(base: number, dx: number, openThreshold: number): boolean {
  return base + dx < -openThreshold || dx < -openThreshold;
}
