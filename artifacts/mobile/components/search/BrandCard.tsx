import React from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT } from '@/lib/theme';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';
import { RADII } from '@/constants/radii';
import { PRESS_SCALE, pressScaleAnim } from '@/constants/motion';
import { SHADOW_SM } from '@/lib/theme';
import type { SuggestedBrand } from '@/lib/searchData';

/**
 * Premium horizontal "trending brand" card — avatar/initials, name, follower
 * count — upgraded from the plain avatar-column row (still used for the
 * inline brand-result rows elsewhere on this screen).
 */
export function BrandCard({ brand, width, onPress }: {
  brand: SuggestedBrand;
  width: number;
  onPress: () => void;
}) {
  const { theme } = useAppTheme();
  const styles = makeStyles(theme);
  const scale = React.useRef(new Animated.Value(1)).current;

  return (
    <Pressable
      onPress={() => { onPress(); }}
      onPressIn={() => pressScaleAnim(scale, PRESS_SCALE).start()}
      onPressOut={() => pressScaleAnim(scale, 1).start()}
      accessibilityRole="button"
      accessibilityLabel={`Visit ${brand.name}, ${brand.followerCount} followers`}
    >
      <Animated.View
        style={[
          styles.card,
          { width, backgroundColor: theme.surface, borderColor: theme.border, shadowColor: theme.shadowColor, transform: [{ scale }] },
        ]}
      >
        <View style={[styles.avatar, { backgroundColor: brand.color }]}>
          <Text style={styles.avatarText}>{brand.initials}</Text>
        </View>
        <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>{brand.name}</Text>
        <Text style={[styles.sub, { color: theme.muted }]} numberOfLines={1}>
          {brand.followerCount > 0 ? `${brand.followerCount} ${brand.followerCount === 1 ? 'follower' : 'followers'}` : brand.handle}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  card: {
    borderRadius: RADII.card, borderWidth: 1, padding: SPACING.sm,
    alignItems: 'flex-start', gap: 2,
    ...SHADOW_SM, shadowOpacity: 0.18,
  },
  avatar: {
    width: 46, height: 46, borderRadius: RADII.avatar,
    alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.xs,
  },
  avatarText: { ...TYPE_SCALE.callout, fontFamily: FONT.bold, color: theme.onAccent },
  name: { ...TYPE_SCALE.callout, fontFamily: FONT.bold, alignSelf: 'stretch' },
  sub: { ...TYPE_SCALE.caption },
});
