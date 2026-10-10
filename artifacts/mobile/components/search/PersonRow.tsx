import React from 'react';
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { CachedImage } from '@/components/CachedImage';
import { haptics } from '@/lib/haptics';
import { FONT } from '@/lib/theme';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';
import { RADII, radius } from '@/constants/radii';
import { PRESS_SCALE, pressScaleAnim } from '@/constants/motion';

export type SearchPerson = {
  userId: string;
  name: string;
  username: string | null;
  handle: string;
  initials: string;
  color: string;
  bio: string | null;
  isFollowing: boolean;
  /** 'buyer' | 'seller' | 'both' — real user profiles, not brand listings. */
  accountType?: string;
  verified?: boolean;
  /** "Buyer", or the seller's storefront name (falling back to "Seller"). */
  roleTag?: string;
  /** Real uploaded/Clerk avatar photo; falls back to the initials circle when absent. */
  avatarUrl?: string | null;
  /** Pre-formatted follower count (e.g. "1.2K followers") — omitted when the
   *  source endpoint doesn't return a follower count (api.social.search
   *  doesn't today; only shown when a caller has one, never fabricated). */
  followersLabel?: string;
  /** This person already follows the viewer — the pill reads "Follow back"
   *  instead of "Follow" (e.g. the Activity "New followers" list). */
  followsYou?: boolean;
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

  // The row's own tap target (avatar + name/handle) and the Follow pill are
  // SIBLING Pressables inside a plain View, never one nested in the other —
  // a Pressable inside a Pressable renders as a <button> nested in a
  // <button> on web, which the browser rejects (and the two press handlers
  // fight each other). See tests/buyer-shopping-no-nested-pressables.
  return (
    <View style={styles.row}>
      <Pressable
        onPress={() => onPress()}
        onPressIn={() => pressScaleAnim(scale, PRESS_SCALE).start()}
        onPressOut={() => pressScaleAnim(scale, 1).start()}
        accessibilityRole="button"
        accessibilityLabel={`Open ${person.name}`}
        style={styles.rowTapArea}
      >
        <Animated.View style={[styles.rowTapAreaInner, { transform: [{ scale }] }]}>
          {person.avatarUrl ? (
            <CachedImage source={{ uri: person.avatarUrl }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, { backgroundColor: person.color }]}>
              <Text style={styles.avatarText}>{person.initials}</Text>
            </View>
          )}
          <View style={{ flex: 1 }}>
            <View style={styles.nameRow}>
              <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>{person.name}</Text>
              {person.verified && (
                <Feather name="check-circle" size={13} color={theme.text} style={styles.verifiedBadge} />
              )}
            </View>
            <Text style={[styles.sub, { color: theme.muted }]} numberOfLines={1}>
              {person.handle}
              {person.roleTag ? ` · ${person.roleTag}` : ''}
              {person.followersLabel ? ` · ${person.followersLabel}` : ''}
              {person.bio ? ` · ${person.bio.slice(0, 40)}` : ''}
            </Text>
          </View>
        </Animated.View>
      </Pressable>
      <FollowPill
        following={person.isFollowing}
        followBack={!!person.followsYou}
        loading={loading}
        onPress={onToggleFollow}
        accessibilityLabel={person.isFollowing
          ? `Unfollow ${person.name}`
          : `${person.followsYou ? 'Follow back' : 'Follow'} ${person.name}`}
        testID={`search-follow-${person.userId}`}
      />
    </View>
  );
}

/**
 * Dedicated Follow/Following pill — deliberately not the shared `Button`
 * component: the owner's spec is a fixed 32pt-tall white-fill/black-text
 * pill (a dark outlined version for "Following"), not the theme-accent
 * `Button` sizes. A plain sibling `Pressable`, never nested inside the
 * row's own Pressable above. Also used by the Activity tab's single-person
 * follow rows, so every Follow pill in the social surfaces is this one.
 */
export function FollowPill({
  following,
  followBack,
  loading,
  onPress,
  accessibilityLabel,
  testID,
}: {
  following: boolean;
  followBack?: boolean;
  loading: boolean;
  onPress: () => void;
  accessibilityLabel: string;
  testID?: string;
}) {
  const scale = React.useRef(new Animated.Value(1)).current;

  return (
    <Pressable
      onPress={() => { if (!loading) { haptics.light(); onPress(); } }}
      onPressIn={() => pressScaleAnim(scale, PRESS_SCALE).start()}
      onPressOut={() => pressScaleAnim(scale, 1).start()}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ busy: loading }}
      testID={testID}
    >
      <Animated.View style={[pillStyles.pill, following ? pillStyles.following : pillStyles.notFollowing, { transform: [{ scale }] }]}>
        {loading ? (
          <ActivityIndicator size="small" color={following ? '#FFFFFF' : '#000000'} />
        ) : (
          <Text style={[pillStyles.label, following ? pillStyles.followingLabel : pillStyles.notFollowingLabel]} numberOfLines={1}>
            {following ? 'Following' : followBack ? 'Follow back' : 'Follow'}
          </Text>
        )}
      </Animated.View>
    </Pressable>
  );
}

const pillStyles = StyleSheet.create({
  pill: {
    height: 32, paddingHorizontal: 16, borderRadius: radius.sm,
    alignItems: 'center', justifyContent: 'center', minWidth: 88,
  },
  // theme-exempt: fixed white-fill/black-text pill per spec, with a dark
  // outlined "Following" state — a neutral follow affordance regardless of
  // the active theme, same intentional pattern as the search field's fixed
  // #1f1f1f fill.
  notFollowing: { backgroundColor: '#FFFFFF' },
  following: { backgroundColor: 'transparent', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
  label: { fontSize: 14, fontFamily: FONT.semibold },
  notFollowingLabel: { color: '#000000' },
  followingLabel: { color: '#FFFFFF' },
});

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.xs + 2,
  },
  rowTapArea: { flex: 1 },
  rowTapAreaInner: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  avatar: { width: 44, height: 44, borderRadius: RADII.avatar, alignItems: 'center', justifyContent: 'center' },
  avatarText: { ...TYPE_SCALE.footnote, fontFamily: FONT.bold, color: theme.onAccent },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  verifiedBadge: { marginTop: 1 },
  name: { ...TYPE_SCALE.body, fontFamily: FONT.semibold },
  sub: { ...TYPE_SCALE.caption, marginTop: 2 },
});
