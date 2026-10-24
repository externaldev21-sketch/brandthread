/**
 * Discover grid/viewer "..." and long-press safety menu — Not interested /
 * Mute / Report. Renders the shared `MenuSheet` (Instagram's post "More
 * options" sheet), the same as the buyer feed's LongPressMenu
 * (components/buyer-feed/LongPressMenu.tsx), specialized for a feed of other
 * people's posts rather than one's own video player.
 */
import React, { useEffect } from 'react';
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { hasMenuHost, openContextMenu, type ContextMenuPreview } from '@/lib/contextMenu';
import { buildPostUrl } from '@/lib/shareLinks';
import { copyLink, shareLink } from '@/lib/shareActions';
import { Icon, type IconName } from '@/components/ui/Icon';
import { FONT, GOLD, ON_DARK } from '@/lib/theme';
import { RADII } from '@/constants/radii';
import { MenuSheet } from '@/components/ui/MenuSheet';

export function DiscoverSafetyMenu({
  visible, authorName, onNotInterested, onMute, onReport, onBlock, onClose, postId, preview, onOpen,
}: {
  visible: boolean;
  authorName: string;
  onNotInterested: () => void;
  onMute: () => void;
  onReport: () => void;
  /** Omitted when the author can't be blocked (e.g. no author id). */
  onBlock?: () => void;
  onClose: () => void;
  /** With a post: shown as the long-press preview menu (Instagram grid
   *  long-press) — the post enlarged over a blurred screen, the actions
   *  under it, plus Share and Copy link. */
  postId?: string;
  preview?: ContextMenuPreview;
  /** Tapping the enlarged preview opens the post. */
  onOpen?: () => void;
}) {
  const asPreviewMenu = !!preview && hasMenuHost();
  useEffect(() => {
    if (!visible || !asPreviewMenu || !preview) return;
    const url = buildPostUrl(postId);
    openContextMenu({
      preview,
      onPreviewPress: onOpen,
      items: [
        ...(onBlock ? [{ key: 'block', label: `Block ${authorName}`, icon: 'slash' as const, destructive: true, onPress: onBlock }] : []),
        ...(url ? [
          { key: 'share', label: 'Share', icon: 'share' as const, onPress: () => { void shareLink(url, `${authorName} on Brandthread`); } },
          { key: 'copy', label: 'Copy link', icon: 'link' as const, onPress: () => { void copyLink(url); } },
        ] : []),
        { key: 'not-interested', label: 'Not interested', icon: 'eye-off' as const, onPress: onNotInterested },
        { key: 'mute', label: `Mute ${authorName}`, icon: 'volume-x' as const, onPress: onMute },
        { key: 'report', label: 'Report', icon: 'flag' as const, destructive: true, onPress: onReport },
      ],
    });
    onClose();
  }, [visible]);
  if (asPreviewMenu) return null;
  return (
    <MenuSheet
      visible={visible}
      onClose={onClose}
      accessibilityLabel="Post options"
      testID="discover-safety-menu"
      sections={[
        [
          ...(onBlock ? [{ key: 'block', label: `Block ${authorName}`, icon: 'slash' as const, destructive: true, onPress: onBlock }] : []),
          { key: 'not-interested', icon: 'eye-off', label: 'Not interested', onPress: onNotInterested },
          { key: 'mute', icon: 'volume-x', label: `Mute ${authorName}`, onPress: onMute },
        ],
        [{ key: 'report', icon: 'flag', label: 'Report', destructive: true, onPress: onReport }],
      ]}
    />
  );
}
