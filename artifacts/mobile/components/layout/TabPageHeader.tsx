/**
 * Shared top-of-screen header for the buyer tab pages (Discover, Messages,
 * Activity, Search): left-aligned title + optional plain icon buttons on the
 * right, offset below the safe area/dynamic island. Extracted from
 * Discover's header so all four tabs render pixel-identical title baselines
 * and top offsets.
 */
import React from 'react';
import { Platform, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { FONT, GUTTER, WEB_SAFE_AREA_TOP } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { IconButton } from '@/components/ui/IconButton';

export interface TabPageHeaderAction {
  name: keyof typeof Feather.glyphMap;
  onPress: () => void;
  accessibilityLabel: string;
  badge?: number;
  testID?: string;
}

interface TabPageHeaderProps {
  title: string;
  actions?: TabPageHeaderAction[];
  gutter?: number;
  style?: StyleProp<ViewStyle>;
}

export function TabPageHeader({ title, actions, gutter = GUTTER, style }: TabPageHeaderProps) {
  const insets = useSafeAreaInsets();
  const { theme } = useAppTheme();
  // Overnight batch item 40: WEB_SAFE_AREA_TOP (lib/theme.ts) is the one
  // shared stand-in for a real device's status-bar inset, since
  // react-native-safe-area-context reads `insets.top` as 0 outside a real
  // device or an emulating preview frame.
  const topPad = Platform.OS === 'web' ? WEB_SAFE_AREA_TOP : insets.top;

  return (
    <View style={[styles.row, { paddingTop: topPad + 12, paddingHorizontal: gutter }, style]}>
      <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>{title}</Text>
      {!!actions?.length && (
        <View style={styles.actions}>
          {actions.map((action) => (
            <IconButton
              key={action.accessibilityLabel}
              name={action.name}
              variant="plain"
              size={20}
              color={theme.text}
              onPress={action.onPress}
              accessibilityLabel={action.accessibilityLabel}
              badge={action.badge}
              testID={action.testID}
            />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 20,
  },
  title: {
    flex: 1,
    fontSize: 20,
    lineHeight: 24,
    fontFamily: FONT.bold,
    letterSpacing: -0.4,
    textAlign: 'left',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
});
