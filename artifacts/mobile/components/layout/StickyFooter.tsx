import React from 'react';
import { Platform, StyleSheet, View, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { GUTTER, SP } from '@/lib/theme';

/**
 * A footer pinned to the bottom of the screen, above the home indicator.
 * Used for cart/checkout pay bars, the product-detail buy bar, and the chat
 * input bar. Pass `tabBarInset` (from useBuyerTabBarInset/useTabBarMetrics)
 * on screens that render behind a floating tab bar so the footer sits above
 * it instead of overlapping it; omit it on screens pushed above the tab bar
 * (e.g. a chat thread).
 */
export function StickyFooter({
  children,
  tabBarInset = 0,
  style,
}: {
  children: React.ReactNode;
  tabBarInset?: number;
  style?: ViewStyle;
}) {
  const insets = useSafeAreaInsets();
  const { theme } = useAppTheme();
  const bottomPadding = Math.max(insets.bottom, SP.sm) + tabBarInset;

  return (
    <View
      style={[
        styles.wrap,
        {
          backgroundColor: theme.background,
          borderTopColor: theme.border,
          paddingBottom: bottomPadding,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: GUTTER,
    paddingTop: SP.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    ...Platform.select({
      web: { boxShadow: '0 -4px 16px rgba(0,0,0,0.24)' },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.24,
        shadowRadius: 16,
      },
    }),
  },
});
