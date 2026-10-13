/**
 * Author-only sheet listing the answers to a story's question stickers, with a
 * Reply button per answer that opens the DM with that person.
 */
import React from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { ModalSafeArea } from '@/components/ModalSafeArea';
import { Avatar } from '@/components/ui';
import { FONT, FS } from '@/lib/theme';
import { RADII } from '@/constants/radii';

export interface QuestionResponses {
  questions: Array<{ overlayId: string; prompt: string; answers: Array<{
    userId: string; name: string; handle: string; initials: string; avatarUrl: string | null; answer: string; createdAt: number;
  }> }>;
}

export function StoryQuestionResponsesSheet({ visible, loading, data, onClose, onReply }: {
  visible: boolean; loading: boolean; data: QuestionResponses | null; onClose: () => void; onReply: (userId: string) => void;
}) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const total = data?.questions.reduce((n, q) => n + q.answers.length, 0) ?? 0;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <ModalSafeArea>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
        <View style={[s.sheet, { backgroundColor: theme.card, paddingBottom: insets.bottom + 16 }]}>
          <View style={[s.handle, { backgroundColor: theme.border }]} />
          <Text style={[s.title, { color: theme.text }]}>Responses</Text>
          {loading ? (
            <View style={s.center}><ActivityIndicator color={theme.text} /></View>
          ) : total === 0 ? (
            <Text style={[s.empty, { color: theme.muted }]}>No responses yet.</Text>
          ) : (
            <ScrollView style={{ maxHeight: 420 }}>
              {data!.questions.filter((q) => q.answers.length > 0).map((q) => (
                <View key={q.overlayId} style={{ marginBottom: 12 }}>
                  <Text style={[s.prompt, { color: theme.muted }]}>{q.prompt}</Text>
                  {q.answers.map((a) => (
                    <View key={a.userId} style={[s.row, { borderBottomColor: theme.border }]}>
                      <Avatar name={a.name} uri={a.avatarUrl ?? undefined} size={40} />
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={[s.name, { color: theme.text }]}>{a.name}</Text>
                        <Text style={[s.answer, { color: theme.text }]}>{a.answer}</Text>
                      </View>
                      <Pressable
                        onPress={() => onReply(a.userId)}
                        style={[s.replyBtn, { borderColor: theme.text }]}
                        accessibilityRole="button"
                        accessibilityLabel={`Reply to ${a.name}`}
                      >
                        <Text style={[s.replyText, { color: theme.text }]}>Reply</Text>
                      </Pressable>
                    </View>
                  ))}
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      </ModalSafeArea>
    </Modal>
  );
}

const s = StyleSheet.create({
  sheet: { borderTopLeftRadius: RADII.sheet, borderTopRightRadius: RADII.sheet, paddingHorizontal: 16, paddingTop: 8, gap: 12 },
  handle: { width: 36, height: 4, borderRadius: RADII.pill, alignSelf: 'center', opacity: 0.6, marginBottom: 4 },
  title: { fontFamily: FONT.bold, fontSize: FS.lg },
  center: { height: 96, alignItems: 'center', justifyContent: 'center' },
  empty: { fontFamily: FONT.regular, fontSize: FS.sm, paddingVertical: 24, textAlign: 'center' },
  prompt: { fontFamily: FONT.semibold, fontSize: FS.meta, marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  name: { fontFamily: FONT.semibold, fontSize: FS.sm },
  answer: { fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 18 },
  replyBtn: { height: 36, minWidth: 72, borderRadius: RADII.pill, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  replyText: { fontFamily: FONT.semibold, fontSize: FS.sm },
});
