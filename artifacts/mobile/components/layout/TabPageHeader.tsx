/**
 * Shared top-of-screen header for the buyer tab pages (Discover, Messages,
 * Activity, Search): left-aligned title + optional plain icon buttons on the
 * right, offset below the safe area/dynamic island. Extracted from
 * Discover's header so all four tabs render pixel-identical title baselines
 * and top offsets.
 */
import React from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { FONT, GUTTER, ICON } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { IconButton } from '@/components/ui/IconButton';
import { PressableScale } from '@/components/BrandthreadUI';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';

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
  /**
   * Optional bare back arrow before the title, for the same page pushed onto
   * a stack (e.g. the seller's Messages, opened from Profile). Omitted on the
   * buyer tab pages, which render exactly as before.
   */
  onBack?: () => void;
  backTestID?: string;
}

export function TabPageHeader({ title, actions, gutter = GUTTER, style, onBack, backTestID }: TabPageHeaderProps) {
  const { theme } = useAppTheme();
  const topPad = useHeaderTopInset();

  return (
    <View style={[styles.row, { paddingTop: topPad + 12, paddingHorizontal: gutter }, style]}>
      {onBack ? (
        <PressableScale
          onPress={onBack}
          style={styles.back}
          accessibilityRole="button"
          accessibilityLabel={`Go back from ${title}`}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          testID={backTestID ?? 'tab-page-header-back'}
        >
          <Feather name="arrow-left" size={ICON.md} color={theme.text} />
        </PressableScale>
      ) : null}
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
  back: {
    marginRight: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
});
