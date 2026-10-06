/**
 * Nicknames — chat details > Nicknames. Sets a per-conversation nickname for
 * the other participant; once set, it renders in place of their real name in
 * the thread (see the `nickname` field on ConversationParticipant, and its
 * use in buyer-conversation.tsx / seller-conversation.tsx's message rows).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ScreenHeader } from '@/components/ScreenHeader';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import { Button } from '@/components/ui/Button';
import { hapticPrimaryAction, hapticSuccessAction } from '@/lib/haptics';
import { useApi } from '@/lib/api';
import { isPreviewConversationId } from '@/lib/previewInbox';
import { setConversationNickname } from '@/services/socialService';
import { apiErrorMessage } from '@/lib/safety';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { EmptyState } from '@/components/layout/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { useConversationParticipant } from '@/hooks/useConversationParticipant';
import { canSaveNickname, cleanParam } from '@/lib/conversationParticipant';

export default function ConversationNicknamesScreen() {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeStyles(), []);
  const router = useRouter();
  const api = useApi();
  const params = useLocalSearchParams<{
    id: string; role?: string; participantUserId: string; participantName: string; participantNickname?: string;
  }>();

  const { state, retry } = useConversationParticipant(params);
  const participant = state.status === 'ready' ? state.participant : null;
  const initialNickname = participant?.nickname ?? '';
  const conversationId = cleanParam(params.id);
  const [nickname, setNickname] = useState(cleanParam(params.participantNickname));
  // A participant loaded from the conversation (no params) brings its
  // current nickname with it — prefill once it arrives.
  useEffect(() => { if (participant) setNickname(participant.nickname ?? ''); }, [participant?.userId]); // eslint-disable-line react-hooks/exhaustive-deps
  const [saving, setSaving] = useState(false);
  const isPreview = isPreviewConversationId(conversationId);
  const canSave = !!participant && canSaveNickname(nickname, initialNickname);

  async function save() {
    if (!participant || !canSave) return;
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

  return (
    <View style={[s.root, { backgroundColor: theme.background }]}>
      <ScreenHeader
        title="Nickname"
        onBack={() => { hapticPrimaryAction(); goBackOr(router); }}
        backTestID="conversation-nicknames-back"
      />

      {state.status === 'loading' ? (
        <ActivityIndicator style={{ marginTop: SP.xl }} color={theme.muted} testID="conversation-nicknames-loading" />
      ) : state.status === 'error' ? (
        <ErrorState message="Couldn’t load this conversation." onRetry={retry} />
      ) : !participant ? (
        <EmptyState icon="message-circle" title="Conversation not found" message="This conversation isn’t available." testID="conversation-nicknames-not-found" />
      ) : (
      <View style={s.body}>
        <Text style={[s.label, { color: theme.muted }]}>
          Set a nickname for {participant.name}. Only you will see it.
        </Text>
        <TextInput
          style={[s.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.cardElevated }]}
          value={nickname}
          onChangeText={setNickname}
          placeholder={participant.name}
          placeholderTextColor={theme.muted}
          maxLength={60}
          autoFocus
          testID="conversation-nicknames-input"
        />
        <Button
          label="Save"
          onPress={save}
          loading={saving}
          disabled={!canSave}
          fullWidth
          style={{ marginTop: SP.lg }}
          testID="conversation-nicknames-save"
        />
      </View>
      )}
    </View>
  );
}

const makeStyles = () => StyleSheet.create({
  root: { flex: 1 },
  body: { paddingHorizontal: SP.md, paddingTop: SP.lg },
  label: { fontFamily: FONT.regular, fontSize: FS.sm, marginBottom: SP.md },
  input: { height: 48, borderRadius: RADIUS.md, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: SP.md, fontFamily: FONT.regular, fontSize: FS.base },
});
