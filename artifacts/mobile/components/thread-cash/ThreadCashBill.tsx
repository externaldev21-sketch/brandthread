/**
 * Thread Cash visual identity — the owner's real art (a green dollar-style
 * bill with a chrome "B" medallion, "THREAD CASH" wordmarks, corner B
 * badges, wireframe globes, and 4-point sparkles), rendered from the actual
 * PNGs at assets/thread-cash/: no vector recreation, at any size where the
 * art is legible.
 *
 * Thread Cash is cash, not a coin — every icon-sized use renders a little
 * BILL (<ThreadCashBillIcon/>), never a round coin.
 *
 * - <ThreadCashBill/> — the full flat bill (thread-cash-bill.png).
 * - <ThreadCashBillStack/> — the two-bill stack (thread-cash-stack.png),
 *   for the wallet balance hero.
 * - <ThreadCashBillIcon/> — the small icon-sized mark (14–24pt, used at the
 *   composer, sheet badges, payment bubbles, Activity rows, the checkout
 *   toggle, the profile pill, the streak dots, the money-burst sprite, …):
 *   below ~32px the full bill just turns to mush, so this renders a
 *   pre-cropped raster thumbnail generated from the same source art (see
 *   scripts/thread-cash/generate-bill-icon.mjs — a centered crop keeping
 *   the medallion plus the top/bottom green border, rounded at the
 *   corners, exported at @1x/@2x/@3x) — literally the owner's art, just
 *   cropped for legibility, never a substitute coin/glyph. At/above that
 *   size it's the full <ThreadCashBill/>.
 */
import React from 'react';
import { Image, type ImageStyle, type StyleProp, type ViewStyle } from 'react-native';

// Metro's asset plugin turns these into asset-registry lookups; outside
// Metro (Vitest's plain Node/esbuild transform has no handler for image
// extensions) the require throws trying to parse the binary as JS — caught
// here so any suite that transitively renders this component still runs;
// nothing under test needs the real pixels.
let BILL_SOURCE: number = 1;
let STACK_SOURCE: number = 1;
// Metro resolves the matching thread-cash-bill-icon@2x.png / @3x.png
// automatically for the device's pixel density.
let MINI_BILL_SOURCE: number = 1;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  BILL_SOURCE = require('../../assets/thread-cash/thread-cash-bill.png');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  STACK_SOURCE = require('../../assets/thread-cash/thread-cash-stack.png');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  MINI_BILL_SOURCE = require('../../assets/thread-cash/thread-cash-bill-icon.png');
} catch {
  // Non-Metro test environment — the `1` fallbacks above stand in.
}

const BILL_ASPECT = 1200 / 510;
const STACK_ASPECT = 1000 / 643;
/** Matches BASE_WIDTH/BASE_HEIGHT in generate-bill-icon.mjs. */
const MINI_BILL_ASPECT = 28 / 19;

/** Below this width, <ThreadCashBillIcon/> renders the cropped mini bill
 *  instead of the full bill, which just turns to mush that small. */
const ICON_SIMPLIFIED_THRESHOLD = 32;

export const THREAD_CASH_GREEN_DEEP = '#155C22';
export const THREAD_CASH_GREEN_MID = '#3DBE4F';
export const THREAD_CASH_GREEN_BRIGHT = '#5FDD70';
export const THREAD_CASH_GREEN_PAPER = '#CFEFC8';

/** The full flat bill. */
export function ThreadCashBill({
  width = 220,
  style,
}: {
  width?: number;
  style?: StyleProp<ViewStyle | ImageStyle>;
}) {
  const height = width / BILL_ASPECT;
  return (
    <Image
      source={BILL_SOURCE}
      style={[{ width, height }, style as StyleProp<ImageStyle>]}
      resizeMode="contain"
      accessibilityIgnoresInvertColors
    />
  );
}

/** The owner's two-bill stack art, for hero-sized spots (the wallet balance card). */
export function ThreadCashBillStack({
  width = 260,
  style,
}: {
  width?: number;
  style?: StyleProp<ViewStyle | ImageStyle>;
}) {
  const height = width / STACK_ASPECT;
  return (
    <Image
      source={STACK_SOURCE}
      style={[{ width, height }, style as StyleProp<ImageStyle>]}
      resizeMode="contain"
      accessibilityIgnoresInvertColors
    />
  );
}

/**
 * The Thread Cash mark wherever a small icon is needed inline — always a
 * little bill, never a coin. Below ~32px this is a pre-cropped raster
 * thumbnail of the real art (see module doc); at/above that it's the full
 * <ThreadCashBill/> scaled down.
 */
export function ThreadCashBillIcon({
  size = 18,
  style,
}: {
  size?: number;
  style?: StyleProp<ImageStyle | ViewStyle>;
}) {
  if (size < ICON_SIMPLIFIED_THRESHOLD) {
    const height = size / MINI_BILL_ASPECT;
    return (
      <Image
        source={MINI_BILL_SOURCE}
        style={[{ width: size, height }, style as StyleProp<ImageStyle>]}
        resizeMode="contain"
        accessibilityIgnoresInvertColors
      />
    );
  }
  return <ThreadCashBill width={size} style={style} />;
}
