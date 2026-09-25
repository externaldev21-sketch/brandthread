import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { PressableScale } from '@/components/BrandthreadUI';

const CARD_WIDTH = 116;
const AVATAR_SIZE = 72;

interface FollowerAvatarCardProps {
  name: string;
  initials: string;
  color: string;
  unread?: boolean;
  busy?: boolean;
  onPress: () => void;
  onMessage: () => void;
  testID?: string;
}

/**
 * Large avatar-card used for the inbox's horizontal "new followers" rail
 * (Azar/Instagram-style): a big round avatar, a name, and an inline
 * "Message" pill. Shared so any screen that needs a follow-card rail (e.g.
 * a future "people you may know" surface) can reuse it instead of a
 * one-off row.
 */
export function FollowerAvatarCard({
  name, initials, color, unread, busy, onPress, onMessage, testID,
}: FollowerAvatarCardProps) {
  const { theme } = useAppTheme();
  return (
    <View style={styles.wrap}>
      <PressableScale
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={name}
        testID={testID}
        style={styles.tap}
      >
        <View style={[styles.avatarRing, { borderColor: unread ? theme.accent : 'transparent' }]}>
          <View style={[styles.avatar, { backgroundColor: color }]}>
            <Text style={styles.initials}>{initials}</Text>
          </View>
          {unread ? <View style={[styles.dot, { backgroundColor: theme.accent, borderColor: theme.background }]} /> : null}
        </View>
        <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>{name}</Text>
      </PressableScale>
      <PressableScale
        style={[styles.messageBtn, { borderColor: theme.border, backgroundColor: theme.cardElevated }]}
        onPress={onMessage}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={`Message ${name}`}
      >
        {busy ? (
          <ActivityIndicator size="small" color={theme.text} />
        ) : (
          <Text style={[styles.messageText, { color: theme.text }]}>Message</Text>
        )}
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: CARD_WIDTH, alignItems: 'center', gap: SP.xs },
  tap: { alignItems: 'center', gap: 6, width: '100%' },
  avatarRing: {
    width: AVATAR_SIZE + 6,
    height: AVATAR_SIZE + 6,
    borderRadius: (AVATAR_SIZE + 6) / 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: { fontSize: FS.lg, fontFamily: FONT.bold, color: '#FFFFFF' },
  dot: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
  },
  name: { fontSize: FS.xs, fontFamily: FONT.semibold, textAlign: 'center', maxWidth: CARD_WIDTH },
  messageBtn: {
    width: '100%',
    height: 32,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  messageText: { fontSize: FS.xs, fontFamily: FONT.semibold },
});
