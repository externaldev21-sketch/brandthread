import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/ui/Icon';

import { PressableScale } from '@/components/BrandthreadUI';
import InboxSwipeRow, { type InboxSwipeAction } from '@/components/inbox/InboxSwipeRow';
import { CommunityAvatar } from '@/components/community/CommunityAvatar';
import { VerifiedMark } from '@/components/community/VerifiedMark';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, SP } from '@/lib/theme';
import type { Community } from '@/lib/communities/types';
import {
  communityMuteActionLabel, communityPreviewText, communityRowPresentation,
} from '@/lib/communities/inboxModel';

function timeAgo(ts?: number): string {
  if (!ts) return '';
  const mins = Math.floor((Date.now() - ts) / 60_000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

interface CommunityInboxRowProps {
  community: Community;
  onPress: () => void;
  onToggleMute: () => void | Promise<void>;
  /** Extra left/right inset for lists that don't pad their own content (seller inbox). */
  horizontalPad?: number;
  minHeight?: number;
}

/**
 * A joined community in the Messages inbox: icon tile, name (+ verified mark
 * for official), "Mara: …" preview, time, unread badge. Muted rows stay quiet —
 * no bold, no loud badge, just a bell-off glyph and a gray count. The only
 * swipe action is Mute/Unmute (the DM-only actions don't apply).
 */
export function CommunityInboxRow({ community, onPress, onToggleMute, horizontalPad = 0, minHeight = 72 }: CommunityInboxRowProps) {
  const { theme } = useAppTheme();
  const p = communityRowPresentation(community);
  const mute = communityMuteActionLabel(community);
  const actions: InboxSwipeAction[] = [{
    key: 'mute',
    label: mute.label,
    icon: mute.icon,
    color: theme.cardElevated,
    textColor: theme.muted,
    onPress: onToggleMute,
    accessibilityLabel: `${mute.label} ${community.name}`,
  }];

  return (
    <InboxSwipeRow rowId={`community-${community.id}`} actions={actions}>
      <PressableScale
        style={[styles.row, { backgroundColor: theme.background, paddingHorizontal: horizontalPad, minHeight }]}
        activeOpacity={0.75}
        onPress={onPress}
        testID={`inbox-community-${community.id}`}
        accessibilityRole="button"
        accessibilityLabel={`Open ${community.name} group chat${p.loud ? `, ${community.unreadCount} unread` : ''}`}
      >
        <View style={styles.avatarSlot}>
          <CommunityAvatar community={community} size={52} />
        </View>
        <View style={styles.center}>
          <View style={styles.nameRow}>
            <Text
              style={[styles.name, { color: theme.text, fontFamily: p.loud ? FONT.bold : FONT.regular }]}
              numberOfLines={1}
            >
              {community.name}
            </Text>
            {community.verified ? <VerifiedMark size={14} /> : null}
          </View>
          <Text
            style={[styles.preview, { color: p.loud ? theme.text : theme.muted, fontFamily: p.loud ? FONT.bold : FONT.regular }]}
            numberOfLines={1}
            {...({ dataSet: { fit: 'preview' } } as object)}
          >
            {communityPreviewText(community)}
          </Text>
        </View>
        <View style={styles.trailing}>
          {community.lastMessageTs ? (
            <Text style={[styles.time, { color: theme.muted }]} numberOfLines={1}>{timeAgo(community.lastMessageTs)}</Text>
          ) : null}
          <View style={styles.badgeRow}>
            {p.showMutedGlyph ? <Icon name="bell-off" size={13} color={theme.subtle} testID={`inbox-community-muted-${community.id}`} /> : null}
            {p.loud ? (
              <View style={[styles.badge, { backgroundColor: theme.accent }]} testID={`inbox-community-badge-${community.id}`}>
                <Text style={[styles.badgeText, { color: theme.onAccent }]}>{p.countLabel}</Text>
              </View>
            ) : p.quietUnread ? (
              <Text style={[styles.quietCount, { color: theme.subtle }]} testID={`inbox-community-quiet-${community.id}`}>{p.countLabel}</Text>
            ) : null}
          </View>
        </View>
      </PressableScale>
    </InboxSwipeRow>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: SP.sm },
  avatarSlot: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, minWidth: 0, marginLeft: SP.md },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3 },
  name: { flexShrink: 1, fontSize: FS.base },
  preview: { fontSize: 14 },
  trailing: { alignItems: 'flex-end', justifyContent: 'center', gap: 6, marginLeft: SP.sm },
  time: { fontSize: FS.sm, fontFamily: FONT.medium },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 20 },
  badge: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: FS.xs, fontFamily: FONT.bold },
  quietCount: { fontSize: FS.xs, fontFamily: FONT.medium },
});
