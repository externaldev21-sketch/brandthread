/** Meta Pixel + TikTok Pixel IDs for the public store site. IDs only, never code. */
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, Alert } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { FONT, FS, SP } from '@/lib/theme';
import { ScreenHeader } from '@/components/ScreenHeader';
import { PrimaryButton } from '@/components/BrandthreadUI';
import { ErrorState } from '@/components/ui/ErrorState';
import { Field } from '@/components/growth/GrowthUI';
import { metaPixelError, tiktokPixelError } from '@/lib/growthValidation';
import { getPixels, savePixels } from '@/services/growthService';

export default function StorePixelsScreen() {
  const colors = useColors();
  const [meta, setMeta] = useState('');
  const [tt, setTt] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    try { const p = await getPixels(); setMeta(p.metaPixelId ?? ''); setTt(p.tiktokPixelId ?? ''); setLoaded(true); setFailed(false); } catch { setFailed(true); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const metaErr = metaPixelError(meta);
  const ttErr = tiktokPixelError(tt);

  async function save() {
    setBusy(true); setSaved(false);
    try {
      const r = await savePixels({ metaPixelId: meta.trim() || null, tiktokPixelId: tt.trim().toUpperCase() || null });
      setMeta(r.metaPixelId ?? ''); setTt(r.tiktokPixelId ?? ''); setSaved(true);
    } catch (e: any) {
      Alert.alert("Couldn't save pixels", 'Check the IDs and try again.');
    } finally { setBusy(false); }
  }

  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader title="Pixels" />
      {failed && !loaded ? <ErrorState onRetry={load} /> : (
        <ScrollView contentContainerStyle={{ padding: SP.md, paddingBottom: 140 }} keyboardShouldPersistTaps="handled">
          <Field label="Meta Pixel ID" value={meta} onChangeText={(v) => { setMeta(v); setSaved(false); }} keyboardType="number-pad" autoCapitalize="none" autoCorrect={false} placeholder="1234567890123456" error={metaErr} />
          <Field label="TikTok Pixel ID" value={tt} onChangeText={(v) => { setTt(v); setSaved(false); }} autoCapitalize="characters" autoCorrect={false} placeholder="C4ABCD1234567890ABCD" error={ttErr} />
          <PrimaryButton label={saved ? 'Saved' : 'Save'} onPress={save} loading={busy} disabled={busy || !!metaErr || !!ttErr || !loaded} />
          <Text style={{ marginTop: SP.lg, color: colors.mutedForeground, fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 19 }}>
            Tracks PageView, ViewContent, AddToCart, InitiateCheckout and Purchase on your public store site. Nothing fires for visitors who send Global Privacy Control or Do Not Track.
          </Text>
        </ScrollView>
      )}
    </View>
  );
}
