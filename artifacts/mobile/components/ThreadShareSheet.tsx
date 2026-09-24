import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import * as ExpoLinking from 'expo-linking';

import {
  createOrGetConversation,
  getAcceptedFriends,
  sendMessage,
} from '@/services/socialService';
import type { Friendship } from '@/services/socialTypes';
import { FONT, FS } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { SheetRise } from '@/components/motion/SheetRise';

interface ThreadShareSheetProps {
  visible: boolean;
  postId: string;
  creator: string;
  caption: string;
  productName?: string;
  mediaUri?: string;
  isVideo: boolean;
  onClose: () => void;
  onReport: () => void;
  onNotInterested: () => void;
  onFeedback: (message: string, kind?: 'info' | 'error') => void;
}

type BusyAction = string | null;

export function ThreadShareSheet({
  visible,
  postId,
  creator,
  caption,
  productName,
  mediaUri,
  isVideo,
  onClose,
  onReport,
  onNotInterested,
  onFeedback,
}: ThreadShareSheetProps) {
  const { theme } = useAppTheme();
  const styles = React.useMemo(() => makeStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const [friends, setFriends] = useState<Friendship[]>([]);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [savingProgress, setSavingProgress] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const actionInFlightRef = useRef(false);

  const postUrl = ExpoLinking.createURL('/buyer-post-viewer', {
    queryParams: { postId },
  });
  const shareText = productName
    ? `${productName} by ${creator} on Brandthread\n${postUrl}`
    : `Watch ${creator}'s post on Brandthread\n${postUrl}`;

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    void getAcceptedFriends()
      .then(rows => {
        if (!cancelled) setFriends(rows.slice(0, 4));
      })
      .catch(() => {
        if (!cancelled) setFriends([]);
      });
    return () => { cancelled = true; };
  }, [visible]);

  async function runAction(name: string, action: () => Promise<void>) {
    if (actionInFlightRef.current) return;
    actionInFlightRef.current = true;
    setBusy(name);
    try {
      await action();
    } catch {
      onFeedback('Could not share this post. Try again.', 'error');
    } finally {
      actionInFlightRef.current = false;
      setBusy(null);
    }
  }

  async function sendToFriend(friend: Friendship) {
    await runAction(`friend:${friend.userId}`, async () => {
      const conversation = await createOrGetConversation({
        type: 'buyer_to_buyer',
        participant: {
          userId: friend.userId,
          name: friend.name,
          handle: friend.handle,
          initials: friend.initials,
          color: friend.color,
          accountType: 'buyer',
        },
      });
      await sendMessage(conversation.id, caption || `Shared ${creator}'s post`, {
        type: 'post',
        uri: postUrl,
        title: productName || `${creator}'s post`,
        subtitle: caption,
        meta: { postId },
      });
      onClose();
      onFeedback(`Sent to ${friend.name}`, 'info');
    });
  }

  async function copyLink() {
    await runAction('copy', async () => {
      await Clipboard.setStringAsync(postUrl);
      onClose();
      onFeedback('Link copied. Anyone who opens it can view this post.', 'info');
    });
  }

  async function openExternal(kind: 'sms' | 'email') {
    const url = kind === 'sms'
      ? `sms:${Platform.OS === 'ios' ? '&' : '?'}body=${encodeURIComponent(shareText)}`
      : `mailto:?subject=${encodeURIComponent(`Shared from Brandthread`)}&body=${encodeURIComponent(shareText)}`;
    await runAction(kind, async () => {
      const supported = await Linking.canOpenURL(url);
      if (!supported) {
        await Share.share({ message: shareText, url: postUrl });
      } else {
        await Linking.openURL(url);
      }
      onClose();
    });
  }

  async function openMore() {
    await runAction('more', async () => {
      await Share.share({ message: shareText, url: postUrl });
      onClose();
    });
  }

  async function saveVideo() {
    if (!mediaUri || !isVideo || savingProgress != null) return;
    setSavingProgress(0);
    onClose();
    const controller = new AbortController();
    abortRef.current = controller;
    let destination: InstanceType<typeof import('expo-file-system').File> | null = null;
    try {
      const [{ File, Paths }, MediaLibrary] = await Promise.all([
        import('expo-file-system'),
        import('expo-media-library'),
      ]);
      const permission = await MediaLibrary.requestPermissionsAsync();
      if (!permission.granted) {
        if (!permission.canAskAgain) {
          Alert.alert(
            'Photos access is off',
            'Allow Brandthread to add videos in Settings, then try again.',
            [
              { text: 'Not now', style: 'cancel' },
              {
                text: 'Open Settings',
                onPress: () => {
                  void Linking.openSettings().catch(() => {
                    onFeedback('Open Settings and allow Photos access for Brandthread.', 'error');
                  });
                },
              },
            ],
          );
        } else {
          onFeedback('Photos permission is required to save this video.', 'error');
        }
        return;
      }
      destination = new File(Paths.cache, `brandthread-${postId}-${Date.now()}.mp4`);
      let downloaded;
      if (/^https?:\/\//i.test(mediaUri)) {
        downloaded = await File.downloadFileAsync(mediaUri, destination, {
          idempotent: true,
          signal: controller.signal,
          onProgress: ({ bytesWritten, totalBytes }) => {
            if (totalBytes > 0) {
              setSavingProgress(Math.min(99, Math.round((bytesWritten / totalBytes) * 100)));
            }
          },
        });
      } else {
        const source = new File(mediaUri);
        source.copy(destination);
        downloaded = destination;
        setSavingProgress(90);
      }
      await MediaLibrary.Asset.create(downloaded.uri);
      setSavingProgress(100);
      onFeedback('Video saved to Photos.', 'info');
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') {
        onFeedback('Video save cancelled.', 'info');
      } else {
        onFeedback(error instanceof Error ? error.message : 'Could not save video.', 'error');
      }
    } finally {
      if (destination?.exists) {
        try {
          destination.delete();
        } catch {
          // The temporary file may already be unavailable after a native handoff.
        }
      }
      abortRef.current = null;
      setTimeout(() => setSavingProgress(null), 450);
    }
  }

  return (
    <>
      <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <SheetRise style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <View style={styles.header}>
            <View style={styles.headerSpacer} />
            <Text style={styles.title}>Share to</Text>
            <Pressable onPress={onClose} style={styles.close} accessibilityLabel="Close share menu" testID="thread-share-close">
              <Feather name="x" size={20} color={theme.text} />
            </Pressable>
          </View>

          <View style={styles.section}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.actionRow}
            >
              {friends.map(friend => (
                <ShareAction
                  key={friend.userId}
                  label={friend.name.split(' ')[0]}
                  busy={busy === `friend:${friend.userId}`}
                  onPress={() => void sendToFriend(friend)}
                  avatar={{ initials: friend.initials, color: friend.color }}
                />
              ))}
              <ShareAction
                label="More friends"
                icon="search"
                onPress={() => {
                  onClose();
                  void Linking.openURL(ExpoLinking.createURL('/(buyer)/friends'));
                }}
              />
            </ScrollView>
          </View>

          <View style={styles.divider} />
          <View style={styles.section}>
            <View style={styles.actionRow}>
              <ShareAction label="Copy link" icon="link-2" busy={busy === 'copy'} onPress={() => void copyLink()} />
              <ShareAction label="Messages" icon="message-circle" busy={busy === 'sms'} onPress={() => void openExternal('sms')} />
              <ShareAction label="Email" icon="mail" busy={busy === 'email'} onPress={() => void openExternal('email')} />
              <ShareAction label="More" icon="more-horizontal" busy={busy === 'more'} onPress={() => void openMore()} />
            </View>
          </View>

          <View style={styles.divider} />
          <View style={styles.section}>
            <View style={styles.actionRow}>
              <ShareAction label="Report" icon="flag" onPress={() => { onClose(); onReport(); }} muted />
              <ShareAction label="Not interested" icon="slash" onPress={() => { onClose(); onNotInterested(); }} muted />
              {isVideo && mediaUri ? (
                <ShareAction label="Save video" icon="download" onPress={() => void saveVideo()} muted />
              ) : null}
            </View>
          </View>
        </SheetRise>
      </Modal>

      {savingProgress != null && (
        <View style={[styles.progressWrap, { bottom: insets.bottom + 70 }]}>
          <View style={styles.progressLabels}>
            <Text style={styles.progressText}>{savingProgress}% Saving…</Text>
            <Pressable
              onPress={() => abortRef.current?.abort()}
              accessibilityRole="button"
              accessibilityLabel="Cancel saving video"
              testID="thread-share-save-cancel"
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </View>
          <View style={styles.progressTrack}>
            <Animated.View style={[styles.progressFill, { width: `${savingProgress}%`, backgroundColor: theme.accent }]} />
          </View>
        </View>
      )}
    </>
  );
}

function ShareAction({
  label,
  icon,
  onPress,
  busy,
  muted,
  avatar,
}: {
  label: string;
  icon?: React.ComponentProps<typeof Feather>['name'];
  onPress: () => void;
  busy?: boolean;
  muted?: boolean;
  avatar?: { initials: string; color: string };
}) {
  const { theme } = useAppTheme();
  const styles = React.useMemo(() => makeStyles(theme), [theme]);
  return (
    <Pressable
      style={styles.action}
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={`thread-share-${label.toLowerCase().replace(/\s+/g, '-')}`}
    >
      <View style={[styles.actionCircle, muted && styles.actionCircleMuted, avatar && { backgroundColor: avatar.color }]}>
         {busy ? <ActivityIndicator color={theme.onAccent} /> : avatar ? (
          <Text style={styles.avatarText}>{avatar.initials}</Text>
        ) : (
           <Feather name={icon ?? 'send'} size={22} color={theme.text} />
        )}
      </View>
      <Text style={styles.actionLabel} numberOfLines={2}>{label}</Text>
    </Pressable>
  );
}

const makeStyles = (theme: { background: string; card: string; border: string; text: string; muted: string; surface: string; onAccent: string }) => StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: `${theme.background}55` },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    backgroundColor: theme.card,
    borderTopWidth: 1,
    borderColor: theme.border,
  },
  header: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14 },
  headerSpacer: { width: 34 },
  title: { color: theme.text, fontFamily: FONT.bold, fontSize: FS.md },
  close: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.surface },
  section: { paddingHorizontal: 14, paddingVertical: 14 },
  actionRow: { flexDirection: 'row', gap: 12 },
  action: { width: 66, alignItems: 'center', gap: 7 },
  actionCircle: { width: 52, height: 52, borderRadius: 26, backgroundColor: theme.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.border },
  actionCircleMuted: { backgroundColor: theme.background },
  actionLabel: { minHeight: 30, color: theme.muted, fontFamily: FONT.medium, fontSize: FS.xs, lineHeight: 13, textAlign: 'center' },
  avatarText: { color: theme.onAccent, fontFamily: FONT.bold, fontSize: FS.sm },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: theme.border },
  progressWrap: { position: 'absolute', left: 0, right: 0, zIndex: 10000, backgroundColor: theme.background, paddingTop: 8 },
  progressLabels: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 18, paddingBottom: 7 },
  progressText: { color: theme.text, fontFamily: FONT.medium, fontSize: FS.xs },
  cancelText: { color: theme.text, fontFamily: FONT.semibold, fontSize: FS.xs },
  progressTrack: { height: 3, backgroundColor: theme.border },
  progressFill: { height: 3 },
});
