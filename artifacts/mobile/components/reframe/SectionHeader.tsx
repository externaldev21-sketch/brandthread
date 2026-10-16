import React from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { DENSE_MAX_FONT_MULTIPLIER } from '@/lib/dynamicType';
import { X_GUTTER, X_SPACE, X_TYPE, xColors } from '@/constants/reframe';

/**
 * Section title inside a screen ("Today", "Suggested", "Trending Brands"):
 * 17 bold white on the gutter, optional gray one-line subtitle, optional
 * trailing text action ("See all") and/or custom trailing node (e.g. a
 * dismiss X). `inset={false}` drops the gutter for a header that already
 * sits inside a padded container.
 */
export function SectionHeader({
  title, subtitle, actionLabel, onAction, actionAccessibilityLabel, actionTestID, trailing, inset = true, style, testID,
}: {
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
  /** Spoken label for the action when the visible text alone is ambiguous ("See all"). */
  actionAccessibilityLabel?: string;
  actionTestID?: string;
  trailing?: React.ReactNode;
  inset?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const { theme } = useAppTheme();
  const c = xColors(theme);
  return (
    <View style={[styles.row, inset && styles.inset, style]} testID={testID}>
      <View style={styles.titleWrap}>
        <Text
          accessibilityRole="header"
          maxFontSizeMultiplier={DENSE_MAX_FONT_MULTIPLIER}
          numberOfLines={1}
          style={[X_TYPE.section, { color: c.text }]}
        >
          {title}
        </Text>
        {!!subtitle && (
          <Text numberOfLines={1} style={[X_TYPE.meta, styles.subtitle, { color: c.secondary }]}>{subtitle}</Text>
        )}
      </View>
      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          accessibilityRole="button"
          accessibilityLabel={actionAccessibilityLabel ?? actionLabel}
          hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
          style={({ pressed }) => pressed && styles.pressed}
          testID={actionTestID}
        >
          <Text maxFontSizeMultiplier={DENSE_MAX_FONT_MULTIPLIER} style={[X_TYPE.body, { color: c.secondary }]}>{actionLabel}</Text>
        </Pressable>
      ) : null}
      {trailing}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: X_SPACE[12],
    paddingTop: X_SPACE[12], paddingBottom: X_SPACE[8],
  },
  inset: { paddingHorizontal: X_GUTTER },
  titleWrap: { flex: 1, minWidth: 0 },
  subtitle: { marginTop: 2 },
  pressed: { opacity: 0.6 },
});
