/** One community in a list: tile, name (+ verified mark), member count, one-line description, Join / Joined pill. */
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
          <View style={styles.nameRow}>
            <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>{community.name}</Text>
            {community.verified ? <VerifiedMark size={14} /> : null}
          </View>
          <Text style={[styles.meta, { color: colors.mutedForeground }]} numberOfLines={1}>
            {formatMemberCount(community.memberCount)}
          </Text>
          {community.description ? (
            <Text style={[styles.desc, { color: colors.mutedForeground }]} numberOfLines={1}>{community.description}</Text>
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
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { flexShrink: 1, fontFamily: FONT.semibold, fontSize: FS.base },
  meta: { fontFamily: FONT.regular, fontSize: FS.meta },
  desc: { fontFamily: FONT.regular, fontSize: FS.sm },
  pill: { minWidth: 72, height: 36, paddingHorizontal: SP.md, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  pillText: { fontFamily: FONT.semibold, fontSize: FS.sm },
  error: { fontFamily: FONT.regular, fontSize: FS.meta, lineHeight: 17, paddingLeft: 52 + SP.md - 4, paddingBottom: SP.sm },
});
