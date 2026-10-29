/**
 * Repost education sheet — extracted from the feed's inline sheet so a global
 * host can mount it. Presentation only: the host owns visibility and the
 * account-wide once-only claim/persistence.
 *
 * Hierarchy (TikTok repost-2 reference, dark Brandthread colors):
 * preview illustration with a "You reposted" badge carrying the viewer's real
 * avatar → bold centered title → two icon bullets → small friend-only privacy
 * note → full-width OK.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useUser } from '@clerk/expo';
import { Sheet } from '@/components/ui/BottomSheet';
import { Icon } from '@/components/ui/Icon';
import { CachedImage } from '@/components/CachedImage';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FG, MUTED, FONT } from '@/lib/theme';

export interface RepostEducationSheetProps {
  visible: boolean;
  onClose: () => void;
}

export function RepostEducationSheet({ visible, onClose }: RepostEducationSheetProps) {
  const { theme } = useAppTheme();
  const { user } = useUser();
  const avatarUri = user?.imageUrl || null;

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      headerRight="none"
      accessibilityLabel="About reposts"
      testID="repost-education-sheet"
      primaryAction={{ label: 'OK', onPress: onClose, accessibilityLabel: 'Got it' }}
    >
      <View style={styles.preview}>
        <View style={[styles.previewMedia, { backgroundColor: theme.cardElevated }]}>
          <View style={[styles.badge, { backgroundColor: theme.text }]} testID="repost-education-badge">
            {avatarUri ? (
              <CachedImage source={{ uri: avatarUri }} style={styles.avatar} contentFit="cover" testID="repost-education-avatar" />
            ) : (
              <View style={[styles.avatar, { backgroundColor: MUTED }]} testID="repost-education-avatar-fallback">
                <Icon name="user" size={11} color={theme.background} />
              </View>
            )}
            <Text style={[styles.badgeText, { color: theme.background }]}>You reposted</Text>
          </View>
          <Icon name="more-horizontal" size={18} color={MUTED} style={styles.more} />
          <View style={styles.lines}>
            <View style={[styles.lineShort, { backgroundColor: theme.border }]} />
            <View style={[styles.lineLong, { backgroundColor: theme.border }]} />
          </View>
          <Icon name="corner-up-right" size={30} color={MUTED} style={styles.share} />
        </View>
      </View>
      <Text style={styles.title} accessibilityRole="header">Introduce this post to others by reposting</Text>
      <View style={styles.point}>
        <Icon name="user" size={22} color={FG} />
        <Text style={styles.pointText}>It will appear on your profile</Text>
      </View>
      <View style={styles.point}>
        <Icon name="repeat" size={22} color={FG} />
        <Text style={styles.pointText}>Use the Repost button to repost or remove repost at any time</Text>
      </View>
      <View style={styles.privacy}>
        <Icon name="lock" size={13} color={MUTED} />
        <Text style={styles.privacyText}>Only mutual friends can see your profile on a repost.</Text>
      </View>
    </Sheet>
  );
}

export default RepostEducationSheet;

const styles = StyleSheet.create({
  preview: { alignItems: 'center', marginBottom: 20 },
  previewMedia: { width: 220, height: 150, borderRadius: 16, overflow: 'hidden', padding: 14, justifyContent: 'flex-end' },
  badge: {
    position: 'absolute', left: 14, top: 54, flexDirection: 'row', alignItems: 'center',
    gap: 5, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 4,
  },
  avatar: { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontFamily: FONT.semibold, fontSize: 11 },
  more: { position: 'absolute', right: 15, top: 52 },
  lines: { gap: 7, marginRight: 52 },
  lineShort: { height: 8, width: 68, borderRadius: 4 },
  lineLong: { height: 8, width: 130, borderRadius: 4 },
  share: { position: 'absolute', right: 16, bottom: 19 },
  title: { color: FG, fontFamily: FONT.bold, fontSize: 28, lineHeight: 34, textAlign: 'center', paddingHorizontal: 12, marginBottom: 22 },
  point: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 6, marginBottom: 16 },
  pointText: { flex: 1, color: FG, fontFamily: FONT.regular, fontSize: 15, lineHeight: 20 },
  privacy: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 2, marginBottom: 18 },
  privacyText: { color: MUTED, fontFamily: FONT.regular, fontSize: 12 },
});
