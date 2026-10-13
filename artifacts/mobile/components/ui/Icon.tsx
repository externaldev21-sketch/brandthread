/**
 * Brandthread Design System — Icon (BRANDTHREAD_DESIGN.md, "Icons").
 *
 * The app's one icon component, replacing Feather:
 * - iOS: the native SF Symbol (expo-symbols, available in Expo Go), medium
 *   weight.
 * - Android and web: the matched Material icon from @expo/vector-icons.
 * - Any name without a mapping (brand marks, rare glyphs): the Feather glyph,
 *   so nothing ever renders blank.
 *
 * Takes the same `name` values as Feather (see lib/iconMap.ts), so moving a
 * screen over is an import swap. Sizes are 17/20/24 (`ICON_SIZE`); other
 * sizes still render for older call sites.
 */
import React from 'react';
import { Platform, type StyleProp, type ViewStyle } from 'react-native';
import * as VectorIcons from '@expo/vector-icons';
import { Feather } from '@expo/vector-icons';
import { iconMappingFor, type FeatherName } from '@/lib/iconMap';

export type IconName = FeatherName;

export const ICON_SIZE = { sm: 17, md: 20, lg: 24 } as const;

export interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

type SymbolViewComponent = React.ComponentType<{
  name: string;
  size?: number;
  tintColor?: string;
  weight?: 'medium';
  type?: 'monochrome';
  fallback?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}>;

let symbolView: SymbolViewComponent | null | undefined;
/** expo-symbols, loaded on first iOS render only; null if it isn't there. */
function getSymbolView(): SymbolViewComponent | null {
  if (symbolView !== undefined) return symbolView;
  try {
    symbolView = (require('expo-symbols') as { SymbolView: SymbolViewComponent }).SymbolView ?? null;
  } catch {
    symbolView = null;
  }
  return symbolView;
}

/** True on iOS; false where Platform is unavailable (partial test mocks). */
function isIOS(): boolean {
  try {
    return Platform.OS === 'ios';
  } catch {
    return false;
  }
}

/** MaterialIcons, or undefined where it isn't available (partial test mocks). */
function getMaterialIcons(): typeof VectorIcons.MaterialIcons | undefined {
  try {
    return VectorIcons.MaterialIcons;
  } catch {
    return undefined;
  }
}

export function Icon({ name, size = ICON_SIZE.md, color = '#FFFFFF', style, testID }: IconProps) {
  const { sf, material } = iconMappingFor(name);
  const MaterialIcons = material ? getMaterialIcons() : undefined;
  const fallback = material && MaterialIcons
    ? <MaterialIcons name={material} size={size} color={color} style={style as never} testID={testID} />
    : <Feather name={name} size={size} color={color} style={style as never} testID={testID} />;

  if (sf && isIOS()) {
    const SymbolView = getSymbolView();
    if (SymbolView) {
      return (
        <SymbolView
          name={sf}
          size={size}
          tintColor={color}
          weight="medium"
          type="monochrome"
          fallback={fallback}
          style={[{ width: size, height: size }, style]}
          testID={testID}
        />
      );
    }
  }
  return fallback;
}
