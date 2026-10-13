/**
 * Author-only sheet listing the answers to a story's question stickers, with a
 * Reply button per answer that opens the DM with that person.
 */
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { Avatar } from '@/components/ui';
import { Sheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { FONT, FS } from '@/lib/theme';

export interface QuestionResponses {
  questions: Array<{ overlayId: string; prompt: string; answers: Array<{
    userId: string; name: string; handle: string; initials: string; avatarUrl: string | null; answer: string; createdAt: number;
  }> }>;
}

export function StoryQuestionResponsesSheet({ visible, loading, data, onClose, onReply }: {
  visible: boolean; loading: boolean; data: QuestionResponses | null; onClose: () => void; onReply: (userId: string) => void;
}) {
  const { theme } = useAppTheme();
  const total = data?.questions.reduce((n, q) => n + q.answers.length, 0) ?? 0;
  return (
    <Sheet visible={visible} onClose={onClose} title="Responses" testID="story-question-responses">
      {loading ? (
        <View style={s.center}><ActivityIndicator color={theme.text} /></View>
      ) : total === 0 ? (
        <Text style={[s.empty, { color: theme.muted }]}>No responses yet.</Text>
      ) : (
        data!.questions.filter((q) => q.answers.length > 0).map((q) => (
          <View key={q.overlayId} style={s.group}>
            <Text style={[s.prompt, { color: theme.muted }]}>{q.prompt}</Text>
            {q.answers.map((a) => (
              <View key={a.userId} style={[s.row, { borderBottomColor: theme.border }]}>
                <Avatar name={a.name} uri={a.avatarUrl ?? undefined} size={40} />
                <View style={s.rowBody}>
                  <Text style={[s.name, { color: theme.text }]}>{a.name}</Text>
                  <Text style={[s.answer, { color: theme.text }]}>{a.answer}</Text>
                </View>
                <Button
                  label="Reply"
                  variant="secondary"
                  size="small"
                  onPress={() => onReply(a.userId)}
                  accessibilityLabel={`Reply to ${a.name}`}
                />
              </View>
            ))}
          </View>
        ))
      )}
    </Sheet>
  );
}

const s = StyleSheet.create({
  center: { height: 96, alignItems: 'center', justifyContent: 'center' },
  empty: { fontFamily: FONT.regular, fontSize: FS.sm, paddingVertical: 24, textAlign: 'center' },
  group: { marginBottom: 12 },
  prompt: { fontFamily: FONT.semibold, fontSize: FS.meta, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  rowBody: { flex: 1, gap: 2 },
  name: { fontFamily: FONT.semibold, fontSize: FS.sm },
  answer: { fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 18 },
});
