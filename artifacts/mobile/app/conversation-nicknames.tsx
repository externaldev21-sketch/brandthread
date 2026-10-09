/**
 * Nicknames — chat details > Nicknames. Sets a per-conversation nickname for
 * the other participant; once set, it renders in place of their real name in
 * the thread (see the `nickname` field on ConversationParticipant, and its
 * use in buyer-conversation.tsx / seller-conversation.tsx's message rows).
 */
import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, StyleSheet, Alert } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ScreenHeader } from '@/components/ScreenHeader';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import { Button } from '@/components/ui/Button';
import { haptics } from '@/lib/haptics';
import { useApi } from '@/lib/api';
import { isPreviewConversationId } from '@/lib/previewInbox';
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

  const [nickname, setNickname] = useState(params.participantNickname ?? '');
  const [saving, setSaving] = useState(false);
  const isPreview = isPreviewConversationId(params.id);

  async function save() {
    setSaving(true);
    try {
      if (!isPreview) {
        if (params.role === 'seller') {
          await api.conversations.setNickname(params.id, params.participantUserId, nickname);
        } else {
          await setConversationNickname(params.id, params.participantUserId, nickname);
        }
      }
      haptics.success();
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
        onBack={() => { goBackOr(router); }}
        backTestID="conversation-nicknames-back"
      />

      <View style={s.body}>
        <Text style={[s.label, { color: theme.muted }]}>
          Set a nickname for {params.participantName}. Only you will see it.
        </Text>
        <TextInput
          style={[s.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.cardElevated }]}
          value={nickname}
          onChangeText={setNickname}
          placeholder={params.participantName}
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
  body: { paddingHorizontal: SP.md, paddingTop: SP.lg },
  label: { fontFamily: FONT.regular, fontSize: FS.sm, marginBottom: SP.md },
  input: { height: 48, borderRadius: RADIUS.md, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: SP.md, fontFamily: FONT.regular, fontSize: FS.base },
});
