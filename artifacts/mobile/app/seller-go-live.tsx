/**
 * Seller Go Live — pre-broadcast setup screen.
 * Sets title, optional product tags, then calls POST /api/live/start.
 */
import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Alert, ActivityIndicator, Image } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useApi } from '@/lib/api';
import { BG, CARD, BORDER, FG, MUTED, SUBTLE, RED, FONT, FS, SP, RADIUS, PURPLE, PURPLE_LIGHT, PURPLE_DIM, CYAN, CYAN_DIM } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { formatCents } from '@/lib/money';

const LIVE_RED = '#FF3B30';
const LIVE_DIM = '#FF3B3020';

export default function SellerGoLiveScreen() {
  const { theme } = useAppTheme();
  const s = makeStyles(theme);
  const { accent: PURPLE } = theme;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const api = useApi();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [products, setProducts] = useState<any[]>([]);
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    // Load seller's products for tagging
    (api as any).seller?.getProducts?.()
      .then((r: any) => setProducts(r?.products ?? []))
      .catch(() => {});
  }, []);

  function toggleProduct(product: any) {
    Haptics.selectionAsync();
    setSelectedProductIds(prev => {
      const next = new Set(prev);
      if (next.has(product.id)) next.delete(product.id);
      else next.add(product.id);
      return next;
    });
  }

  async function handleGoLive() {
    if (!title.trim()) {
      Alert.alert('Title required', 'Give your live stream a title so viewers know what to expect.');
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setStarting(true);
    try {
      const selectedProducts = products
        .filter(p => selectedProductIds.has(p.id))
        .map((p, index) => ({
          productId: p.id,
          productName: p.name,
          priceCents: p.priceCents ?? 0,
          variantId: p.variants?.[0]?.id ?? null,
          highlighted: index === 0,
        }));

      const result = await (api as any).live.start({
        title: title.trim(),
        description: description.trim() || undefined,
        productTags: selectedProducts,
      }) as any;

      router.replace({
        pathname: '/seller-live',
        params: {
          streamId:    result.stream.id,
          channelName: result.stream.channelName,
          agoraUid:    String(result.stream.agoraUid),
          agoraAppId:  result.agoraAppId,
          token:       result.token ?? '',
          title:       title.trim(),
        },
      } as any);
    } catch (e: any) {
      Alert.alert('Could not start live', e?.message ?? 'Please check your connection and try again.');
    } finally {
      setStarting(false);
    }
  }

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={[s.header, { borderBottomColor: BORDER }]}>
        <TouchableOpacity onPress={() => router.back()} style={s.closeBtn}>
          <Feather name="x" size={22} color={FG} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Go Live</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
        {/* Live badge */}
        <View style={s.liveHero}>
          <View style={[s.liveBadge, { backgroundColor: LIVE_RED }]}>
            <View style={s.liveDot} />
            <Text style={s.liveBadgeText}>LIVE</Text>
          </View>
          <Text style={[s.liveHint, { color: MUTED }]}>
            Your followers will see your stream in the Thread feed and get notified.
          </Text>
        </View>

        {/* Title */}
        <View style={s.field}>
          <Text style={[s.label, { color: MUTED }]}>Stream title *</Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="e.g. New drop preview, styling tips…"
            placeholderTextColor={SUBTLE}
            maxLength={80}
            style={[s.input, { backgroundColor: CARD, borderColor: BORDER, color: FG }]}
          />
          <Text style={[s.charCount, { color: SUBTLE }]}>{title.length}/80</Text>
        </View>

        {/* Description */}
        <View style={s.field}>
          <Text style={[s.label, { color: MUTED }]}>Description (optional)</Text>
          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder="Tell viewers what the stream is about…"
            placeholderTextColor={SUBTLE}
            multiline
            maxLength={200}
            style={[s.inputMulti, { backgroundColor: CARD, borderColor: BORDER, color: FG }]}
          />
        </View>

        {/* Product tags */}
        {products.length > 0 && (
          <View style={s.field}>
            <Text style={[s.label, { color: MUTED }]}>Tag products (optional)</Text>
            <Text style={[s.sublabel, { color: SUBTLE }]}>
              Viewers can tap to shop these during your stream. You can also add/remove them while live.
            </Text>
            <View style={[s.productList, { backgroundColor: CARD, borderColor: BORDER }]}>
              {products.slice(0, 20).map((p, i) => {
                const selected = selectedProductIds.has(p.id);
                return (
                  <TouchableOpacity
                    key={p.id}
                    onPress={() => toggleProduct(p)}
                    activeOpacity={0.7}
                    style={[
                      s.productRow,
                      i > 0 && { borderTopWidth: 1, borderTopColor: BORDER },
                      selected && { backgroundColor: `${PURPLE}10` },
                    ]}
                  >
                    {p.imageUrl ? (
                      <Image source={{ uri: p.imageUrl }} style={s.productThumb} />
                    ) : (
                      <View style={[s.productThumb, { backgroundColor: BORDER }]}>
                        <Feather name="package" size={14} color={MUTED} />
                      </View>
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={[s.productName, { color: FG }]} numberOfLines={1}>{p.name}</Text>
                      <Text style={[s.productPrice, { color: MUTED }]}>
                        {typeof p.priceCents === 'number' ? formatCents(p.priceCents) : '—'}
                      </Text>
                    </View>
                    <View style={[s.checkbox, selected && { backgroundColor: PURPLE, borderColor: PURPLE }]}>
                      {selected && <Feather name="check" size={13} color={theme.onAccent} />}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
            {selectedProductIds.size > 0 && (
              <Text style={[s.selCount, { color: PURPLE }]}>
                {selectedProductIds.size} product{selectedProductIds.size !== 1 ? 's' : ''} tagged
              </Text>
            )}
          </View>
        )}

      </ScrollView>

      {/* Go Live CTA */}
      <View style={[s.footer, { paddingBottom: insets.bottom + 12, borderTopColor: BORDER }]}>
        <TouchableOpacity
          onPress={handleGoLive}
          disabled={starting || !title.trim()}
          activeOpacity={0.85}
          style={[s.goLiveBtn, { backgroundColor: LIVE_RED, opacity: starting || !title.trim() ? 0.5 : 1 }]}
        >
          {starting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <View style={s.liveDot} />
              <Text style={s.goLiveBtnText}>Go Live</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => {
  const PURPLE = theme.accent;
  return StyleSheet.create({
  root:           { flex: 1, backgroundColor: 'transparent' },
  header:         { height: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SP.md, borderBottomWidth: 1 },
  closeBtn:       { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle:    { fontSize: FS.base, fontFamily: FONT.bold, color: FG },
  body:           { padding: SP.md, gap: SP.lg, paddingBottom: 100 },
  liveHero:       { alignItems: 'center', paddingVertical: SP.md },
  liveBadge:      { flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: RADIUS.pill, paddingHorizontal: 14, paddingVertical: 7, marginBottom: 10 },
  liveDot:        { width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff' },
  liveBadgeText:  { color: '#fff', fontFamily: FONT.bold, fontSize: FS.sm, letterSpacing: 1.5 },
  liveHint:       { fontSize: FS.xs, fontFamily: FONT.regular, textAlign: 'center', lineHeight: 18 },
  field:          { gap: SP.xs },
  label:          { fontSize: FS.xs, fontFamily: FONT.semibold, textTransform: 'uppercase', letterSpacing: 0.6 },
  sublabel:       { fontSize: FS.xs, fontFamily: FONT.regular, lineHeight: 17 },
  charCount:      { fontSize: FS.xs, fontFamily: FONT.regular, textAlign: 'right' },
  input:          { borderRadius: RADIUS.sm, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, fontSize: FS.sm, fontFamily: FONT.regular },
  inputMulti:     { borderRadius: RADIUS.sm, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, fontSize: FS.sm, fontFamily: FONT.regular, minHeight: 80, textAlignVertical: 'top' },
  productList:    { borderRadius: RADIUS.lg, borderWidth: 1, overflow: 'hidden' },
  productRow:     { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  productThumb:   { width: 38, height: 38, borderRadius: RADIUS.sm, alignItems: 'center', justifyContent: 'center' },
  productName:    { fontSize: FS.sm, fontFamily: FONT.semibold },
  productPrice:   { fontSize: FS.xs, fontFamily: FONT.regular, marginTop: 2 },
  checkbox:       { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  selCount:       { fontSize: FS.xs, fontFamily: FONT.semibold, textAlign: 'right' },
  footer:         { borderTopWidth: 1, padding: SP.md },
  goLiveBtn:      { borderRadius: RADIUS.pill, height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  goLiveBtnText:  { color: '#fff', fontFamily: FONT.bold, fontSize: FS.base, letterSpacing: 0.5 },
  });
};
