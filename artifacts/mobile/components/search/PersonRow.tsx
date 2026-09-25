import React from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { Button } from '@/components/ui';
import { hapticPrimaryAction } from '@/lib/haptics';
import { FONT } from '@/lib/theme';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';
import { RADII } from '@/constants/radii';
import { PRESS_DURATION_MS, PRESS_SCALE } from '@/constants/motion';

export type SearchPerson = {
  userId: string;
  name: string;
  username: string | null;
  handle: string;
  initials: string;
  color: string;
  bio: string | null;
  isFollowing: boolean;
};

/**
 * Compact inline follow row for the People tab. Only tracks Follow /
 * Following — the buyer search API (`api.social.search`) doesn't return
 * `isFollowedBy`/`isMutual`, so the richer Friends/Follow-Back states from
 * `buyer-other-profile`'s `renderFollowButton` aren't available here.
 */
export function PersonRow({
  person,
  loading,
  onPress,
  onToggleFollow,
}: {
  person: SearchPerson;
  loading: boolean;
  onPress: () => void;
  onToggleFollow: () => void;
}) {
  const { theme } = useAppTheme();
  const styles = makeStyles(theme);
  const scale = React.useRef(new Animated.Value(1)).current;
  const nativeDriver = Platform.OS !== 'web';

  return (
    <Pressable
      onPress={() => { hapticPrimaryAction(); onPress(); }}
      onPressIn={() => Animated.timing(scale, { toValue: PRESS_SCALE, duration: PRESS_DURATION_MS, useNativeDriver: nativeDriver }).start()}
      onPressOut={() => Animated.spring(scale, { toValue: 1, useNativeDriver: nativeDriver, speed: 18, bounciness: 6 }).start()}
      accessibilityRole="button"
      accessibilityLabel={`Open ${person.name}`}
    >
      <Animated.View style={[styles.row, { transform: [{ scale }] }]}>
        <View style={[styles.avatar, { backgroundColor: person.color }]}>
          <Text style={styles.avatarText}>{person.initials}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>{person.name}</Text>
          <Text style={[styles.sub, { color: theme.muted }]} numberOfLines={1}>
            {person.handle}{person.bio ? `  ·  ${person.bio.slice(0, 40)}` : ''}
          </Text>
        </View>
        <Button
          label={person.isFollowing ? 'Following' : 'Follow'}
          accessibilityLabel={person.isFollowing ? `Unfollow ${person.name}` : `Follow ${person.name}`}
          variant={person.isFollowing ? 'secondary' : 'primary'}
          size="small"
          loading={loading}
          onPress={onToggleFollow}
          style={styles.followBtn}
          testID={`search-follow-${person.userId}`}
        />
      </Animated.View>
    </Pressable>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.xs + 2,
  },
  avatar: { width: 44, height: 44, borderRadius: RADII.avatar, alignItems: 'center', justifyContent: 'center' },
  avatarText: { ...TYPE_SCALE.footnote, fontFamily: FONT.bold, color: theme.onAccent },
  name: { ...TYPE_SCALE.body, fontFamily: FONT.semibold },
  sub: { ...TYPE_SCALE.caption, marginTop: 2 },
  followBtn: { minWidth: 98, paddingHorizontal: SPACING.sm },
});
