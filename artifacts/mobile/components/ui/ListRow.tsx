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
import { FONT } from '@/lib/theme';
import { HapticSwitch } from '@/components/BrandthreadUI';
import { Avatar } from '@/components/ui/Avatar';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';
import { RADII } from '@/constants/radii';
import { PRESS_DURATION_MS } from '@/constants/motion';
import { BODY_MAX_FONT_MULTIPLIER } from '@/lib/dynamicType';

export interface ListRowProps {
  icon?: keyof typeof Feather.glyphMap;
  iconColor?: string;
  /** Renders a round Avatar (photo or initials) in place of `icon`, for people rows. */
  avatar?: { uri?: string | null; name?: string };
  title: string;
  subtitle?: string;
  /** How many lines `subtitle` may wrap to before truncating. Defaults to 1. */
  subtitleNumberOfLines?: number;
  value?: string;
  chevron?: boolean;
  toggle?: { value: boolean; onChange: (next: boolean) => void };
  /** Arbitrary trailing content (e.g. an "Unblock" button) in place of value/chevron/toggle. */
  right?: React.ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  destructive?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function ListRow({
  icon, iconColor, avatar, title, subtitle, subtitleNumberOfLines = 1, value, chevron, toggle, right, onPress, disabled, destructive, style, testID,
}: ListRowProps) {
  const palette = useColors();
  // Rows get a subtle background highlight instead of a scale — a whole row
  // of text shrinking on tap reads as busier than the row-level feedback
  // this list is built from; icon buttons and primary CTAs still scale
  // (see Button.tsx / IconButton.tsx).
  const highlight = React.useRef(new Animated.Value(0)).current;
  const nativeDriver = Platform.OS !== 'web';
  const interactive = !!onPress && !disabled;
  const titleColor = destructive ? palette.destructive : palette.foreground;

  const content = (
    <>
      {avatar && <Avatar uri={avatar.uri} name={avatar.name} size={40} />}
      {icon && !avatar && (
        <View style={[styles.iconWrap, { backgroundColor: palette.card, borderRadius: RADII.chip }]}>
          <Feather name={icon} size={18} color={iconColor ?? (destructive ? palette.destructive : palette.mutedForeground)} />
        </View>
      )}
      <View style={styles.body}>
        <Text style={[TYPE_SCALE.body, { fontFamily: FONT.medium, color: titleColor }]} numberOfLines={1} maxFontSizeMultiplier={BODY_MAX_FONT_MULTIPLIER}>{title}</Text>
        {subtitle && <Text style={[TYPE_SCALE.footnote, { color: palette.mutedForeground, marginTop: 2 }]} numberOfLines={subtitleNumberOfLines} maxFontSizeMultiplier={BODY_MAX_FONT_MULTIPLIER}>{subtitle}</Text>}
      </View>
      {right}
      {!right && value && <Text style={[TYPE_SCALE.body, { color: palette.mutedForeground, marginRight: SPACING.xs }]} numberOfLines={1} maxFontSizeMultiplier={BODY_MAX_FONT_MULTIPLIER}>{value}</Text>}
      {!right && toggle && <HapticSwitch value={toggle.value} onValueChange={toggle.onChange} disabled={disabled} accessibilityLabel={title} />}
      {!right && chevron && !toggle && <Feather name="chevron-right" size={18} color={palette.mutedForeground} />}
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
      onPress={() => { onPress?.(); }}
      onPressIn={() => Animated.timing(highlight, { toValue: 1, duration: PRESS_DURATION_MS, useNativeDriver: nativeDriver }).start()}
      onPressOut={() => Animated.timing(highlight, { toValue: 0, duration: PRESS_DURATION_MS, useNativeDriver: nativeDriver }).start()}
      testID={testID}
    >
      <View style={[styles.row, { opacity: disabled ? 0.5 : 1 }, style]}>
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            styles.highlight,
            { backgroundColor: palette.foreground, opacity: highlight.interpolate({ inputRange: [0, 1], outputRange: [0, 0.06] }) },
          ]}
        />
        {content}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, minHeight: 52, paddingVertical: SPACING.xs },
  highlight: { borderRadius: RADII.chip },
  iconWrap: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, minWidth: 0 },
});
