/** One community in a list: tile, name (+ inline verified mark), member count, description (up to two lines), Join / Joined pill. */
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { PressableScale } from '@/components/BrandthreadUI';
import { useColors } from '@/hooks/useColors';
import { formatMemberCount, type Community } from '@/lib/communities/types';
import { FONT, FS, SP } from '@/lib/theme';
import { CommunityAvatar } from './CommunityAvatar';
import { VerifiedMark } from './VerifiedMark';

export interface CommunityRowProps {
  community: Community;
  joined: boolean;
  joining?: boolean;
  /** Calm inline message under the row (banned, private, rate limit…). */
  error?: string | null;
  onPress: () => void;
  onJoin: () => void;
}

export function CommunityRow({ community, joined, joining, error, onPress, onJoin }: CommunityRowProps) {
  const colors = useColors();
  return (
    <View>
      <PressableScale
        onPress={onPress}
        style={styles.row}
        accessibilityRole="button"
        accessibilityLabel={`${community.name}, ${formatMemberCount(community.memberCount)}`}
      >
        <CommunityAvatar community={community} size={52} />
        <View style={styles.copy}>
          {/* The verified mark is inline inside the name's own Text, so it
              always follows the last word — on one line, or at the end of the
              second when a long name wraps — never floating off on its own
              next to the Join pill. */}
          <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={2}>
            {community.name}
            {community.verified ? (
              <>
                {'\u00A0'}
                <View style={styles.inlineMark}><VerifiedMark size={14} /></View>
              </>
            ) : null}
          </Text>
          <Text style={[styles.meta, { color: colors.mutedForeground }]} numberOfLines={1}>
            {formatMemberCount(community.memberCount)}
          </Text>
          {community.description ? (
            // Up to two lines (wrapping at word boundaries) rather than a
            // one-line ellipsis cutting it mid-word.
            <Text style={[styles.desc, { color: colors.mutedForeground }]} numberOfLines={2}>{community.description}</Text>
          ) : null}
        </View>
        <PressableScale
          onPress={joined ? onPress : onJoin}
          disabled={joining}
          hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
          accessibilityRole="button"
          accessibilityLabel={joined ? `Open ${community.name}` : `Join ${community.name}`}
          style={[
            styles.pill,
            joined
              ? { borderColor: colors.border, backgroundColor: 'transparent' }
              : { borderColor: colors.foreground, backgroundColor: colors.foreground },
          ]}
        >
          {joining ? (
            <ActivityIndicator size="small" color={colors.background} />
          ) : (
            <Text style={[styles.pillText, { color: joined ? colors.mutedForeground : colors.background }]}>
              {joined ? 'Joined' : 'Join'}
            </Text>
          )}
        </PressableScale>
      </PressableScale>
      {error ? <Text style={[styles.error, { color: colors.mutedForeground }]}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: SP.md - 4, paddingVertical: SP.sm + 2, minHeight: 72 },
  copy: { flex: 1, gap: 1 },
  name: { fontFamily: FONT.semibold, fontSize: FS.base },
  inlineMark: { transform: [{ translateY: 2 }] },
  meta: { fontFamily: FONT.regular, fontSize: FS.meta },
  desc: { fontFamily: FONT.regular, fontSize: FS.sm },
  pill: { minWidth: 72, height: 36, paddingHorizontal: SP.md, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  pillText: { fontFamily: FONT.semibold, fontSize: FS.sm },
  error: { fontFamily: FONT.regular, fontSize: FS.meta, lineHeight: 17, paddingLeft: 52 + SP.md - 4, paddingBottom: SP.sm },
});
