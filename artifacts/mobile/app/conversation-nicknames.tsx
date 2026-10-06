/**
 * Nicknames — chat details > Nicknames. Sets a per-conversation nickname for
 * the other participant; once set, it renders in place of their real name in
 * the thread (see the `nickname` field on ConversationParticipant, and its
 * use in buyer-conversation.tsx / seller-conversation.tsx's message rows).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, StyleSheet, Alert } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ScreenHeader } from '@/components/ScreenHeader';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import { Button } from '@/components/ui/Button';
import { hapticPrimaryAction, hapticSuccessAction } from '@/lib/haptics';
import { useApi } from '@/lib/api';
import { isPreviewConversationId, getPreviewConversation } from '@/lib/previewInbox';
import { isSellerDevPreview, isBuyerDevPreview } from '@/lib/devPreview';
import { EmptyState } from '@/components/layout/EmptyState';
import { firstParam, resolveConversationParticipant, type ParticipantLike } from '@/lib/conversationParticipant';
import { setConversationNickname } from '@/services/socialService';
import { apiErrorMessage } from '@/lib/safety';
import { goBackOr } from '@/lib/navigation/goBackOr';

export default function ConversationNicknamesScreen() {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeStyles(), []);
  const router = useRouter();
  const api = useApi();
  const params = useLocalSearchParams<{
    id: string; role?: string; participantUserId: string; participantName: string; participantNickname?: string;
  }>();

  const conversationId = firstParam(params.id);
  // Any dev-preview session is preview here (same rule as conversation-
  // details): a signed-out web preview must never hit the nickname API.
  const isPreview = isPreviewConversationId(conversationId ?? undefined) || isSellerDevPreview() || isBuyerDevPreview();
  // Fills in the participant when the URL doesn't name them (direct link).
  const [loadedParticipant, setLoadedParticipant] = useState<ParticipantLike | null>(
    () => (conversationId && isPreview ? getPreviewConversation(conversationId)?.participants?.[0] ?? null : null),
  );
  const [fetched, setFetched] = useState(false);
  const participant = resolveConversationParticipant(params, loadedParticipant);
  const needsFetch = !!conversationId && !isPreview && !participant;

  useEffect(() => {
    if (!needsFetch || !conversationId) return;
    let cancelled = false;
    api.conversations.get(conversationId)
      .then((conv: { participants?: ParticipantLike[] } | null) => {
        if (!cancelled) setLoadedParticipant(conv?.participants?.[0] ?? null);
      })
      .catch(() => { /* falls through to the not-found state below */ })
      .finally(() => { if (!cancelled) setFetched(true); });
    return () => { cancelled = true; };
  }, [needsFetch, conversationId, api]);

  const [nickname, setNickname] = useState(params.participantNickname ?? '');
  useEffect(() => {
    if (!params.participantNickname && participant?.nickname) setNickname(participant.nickname);
    // Only when a fetched participant arrives with an existing nickname.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participant?.nickname]);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!conversationId || !participant?.userId) return;
    hapticPrimaryAction();
    setSaving(true);
    try {
      if (!isPreview) {
        if (params.role === 'seller') {
          await api.conversations.setNickname(conversationId, participant.userId, nickname);
        } else {
          await setConversationNickname(conversationId, participant.userId, nickname);
        }
      }
      hapticSuccessAction();
      goBackOr(router);
    } catch (e) {
      Alert.alert('Couldn’t save nickname', apiErrorMessage(e, 'Please try again.'));
    } finally {
      setSaving(false);
    }
  }

  const goBack = () => { hapticPrimaryAction(); goBackOr(router); };
  const header = (
    <ScreenHeader
      title="Nickname"
      onBack={goBack}
      backTestID="conversation-nicknames-back"
    />
  );

  // No conversation / participant to nickname: a not-found state rather than
  // "Set a nickname for . Only you will see it." over a dead Save button.
  if (!participant?.userId) {
    return (
      <View style={[s.root, { backgroundColor: theme.background }]}>
        {header}
        {needsFetch && !fetched ? null : (
          <EmptyState
            icon="message-circle"
            title="Conversation not found"
            message="This conversation may have been deleted or the link is incomplete."
            actionLabel="Go back"
            onAction={goBack}
            style={s.stateFill}
            testID="conversation-nicknames-not-found"
          />
        )}
      </View>
    );
  }

  return (
    <View style={[s.root, { backgroundColor: theme.background }]}>
      {header}

      <View style={s.body}>
        <Text style={[s.label, { color: theme.muted }]}>
          Set a nickname for {participant.name}. Only you will see it.
        </Text>
        <TextInput
          style={[s.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.cardElevated }]}
          value={nickname}
          onChangeText={setNickname}
          placeholder="Add a nickname"
          placeholderTextColor={theme.muted}
          maxLength={60}
          autoFocus
          testID="conversation-nicknames-input"
        />
        <Button
          label="Save"
          onPress={save}
          loading={saving}
          fullWidth
          style={{ marginTop: SP.lg }}
          testID="conversation-nicknames-save"
        />
      </View>
    </View>
  );
}

const makeStyles = () => StyleSheet.create({
  root: { flex: 1 },
  stateFill: { flex: 1, justifyContent: 'center' },
  body: { paddingHorizontal: SP.md, paddingTop: SP.lg },
  label: { fontFamily: FONT.regular, fontSize: FS.sm, marginBottom: SP.md },
  input: { height: 48, borderRadius: RADIUS.md, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: SP.md, fontFamily: FONT.regular, fontSize: FS.base },
});
