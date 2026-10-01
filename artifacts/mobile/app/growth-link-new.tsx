/** Create a tracked UTM link: pick destination, source preset, campaign. */
import React, { useEffect, useState } from 'react';
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

  useEffect(() => { getDestinations().then(setDest).catch(() => setDest({ store: { available: false }, bio: { available: false, url: null }, products: [] })); }, []);

  const pickPreset = (id: string) => {
    const p = UTM_PRESETS.find((x) => x.id === id);
    setPreset(id);
    if (p) { setSource(p.source); setMedium(p.medium); }
  };

  const unavailable =
    (type === 'store' && dest && !dest.store.available) ? 'Publish your store or set a username to link to it.'
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
    } catch (e: any) {
      Alert.alert("Couldn't create link", String(e?.message ?? 'Try again.').slice(0, 160));
    } finally { setBusy(false); }
  }

  if (created) {
    return (
      <View style={{ flex: 1 }}>
        <ScreenHeader title="Link ready" onBack={() => router.replace('/growth-links' as never)} />
        <ScrollView contentContainerStyle={{ padding: SP.md, paddingBottom: 120 }}>
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
      <ScrollView contentContainerStyle={{ padding: SP.md, paddingBottom: 140 }} keyboardShouldPersistTaps="handled">
        <Text style={[lbl, { color: colors.mutedForeground }]}>Destination</Text>
        <View style={row}>
          <Chip label="Store" active={type === 'store'} onPress={() => setType('store')} />
          <Chip label="Product" active={type === 'product'} onPress={() => setType('product')} />
          <Chip label="Link in bio" active={type === 'bio'} onPress={() => setType('bio')} />
        </View>
        {!!unavailable && <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: FS.sm, marginBottom: SP.md }}>{unavailable}</Text>}
        {type === 'product' && !!dest?.products.length && (
          <View style={[row, { marginBottom: SP.sm }]}>
            {dest.products.slice(0, 30).map((p) => <Chip key={p.id} label={p.name} active={productId === p.id} onPress={() => setProductId(p.id)} />)}
          </View>
        )}

        <Text style={[lbl, { color: colors.mutedForeground, marginTop: SP.md }]}>Where will you share it</Text>
        <View style={row}>
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

const lbl = { fontSize: FS.sm, fontFamily: FONT.semibold, marginBottom: 8 } as const;
const row = { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: SP.sm } as const;
