/**
 * Product Q&A — public questions and the seller's answers, with an ask
 * composer. Reached from "Questions" on the product page. Anyone can read;
 * asking needs a signed-in account (signed-out visitors are sent to sign in).
 *
 * Reference: Ulta Beauty and Target Q&A screens on Mobbin — count header,
 * outlined "Ask a question" button, Q/A pairs with the answering party named.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@clerk/expo';
import * as Haptics from 'expo-haptics';
import { ScreenHeader } from '@/components/ScreenHeader';
import { PressableScale, EmptyState } from '@/components/BrandthreadUI';
import { Button } from '@/components/ui/Button';
import { Snackbar } from '@/components/ui/Snackbar';
import { useApi } from '@/lib/api';
import type { ProductQuestion } from '@/lib/api';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, SP } from '@/lib/theme';
import { QUESTION_MAX, checkQuestionDraft, questionCountLabel } from '@/lib/reviewDisplay';

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

export default function ProductQuestionsScreen() {
  const { productId, productName } = useLocalSearchParams<{ productId: string; productName?: string }>();
  const api = useApi();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme } = useAppTheme();
  const { isSignedIn } = useAuth();
  const [questions, setQuestions] = useState<ProductQuestion[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!productId) return Promise.resolve();
    setFailed(false);
    return api.productQa.list(productId)
      .then(r => { setQuestions(r.questions); setTotal(r.totalCount); })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, [productId, api]);

  useEffect(() => { void load(); }, [load]);

  const startAsk = () => {
    if (!isSignedIn) { router.push('/sign-in' as never); return; }
    setComposing(true);
  };

  const submit = async () => {
    const check = checkQuestionDraft(draft);
    if (!check.ok) { setError(check.message); return; }
    if (!productId || sending) return;
    setSending(true);
    setError(null);
    try {
      const created = await api.productQa.ask(productId, check.text);
      setQuestions(prev => [created, ...prev]);
      setTotal(n => n + 1);
      setDraft('');
      setComposing(false);
      setToast('Question posted');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: any) {
      let message = 'Couldn’t post your question. Try again.';
      try {
        const parsed = JSON.parse(err?.body ?? '{}').error;
        if (typeof parsed === 'string') message = parsed;
      } catch { /* keep default */ }
      setError(message);
    } finally {
      setSending(false);
    }
  };

  const remove = (id: string) => {
    setQuestions(prev => prev.filter(q => q.id !== id));
    setTotal(n => Math.max(0, n - 1));
    api.productQa.remove(id).catch(() => { void load(); });
  };

  const header = (
    <View style={{ paddingBottom: SP.md }}>
      <Text style={[s.count, { color: theme.text }]}>{questionCountLabel(total)}</Text>
      {productName ? <Text style={[s.product, { color: theme.muted }]} numberOfLines={1}>{productName}</Text> : null}
      {composing ? (
        <View style={s.composer}>
          <TextInput
            style={[s.input, { backgroundColor: theme.cardElevated, borderColor: theme.border, color: theme.text }]}
            placeholder="What would you like to know?"
            placeholderTextColor={theme.muted}
            value={draft}
            onChangeText={t => { setDraft(t); if (error) setError(null); }}
            multiline
            maxLength={QUESTION_MAX}
            textAlignVertical="top"
            autoFocus
            accessibilityLabel="Your question"
          />
          <View style={s.composerMeta}>
            <Text style={[s.error, { color: theme.error }]}>{error ?? ''}</Text>
            <Text style={[s.counter, { color: theme.muted }]}>{draft.length}/{QUESTION_MAX}</Text>
          </View>
          <View style={s.composerActions}>
            <View style={s.half}>
              <Button label="Cancel" variant="secondary" fullWidth onPress={() => { setComposing(false); setError(null); }} />
            </View>
            <View style={s.half}>
              <Button label="Post question" fullWidth loading={sending} disabled={draft.trim().length === 0} onPress={submit} />
            </View>
          </View>
        </View>
      ) : (
        <View style={s.askWrap}>
          <Button label="Ask a question" variant="secondary" fullWidth onPress={startAsk} />
        </View>
      )}
    </View>
  );

  return (
    <KeyboardAvoidingView style={[s.root, { backgroundColor: theme.background }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScreenHeader title="Questions" />
      {loading ? (
        <View style={s.center}><ActivityIndicator color={theme.muted} /></View>
      ) : failed ? (
        <View style={s.center}>
          <EmptyState icon="alert-circle" title="Couldn’t load questions" description="Check your connection and try again." action={{ label: 'Try again', onPress: () => { setLoading(true); void load(); } }} />
        </View>
      ) : (
        <FlatList
          data={questions}
          keyExtractor={q => q.id}
          ListHeaderComponent={header}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: SP.md, paddingTop: SP.sm, paddingBottom: insets.bottom + SP.xl }}
          ListEmptyComponent={
            <Text style={[s.empty, { color: theme.muted }]}>No questions yet. Be the first to ask the seller.</Text>
          }
          renderItem={({ item }) => (
            <View style={[s.card, { borderTopColor: theme.borderSubtle }]}>
              <Text style={[s.q, { color: theme.text }]}>Q: {item.body}</Text>
              <Text style={[s.meta, { color: theme.muted }]}>{item.askerName} · {fmtDate(item.createdAt)}</Text>
              {item.answer ? (
                <View style={[s.answer, { backgroundColor: theme.cardElevated }]}>
                  <Text style={[s.a, { color: theme.text }]}>A: {item.answer.body}</Text>
                  <Text style={[s.meta, { color: theme.muted }]}>Answered by the seller · {fmtDate(item.answer.createdAt)}</Text>
                </View>
              ) : (
                <Text style={[s.meta, { color: theme.muted }]}>Waiting for the seller to answer</Text>
              )}
              {item.mine && (
                <PressableScale onPress={() => remove(item.id)} style={s.deleteRow} accessibilityRole="button" accessibilityLabel="Delete your question">
                  <Text style={[s.deleteText, { color: theme.muted }]}>Delete</Text>
                </PressableScale>
              )}
            </View>
          )}
        />
      )}
      <Snackbar visible={!!toast} message={toast ?? ''} onDismiss={() => setToast(null)} />
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  count: { fontSize: FS.xl, fontFamily: FONT.bold },
  product: { fontSize: FS.sm, fontFamily: FONT.medium, marginTop: 2, marginBottom: SP.md },
  askWrap: { marginTop: SP.sm },
  half: { flex: 1 },
  composer: { marginTop: SP.sm },
  input: { minHeight: 96, borderRadius: 12, borderWidth: 1, padding: SP.md, fontFamily: FONT.regular, fontSize: FS.sm },
  composerMeta: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4, marginBottom: SP.sm },
  error: { flex: 1, fontSize: FS.meta, fontFamily: FONT.medium },
  counter: { fontSize: FS.meta, fontFamily: FONT.regular },
  composerActions: { flexDirection: 'row', gap: SP.sm },
  empty: { fontSize: FS.sm, fontFamily: FONT.medium, textAlign: 'center', paddingVertical: SP.xl },
  card: { paddingVertical: SP.md, borderTopWidth: 1, gap: 6 },
  q: { fontSize: FS.base, fontFamily: FONT.bold, lineHeight: 22 },
  a: { fontSize: FS.sm, fontFamily: FONT.medium, lineHeight: 20 },
  answer: { borderRadius: 8, padding: 12, gap: 4 },
  meta: { fontSize: FS.meta, fontFamily: FONT.medium },
  deleteRow: { alignSelf: 'flex-start' },
  deleteText: { fontSize: FS.meta, fontFamily: FONT.semibold },
});
