import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { X_HAIRLINE, xColors } from '@/constants/reframe';

/**
 * Hairline divider between full-width rows (X-style), replacing bordered
 * cards/boxes in lists. `inset` indents the left edge — pass
 * `xTextColumn()` to start it under the row's text instead of the avatar.
 */
export function Divider({ inset = 0, style, testID }: {
  inset?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const { theme } = useAppTheme();
  return (
    <View
      testID={testID}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ height: X_HAIRLINE, marginLeft: inset, backgroundColor: xColors(theme).divider }, style]}
    />
  );
}
