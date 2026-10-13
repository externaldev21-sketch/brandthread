/**
 * Brandthread Design System — control states.
 *
 * One rule for every control (less-AI pass items 70, 71, 75):
 * - Disabled: the whole control at 30% opacity. Colours stay as they are,
 *   so a disabled button still reads as the same button, just unavailable.
 * - Destructive: red text only, never a red fill.
 * - Chips: solid (accent/white) fill when selected, outline when not.
 */
export const DISABLED_OPACITY = 0.3;
