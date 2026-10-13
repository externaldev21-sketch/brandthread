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
import { MenuSheet } from '@/components/ui/MenuSheet';

export function LiveStreamOptionsSheet({
  visible, hostName, onClose, onReport, onBlock,
}: {
  visible: boolean;
  hostName: string;
  onClose: () => void;
  onReport: () => void;
  onBlock: () => void;
}) {
  return (
    <MenuSheet
      visible={visible}
      onClose={onClose}
      accessibilityLabel="Live stream options"
      testID="live-stream-options-sheet"
      sections={[[
        { key: 'report', icon: 'flag', label: 'Report live stream', destructive: true, onPress: onReport },
        { key: 'block', icon: 'slash', label: `Block ${hostName}`, destructive: true, onPress: onBlock },
      ]]}
    />
  );
}
