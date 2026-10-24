/** Create a tracked UTM link: pick destination, source preset, campaign. */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Alert, Share } from 'react-native';
import { useRouter } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { FONT, FS, SP } from '@/lib/theme';
import { ScreenHeader } from '@/components/ScreenHeader';
import { PrimaryButton, SecondaryButton } from '@/components/BrandthreadUI';
import { Chip, CopyRow, Field } from '@/components/growth/GrowthUI';
import {
  createLink, getDestinations, UTM_PRESETS, type GrowthDestinations, type LinkDestinationType, type TrackedLink,
} from '@/services/growthService';
import { friendlyError } from '@/lib/friendlyError';

export default function GrowthLinkNewScreen() {
  const colors = useColors();
  const router = useRouter();
  const [dest, setDest] = useState<GrowthDestinations | null>(null);
  const [type, setType] = useState<LinkDestinationType>('store');
  const [productId, setProductId] = useState<string | null>(null);
  const [preset, setPreset] = useState<string>('instagram');
  const [source, setSource] = useState('instagram');
  const [medium, setMedium] = useState('social');
  const [campaign, setCampaign] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<TrackedLink | null>(null);
  const [destFailed, setDestFailed] = useState(false);
  const [productQuery, setProductQuery] = useState('');

  useEffect(() => {
    getDestinations().then(setDest).catch(() => {
      setDestFailed(true);
      setDest({ store: { available: false }, bio: { available: false, url: null }, products: [] });
    });
  }, []);

  // Product chips: filtered by the search field, capped at PRODUCT_CHIP_LIMIT.
  // The chosen product always stays visible so the selection never vanishes.
  const products = dest?.products ?? NO_PRODUCTS;
  const productMatches = useMemo(() => {
    const q = productQuery.trim().toLowerCase();
    return q ? products.filter((p) => p.name.toLowerCase().includes(q)) : products;
  }, [products, productQuery]);
  const shownProducts = useMemo(() => {
    const first = productMatches.slice(0, PRODUCT_CHIP_LIMIT);
    const chosen = productId ? products.find((p) => p.id === productId) : undefined;
    return chosen && !first.some((p) => p.id === chosen.id) ? [chosen, ...first] : first;
  }, [productMatches, products, productId]);
  const hiddenProductCount = Math.max(0, productMatches.length - PRODUCT_CHIP_LIMIT);

  const pickPreset = (id: string) => {
    const p = UTM_PRESETS.find((x) => x.id === id);
    setPreset(id);
    if (p) { setSource(p.source); setMedium(p.medium); }
  };

  const unavailable =
    destFailed ? "Couldn't load your link destinations. Go back and try again."
    : (type === 'store' && dest && !dest.store.available) ? 'Publish your store or set a username to link to it.'
    : (type === 'bio' && dest && !dest.bio.available) ? 'Set up your link in bio page first.'
    : (type === 'product' && dest && dest.products.length === 0) ? 'Add an active product to link to it.'
    : null;
  const canCreate = !!dest && !unavailable && !!source.trim() && !!medium.trim() && (type !== 'product' || !!productId);

  async function submit() {
    setBusy(true);
    try {
      setCreated(await createLink({
        label: label.trim(), destinationType: type, destinationRef: type === 'product' ? productId : null,
        utmSource: source, utmMedium: medium, utmCampaign: campaign,
      }));
    } catch (e) {
      Alert.alert("Couldn't create link", friendlyError(e, 'Try again.'));
    } finally { setBusy(false); }
  }

  if (created) {
    return (
      <View style={{ flex: 1 }}>
        <ScreenHeader title="Link ready" onBack={() => router.replace('/growth-links' as never)} />
        <ScrollView contentContainerStyle={{ padding: SP.md, paddingBottom: SP.xl }}>
          <Text style={{ fontSize: FS.sm, color: colors.mutedForeground, fontFamily: FONT.medium, marginBottom: SP.sm }}>Your short link</Text>
          <CopyRow value={created.url} />
          <View style={{ height: SP.md }} />
          <PrimaryButton label="Share link" icon="share-2" onPress={() => Share.share({ message: created.url, url: created.url }).catch(() => {})} />
          <View style={{ height: SP.sm }} />
          <SecondaryButton label="View stats" onPress={() => router.replace(`/growth-link-detail?id=${encodeURIComponent(created.id)}` as never)} />
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader title="New link" />
      <ScrollView contentContainerStyle={{ padding: SP.md, paddingBottom: SP.xl }} keyboardShouldPersistTaps="handled">
        <Text style={[lbl, { color: colors.mutedForeground }]}>Destination</Text>
        <View style={row}>
          <Chip label="Store" active={type === 'store'} onPress={() => setType('store')} />
          <Chip label="Product" active={type === 'product'} onPress={() => setType('product')} />
          <Chip label="Link in bio" active={type === 'bio'} onPress={() => setType('bio')} />
        </View>
        {!!unavailable && <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: FS.sm, marginBottom: SP.md }}>{unavailable}</Text>}
        {type === 'product' && !!dest?.products.length && (
          <>
            {dest.products.length > PRODUCT_CHIP_LIMIT && (
              <Field
                label="Search products"
                value={productQuery}
                onChangeText={setProductQuery}
                placeholder="Product name"
                autoCorrect={false}
                returnKeyType="search"
              />
            )}
            <View style={[row, { marginBottom: SP.sm }]}>
              {shownProducts.map((p) => <Chip key={p.id} label={p.name} active={productId === p.id} onPress={() => setProductId(p.id)} />)}
            </View>
            {productMatches.length === 0 && (
              <Text style={hint(colors.mutedForeground)}>No products match “{productQuery.trim()}”.</Text>
            )}
            {hiddenProductCount > 0 && (
              <Text style={hint(colors.mutedForeground)}>+{hiddenProductCount} more — search to find them.</Text>
            )}
            {!productId && <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: FS.sm, marginBottom: SP.md }}>Choose the product to link to.</Text>}
          </>
        )}

        <Text style={[lbl, { color: colors.mutedForeground, marginTop: SP.md }]}>Where will you share it?</Text>
        <View style={[row, { marginBottom: SP.md }]}>
          {UTM_PRESETS.map((p) => <Chip key={p.id} label={p.label} active={preset === p.id} onPress={() => pickPreset(p.id)} />)}
        </View>

        <Field label="Source" value={source} onChangeText={(v) => { setSource(v); setPreset(''); }} autoCapitalize="none" autoCorrect={false} />
        <Field label="Medium" value={medium} onChangeText={(v) => { setMedium(v); setPreset(''); }} autoCapitalize="none" autoCorrect={false} />
        <Field label="Campaign (optional)" value={campaign} onChangeText={setCampaign} autoCapitalize="none" autoCorrect={false} placeholder="spring-drop" />
        <Field label="Name (optional)" value={label} onChangeText={setLabel} maxLength={80} placeholder="Instagram bio" />

        <PrimaryButton label="Create link" onPress={submit} loading={busy} disabled={!canCreate || busy} />
      </ScrollView>
    </View>
  );
}

// Most chips shown at once; the rest are reached through the search field.
const PRODUCT_CHIP_LIMIT = 30;
const NO_PRODUCTS: GrowthDestinations['products'] = [];

const hint = (color: string) => ({ color, fontFamily: FONT.medium, fontSize: FS.sm, marginBottom: SP.md }) as const;
const lbl = { fontSize: FS.sm, fontFamily: FONT.semibold, marginBottom: SP.sm } as const;
const row = { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm, marginBottom: SP.sm } as const;
