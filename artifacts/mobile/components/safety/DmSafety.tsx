/**
 * Shared safety controls for direct-message screens: the conversation options
 * menu (report / block / unblock), per-message reporting, and the composer
 * replacement shown when messaging is blocked in either direction.
 */
import React from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { useRouter } from 'expo-router';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { confirmBlock, confirmUnblock, reportHref } from '@/lib/safety';

export interface DmCounterpart {
  userId: string;
  name: string;
}

export interface DmMessagingState {
  blockedByMe: boolean;
  unavailable: boolean;
}

interface BlockApi {
  block: (userId: string) => Promise<unknown>;
  unblock: (userId: string) => Promise<unknown>;
}

/** "⋯" menu for a conversation. */
export function openConversationOptions(params: {
  router: Router;
  social: BlockApi;
  counterpart: DmCounterpart;
  messaging: DmMessagingState;
  onChange: (next: DmMessagingState) => void;
  extraOptions?: Array<{ text: string; onPress: () => void }>;
}) {
  const { router, social, counterpart, messaging, onChange, extraOptions = [] } = params;
  Alert.alert(counterpart.name, undefined, [
    ...extraOptions,
    {
      text: `Report ${counterpart.name}`,
      onPress: () => router.push(reportHref({
        targetType: 'profile',
        targetId: counterpart.userId,
        label: counterpart.name,
        ownerId: counterpart.userId,
        ownerName: counterpart.name,
      }) as never),
    },
    messaging.blockedByMe
      ? {
          text: `Unblock ${counterpart.name}`,
          onPress: async () => {
            if (await confirmUnblock(counterpart, social.unblock)) onChange({ ...messaging, blockedByMe: false });
          },
        }
      : {
          text: `Block ${counterpart.name}`,
          style: 'destructive' as const,
          onPress: async () => {
            if (await confirmBlock(counterpart, social.block)) onChange({ ...messaging, blockedByMe: true });
          },
        },
    { text: 'Cancel', style: 'cancel' as const },
  ]);
}

/** Long-press menu for someone else's message. */
export function openMessageOptions(params: {
  router: Router;
  messageId: string;
  text: string;
  counterpart: DmCounterpart;
}) {
  const { router, messageId, text, counterpart } = params;
  Alert.alert('Message', text ? `“${text.slice(0, 140)}”` : undefined, [
    {
      text: 'Report message',
      onPress: () => router.push(reportHref({
        targetType: 'message',
        targetId: messageId,
        label: `Message from ${counterpart.name}`,
        ownerId: counterpart.userId,
        ownerName: counterpart.name,
      }) as never),
    },
    { text: 'Cancel', style: 'cancel' },
  ]);
}

/** Replaces the composer when messaging is blocked in either direction. */
export function BlockedComposer({
  counterpartName,
  messaging,
  onUnblock,
  bottomInset,
}: {
  counterpartName: string;
  messaging: DmMessagingState;
  onUnblock: () => void;
  bottomInset: number;
}) {
  const { theme } = useAppTheme();
  const byMe = messaging.blockedByMe;
  return (
    <View style={[st.wrap, { borderTopColor: theme.border, backgroundColor: theme.surface, paddingBottom: Math.max(bottomInset, 12) }]}>
      <View style={[st.icon, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <Feather name={byMe ? 'slash' : 'lock'} size={16} color={theme.text} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[st.title, { color: theme.text }]}>
          {byMe ? `You blocked ${counterpartName}` : 'You can’t reply to this conversation'}
        </Text>
        <Text style={[st.body, { color: theme.muted }]}>
          {byMe
            ? 'They can’t message you or see your content. Unblock to message them again.'
            : 'This account isn’t available for messaging.'}
        </Text>
      </View>
      {byMe ? (
        <TouchableOpacity
          onPress={onUnblock}
          style={[st.btn, { borderColor: theme.text }]}
          accessibilityRole="button"
          accessibilityLabel={`Unblock ${counterpartName}`}
        >
          <Text style={[st.btnText, { color: theme.text }]}>Unblock</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

/** Placeholder text for a message a moderator removed. */
export const REMOVED_MESSAGE_TEXT = 'This message was removed for violating the Community Guidelines.';

type Router = ReturnType<typeof useRouter>;

const st = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingHorizontal: SP.md, paddingTop: 12, borderTopWidth: 1 },
  icon: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: FONT.semibold, fontSize: FS.sm },
  body: { fontFamily: FONT.regular, fontSize: FS.xs, lineHeight: 16, marginTop: 2 },
  btn: { borderWidth: 1, borderRadius: RADIUS.pill, paddingHorizontal: 14, height: 34, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontFamily: FONT.semibold, fontSize: FS.xs },
});
