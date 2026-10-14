/**
 * Draw result (SNKRS "Got 'Em" / "Didn't Get 'Em", in Brandthread's words):
 * the product photo and one line, "You got it" or "Not this time". No
 * animation, no sound; the one confirmation haptic already fired when the
 * entry was made, so none here.
 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useApi } from '@/lib/api';
import type { ProductDrawEntry } from '@/lib/api';
import { useColors } from '@/hooks/useColors';
import { formatCents } from '@/lib/money';
import { FONT, FS, ICON, RADIUS, SP } from '@/lib/theme';

export default function DrawResultScreen() {
  const { productId } = useLocalSearchParams<{ productId: string }>();
  const api = useApi();
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [entry, setEntry] = useState<ProductDrawEntry | null>(null);
  const [name, setName] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!productId) return;
    Promise.all([
      api.productDraws.entry(productId).catch(() => ({ entry: null })),
      api.publicProducts.get(productId).catch(() => null),
    ]).then(([mine, row]) => {
      setEntry(mine.entry);
      setName(row?.name ?? '');
      setImage((row?.images ?? [])[0] ?? null);
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  if (loading) {
    return <View style={[st.screen, st.center, { backgroundColor: colors.background }]}><ActivityIndicator color={colors.foreground} /></View>;
  }

  const won = entry?.status === 'won';
  const decided = won || entry?.status === 'lost' || entry?.status === 'charge_failed';

  return (
    <View style={[st.screen, { backgroundColor: colors.background }]}>
      <View style={[st.hero, { backgroundColor: colors.card }]}>
        {image ? <Image source={{ uri: image }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
        <Pressable onPress={() => router.back()} style={[st.close, { top: insets.top + SP.sm }]} accessibilityRole="button" accessibilityLabel="Close" hitSlop={12}>
          <Feather name="x" size={ICON.md} color="#FFFFFF" />
        </Pressable>
      </View>
      <View style={st.body}>
        <Text style={[st.result, { color: colors.foreground }]} testID="draw-result-title">
          {!decided ? 'Results aren’t in yet' : won ? 'You got it' : 'Not this time'}
        </Text>
        <Text style={[st.name, { color: colors.mutedForeground }]} numberOfLines={2}>
          {name}{entry?.variantLabel ? ` · ${entry.variantLabel}` : ''}
        </Text>
        {decided ? (
          <Text style={[st.line, { color: colors.mutedForeground }]}>
            {won ? `${formatCents(entry!.amountCents)} charged. Your order is confirmed.` : 'Your card wasn’t charged.'}
          </Text>
        ) : null}
      </View>
      <View style={[st.footer, { paddingBottom: insets.bottom + SP.sm }]}>
        <Pressable
          onPress={() => (won ? router.navigate('/(buyer)/orders' as never) : router.back())}
          style={[st.cta, { backgroundColor: colors.foreground }]}
          accessibilityRole="button"
          testID="draw-result-cta"
        >
          <Text style={[st.ctaText, { color: colors.background }]}>{won ? 'View order' : 'Done'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  screen: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  hero: { height: 420 },
  close: { position: 'absolute', right: SP.md, width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: SP.md, paddingTop: SP.lg, alignItems: 'center', gap: SP.sm },
  result: { fontFamily: FONT.bold, fontSize: FS.h2, letterSpacing: -0.6, textAlign: 'center' },
  name: { fontFamily: FONT.medium, fontSize: FS.base, textAlign: 'center' },
  line: { fontFamily: FONT.regular, fontSize: FS.sm, textAlign: 'center', fontVariant: ['tabular-nums'] },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: SP.md },
  cta: { minHeight: 52, borderRadius: RADIUS.pill, alignItems: 'center', justifyContent: 'center' },
  ctaText: { fontFamily: FONT.semibold, fontSize: FS.base },
});
