/**
 * One community in a list: tile, name (+ verified mark), member count, Join / Joined pill, and the description
 * underneath across the full card width so nothing is ever cut off (names wrap instead of ellipsising).
 */
import React from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import { PressableScale } from '@/components/BrandthreadUI';
import { useColors } from '@/hooks/useColors';
import { formatMemberCount, type Community } from '@/lib/communities/types';
import { FONT, FS, SP } from '@/lib/theme';
import { CommunityAvatar } from './CommunityAvatar';
import { VerifiedGlyph } from './VerifiedMark';

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
        style={styles.card}
        accessibilityRole="button"
        accessibilityLabel={`${community.name}, ${formatMemberCount(community.memberCount)}`}
      >
        <View style={styles.top}>
        <CommunityAvatar community={community} size={52} />
        <View style={styles.copy}>
          <View style={styles.nameRow}>
            <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={2}>
              {community.name}
              {community.verified ? <VerifiedGlyph size={15} /> : null}
            </Text>
          </View>
          <Text style={[styles.meta, { color: colors.mutedForeground }]} numberOfLines={1}>
            {formatMemberCount(community.memberCount)}
          </Text>
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
        </View>
        {community.description ? (
          <Text style={[styles.desc, { color: colors.mutedForeground }]}>{community.description}</Text>
        ) : null}
      </PressableScale>
      {error ? <Text style={[styles.error, { color: colors.mutedForeground }]}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { paddingVertical: SP.sm + 2, gap: SP.sm },
  top: { flexDirection: 'row', alignItems: 'center', gap: SP.md - 4, minHeight: 56 },
  copy: { flex: 1, gap: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { flexShrink: 1, fontFamily: FONT.semibold, fontSize: FS.base },
  meta: { fontFamily: FONT.regular, fontSize: FS.meta },
  // Balanced wrapping (web) keeps a long user-written description from ending on a lone word.
  desc: { fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 19, ...(Platform.OS === 'web' ? ({ textWrap: 'balance' } as object) : null) },
  pill: { minWidth: 72, height: 36, paddingHorizontal: SP.md, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  pillText: { fontFamily: FONT.semibold, fontSize: FS.sm },
  error: { fontFamily: FONT.regular, fontSize: FS.meta, lineHeight: 17, paddingBottom: SP.sm },
});
