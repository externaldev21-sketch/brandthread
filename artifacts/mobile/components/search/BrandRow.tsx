import React from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { hapticPrimaryAction } from '@/lib/haptics';
import { FONT } from '@/lib/theme';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';
import { RADII } from '@/constants/radii';
import { PRESS_SCALE, pressScaleAnim } from '@/constants/motion';

export type SearchBrandRow = {
  id: string;
  name: string;
  handle: string;
  color: string;
  initials: string;
  /** Real search results never carry these today (the endpoint returns no
   *  verified/follower fields for a brand row) — only rendered when present,
   *  never fabricated. */
  verified?: boolean;
  followersLabel?: string;
};

/**
 * Accounts/Brands tab row for a brand — same row shape as PersonRow but a
 * fixed store-icon avatar (brand search results carry no photo today, so a
 * generic storefront glyph reads honestly instead of implying a real logo).
 */
export function BrandRow({ brand, onPress }: { brand: SearchBrandRow; onPress: () => void }) {
  const { theme } = useAppTheme();
  const styles = makeStyles(theme);
  const scale = React.useRef(new Animated.Value(1)).current;

  return (
    <Pressable
      onPress={() => { hapticPrimaryAction(); onPress(); }}
      onPressIn={() => pressScaleAnim(scale, PRESS_SCALE).start()}
      onPressOut={() => pressScaleAnim(scale, 1).start()}
      accessibilityRole="button"
      accessibilityLabel={`Open ${brand.name}`}
      style={styles.row}
    >
      <Animated.View style={[styles.rowInner, { transform: [{ scale }] }]}>
        <View style={[styles.avatar, { backgroundColor: brand.color }]}>
          <Icon name="shopping-bag" size={18} color="#FFFFFF" />
        </View>
        <View style={{ flex: 1 }}>
          <View style={styles.nameRow}>
            <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>{brand.name}</Text>
            {brand.verified && <Icon name="check-circle" size={13} color={theme.text} style={{ marginTop: 1 }} />}
          </View>
          <Text style={[styles.sub, { color: theme.muted }]} numberOfLines={1}>
            {brand.handle}{brand.followersLabel ? ` · ${brand.followersLabel}` : ''}
          </Text>
        </View>
      </Animated.View>
    </Pressable>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  row: { paddingHorizontal: SPACING.md, paddingVertical: SPACING.xs + 2 },
  rowInner: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  avatar: { width: 44, height: 44, borderRadius: RADII.avatar, alignItems: 'center', justifyContent: 'center' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  name: { ...TYPE_SCALE.body, fontFamily: FONT.semibold },
  sub: { ...TYPE_SCALE.caption, marginTop: 2 },
});
