/**
 * Animated SF Symbols for the taps that deserve one (BRANDTHREAD_DESIGN:
 * motion only to answer a touch):
 *  - like → `heart` / `heart.fill` with a bounce when it turns on
 *  - save → `bookmark` / `bookmark.fill`, filling with a bounce
 * iOS only, through expo-symbols' `animationSpec` (in Expo Go). Everywhere
 * else — and on iOS if expo-symbols is missing — callers keep their static
 * glyph (`symbolFor` returns null).
 */
import React, { useEffect, useRef, useState } from 'react';
import { Platform, type StyleProp, type ViewStyle } from 'react-native';

/** Feather outline name → [outline SF Symbol, filled SF Symbol]. */
export const ANIMATED_SYMBOLS = {
  heart: ['heart', 'heart.fill'],
  bookmark: ['bookmark', 'bookmark.fill'],
} as const;

export type AnimatedSymbolName = keyof typeof ANIMATED_SYMBOLS;

type SymbolViewComponent = React.ComponentType<{
  name: string;
  size?: number;
  tintColor?: string;
  weight?: 'medium';
  type?: 'monochrome';
  animationSpec?: { effect?: { type: 'bounce' | 'pulse' | 'scale'; wholeSymbol?: boolean; direction?: 'up' | 'down' }; repeating?: boolean; speed?: number };
  style?: StyleProp<ViewStyle>;
  testID?: string;
}>;

let cached: SymbolViewComponent | null | undefined;
function getSymbolView(): SymbolViewComponent | null {
  if (cached !== undefined) return cached;
  try {
    cached = (require('expo-symbols') as { SymbolView?: SymbolViewComponent }).SymbolView ?? null;
  } catch {
    cached = null;
  }
  return cached;
}

/** Platform.OS, or '' where Platform is missing (partial test mocks). */
function currentOS(): string {
  try {
    return Platform.OS;
  } catch {
    return '';
  }
}

/** Pure: the SF Symbol to draw, or null when this glyph/platform has none. */
export function symbolFor(name: string, active: boolean, os: string = currentOS()): string | null {
  if (os !== 'ios') return null;
  const pair = (ANIMATED_SYMBOLS as Record<string, readonly [string, string]>)[name];
  return pair ? pair[active ? 1 : 0] : null;
}

export function canAnimateSymbol(name: string): boolean {
  return symbolFor(name, false) !== null && getSymbolView() !== null;
}

export function AnimatedSymbol({
  name, active, size, activeColor, inactiveColor, testID,
}: {
  name: AnimatedSymbolName;
  active: boolean;
  size: number;
  activeColor: string;
  inactiveColor: string;
  testID?: string;
}) {
  const SymbolView = getSymbolView();
  const wasActive = useRef(active);
  // Bumped only on an off → on change, so the bounce plays once per tap and
  // never on mount or when the list re-renders an already-liked post.
  const [plays, setPlays] = useState(0);
  useEffect(() => {
    if (active && !wasActive.current) setPlays((n) => n + 1);
    wasActive.current = active;
  }, [active]);

  const sf = symbolFor(name, active);
  if (!SymbolView || !sf) return null;
  return (
    <SymbolView
      key={plays}
      name={sf}
      size={size}
      tintColor={active ? activeColor : inactiveColor}
      weight="medium"
      type="monochrome"
      animationSpec={plays > 0 && active ? { effect: { type: 'bounce', wholeSymbol: true, direction: 'up' }, repeating: false } : undefined}
      style={{ width: size, height: size }}
      testID={testID}
    />
  );
}
