/**
 * Shared top-of-screen header for the buyer tab pages (Discover, Messages,
 * Activity, Search): left-aligned title + optional plain icon buttons on the
 * right, offset below the safe area/dynamic island. Extracted from
 * Discover's header so all four tabs render pixel-identical title baselines
 * and top offsets.
 */
import React from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { FONT, GUTTER } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { IconButton } from '@/components/ui/IconButton';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import { Icon, type IconName } from '@/components/ui/Icon';

export interface TabPageHeaderAction {
  name: IconName;
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
  const { theme } = useAppTheme();
  const topPad = useHeaderTopInset();

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
