/**
 * Product page details — what the buyer's product page shows under the
 * photos and description (polish 87, 88, 93, 94):
 *   - Model: height + size worn → "Model is 6'1" and wears a size L"
 *   - Fabric, Care, Origin → collapsible rows
 *   - Colour photos: one of the product's photos per colour → the colour
 *     swatch shows it and picking the colour pages the gallery to it.
 *
 * Opened from Products → ⋯ → Details and colour photos. Layout follows
 * Shopify's product editor: plain labelled fields, and the variant image
 * picker that chooses from the product's existing media.
 *
 * Route: /product-page-details?productId=<uuid>
 */
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { Feather } from '@expo/vector-icons';
import { Header } from '@/components/layout';
import { CachedImage } from '@/components/CachedImage';
import { useTabBarMetrics } from '@/components/buyer-nav/buyerTabBarMetrics';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { useApi, type ProductPageDetailsEditor } from '@/lib/api';
import { isPreviewDemoMode, isSellerDevPreview } from '@/lib/devPreview';
import { hapticSelection } from '@/lib/haptics';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';

const TEXT_MAX = 300;

function errorText(err: unknown, fallback: string): string {
  const raw = (err as { message?: string } | null)?.message;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed?.error === 'string') return parsed.error;
    } catch { /* plain text */ }
  }
  return fallback;
}

export default function ProductPageDetailsScreen() {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const router = useRouter();
  const api = useApi();
  const { isLoaded, isSignedIn } = useAuth();
  const tabBar = useTabBarMetrics();
  const { productId } = useLocalSearchParams<{ productId: string }>();

  const [editor, setEditor] = useState<ProductPageDetailsEditor | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [height, setHeight] = useState('');
  const [sizeWorn, setSizeWorn] = useState('');
  const [fabric, setFabric] = useState('');
  const [care, setCare] = useState('');
  const [origin, setOrigin] = useState('');
  const [colorImages, setColorImages] = useState<Record<string, string>>({});

  const hydrate = (e: ProductPageDetailsEditor) => {
    setEditor(e);
    setHeight(e.details.modelHeightCm ? String(e.details.modelHeightCm) : '');
    setSizeWorn(e.details.modelSizeWorn ?? '');
    setFabric(e.details.fabric ?? '');
    setCare(e.details.care ?? '');
    setOrigin(e.details.origin ?? '');
    setColorImages(e.details.colorImages ?? {});
  };

  // Signed-out web preview: never call the API. The form shows in its empty
  // state; `&demo=1` fills it from the preview catalogue. Save is hidden, so
  // nothing pretends to be stored.
  const preview = isSellerDevPreview();
  useEffect(() => {
    if (preview) {
      let live = true;
      (async () => {
        const empty = { modelHeightCm: null, modelSizeWorn: null, fabric: null, care: null, origin: null, colorImages: {} };
        if (!isPreviewDemoMode()) {
          if (live) hydrate({ productId: String(productId ?? ''), productName: '', images: [], colors: [], details: empty });
          return;
        }
        const { getProducts } = await import('@/services/productService');
        const first = (await getProducts())[0];
        const images = (first?.media ?? []).map(m => m.uri).filter(Boolean).slice(0, 6);
        const colors = (first?.options ?? []).find(o => o.name.toLowerCase() === 'color')?.values.map(v => v.value) ?? [];
        if (live) hydrate({ productId: first?.id ?? '', productName: first?.name ?? '', images, colors, details: empty });
      })().finally(() => { if (live) setLoading(false); });
      return () => { live = false; };
    }
    if (!productId || !isLoaded || !isSignedIn) {
      if (isLoaded) setLoading(false);
      return;
    }
    let live = true;
    setLoading(true);
    api.productPageDetails.get(String(productId))
      .then(e => { if (live) hydrate(e); })
      .catch(err => { if (live) setLoadError(errorText(err, 'Could not load this product.')); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [api, productId, isLoaded, isSignedIn, preview]);

  async function save() {
    if (!editor || saving) return;
    const trimmedHeight = height.trim();
    const heightCm = trimmedHeight ? Number(trimmedHeight) : null;
    if (heightCm !== null && (!Number.isInteger(heightCm) || heightCm < 120 || heightCm > 230)) {
      setSaveError('Enter the model height in whole centimetres, between 120 and 230.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const next = await api.productPageDetails.save(editor.productId, {
        modelHeightCm: heightCm,
        modelSizeWorn: sizeWorn.trim() || null,
        fabric: fabric.trim() || null,
        care: care.trim() || null,
        origin: origin.trim() || null,
        colorImages,
      });
      hydrate(next);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setSaveError(errorText(err, 'Could not save. Check your connection and try again.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={s.root}>
      <Header
        title="Details"
        dividerVariant="none"
        onBack={() => goBackOr(router)}
        rightElement={editor && !preview ? (
          <Pressable onPress={save} disabled={saving} hitSlop={8} accessibilityRole="button" accessibilityLabel="Save" style={s.saveBtn}>
            {saving ? <ActivityIndicator size="small" color={theme.text} /> : <Text style={s.saveText}>{saved ? 'Saved' : 'Save'}</Text>}
          </Pressable>
        ) : undefined}
      />

      {loading ? (
        <View style={s.center}><ActivityIndicator color={theme.muted} /></View>
      ) : loadError || !editor ? (
        <View style={s.center}><Text style={s.muted}>{loadError ?? 'This product could not be found.'}</Text></View>
      ) : (
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}
          contentContainerStyle={{ padding: SP.md, paddingBottom: tabBar.occupiedHeight + SP.xl }}>
          <Text style={s.productName} numberOfLines={1}>{editor.productName}</Text>

          <Text style={s.section}>Model</Text>
          <View style={s.pair}>
            <View style={{ flex: 1 }}>
              <Text style={s.label}>Height (cm)</Text>
              <TextInput
                value={height}
                onChangeText={v => { setHeight(v.replace(/[^0-9]/g, '').slice(0, 3)); setSaveError(null); }}
                placeholder="185"
                placeholderTextColor={theme.muted}
                keyboardType="number-pad"
                style={s.input}
                accessibilityLabel="Model height in centimetres"
                testID="details-model-height"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.label}>Size worn</Text>
              <TextInput
                value={sizeWorn}
                onChangeText={v => setSizeWorn(v.slice(0, 12))}
                placeholder="L"
                placeholderTextColor={theme.muted}
                autoCapitalize="characters"
                style={s.input}
                accessibilityLabel="Size the model wears"
                testID="details-model-size"
              />
            </View>
          </View>

          <Text style={s.section}>Fabric and care</Text>
          <LongField label="Fabric" value={fabric} onChange={setFabric} placeholder="100% organic cotton, 480 gsm" s={s} theme={theme} />
          <LongField label="Care" value={care} onChange={setCare} placeholder="Machine wash cold. Hang dry." s={s} theme={theme} />
          <LongField label="Origin" value={origin} onChange={setOrigin} placeholder="Made in Portugal" s={s} theme={theme} />

          {editor.colors.length > 0 && editor.images.length > 0 && (
            <>
              <Text style={s.section}>Colour photos</Text>
              {editor.colors.map(color => (
                <View key={color} style={s.colorBlock}>
                  <Text style={s.label}>{color}</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: SP.sm }}>
                    {editor.images.map((uri, i) => {
                      const selected = colorImages[color] === uri;
                      return (
                        <Pressable
                          key={`${uri}-${i}`}
                          onPress={() => {
                            hapticSelection();
                            setColorImages(prev => {
                              const next = { ...prev };
                              if (next[color] === uri) delete next[color]; else next[color] = uri;
                              return next;
                            });
                          }}
                          style={[s.thumb, selected && s.thumbSelected]}
                          accessibilityRole="radio"
                          accessibilityState={{ selected }}
                          accessibilityLabel={`Photo ${i + 1} for ${color}`}
                          testID={`details-color-${color}-${i}`}
                        >
                          <CachedImage source={{ uri }} style={s.thumbImage} contentFit="cover" />
                          {selected && (
                            <View style={s.check}><Feather name="check" size={12} color={theme.background} /></View>
                          )}
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>
              ))}
            </>
          )}

          {saveError && <Text style={s.error}>{saveError}</Text>}
        </ScrollView>
      )}
    </View>
  );
}

function LongField({ label, value, onChange, placeholder, s, theme }: {
  label: string; value: string; onChange: (v: string) => void; placeholder: string;
  s: ReturnType<typeof makeStyles>; theme: any;
}) {
  return (
    <View style={s.field}>
      <View style={s.fieldHead}>
        <Text style={s.label}>{label}</Text>
        {value.length > TEXT_MAX - 40 && <Text style={s.counter}>{value.length}/{TEXT_MAX}</Text>}
      </View>
      <TextInput
        value={value}
        onChangeText={v => onChange(v.slice(0, TEXT_MAX))}
        placeholder={placeholder}
        placeholderTextColor={theme.muted}
        style={[s.input, s.multiline]}
        multiline
        textAlignVertical="top"
        accessibilityLabel={label}
      />
    </View>
  );
}

function makeStyles(theme: any) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.background },
    saveBtn: { minWidth: 56, height: 44, alignItems: 'center', justifyContent: 'center' },
    saveText: { fontFamily: FONT.bold, fontSize: FS.base, color: theme.text },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SP.lg },
    muted: { fontFamily: FONT.medium, fontSize: FS.base, color: theme.muted, textAlign: 'center' },
    productName: { fontFamily: FONT.semibold, fontSize: FS.sm, color: theme.muted, marginBottom: SP.sm },
    section: { fontFamily: FONT.bold, fontSize: FS.base, color: theme.text, marginTop: SP.lg, marginBottom: SP.sm },
    pair: { flexDirection: 'row', gap: SP.sm },
    field: { marginBottom: SP.md },
    fieldHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
    label: { fontFamily: FONT.semibold, fontSize: FS.sm, color: theme.text, marginBottom: 6 },
    counter: { fontFamily: FONT.regular, fontSize: FS.sm, color: theme.muted },
    input: {
      minHeight: 48, borderRadius: RADIUS.md, borderWidth: 1, borderColor: theme.border,
      backgroundColor: theme.card, paddingHorizontal: SP.md, paddingVertical: 12,
      fontFamily: FONT.regular, fontSize: FS.base, color: theme.text,
    },
    multiline: { minHeight: 88 },
    colorBlock: { marginBottom: SP.md },
    thumb: { width: 64, height: 80, borderRadius: RADIUS.sm, overflow: 'hidden', borderWidth: 2, borderColor: 'transparent' },
    thumbSelected: { borderColor: theme.text },
    thumbImage: { width: '100%', height: '100%' },
    check: {
      position: 'absolute', top: 4, right: 4, width: 20, height: 20, borderRadius: 10,
      backgroundColor: theme.text, alignItems: 'center', justifyContent: 'center',
    },
    error: { fontFamily: FONT.medium, fontSize: FS.sm, color: theme.error, marginTop: SP.sm },
  });
}
