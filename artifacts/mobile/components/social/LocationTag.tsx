import React from 'react';
import { StyleSheet, Text, TouchableOpacity, type StyleProp, type ViewStyle } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { useRouter } from 'expo-router';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { hapticSelection } from '@/lib/haptics';
import { FONT } from '@/lib/theme';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';

export function locationHref(placeId: string): string {
  return `/location/${encodeURIComponent(placeId)}`;
}

/**
 * "Pin + place name" line shown under a caption when a post has a location.
 * Tapping opens the location page. Long names wrap rather than truncate.
 */
export function LocationTag({
  location, style,
}: { location: { id: string; name: string }; style?: StyleProp<ViewStyle> }) {
  const { theme } = useAppTheme();
  const router = useRouter();
  return (
    <TouchableOpacity
      onPress={() => { hapticSelection(); router.push(locationHref(location.id) as never); }}
      accessibilityRole="link"
      accessibilityLabel={`Location ${location.name}`}
      testID="location-tag"
      style={[styles.row, style]}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <Icon name="map-pin" size={14} color={theme.muted} />
      <Text style={[styles.text, { color: theme.text }]}>{location.name}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACING.xs, alignSelf: 'flex-start' },
  text: { ...TYPE_SCALE.footnote, fontFamily: FONT.semibold, flexShrink: 1 },
});
