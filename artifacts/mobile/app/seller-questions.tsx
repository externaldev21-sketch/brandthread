/**
 * Seller side of product Q&A — questions buyers asked on the seller's own
 * products, unanswered first, with an inline answer composer. Reached from
 * "Questions" in the seller More menu. The API only lets the product's owner
 * answer.
 */
import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TextInput, ActivityIndicator } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { ScreenHeader } from '@/components/ScreenHeader';
import { PressableScale, EmptyState } from '@/components/BrandthreadUI';
import { Button } from '@/components/ui/Button';
import { Snackbar } from '@/components/ui/Snackbar';
import { useApi } from '@/lib/api';
import type { SellerProductQuestion } from '@/lib/api';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, SP } from '@/lib/theme';
import { ANSWER_MAX, checkAnswerDraft } from '@/lib/reviewDisplay';

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

function QuestionCard({ item, onAnswered }: { item: SellerProductQuestion; onAnswered: (id: string, body: string) => void }) {
  const api = useApi();
  const { theme } = useAppTheme();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.answer?.body ?? '');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const send = async () => {
    const check = checkAnswerDraft(draft);
    if (!check.ok) { setError(check.message); return; }
    setSending(true);
    setError(null);
    try {
      await api.productQa.answer(item.id, check.text);
      setEditing(false);
      onAnswered(item.id, check.text);
    } catch {
      setError('Couldn’t post your answer. Try again.');
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={[s.card, { borderTopColor: theme.borderSubtle }]}>
      <Text style={[s.product, { color: theme.muted }]} numberOfLines={1}>{item.productName}</Text>
      <Text style={[s.q, { color: theme.text }]}>{item.body}</Text>
      <Text style={[s.meta, { color: theme.muted }]}>{item.askerName} · {fmtDate(item.createdAt)}</Text>

      {item.answer && !editing ? (
        <View style={[s.answer, { backgroundColor: theme.cardElevated }]}>
          <Text style={[s.a, { color: theme.text }]}>{item.answer.body}</Text>
          <PressableScale onPress={() => setEditing(true)} accessibilityRole="button" accessibilityLabel="Edit your answer" style={{ alignSelf: 'flex-start' }}>
            <Text style={[s.link, { color: theme.muted }]}>Edit answer</Text>
          </PressableScale>
        </View>
      ) : editing || !item.answer ? (
        <View>
          {!editing ? (
            <View style={s.answerBtnWrap}>
              <Button label="Answer" variant="secondary" size="small" fullWidth onPress={() => setEditing(true)} accessibilityLabel="Answer this question" />
            </View>
          ) : (
            <>
              <TextInput
                style={[s.input, { backgroundColor: theme.cardElevated, borderColor: theme.border, color: theme.text }]}
                placeholder="Write a public answer"
                placeholderTextColor={theme.muted}
                value={draft}
                onChangeText={t => { setDraft(t); if (error) setError(null); }}
                multiline
                maxLength={ANSWER_MAX}
                textAlignVertical="top"
                accessibilityLabel="Your answer"
              />
              {!!error && <Text style={[s.error, { color: theme.error }]}>{error}</Text>}
              <View style={s.actions}>
                <View style={s.half}>
                  <Button label="Cancel" variant="secondary" size="small" fullWidth onPress={() => { setEditing(false); setDraft(item.answer?.body ?? ''); setError(null); }} />
                </View>
                <View style={s.half}>
                  <Button label="Post answer" size="small" fullWidth loading={sending} disabled={!draft.trim()} onPress={send} />
                </View>
              </View>
            </>
          )}
        </View>
      ) : null}
    </View>
  );
}

export default function SellerQuestionsScreen() {
  const api = useApi();
  const insets = useSafeAreaInsets();
  const { theme } = useAppTheme();
  const [items, setItems] = useState<SellerProductQuestion[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(() => {
    setFailed(false);
    api.productQa.sellerInbox()
      .then(r => setItems(r.questions))
      .catch(() => { setFailed(true); setItems(prev => prev ?? []); });
  }, [api]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onAnswered = (id: string, body: string) => {
    setItems(prev => (prev ?? []).map(q => q.id === id ? { ...q, answer: { id: q.answer?.id ?? id, body, createdAt: new Date().toISOString() } } : q));
    setToast('Answer posted');
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  return (
    <View style={[s.root, { backgroundColor: theme.background }]}>
      <ScreenHeader title="Questions" />
      {items === null ? (
        <View style={s.center}><ActivityIndicator color={theme.muted} /></View>
      ) : failed ? (
        <View style={s.center}>
          <EmptyState icon="alert-circle" title="Couldn’t load questions" description="Check your connection and try again." action={{ label: 'Try again', onPress: () => { setItems(null); load(); } }} />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={q => q.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: SP.md, paddingBottom: insets.bottom + SP.xl, flexGrow: 1 }}
          ListEmptyComponent={
            <View style={s.center}>
              <EmptyState icon="help-circle" title="No questions yet" description="When buyers ask about your products, their questions show up here." />
            </View>
          }
          renderItem={({ item }) => <QuestionCard item={item} onAnswered={onAnswered} />}
        />
      )}
      <Snackbar visible={!!toast} message={toast ?? ''} onDismiss={() => setToast(null)} />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: { paddingVertical: SP.md, borderTopWidth: 1, gap: 6 },
  product: { fontSize: FS.meta, fontFamily: FONT.semibold },
  q: { fontSize: FS.base, fontFamily: FONT.bold, lineHeight: 22 },
  a: { fontSize: FS.sm, fontFamily: FONT.medium, lineHeight: 20 },
  meta: { fontSize: FS.meta, fontFamily: FONT.medium },
  answer: { borderRadius: 10, padding: 12, gap: 6 },
  link: { fontSize: FS.meta, fontFamily: FONT.semibold },
  answerBtnWrap: { marginTop: 4 },
  half: { flex: 1 },
  input: { minHeight: 88, borderRadius: 12, borderWidth: 1, padding: SP.md, fontFamily: FONT.regular, fontSize: FS.sm },
  error: { fontSize: FS.meta, fontFamily: FONT.medium, marginTop: 4 },
  actions: { flexDirection: 'row', gap: SP.sm, marginTop: SP.sm },
});
