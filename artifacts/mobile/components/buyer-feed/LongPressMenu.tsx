/**
 * Buyer Threads Home feed — long-press menu.
 *
 * Offers "2x speed", "Not interested" and "Report" — opened by long-pressing
 * anywhere on the active video. Reuses the same 2x playback-rate mechanism
 * the existing press-and-hold gesture already drives (`speedActive`/`rate`
 * on the video player); this just gives it a second, discoverable entry
 * point alongside a moderation menu.
 *
 * Renders the shared `MenuSheet` (Instagram's reel "More options" sheet):
 * playback in one block, Report in its own block below in the error colour.
 */
import React from 'react';
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Icon, type IconName } from '@/components/ui/Icon';
import { FONT, GOLD, ON_DARK } from '@/lib/theme';
import { RADII } from '@/constants/radii';
import { MenuSheet } from '@/components/ui/MenuSheet';

export function LongPressMenu({
  visible, speedActive, onToggleSpeed, onNotInterested, onReport, onClose,
}: {
  visible: boolean;
  speedActive: boolean;
  onToggleSpeed: () => void;
  onNotInterested: () => void;
  onReport: () => void;
  onClose: () => void;
}) {
  return (
    <MenuSheet
      visible={visible}
      onClose={onClose}
      accessibilityLabel="Video options"
      testID="feed-long-press-menu"
      sections={[
        [
          { key: 'speed', icon: 'fast-forward', label: speedActive ? '2x speed (on)' : '2x speed', onPress: onToggleSpeed },
          { key: 'not-interested', icon: 'eye-off', label: 'Not interested', onPress: onNotInterested },
        ],
        [{ key: 'report', icon: 'flag', label: 'Report', destructive: true, onPress: onReport }],
      ]}
    />
  );
}
