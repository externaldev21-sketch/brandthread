/**
 * Brandthread Design System — ListRow (Phase 1)
 *
 * A single consistent settings/list row shape: leading icon, title, subtitle,
 * trailing value, chevron and/or toggle. Replaces the many one-off row
 * layouts scattered across settings/profile/seller screens (see audit in the
 * PR description) for any screen migrated in later phases.
 */
import React from 'react';
import { Animated, Platform, Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { hapticLight } from '@/lib/haptics';
import { FONT } from '@/lib/theme';
import { HapticSwitch } from '@/components/BrandthreadUI';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';
import { RADII } from '@/constants/radii';
import { PRESS_DURATION_MS, PRESS_SCALE } from '@/constants/motion';

export interface ListRowProps {
  icon?: keyof typeof Feather.glyphMap;
  iconColor?: string;
  title: string;
  subtitle?: string;
  value?: string;
  chevron?: boolean;
  toggle?: { value: boolean; onChange: (next: boolean) => void };
  onPress?: () => void;
  disabled?: boolean;
  destructive?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function ListRow({
  icon, iconColor, title, subtitle, value, chevron, toggle, onPress, disabled, destructive, style, testID,
}: ListRowProps) {
  const palette = useColors();
  const scale = React.useRef(new Animated.Value(1)).current;
  const nativeDriver = Platform.OS !== 'web';
  const interactive = !!onPress && !disabled;
  const titleColor = destructive ? palette.destructive : palette.foreground;

  const content = (
    <>
      {icon && (
        <View style={[styles.iconWrap, { backgroundColor: palette.card, borderRadius: RADII.chip }]}>
          <Feather name={icon} size={18} color={iconColor ?? (destructive ? palette.destructive : palette.mutedForeground)} />
        </View>
      )}
      <View style={styles.body}>
        <Text style={[TYPE_SCALE.body, { fontFamily: FONT.medium, color: titleColor }]} numberOfLines={1}>{title}</Text>
        {subtitle && <Text style={[TYPE_SCALE.footnote, { color: palette.mutedForeground, marginTop: 2 }]} numberOfLines={1}>{subtitle}</Text>}
      </View>
      {value && <Text style={[TYPE_SCALE.body, { color: palette.mutedForeground, marginRight: SPACING.xs }]} numberOfLines={1}>{value}</Text>}
      {toggle && <HapticSwitch value={toggle.value} onValueChange={toggle.onChange} disabled={disabled} />}
      {chevron && !toggle && <Feather name="chevron-right" size={18} color={palette.mutedForeground} />}
    </>
  );

  if (!interactive) {
    return <View style={[styles.row, { opacity: disabled ? 0.5 : 1 }, style]} testID={testID}>{content}</View>;
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => { hapticLight(); onPress?.(); }}
      onPressIn={() => Animated.timing(scale, { toValue: PRESS_SCALE, duration: PRESS_DURATION_MS, useNativeDriver: nativeDriver }).start()}
      onPressOut={() => Animated.spring(scale, { toValue: 1, useNativeDriver: nativeDriver, speed: 18, bounciness: 6 }).start()}
      testID={testID}
    >
      <Animated.View style={[styles.row, { transform: [{ scale }], opacity: disabled ? 0.5 : 1 }, style]}>
        {content}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, minHeight: 52, paddingVertical: SPACING.xs },
  iconWrap: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, minWidth: 0 },
});
