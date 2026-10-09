/**
 * Brandthread Design System — GlassIconButton (BRANDTHREAD_DESIGN.md, "Glass").
 *
 * The only place real blur is used: a circular control floating over a
 * photo or video (back, share, close on the product page, story viewer and
 * post viewer). Built on the shared `Glass` primitive, so it is iOS liquid
 * glass where available and a real blur elsewhere. Never use it for a bar,
 * a card, or anything over the tab bar.
 */
import React from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Glass } from '@/components/ui/Glass';
import { Icon, ICON_SIZE, type IconName } from '@/components/ui/Icon';
import { hapticLight } from '@/lib/haptics';
import { iconAccessibilityLabel } from '@/lib/a11y/iconLabels';
import { RADII } from '@/constants/radii';

export interface GlassIconButtonProps {
  name: IconName;
  onPress: () => void;
  /** Defaults to a label derived from the icon name. */
  accessibilityLabel?: string;
  /** Diameter; 40 by default, with a 44pt hit area either way. */
  size?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function GlassIconButton({ name, onPress, accessibilityLabel, size = 40, style, testID }: GlassIconButtonProps) {
  const slop = Math.max(0, (44 - size) / 2);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={iconAccessibilityLabel(name, accessibilityLabel)}
      onPress={() => { hapticLight(); onPress(); }}
      hitSlop={{ top: slop, bottom: slop, left: slop, right: slop }}
      testID={testID}
      style={({ pressed }) => [{ width: size, height: size, opacity: pressed ? 0.7 : 1 }, style]}
    >
      <View style={[styles.circle, { borderRadius: size / 2 }]}>
        <Glass variant="regular" tint="dark" radius={RADII.pill} style={StyleSheet.absoluteFill} />
        <Icon name={name} size={size >= 44 ? ICON_SIZE.lg : ICON_SIZE.sm} color="#FFFFFF" />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  circle: { flex: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
