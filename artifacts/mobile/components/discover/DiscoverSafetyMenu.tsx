/**
 * Discover grid/viewer "..." and long-press safety menu — Not interested /
 * Mute / Report. Renders the shared `MenuSheet` (Instagram's post "More
 * options" sheet), the same as the buyer feed's LongPressMenu
 * (components/buyer-feed/LongPressMenu.tsx), specialized for a feed of other
 * people's posts rather than one's own video player.
 */
import React from 'react';
import { MenuSheet } from '@/components/ui/MenuSheet';

export function DiscoverSafetyMenu({
  visible, authorName, onNotInterested, onMute, onReport, onClose,
}: {
  visible: boolean;
  authorName: string;
  onNotInterested: () => void;
  onMute: () => void;
  onReport: () => void;
  onClose: () => void;
}) {
  return (
    <MenuSheet
      visible={visible}
      onClose={onClose}
      accessibilityLabel="Post options"
      testID="discover-safety-menu"
      sections={[
        [
          { key: 'not-interested', icon: 'eye-off', label: 'Not interested', onPress: onNotInterested },
          { key: 'mute', icon: 'volume-x', label: `Mute ${authorName}`, onPress: onMute },
        ],
        [{ key: 'report', icon: 'flag', label: 'Report', destructive: true, onPress: onReport }],
      ]}
    />
  );
}
