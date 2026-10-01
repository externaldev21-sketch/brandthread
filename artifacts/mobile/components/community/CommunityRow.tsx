/**
 * One community in a list: tile, name (+ verified mark), member count, description, Join / Joined pill.
 * The row body and the pill are siblings (never nested pressables) so the web build renders no
 * <button> inside a <button>. The description shows only when it fits on one line.
 */
import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import type { NativeSyntheticEvent, TextLayoutEventData } from 'react-native';
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

/** Renders `text` on one line, or nothing at all once it's known not to fit. */
function OneLineOrNothing({ text, style }: { text: string; style: object }) {
  const [fits, setFits] = useState(true);
  const ref = useRef<Text>(null);
  const onTextLayout = useCallback((e: NativeSyntheticEvent<TextLayoutEventData>) => {
    if (e.nativeEvent.lines.length > 1) setFits(false);
  }, []);
  const onLayout = useCallback(() => {
    if (Platform.OS !== 'web') return;
    const el = ref.current as unknown as { scrollWidth?: number; clientWidth?: number } | null;
    if (el && typeof el.scrollWidth === 'number' && typeof el.clientWidth === 'number' && el.scrollWidth > el.clientWidth) setFits(false);
  }, []);
  if (!fits) return null;
  return (
    <Text ref={ref} style={style} numberOfLines={1} onTextLayout={onTextLayout} onLayout={onLayout}>
      {text}
    </Text>
  );
}

export function CommunityRow({ community, joined, joining, error, onPress, onJoin }: CommunityRowProps) {
  const colors = useColors();
  return (
    <View>
      <View style={styles.row}>
        {/* Width-bounded wrapper: the pressable's own box never grows past the text column. */}
        <View style={styles.bodyWrap}>
        <PressableScale
          onPress={onPress}
          style={styles.body}
          accessibilityRole="button"
          accessibilityLabel={community.memberCount > 0 ? `${community.name}, ${formatMemberCount(community.memberCount)}` : community.name}
        >
          <CommunityAvatar community={community} size={52} />
          <View style={styles.copy}>
            <View style={styles.nameRow}>
              <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={2}>{community.name}</Text>
              {community.verified ? <VerifiedMark size={14} /> : null}
            </View>
            {community.memberCount > 0 ? (
              <Text style={[styles.meta, { color: colors.mutedForeground }]} numberOfLines={1}>
                {formatMemberCount(community.memberCount)}
              </Text>
            ) : null}
            {community.description ? (
              <OneLineOrNothing text={community.description} style={[styles.desc, { color: colors.mutedForeground }]} />
            ) : null}
          </View>
        </PressableScale>
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
      {error ? <Text style={[styles.error, { color: colors.mutedForeground }]}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: SP.sm + 2, paddingVertical: SP.sm + 2, minHeight: 72 },
  bodyWrap: { flex: 1, minWidth: 0 },
  body: { flexDirection: 'row', alignItems: 'center', gap: SP.md - 4 },
  copy: { flex: 1, minWidth: 0, gap: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { flexShrink: 1, fontFamily: FONT.semibold, fontSize: FS.base, lineHeight: 20 },
  meta: { fontFamily: FONT.regular, fontSize: FS.meta },
  desc: { fontFamily: FONT.regular, fontSize: FS.sm },
  pill: { height: 34, paddingHorizontal: SP.md - 2, borderRadius: 17, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  pillText: { fontFamily: FONT.semibold, fontSize: FS.sm },
  error: { fontFamily: FONT.regular, fontSize: FS.meta, lineHeight: 17, paddingLeft: 52 + SP.md - 4, paddingBottom: SP.sm },
});
