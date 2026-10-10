/**
 * Shared 2-column grid card for Discover's Brands and People tabs — avatar,
 * name (+ verified check), a subline, and a full-width Follow button. Dev
 * asked for the two tabs to look identical, so this is the one component
 * both `DiscoverBrandCard` and `DiscoverPersonCard` render, rather than two
 * near-identical layouts drifting apart.
 *
 * Fixed-height parts (avatar, single-line name/subline, Follow button) keep
 * every card in a 2-column row the same height even when a row mixes cards
 * with and without a subline — the subline's height is always reserved.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Icon, type IconName } from '@/components/ui/Icon';
import { PressableScale } from '@/components/BrandthreadUI';
import { CachedImage } from '@/components/CachedImage';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, SP, ON_DARK } from '@/lib/theme';
import { RADII } from '@/constants/radii';
import FollowButton, { type FollowState } from '@/components/social/FollowButton';

export function DiscoverEntityCard({
  id,
  name,
  imageUri,
  verified,
  subline,
  initials,
  avatarColor,
  fallbackIcon = 'shopping-bag',
  onPress,
  followInitial = { isFollowing: false, isFollowedBy: false, isMutual: false },
}: {
  id: string;
  name: string;
  imageUri?: string;
  verified?: boolean;
  subline?: string;
  /** Person-style fallback: colored circle + initials instead of an icon. */
  initials?: string;
  avatarColor?: string;
  fallbackIcon?: IconName;
  onPress: () => void;
  followInitial?: FollowState;
}) {
  const { theme } = useAppTheme();
  return (
    // Two SIBLING tap targets, never nested — a Pressable inside a
    // Pressable renders as a nested <button> on web (invalid HTML, and the
    // two press handlers fight each other). See
    // tests/discover-no-nested-pressables.test.ts.
    <View style={[styles.card, { borderColor: theme.border, backgroundColor: theme.card }]}>
      <PressableScale onPress={onPress} style={styles.cardTapArea}>
        {imageUri ? (
          <CachedImage source={{ uri: imageUri }} style={[styles.image, styles.imageAlign]} contentFit="cover" />
        ) : initials ? (
          <View style={[styles.image, styles.imageAlign, styles.fallback, { backgroundColor: avatarColor ?? theme.border }]}>
            <Text style={styles.initialsText}>{initials}</Text>
          </View>
        ) : (
          <View style={[styles.image, styles.imageAlign, styles.fallback]}>
            <Icon name={fallbackIcon} size={22} color={theme.muted} />
          </View>
        )}
        <View style={styles.nameRow}>
          <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>{name}</Text>
          {verified && <Icon name="check-circle" size={14} color={ON_DARK} />}
        </View>
        <Text style={[styles.subline, { color: theme.muted }]} numberOfLines={1}>{subline ?? ' '}</Text>
      </PressableScale>
      <FollowButton
        userId={id}
        initial={followInitial}
        size="compact"
        style={{ marginTop: SP.xs, alignSelf: 'stretch' }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // `minWidth: 0` overrides a flex item's default `min-width: auto`, which
  // otherwise lets a flex:1 card grow past its allotted share to fit a long
  // child text node instead of shrinking to it. `overflow: 'hidden'` on top
  // of that is belt-and-suspenders: whatever the interior sizing works out
  // to, nothing can ever paint past this card's own border — this is what
  // actually stopped a long "Followed by X + N others" subline from
  // visually bleeding into the next card in the row (the child Text's own
  // numberOfLines/ellipsis wasn't enough by itself).
  card: {
    flex: 1, minWidth: 0, overflow: 'hidden',
    borderRadius: RADII.card, borderWidth: 1, padding: SP.sm, alignItems: 'center', gap: 4,
  },
  cardTapArea: { alignItems: 'stretch', width: '100%', gap: 4 },
  image: { width: 64, height: 64, borderRadius: 32 },
  imageAlign: { alignSelf: 'center' },
  fallback: { alignItems: 'center', justifyContent: 'center' },
  initialsText: { color: '#FFFFFF', fontFamily: FONT.bold, fontSize: FS.md },
  nameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, marginTop: 6 },
  name: { fontFamily: FONT.semibold, fontSize: FS.sm, flexShrink: 1, minWidth: 0 },
  // Always rendered (falls back to a single space) so every card reserves
  // the same subline height whether or not it has real subline text.
  subline: { fontFamily: FONT.regular, fontSize: FS.xs, textAlign: 'center', flexShrink: 1, minWidth: 0 },
});
