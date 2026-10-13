/**
 * Product detail "Questions" section — sits after the reviews block. Shows the
 * question count and the latest answered question, with entry points to the
 * full Q&A screen (read, ask). Signed-out visitors can read; asking sends them
 * to sign in from the Q&A screen.
 *
 * Reference: Ulta / Target product Q&A on Mobbin (count header, outlined
 * "Ask a question" button, Q/A pairs with the responder labelled).
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useApi } from '@/lib/api';
import type { ProductQuestion } from '@/lib/api';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { PressableScale } from '@/components/BrandthreadUI';
import { Button } from '@/components/ui/Button';
import { FONT, FS } from '@/lib/theme';
import { questionCountLabel } from '@/lib/reviewDisplay';

export function ProductQuestionsSection({ productId, productName }: { productId: string; productName?: string }) {
  const api = useApi();
  const router = useRouter();
  const { theme } = useAppTheme();
  const [data, setData] = useState<{ questions: ProductQuestion[]; totalCount: number } | null>(null);

  useEffect(() => {
    let active = true;
    api.productQa.list(productId, 3)
      .then(result => { if (active) setData(result); })
      .catch(() => { if (active) setData({ questions: [], totalCount: 0 }); });
    return () => { active = false; };
  }, [productId, api]);

  if (!data) return null;
  const open = () => router.push(
    `/product-questions?productId=${encodeURIComponent(productId)}&productName=${encodeURIComponent(productName ?? '')}` as never,
  );
  const featured = data.questions.find(q => q.answer) ?? data.questions[0];

  return (
    <View style={[s.wrap, { borderTopColor: theme.borderSubtle }]}>
      <View style={s.headerRow}>
        <Text style={[s.title, { color: theme.text }]}>Questions ({data.totalCount})</Text>
        {data.totalCount > 0 && (
          <PressableScale onPress={open} noMinHeight hitSlop={12} accessibilityRole="button" accessibilityLabel="See all questions">
            <Text style={[s.seeAll, { color: theme.muted }]}>See all</Text>
          </PressableScale>
        )}
      </View>

      {featured ? (
        <View style={s.qa}>
          <Text style={[s.q, { color: theme.text }]} numberOfLines={2}>{featured.body}</Text>
          {featured.answer ? (
            <Text style={[s.a, { color: theme.muted }]} numberOfLines={3}>Seller: {featured.answer.body}</Text>
          ) : (
            <Text style={[s.a, { color: theme.muted }]}>Waiting for the seller to answer</Text>
          )}
        </View>
      ) : (
        <Text style={[s.empty, { color: theme.muted }]}>No questions yet. Ask the seller about fit, fabric or shipping.</Text>
      )}

      <View style={s.askWrap}>
        <Button
          label="Ask a question"
          variant="secondary"
          fullWidth
          onPress={open}
          accessibilityLabel={data.totalCount > 0 ? `Ask a question, ${questionCountLabel(data.totalCount)} so far` : 'Ask a question'}
        />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingTop: 16, borderTopWidth: 1, marginBottom: 8 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  title: { fontSize: FS.sm, fontFamily: FONT.bold, },
  seeAll: { fontSize: FS.sm, fontFamily: FONT.semibold },
  qa: { gap: 4, marginBottom: 14 },
  q: { fontSize: FS.base, fontFamily: FONT.semibold, lineHeight: 21 },
  a: { fontSize: FS.sm, fontFamily: FONT.medium, lineHeight: 19 },
  empty: { fontSize: FS.sm, fontFamily: FONT.medium, lineHeight: 19, marginBottom: 14 },
  askWrap: { marginBottom: 8 },
});
