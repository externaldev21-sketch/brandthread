/**
 * Buyer Threads Home feed — long-press "Video options" sheet.
 *
 * Copied from TikTok's Video options flow (Mobbin flow cf7d0c6d, "Video
 * options"): long-press anywhere on the video → a bottom sheet with a row of
 * round actions (Report · Not interested · Save video · Captions · Playback
 * speed), a "Share with" row, then Save / Repost rows. "Not interested" opens
 * a second page in the same sheet asking why (this video, or this seller),
 * like TikTok's "Not interested" details.
 *
 * Reskinned to Brandthread's theme tokens; same Modal + SheetRise shell as
 * the Share sheet (components/ThreadShareSheet.tsx) so the two feel like one
 * family. The 2x-speed toggle is the same `speedActive` the press-and-hold
 * gesture drives.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Icon, type IconName } from '@/components/ui/Icon';

import { Sheet } from '@/components/ui/BottomSheet';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FONT, FS } from '@/lib/theme';

import { useAppTheme } from '@/contexts/AppThemeContext';

import { SheetRise } from '@/components/motion/SheetRise';

import { hapticLight } from '@/lib/haptics';

export type NotInterestedReason = 'video' | 'creator';

type FeatherName = IconName;

export function LongPressMenu({
  visible, creator, isVideo, speedActive, onToggleSpeed,
  saved, onToggleSave, reposted, canRepost = true, onToggleRepost,
  onShare, onCopyLink, captions, canDownload = false, onDownload,
  onNotInterested, onReport, onClose,
}: {
  visible: boolean;
  /** Seller display name, read out by VoiceOver on the "Don't recommend" row. */
  creator: string;
  isVideo: boolean;
  speedActive: boolean;
  onToggleSpeed: () => void;
  saved: boolean;
  onToggleSave: () => void;
  reposted: boolean;
  canRepost?: boolean;
  onToggleRepost: () => void;
  onShare: () => void;
  /** Omitted for posts that have no public link (preview/demo ids). */
  onCopyLink?: () => void;
  /** Present only when this video has a ready caption track. */
  captions?: { on: boolean; onToggle: () => void };
  /** The seller left "Allow downloads" on and this is a video. */
  canDownload?: boolean;
  onDownload?: () => void;
  onNotInterested: (reason: NotInterestedReason) => void;
  onReport: () => void;
  onClose: () => void;
}) {
  const { theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const [page, setPage] = useState<'main' | 'not-interested'>('main');
  useEffect(() => { if (!visible) setPage('main'); }, [visible]);
  if (!visible) return null;

  // One haptic per action, then the sheet closes (TikTok closes on every
  // action except opening the "Not interested" details).
  const act = (fn: () => void) => () => { hapticLight(); onClose(); fn(); };

  const topActions: { key: string; icon: FeatherName; label: string; onPress: () => void; active?: boolean }[] = [
    { key: 'report', icon: 'flag', label: 'Report', onPress: act(onReport) },
    { key: 'not-interested', icon: 'slash', label: 'Not interested', onPress: () => { hapticLight(); setPage('not-interested'); } },
  ];
  if (isVideo && canDownload && onDownload) {
    topActions.push({ key: 'download', icon: 'download', label: 'Save video', onPress: act(onDownload) });
  }
  if (isVideo && captions) {
    topActions.push({
      key: 'captions', icon: 'type', label: captions.on ? 'Captions on' : 'Captions',
      active: captions.on, onPress: act(captions.onToggle),
    });
  }
  if (isVideo) {
    topActions.push({
      key: 'speed', icon: 'fast-forward', label: speedActive ? '2x speed on' : '2x speed',
      active: speedActive, onPress: act(onToggleSpeed),
    });
  }

  return (
    <Sheet visible={visible} onClose={onClose} title={page === 'main' ? 'Video options' : 'Not interested'} padded={false} testID="feed-video-options">
        {page === 'main' ? (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.actionRow}>
              {topActions.map(a => (
                <RoundAction key={a.key} icon={a.icon} label={a.label} active={a.active} onPress={a.onPress} testID={`feed-option-${a.key}`} />
              ))}
            </ScrollView>

            <View style={styles.divider} />
            <View style={styles.shareRow}>
              <Text style={styles.shareLabel}>Share with</Text>
              <View style={styles.shareIcons}>
                {onCopyLink ? (
                  <SmallCircle icon="link-2" label="Copy link" onPress={act(onCopyLink)} testID="feed-option-copy-link" />
                ) : null}
                <SmallCircle icon="send" label="Share" onPress={act(onShare)} testID="feed-option-share" />
              </View>
            </View>

            <View style={styles.divider} />
            <ListAction icon="bookmark" label={saved ? 'Saved' : 'Save'} active={saved} onPress={act(onToggleSave)} testID="feed-option-save" />
            {canRepost ? (
              <ListAction icon="repeat" label={reposted ? 'Remove repost' : 'Repost'} active={reposted} onPress={act(onToggleRepost)} testID="feed-option-repost" />
            ) : null}
          </>
        ) : (
          <>
            <View style={styles.subHeader}>
              <Pressable onPress={() => setPage('main')} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back" style={styles.subBack}>
                <Icon name="chevron-left" size={24} color={theme.text} />
              </Pressable>
              <Text style={styles.subTitle}>Not interested</Text>
              <View style={styles.subBack} />
            </View>
            <View style={styles.divider} />
            <ListAction icon="eye-off" label="Hide this video" onPress={act(() => onNotInterested('video'))} testID="feed-not-interested-video" />
            <ListAction icon="user-x" label="Don't recommend this seller" a11y={`Don't recommend videos from ${creator}`} onPress={act(() => onNotInterested('creator'))} testID="feed-not-interested-creator" />
          </>
        )}
      </Sheet>
  );

  function RoundAction({ icon, label, active, onPress, testID }: { icon: FeatherName; label: string; active?: boolean; onPress: () => void; testID?: string }) {
    return (
      <Pressable style={styles.action} onPress={onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: !!active }} testID={testID}>
        <View style={[styles.circle, active && styles.circleActive]}>
          <Icon name={icon} size={22} color={active ? theme.onAccent : theme.text} />
        </View>
        <Text style={styles.actionLabel} numberOfLines={2}>{label}</Text>
      </Pressable>
    );
  }

  function SmallCircle({ icon, label, onPress, testID }: { icon: FeatherName; label: string; onPress: () => void; testID?: string }) {
    return (
      <Pressable style={styles.smallCircle} onPress={onPress} hitSlop={6} accessibilityRole="button" accessibilityLabel={label} testID={testID}>
        <Icon name={icon} size={18} color={theme.text} />
      </Pressable>
    );
  }

  function ListAction({ icon, label, a11y, active, onPress, testID }: { icon: FeatherName; label: string; a11y?: string; active?: boolean; onPress: () => void; testID?: string }) {
    return (
      <Pressable style={({ pressed }) => [styles.listRow, pressed && styles.listRowPressed]} onPress={onPress} accessibilityRole="button" accessibilityLabel={a11y ?? label} testID={testID}>
        <Icon name={icon} size={20} color={theme.text} />
        <Text style={[styles.listLabel, active && styles.listLabelActive]} numberOfLines={2}>{label}</Text>
        <Icon name="chevron-right" size={18} color={theme.muted} />
      </Pressable>
    );
  }
}

const makeStyles = (theme: { background: string; card: string; border: string; text: string; muted: string; surface: string; onAccent: string; accent: string }) => StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: `${theme.background}55` },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    borderTopLeftRadius: 22, borderTopRightRadius: 22,
    backgroundColor: theme.card, borderTopWidth: 1, borderColor: theme.border,
    paddingTop: 8,
  },
  actionRow: { flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  action: { width: 66, alignItems: 'center', gap: 8 },
  circle: {
    width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center',
    backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border,
  },
  circleActive: { backgroundColor: theme.accent, borderColor: theme.accent },
  actionLabel: { minHeight: 30, color: theme.muted, fontFamily: FONT.medium, fontSize: FS.xs, lineHeight: 14, textAlign: 'center' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: theme.border },
  shareRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  shareLabel: { color: theme.text, fontFamily: FONT.semibold, fontSize: 15 },
  shareIcons: { flexDirection: 'row', gap: 12 },
  smallCircle: {
    width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border,
  },
  listRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 8 },
  listRowPressed: { backgroundColor: theme.surface },
  listLabel: { flex: 1, color: theme.text, fontFamily: FONT.medium, fontSize: 15 },
  listLabelActive: { fontFamily: FONT.semibold },
  subHeader: { height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8 },
  subBack: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  subTitle: { color: theme.text, fontFamily: FONT.semibold, fontSize: 17 },
});
