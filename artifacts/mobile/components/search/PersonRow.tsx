import React from 'react';
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { CachedImage } from '@/components/CachedImage';
import { haptics, hapticFollow } from '@/lib/haptics';
import { FONT } from '@/lib/theme';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';
import { RADII, radius } from '@/constants/radii';
import { PRESS_SCALE, pressScaleAnim } from '@/constants/motion';
import { VerifiedBadge } from '@/components/ui/VerifiedBadge';
import { showActionSheet } from '@/components/ui/ActionSheet';

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
  /** A follow request to this private account is pending — the pill reads
   *  "Requested", and tapping it cancels the request. */
  requested?: boolean;
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
  //
  // Tapping "Following" confirms first — the same two-option sheet as the
  // Following list (app/connections.tsx) — so no caller unfollows on one tap.
  // Follow and cancelling a pending request go straight through.
  const handleFollowPress = () => {
    if (!person.isFollowing) { onToggleFollow(); return; }
    showActionSheet(`Unfollow ${person.name}?`, undefined, [
      { text: 'Unfollow', style: 'destructive', onPress: () => onToggleFollow() },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

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
                <VerifiedBadge style={styles.verifiedBadge} />
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
        requested={!person.isFollowing && !!person.requested}
        loading={loading}
        onPress={handleFollowPress}
        accessibilityLabel={person.isFollowing
          ? `Unfollow ${person.name}`
          : person.requested
            ? `Requested, tap to cancel the follow request to ${person.name}`
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
 * `requested` (a pending request to a private account) uses the outlined
 * "Following" look with the label "Requested".
 */
export function FollowPill({
  following,
  followBack,
  requested,
  loading,
  onPress,
  accessibilityLabel,
  testID,
}: {
  following: boolean;
  followBack?: boolean;
  requested?: boolean;
  loading: boolean;
  onPress: () => void;
  accessibilityLabel: string;
  testID?: string;
}) {
  const scale = React.useRef(new Animated.Value(1)).current;
  // "Requested" is drawn like "Following" (outlined) — both are a pending or
  // active follow the next tap undoes.
  const outlined = following || !!requested;

  return (
    <Pressable
      onPress={() => { if (!loading) { hapticFollow(!outlined); onPress(); } }}
      onPressIn={() => pressScaleAnim(scale, PRESS_SCALE).start()}
      onPressOut={() => pressScaleAnim(scale, 1).start()}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ busy: loading }}
      testID={testID}
    >
      <Animated.View style={[pillStyles.pill, outlined ? pillStyles.following : pillStyles.notFollowing, { transform: [{ scale }] }]}>
        {loading ? (
          <ActivityIndicator size="small" color={outlined ? '#FFFFFF' : '#000000'} />
        ) : (
          <Text style={[pillStyles.label, outlined ? pillStyles.followingLabel : pillStyles.notFollowingLabel]} numberOfLines={1}>
            {following ? 'Following' : requested ? 'Requested' : followBack ? 'Follow back' : 'Follow'}
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
  label: { fontSize: TYPE_SCALE.callout.fontSize, fontFamily: FONT.semibold },
  notFollowingLabel: { color: '#000000' },
  followingLabel: { color: '#FFFFFF' },
});

/** A PersonRow's vertical padding — exported so loading skeletons standing
 *  in for these rows (app/activity-people.tsx) keep exactly the same height. */
export const PERSON_ROW_PADDING_V = SPACING.xs + 2;

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    paddingHorizontal: SPACING.md, paddingVertical: PERSON_ROW_PADDING_V,
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
