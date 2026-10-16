import React from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useAppTheme } from '@/contexts/AppThemeContext';
import {
  X_AVATAR_GAP, X_GUTTER, X_HAIRLINE, X_ROW_MIN_HEIGHT, X_SPACE, X_TYPE, xColors,
} from '@/constants/reframe';

/**
 * Full-width X-style list row: leading avatar/thumbnail on the gutter, a
 * text column 12pt to its right (bold 15 name, gray 15 secondary line,
 * optional gray 13 meta after the name), an optional trailing control, and
 * a hairline divider along the bottom instead of a card border.
 *
 * The trailing control renders as a SIBLING of the row's tap target, never
 * nested inside it, so a Follow/Message button is its own button (no
 * nested <button> on web, no double-firing).
 */
export function ListRow({
  leading, title, titleAccessory, meta, subtitle, subtitleLines = 1, trailing, onPress, onLongPress,
  divider = true, dividerInset = 0, accessibilityLabel, testID, style,
}: {
  leading?: React.ReactNode;
  title: React.ReactNode;
  /** Small inline accessory after the title (verified check, AI tag). */
  titleAccessory?: React.ReactNode;
  /** Gray meta after the title, e.g. "· 2h" or a handle. */
  meta?: string;
  subtitle?: React.ReactNode;
  subtitleLines?: number;
  trailing?: React.ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  divider?: boolean;
  /** Left inset of the bottom hairline (0 = full width). */
  dividerInset?: number;
  accessibilityLabel?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { theme } = useAppTheme();
  const c = xColors(theme);
  const body = (
    <>
      {leading ? <View style={styles.leading}>{leading}</View> : null}
      <View style={styles.text}>
        <View style={styles.titleRow}>
          {typeof title === 'string' ? (
            <Text style={[X_TYPE.name, styles.shrink, { color: c.text }]} numberOfLines={1}>{title}</Text>
          ) : title}
          {titleAccessory}
          {!!meta && <Text style={[X_TYPE.meta, styles.meta, { color: c.secondary }]} numberOfLines={1}>{meta}</Text>}
        </View>
        {subtitle == null ? null : typeof subtitle === 'string' ? (
          <Text style={[X_TYPE.body, { color: c.secondary }]} numberOfLines={subtitleLines}>{subtitle}</Text>
        ) : subtitle}
      </View>
    </>
  );

  return (
    <View
      style={[styles.row, { backgroundColor: c.background }, style]}
      testID={testID}
    >
      {onPress || onLongPress ? (
        <Pressable
          onPress={onPress}
          onLongPress={onLongPress}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          style={({ pressed }) => [styles.tap, pressed && styles.pressed]}
        >
          {body}
        </Pressable>
      ) : (
        <View style={styles.tap}>{body}</View>
      )}
      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
      {divider ? (
        <View
          pointerEvents="none"
          style={[styles.divider, { left: dividerInset, backgroundColor: c.divider }]}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: X_SPACE[12],
    paddingHorizontal: X_GUTTER,
    paddingVertical: X_SPACE[12],
    minHeight: X_ROW_MIN_HEIGHT.double,
  },
  tap: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: X_AVATAR_GAP },
  pressed: { opacity: 0.6 },
  leading: { flexShrink: 0 },
  text: { flex: 1, minWidth: 0, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: X_SPACE[4], minWidth: 0 },
  shrink: { flexShrink: 1 },
  meta: { flexShrink: 0 },
  trailing: { flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: X_SPACE[8] },
  divider: { position: 'absolute', right: 0, bottom: 0, height: X_HAIRLINE },
});
