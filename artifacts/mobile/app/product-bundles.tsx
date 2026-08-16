/**
 * Product Bundles — seller management screen.
 *
 * Lists all bundles for the logged-in seller.
 * Navigates to product-bundle-edit for create/edit.
 */
import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {
  BG, CARD, BORDER,
  FG, MUTED, SUBTLE,
  PURPLE_LIGHT, PURPLE_DIM,
  SUCCESS, SUCCESS_DIM,
  ORANGE, ORANGE_DIM,
  FONT, FS, SP, RADIUS, ICON,
} from '@/lib/theme';
import { BrandthreadHeader, BrandedEmptyState } from '@/components/BrandthreadUI';
import { useApi } from '@/lib/api';

function fmtCents(cents: number): string {
  return '$' + (cents / 100).toFixed(2);
}

function BundleRow({ bundle, onPress }: { bundle: any; onPress: () => void }) {
  const savings = bundle.compareAtCents > bundle.bundlePriceCents
    ? bundle.compareAtCents - bundle.bundlePriceCents
    : 0;
  const isActive = bundle.status === 'active';

  return (
    <TouchableOpacity style={r.root} onPress={onPress} activeOpacity={0.7}>
      <View style={r.iconWrap}>
        <Feather name="package" size={ICON.md} color={PURPLE_LIGHT} />
      </View>
      <View style={r.body}>
        <View style={r.topRow}>
          <Text style={r.name} numberOfLines={1}>{bundle.name}</Text>
          <View style={[r.badge, isActive ? r.activeBadge : r.draftBadge]}>
            <Text style={[r.badgeText, { color: isActive ? SUCCESS : ORANGE }]}>
              {isActive ? 'Active' : 'Draft'}
            </Text>
          </View>
        </View>
        <Text style={r.meta}>
          {bundle.itemCount ?? 0} item{(bundle.itemCount ?? 0) !== 1 ? 's' : ''} ·{' '}
          {fmtCents(bundle.bundlePriceCents)}
          {savings > 0 ? ` · saves ${fmtCents(savings)}` : ''}
        </Text>
      </View>
      <Feather name="chevron-right" size={16} color={MUTED} />
    </TouchableOpacity>
  );
}

export default function ProductBundlesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const api    = useApi();

  const [bundles, setBundles]     = useState<any[]>([]);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await (api as any).bundles.list();
      setBundles(Array.isArray(data) ? data : []);
    } catch (err) {
      console.warn('bundles load error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [api]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  function onRefresh() { setRefreshing(true); load(true); }

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <BrandthreadHeader
        title="Bundles"
        onBack={() => router.back()}
        rightAction={{
          icon: 'plus',
          onPress: () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); router.push('/product-bundle-edit' as any); },
        }}
      />

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator color={PURPLE_LIGHT} />
        </View>
      ) : bundles.length === 0 ? (
        <BrandedEmptyState
          icon="package"
          title="No bundles yet"
          subtitle="Group 2+ products together and offer them at a special price."
          action={{ label: 'Create first bundle', onPress: () => router.push('/product-bundle-edit' as any) }}
        />
      ) : (
        <ScrollView
          contentContainerStyle={[s.list, { paddingBottom: insets.bottom + 24 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={PURPLE_LIGHT} />}
          showsVerticalScrollIndicator={false}
        >
          <Text style={s.hint}>
            Bundle 2+ products at a discounted price. Buyers see the savings clearly.
          </Text>
          {bundles.map(b => (
            <BundleRow
              key={b.id}
              bundle={b}
              onPress={() => router.push((`/product-bundle-edit?bundleId=${b.id}`) as any)}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: BG },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list:   { padding: SP.md, gap: SP.sm },
  hint:   { fontFamily: FONT.regular, fontSize: FS.xs, color: SUBTLE, marginBottom: SP.xs, lineHeight: 18 },
});

const r = StyleSheet.create({
  root:        { flexDirection: 'row', alignItems: 'center', gap: SP.md, backgroundColor: CARD, borderRadius: RADIUS.md, padding: SP.md, borderWidth: 1, borderColor: BORDER },
  iconWrap:    { width: 44, height: 44, borderRadius: RADIUS.sm, backgroundColor: PURPLE_DIM, alignItems: 'center', justifyContent: 'center' },
  body:        { flex: 1, gap: 3 },
  topRow:      { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  name:        { flex: 1, fontFamily: FONT.semibold, fontSize: FS.sm, color: FG },
  badge:       { paddingHorizontal: 8, paddingVertical: 2, borderRadius: RADIUS.pill },
  activeBadge: { backgroundColor: SUCCESS_DIM },
  draftBadge:  { backgroundColor: ORANGE_DIM },
  badgeText:   { fontFamily: FONT.semibold, fontSize: FS.xxs, letterSpacing: 0.4 },
  meta:        { fontFamily: FONT.regular, fontSize: FS.xs, color: MUTED },
});
