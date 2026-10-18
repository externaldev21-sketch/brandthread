/**
 * "Live stream options" sheet — the comment bar's ⋯ button on the real LIVE
 * pager (app/live.tsx): Report live stream / Block host.
 *
 * Not `Alert.alert`: react-native-web's `Alert.alert` is a no-op
 * (node_modules/react-native-web/dist/exports/Alert — `static alert() {}`),
 * so the equivalent menu in app/buyer-live.tsx (the real-time RTC viewer)
 * silently does nothing on web. Renders the shared `MenuSheet` instead, so
 * report/block actually work in the web preview too, not just native.
 */
import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/ui/Icon';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SheetRise } from '@/components/motion/SheetRise';

import { useAppTheme } from '@/contexts/AppThemeContext';

import { FONT, FS, RADIUS, SP } from '@/lib/theme';

import { MenuSheet } from '@/components/ui/MenuSheet';

export function LiveStreamOptionsSheet({
  visible, hostName, onClose, onReport, onBlock, sound, onGift, reportLabel = 'Report live stream',
}: {
  visible: boolean;
  hostName: string;
  onClose: () => void;
  onReport: () => void;
  onBlock: () => void;
  sound?: { muted: boolean; onToggle: () => void };
  onGift?: () => void;
  reportLabel?: string;
}) {
  return (
    <MenuSheet
      visible={visible}
      onClose={onClose}
      accessibilityLabel="Live stream options"
      testID="live-stream-options-sheet"
      sections={[[
        ...(sound ? [{ key: 'sound', icon: sound.muted ? 'volume-2' as const : 'volume-x' as const, label: sound.muted ? 'Turn sound on' : 'Mute sound', onPress: sound.onToggle }] : []),
        ...(onGift ? [{ key: 'gift', icon: 'gift' as const, label: `Send Thread Cash to ${hostName}`, onPress: onGift }] : []),
        { key: 'report', icon: 'flag', label: reportLabel, destructive: true, onPress: onReport },
        { key: 'block', icon: 'slash', label: `Block ${hostName}`, destructive: true, onPress: onBlock },
      ]]}
    />
  );
}
