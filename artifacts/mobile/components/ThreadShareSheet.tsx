import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Icon, type IconName } from '@/components/ui/Icon';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import * as ExpoLinking from 'expo-linking';
import { smsComposeUrl } from '@/lib/smsLink';

import {
  createOrGetConversation,
  getAcceptedFriends,
  getConversations,
  sendMessage,
} from '@/services/socialService';
import { SHARE_ROW_MAX, type ShareTarget } from '@/lib/shareRecents';
import { allShareTargets } from '@/lib/shareContactSearch';
import { ShareContactPicker, type ContactLoadStatus } from '@/components/ShareContactPicker';
import { useAuth } from '@clerk/expo';
import { FONT, FS } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { Sheet } from '@/components/ui/BottomSheet';
import { useApi } from '@/lib/api';
import { isUUID } from '@/lib/engagementUtils';
import { buildPostUrl } from '@/lib/shareLinks';
import { storyPostShareHref } from '@/lib/storyPostShare';
import { quotePostHref } from '@/lib/quotePost';
import { stitchHref } from '@/lib/fits';
import { useRouter } from 'expo-router';
import { getMediaLibrary, mediaLibraryUnavailableMessage } from '@/lib/mediaLibraryCompat';
import { isBuyerDevPreview } from '@/lib/devPreview';
import { remixActionVisible, remixRoute } from '@/lib/remix';
import { publishPostEngagement } from '@/lib/postEngagement';
import { OFFICIAL_AVATAR_SOURCE, isOfficialAccountId } from '@/lib/officialAccount';

interface ThreadShareSheetProps {
  visible: boolean;
  postId: string;
  creator: string;
  caption: string;
  productName?: string;
  mediaUri?: string;
  isVideo: boolean;
  shareCount?: number;
  onClose: () => void;
  onReport: () => void;
  onNotInterested: () => void;
  onFeedback: (message: string, kind?: 'info' | 'error') => void;
  /** Whether the signed-in viewer has already reposted this post. */
  reposted?: boolean;
  /** Persists the repost toggle; parent owns the repost state. */
  onRepost?: () => Promise<void> | void;
  /** Truthful reason supplied by the feed ranker, if any. */
  recommendationReason?: string;
}

export const DEFAULT_RECOMMENDATION_REASON =
  "This video is shown based on general activity on Brandthread, such as recent and popular posts. Brandthread doesn't have a more specific reason to show for this video.";

type BusyAction = string | null;

export function ThreadShareSheet(props: ThreadShareSheetProps) {
  const { userId } = useAuth();
  // Contacts, search text and pending sends belong to one Clerk identity.
  // Remount before paint when sessions change, rather than clear private
  // contact names in a later effect.
  return <AccountThreadShareSheet key={userId ?? 'guest'} {...props} />;
}

function AccountThreadShareSheet({
  visible,
  postId,
  creator,
  caption,
  productName,
  mediaUri,
  isVideo,
  shareCount = 0,
  onClose,
  onReport,
  onNotInterested,
  onFeedback,
  reposted = false,
  onRepost,
  recommendationReason,
}: ThreadShareSheetProps) {
  const { theme } = useAppTheme();
  const styles = React.useMemo(() => makeStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const api = useApi();
  const router = useRouter();
  // "Send to" row (#145): recent chats first, then friends (lib/shareRecents).
  const [allTargets, setAllTargets] = useState<ShareTarget[]>([]);
  const friends = React.useMemo(() => allTargets.slice(0, SHARE_ROW_MAX), [allTargets]);
  const [contactStatus, setContactStatus] = useState<ContactLoadStatus>('loading');
  const [contactsReload, setContactsReload] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  useEffect(() => { if (!visible) setPickerOpen(false); }, [visible]);
  const { userId: myUserId } = useAuth();
  const [busy, setBusy] = useState<BusyAction>(null);
  const [savingProgress, setSavingProgress] = useState<number | null>(null);
  // The author's "Allow downloads" setting (GET /api/interaction-settings/
  // posts/:id/download). Preview/demo posts (non-UUID ids) have no author
  // account to ask, so they keep the plain save action.
  const [downloadAllowed, setDownloadAllowed] = useState<boolean | null>(null);
  // "Remix" — offered only when the server says the author allows this viewer
  // to remix (GET /api/remix/posts/:id) and the viewer can publish video.
  const [remixAllowed, setRemixAllowed] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const actionInFlightRef = useRef(false);

  // Records a persisted share interaction (see POST /api/posts/:id/interact,
  // type "share") whenever the person actually completes a share out of the
  // app — sending to a friend, copying the link, or handing off to the
  // native share sheet. Fire-and-forget: this is analytics, not something
  // the share flow should ever block or fail on, and preview/demo posts
  // (non-UUID ids) have nothing to record against.
  const accountRef = useRef(myUserId);
  accountRef.current = myUserId;
  React.useEffect(() => {
    accountRef.current = myUserId;
    return () => { accountRef.current = null; };
  }, [myUserId]);
  const recordShare = React.useCallback(async () => {
    const owner = myUserId;
    if (!isUUID(postId) || !owner || accountRef.current !== owner) return;
    publishPostEngagement(owner, postId, { shares: shareCount + 1 });
    try {
      const result = await api.posts.interact(postId, { type: 'share' });
      if (accountRef.current !== owner) return;
      publishPostEngagement(owner, postId, { shares: result.count ?? shareCount + 1 });
    } catch {
      // Roll back the optimistic count for the account that made it.
      publishPostEngagement(owner, postId, { shares: shareCount });
      if (accountRef.current === owner) onFeedback('Shared, but the share count could not be updated.', 'error');
    }
  }, [api, postId, myUserId, shareCount, onFeedback]);

  // Shared out as the canonical https link (/p/:id) so it opens the app via
  // universal links and unfurls with Open Graph in other apps. Demo/preview
  // ids that can't form a public link keep the in-app deep link.
  const postUrl = buildPostUrl(postId) ?? ExpoLinking.createURL('/buyer-post-viewer', {
    queryParams: { postId },
  });
  const shareText = productName
    ? `${productName} by ${creator} on Brandthread\n${postUrl}`
    : `Watch ${creator}'s post on Brandthread\n${postUrl}`;

  useEffect(() => {
    if (!visible || !isVideo || !mediaUri) return;
    if (!isUUID(postId)) { setDownloadAllowed(true); return; }
    let cancelled = false;
    setDownloadAllowed(null);
    api.interactionSettings.downloadAllowed(postId)
      .then(result => { if (!cancelled) setDownloadAllowed(result.allowed === true); })
      .catch(() => { if (!cancelled) setDownloadAllowed(false); });
    return () => { cancelled = true; };
  }, [api, visible, isVideo, mediaUri, postId]);

  useEffect(() => {
    // Signed-out web preview never calls protected APIs.
    if (!visible || !isVideo || !isUUID(postId) || isBuyerDevPreview()) { setRemixAllowed(false); return; }
    let cancelled = false;
    api.remix.check(postId)
      .then(result => { if (!cancelled) setRemixAllowed(remixActionVisible(result)); })
      .catch(() => { if (!cancelled) setRemixAllowed(false); });
    return () => { cancelled = true; };
  }, [api, visible, isVideo, postId]);

  useEffect(() => {
    if (!visible) return;
    setAllTargets([]);
    // Signed out: no DM history to read (and never a protected call).
    if (!myUserId) { setContactStatus('signed_out'); return; }
    let cancelled = false;
    setContactStatus('loading');
    void Promise.all([getConversations(), getAcceptedFriends()])
      .then(([conversations, accepted]) => {
        if (cancelled) return;
        setAllTargets(allShareTargets(conversations, accepted, myUserId));
        setContactStatus('ready');
      })
      .catch(() => {
        if (!cancelled) setContactStatus('error');
      });
    return () => { cancelled = true; };
  }, [visible, myUserId, contactsReload]);

  async function runAction(name: string, action: () => Promise<void>) {
    if (actionInFlightRef.current) return;
    actionInFlightRef.current = true;
    setBusy(name);
    try {
      await action();
    } catch {
      onFeedback("Couldn't share post. Try again.", 'error');
    } finally {
      actionInFlightRef.current = false;
      setBusy(null);
    }
  }

  async function sendToFriend(friend: ShareTarget) {
    const owner = myUserId;
    if (!owner) { onFeedback('Sign in to send posts to friends.', 'error'); return; }
    await runAction(`friend:${friend.userId}`, async () => {
      // A recent chat already has a conversation: send straight into it.
      const conversation = friend.conversationId ? { id: friend.conversationId } : await createOrGetConversation({
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
      if (accountRef.current !== owner) return;
      await sendMessage(conversation.id, caption || `Shared ${creator}'s post`, {
        type: 'post',
        uri: postUrl,
        title: productName || `${creator}'s post`,
        subtitle: caption,
        meta: { postId },
      });
      if (accountRef.current !== owner) return;
      onClose();
      onFeedback(`Sent to ${friend.name}`, 'info');
      void recordShare();
    });
  }

  async function copyLink() {
    await runAction('copy', async () => {
      await Clipboard.setStringAsync(postUrl);
      onClose();
      onFeedback('Copied', 'info');
      void recordShare();
    });
  }

  async function openExternal(kind: 'sms' | 'email') {
    const url = kind === 'sms'
      ? smsComposeUrl(shareText, Platform.OS)
      : `mailto:?subject=${encodeURIComponent(`Shared from Brandthread`)}&body=${encodeURIComponent(shareText)}`;
    await runAction(kind, async () => {
      const supported = await Linking.canOpenURL(url);
      if (!supported) {
        const result = await Share.share({ message: shareText, url: postUrl });
        if (result.action === Share.dismissedAction) return;
      } else {
        await Linking.openURL(url);
      }
      onClose();
      void recordShare();
    });
  }

  async function openMore() {
    await runAction('more', async () => {
      const result = await Share.share({ message: shareText, url: postUrl });
      if (result.action === Share.dismissedAction) return;
      onClose();
      void recordShare();
    });
  }

  async function toggleRepost() {
    if (!onRepost) return;
    if (!myUserId) { onFeedback('Sign in to repost.', 'error'); return; }
    const owner = myUserId;
    const wasReposted = reposted;
    if (actionInFlightRef.current) return;
    actionInFlightRef.current = true;
    setBusy('repost');
    try {
      // Parent owns repost success/error toasts (its handler may catch and
      // report failures itself), so the sheet only closes on resolve.
      await onRepost();
      if (accountRef.current !== owner) return;
      onClose();
    } catch {
      if (accountRef.current === owner) {
        onFeedback(wasReposted ? "Couldn't remove repost. Try again." : "Couldn't repost. Try again.", 'error');
      }
    } finally {
      actionInFlightRef.current = false;
      setBusy(null);
    }
  }

  // Hands off only the post id; the story composer fetches the authoritative
  // post (and its server-side canReshareToStory permission) itself.
  function addToStory() {
    if (!myUserId) { onFeedback('Sign in to add posts to your Story.', 'error'); return; }
    const href = storyPostShareHref(postId);
    if (!href) { onFeedback("This post can't be added to your Story.", 'error'); return; }
    onClose();
    router.push(href as never);
  }

  async function systemShare(name: string, message: string, notice?: string) {
    await runAction(name, async () => {
      const result = await Share.share({ message, url: postUrl });
      if (result.action === Share.dismissedAction) return;
      onClose();
      if (notice) onFeedback(notice, 'info');
      void recordShare();
    });
  }

  async function shareToInstagram() {
    // Instagram offers no public API for posting a link from another app, so
    // hand off through the system share sheet (Instagram appears there when
    // installed and accepts what it supports, e.g. DMs).
    await systemShare(
      'instagram',
      shareText,
      'Shared via your phone’s share sheet — pick Instagram there if it’s installed.',
    );
  }

  function openMoreOptions() {
    const options: { text: string; onPress: () => void; style?: 'cancel' }[] = [];
    if (isUUID(postId)) {
      options.push({ text: 'Quote', onPress: () => { onClose(); router.push(quotePostHref({ postId, author: creator, caption, thumb: isVideo ? undefined : mediaUri, mediaType: isVideo ? 'video' : 'photo' }) as never); } });
    }
    if (remixAllowed) options.push({ text: 'Remix', onPress: () => { onClose(); router.push(remixRoute(postId) as never); } });
    if (isUUID(postId)) options.push({ text: 'Stitch', onPress: () => { onClose(); router.push(stitchHref(postId) as never); } });
    options.push({ text: 'Other apps', onPress: () => { void systemShare('more', shareText); } });
    options.push({ text: 'Cancel', style: 'cancel', onPress: () => {} });
    Alert.alert('More', undefined, options);
  }

  function whyThisVideo() {
    Alert.alert('Why this video', recommendationReason?.trim() || DEFAULT_RECOMMENDATION_REASON);
  }

  async function saveVideo() {
    if (!mediaUri || !isVideo || downloadAllowed !== true || savingProgress != null) return;
    setSavingProgress(0);
    onClose();
    const controller = new AbortController();
    abortRef.current = controller;
    let destination: InstanceType<typeof import('expo-file-system').File> | null = null;
    try {
      const [{ File, Paths }] = await Promise.all([import('expo-file-system')]);
      const MediaLibrary = getMediaLibrary();
      if (!MediaLibrary) {
        onFeedback(mediaLibraryUnavailableMessage(), 'error');
        return;
      }
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
          onFeedback('Allow Photos access to save this video.', 'error');
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
      await MediaLibrary.createAssetAsync(downloaded.uri);
      setSavingProgress(100);
      onFeedback('Saved to Photos', 'info');
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') {
        onFeedback('Save cancelled', 'info');
      } else {
        onFeedback("Couldn't save video. Try again.", 'error');
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
      <Sheet
        visible={visible}
        onClose={onClose}
        title="Send to"
        centerTitle
        headerRight="plain-close"
        padded={false}
        accessibilityLabel="Share menu"
        testID="thread-share-sheet"
      >
        {pickerOpen ? (
          <ShareContactPicker
            status={contactStatus}
            targets={allTargets}
            busyUserId={busy?.startsWith('friend:') ? busy.slice(7) : null}
            onSend={target => void sendToFriend(target)}
            onBack={() => setPickerOpen(false)}
            onRetry={() => setContactsReload(n => n + 1)}
          />
        ) : (
        <>
          <View style={styles.section}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.actionRow}>
              {onRepost ? (
                <ShareAction
                  label={reposted ? 'Remove repost' : 'Repost'}
                  icon="repeat"
                  busy={busy === 'repost'}
                  onPress={() => void toggleRepost()}
                  highlighted={reposted}
                />
              ) : null}
              <ShareAction label="Add to Story" icon="plus-circle" onPress={addToStory} />
              {friends.map(friend => (
                <ShareAction
                  key={friend.userId}
                  label={friend.name.split(' ')[0]}
                  busy={busy === `friend:${friend.userId}`}
                  onPress={() => void sendToFriend(friend)}
                  avatar={{ initials: friend.initials, color: friend.color, uri: friend.avatarUri, official: friend.isOfficial || isOfficialAccountId(friend.userId) }}
                />
              ))}
              <ShareAction
                label="More"
                testID="thread-share-more-contacts"
                icon="search"
                onPress={() => setPickerOpen(true)}
              />
              <ShareAction
                label="Invite friends to chat"
                icon="user-plus"
                busy={busy === 'invite'}
                onPress={() => void systemShare('invite', `Join me on Brandthread and check this out\n${postUrl}`)}
              />
            </ScrollView>
          </View>

          <View style={styles.divider} />
          <View style={styles.section}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.actionRow}>
              <ShareAction label="Copy link" icon="link-2" busy={busy === 'copy'} onPress={() => void copyLink()} />
              <ShareAction label="SMS" icon="message-circle" busy={busy === 'sms'} onPress={() => void openExternal('sms')} />
              <ShareAction label="Email" icon="mail" busy={busy === 'email'} onPress={() => void openExternal('email')} />
              <ShareAction label="Instagram" icon="instagram" busy={busy === 'instagram'} onPress={() => void shareToInstagram()} />
              <ShareAction label="More" icon="more-horizontal" busy={busy === 'more'} onPress={openMoreOptions} />
            </ScrollView>
          </View>

          <View style={styles.section}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.actionRow}>
              <ShareAction label="Report" icon="flag" onPress={() => { onClose(); onReport(); }} muted />
              <ShareAction label="Not interested" icon="slash" onPress={() => { onClose(); onNotInterested(); }} muted />
              {isVideo && mediaUri && downloadAllowed === true ? (
                <ShareAction label="Save video" icon="download" onPress={() => void saveVideo()} muted />
              ) : null}
              <ShareAction label="Why this video" icon="help-circle" onPress={whyThisVideo} muted />
            </ScrollView>
          </View>
        </>
        )}
      </Sheet>

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
  highlighted,
  testID,
}: {
  label: string;
  icon?: IconName;
  onPress: () => void;
  busy?: boolean;
  muted?: boolean;
  avatar?: { initials: string; color: string; uri?: string; official?: boolean };
  highlighted?: boolean;
  testID?: string;
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
      testID={testID ?? `thread-share-${label.toLowerCase().replace(/\s+/g, '-')}`}
    >
      <View style={[styles.actionCircle, muted && styles.actionCircleMuted, highlighted && { backgroundColor: theme.text }, avatar && { backgroundColor: avatar.color }]}>
         {busy ? <ActivityIndicator color={theme.onAccent} /> : avatar?.official ? (
          <Image source={OFFICIAL_AVATAR_SOURCE} style={styles.avatarImage} resizeMode="cover" testID="thread-share-official-avatar" />
        ) : avatar?.uri ? (
          <Image source={{ uri: avatar.uri }} style={styles.avatarImage} resizeMode="cover" testID="thread-share-avatar-image" />
        ) : avatar ? (
          <Text style={styles.avatarText}>{avatar.initials}</Text>
        ) : (
           <Icon name={icon ?? 'send'} size={22} color={highlighted ? theme.background : theme.text} />
        )}
      </View>
      <Text style={styles.actionLabel} numberOfLines={2}>{label}</Text>
    </Pressable>
  );
}

const makeStyles = (theme: { background: string; card: string; border: string; text: string; muted: string; surface: string; onAccent: string }) => StyleSheet.create({
  section: { paddingVertical: 8 },
  actionRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 8 },
  action: { width: 60, alignItems: 'center', gap: 6 },
  actionCircle: { width: 48, height: 48, borderRadius: 24, overflow: 'hidden', backgroundColor: theme.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.border },
  actionCircleMuted: { backgroundColor: theme.background },
  actionLabel: { minHeight: 28, color: theme.muted, fontFamily: FONT.medium, fontSize: FS.xs, lineHeight: 14, textAlign: 'center' },
  avatarImage: { width: '100%', height: '100%' },
  avatarText: { color: theme.onAccent, fontFamily: FONT.bold, fontSize: FS.sm },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: theme.border },
  progressWrap: { position: 'absolute', left: 0, right: 0, zIndex: 10000, backgroundColor: theme.background, paddingTop: 8 },
  progressLabels: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 18, paddingBottom: 7 },
  progressText: { color: theme.text, fontFamily: FONT.medium, fontSize: FS.xs },
  cancelText: { color: theme.text, fontFamily: FONT.semibold, fontSize: FS.xs },
  progressTrack: { height: 3, backgroundColor: theme.border },
  progressFill: { height: 3 },
});
