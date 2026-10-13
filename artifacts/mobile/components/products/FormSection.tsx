/**
 * Grouped form section (iOS grouped-list / Shopify product editor style):
 * a small header line above one bordered card that holds the fields.
 */
import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle, type ViewProps } from 'react-native';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { PressableScale } from '@/components/BrandthreadUI';

interface Props {
  title: string;
  /** Quiet right-aligned text in the header, e.g. "3/10". */
  meta?: string;
  /** Text action on the right of the header, e.g. "Add options". */
  action?: { label: string; onPress: () => void; testID?: string };
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  onLayout?: ViewProps['onLayout'];
}

export function FormSection({ title, meta, action, children, style, testID, onLayout }: Props) {
  const { theme } = useAppTheme();
  return (
    <View style={[styles.wrap, style]} testID={testID} onLayout={onLayout}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.muted }]} numberOfLines={1} accessibilityRole="header">{title}</Text>
        {meta ? <Text style={[styles.meta, { color: theme.muted }]}>{meta}</Text> : null}
        {action ? (
          <PressableScale
            onPress={action.onPress}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            testID={action.testID}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            noMinHeight
          >
            <Text style={[styles.action, { color: theme.text }]}>{action.label}</Text>
          </PressableScale>
        ) : null}
      </View>
      <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginHorizontal: SP.md,
    marginBottom: SP.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    paddingHorizontal: SP.xs,
    marginBottom: SP.sm,
    minHeight: 20,
  },
  title: {
    flex: 1,
    fontFamily: FONT.semibold,
    fontSize: FS.sm,
    lineHeight: 18,
  },
  meta: {
    fontFamily: FONT.regular,
    fontSize: FS.sm,
    lineHeight: 18,
  },
  action: {
    fontFamily: FONT.semibold,
    fontSize: FS.sm,
    lineHeight: 18,
  },
  card: {
    borderWidth: 1,
    borderRadius: RADIUS.md,
    padding: SP.md,
    gap: 12,
  },
});
