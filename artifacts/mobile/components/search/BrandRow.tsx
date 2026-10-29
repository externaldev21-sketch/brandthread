import React from 'react';
import { Animated, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT } from '@/lib/theme';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';
import { RADII } from '@/constants/radii';
import { PRESS_SCALE, pressScaleAnim } from '@/constants/motion';
import { VerifiedBadge } from '@/components/ui/VerifiedBadge';
import { OFFICIAL_AVATAR_SOURCE } from '@/lib/officialAccount';

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
  /** Real brand photo from search (http/https only). */
  imageUri?: string | null;
  /** The official @brandthread account: always the bundled B logo. */
  official?: boolean;
};

/**
 * Accounts/Brands tab row for a brand — same row shape as PersonRow. Avatar:
 * the bundled B logo for the official account, else the brand's real photo
 * (http/https `imageUri`), else its initials on its colour.
 */
export function BrandRow({ brand, onPress }: { brand: SearchBrandRow; onPress: () => void }) {
  const { theme } = useAppTheme();
  const styles = makeStyles(theme);
  const scale = React.useRef(new Animated.Value(1)).current;

  return (
    <Pressable
      onPress={() => onPress()}
      onPressIn={() => pressScaleAnim(scale, PRESS_SCALE).start()}
      onPressOut={() => pressScaleAnim(scale, 1).start()}
      accessibilityRole="button"
      accessibilityLabel={`Open ${brand.name}`}
      style={styles.row}
    >
      <Animated.View style={[styles.rowInner, { transform: [{ scale }] }]}>
        {brand.official ? (
          <View style={[styles.avatar, styles.clip, { backgroundColor: theme.background }]}>
            <Image source={OFFICIAL_AVATAR_SOURCE} style={styles.fill} resizeMode="cover" testID="brand-row-official-avatar" />
          </View>
        ) : brand.imageUri && /^https?:\/\//.test(brand.imageUri) ? (
          <View style={[styles.avatar, styles.clip, { backgroundColor: brand.color }]}>
            <Image source={{ uri: brand.imageUri }} style={styles.fill} resizeMode="cover" testID="brand-row-avatar-image" />
          </View>
        ) : (
          <View style={[styles.avatar, { backgroundColor: brand.color }]}>
            <Text style={styles.initials}>{brand.initials}</Text>
          </View>
        )}
        <View style={{ flex: 1 }}>
          <View style={styles.nameRow}>
            <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>{brand.name}</Text>
            {brand.verified && <VerifiedBadge style={{ marginTop: 1 }} />}
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
  clip: { overflow: 'hidden' },
  fill: { width: '100%', height: '100%' },
  initials: { color: '#FFFFFF', fontFamily: FONT.semibold, fontSize: 15 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  name: { ...TYPE_SCALE.body, fontFamily: FONT.semibold },
  sub: { ...TYPE_SCALE.caption, marginTop: 2 },
});
