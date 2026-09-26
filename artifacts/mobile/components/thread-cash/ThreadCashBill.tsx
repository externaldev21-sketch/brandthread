/**
 * Thread Cash visual identity — the currency art the owner designed: a
 * green dollar-style bill with a chrome "B" in a medallion, "THREAD CASH"
 * wordmarks, a "B" in each corner, wireframe globes, and 4-point sparkles,
 * plus a round coin crop of the "B" medallion.
 *
 * <ThreadCashBill/> renders the shipped bill artwork
 * (assets/thread-cash/thread-cash-bill.png, 1200x510 — same 600/255 aspect
 * this component always sized itself to, so no caller changes were needed
 * once the PNG landed). It replaces the react-native-svg recreation this
 * component used as a stand-in before that asset existed.
 *
 * <ThreadCashCoin/> renders the existing coin PNG
 * (assets/thread-cash/thread-cash-coin.png, already on dev) — kept only for
 * call sites that still explicitly ask for the round coin crop; Thread Cash
 * iconography elsewhere in the app must use the bill, never the coin.
 */
import React from 'react';
import { Image, type ImageStyle, type StyleProp } from 'react-native';

export const THREAD_CASH_GREEN_DEEP = '#1E7A2E';
export const THREAD_CASH_GREEN_MID = '#3DBE4F';
export const THREAD_CASH_GREEN_PAPER = '#CFEFC8';

const BILL_ASPECT = 600 / 255;

/** The flat bill: the shipped bill artwork, sized off its own aspect ratio. */
export function ThreadCashBill({
  width = 220,
  style,
}: {
  width?: number;
  style?: StyleProp<ImageStyle>;
}) {
  const height = width / BILL_ASPECT;
  return (
    <Image
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      source={require('../../assets/thread-cash/thread-cash-bill.png')}
      style={[{ width, height }, style]}
      resizeMode="contain"
      accessibilityIgnoresInvertColors
    />
  );
}

/** The round coin crop of the "B" medallion, from the shipped PNG. */
export function ThreadCashCoin({
  size = 24,
  style,
}: {
  size?: number;
  style?: StyleProp<ImageStyle>;
}) {
  return (
    <Image
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      source={require('../../assets/thread-cash/thread-cash-coin.png')}
      style={[{ width: size, height: size }, style]}
      resizeMode="contain"
      accessibilityIgnoresInvertColors
    />
  );
}
