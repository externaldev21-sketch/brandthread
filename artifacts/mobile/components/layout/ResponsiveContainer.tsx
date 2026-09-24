import React from 'react';
import { View, ViewStyle } from 'react-native';
import { CONTENT_MAX_WIDTH } from '@/lib/theme';
import { useCenteredContentPadding } from './useBreakpoint';

/**
 * Centers form/detail content in a max-width column on iPad and landscape so
 * nothing stretches edge to edge; on phones it's a plain full-width wrapper
 * with the standard side gutter.
 */
export function ResponsiveContainer({
  children,
  maxWidth = CONTENT_MAX_WIDTH,
  style,
}: {
  children: React.ReactNode;
  maxWidth?: number;
  style?: ViewStyle;
}) {
  const paddingHorizontal = useCenteredContentPadding(maxWidth);
  return (
    <View style={[{ width: '100%', paddingHorizontal }, style]}>
      <View style={{ width: '100%', maxWidth, alignSelf: 'center' }}>
        {children}
      </View>
    </View>
  );
}
