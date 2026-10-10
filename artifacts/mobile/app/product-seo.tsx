/**
 * Product search listing (SEO) — page title, meta description, URL handle,
 * noindex and social image for one product, with a Google-style preview.
 *
 * Route: /product-seo?productId=<uuid>
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet, ActivityIndicator, Pressable } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { Header } from '@/components/layout';
import { HapticSwitch } from '@/components/BrandthreadUI';
import { useTabBarMetrics } from '@/components/buyer-nav/buyerTabBarMetrics';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { useApi } from '@/lib/api';
import { bulkErrorMessage, errorCode, type ProductSeoDetail } from '@/lib/productBulk';
import { isSellerDevPreview } from '@/lib/devPreview';

const SITE_HOST = 'brandthread.app';

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

export default function ProductSeoScreen() {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const router = useRouter();
  const api = useApi();
  const { isLoaded, isSignedIn } = useAuth();
  const tabBar = useTabBarMetrics();
  const { productId } = useLocalSearchParams<{ productId: string }>();

  const [detail, setDetail] = useState<ProductSeoDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [handle, setHandle] = useState('');
  const [noIndex, setNoIndex] = useState(false);
  const [image, setImage] = useState('');

  const hydrate = useCallback((d: ProductSeoDetail) => {
    setDetail(d);
    setTitle(d.seo.seoTitle ?? '');
    setDescription(d.seo.seoDescription ?? '');
    setHandle(d.seo.urlHandle ?? '');
    setNoIndex(d.seo.noIndex);
    setImage(d.seo.socialImageUrl ?? '');
  }, []);

  useEffect(() => {
    if (isSellerDevPreview()) {
      setLoadError('Product SEO editing is unavailable in the signed-out preview.');
      setLoading(false);
      return;
    }
    if (!productId || !isLoaded || !isSignedIn) {
      if (isLoaded) setLoading(false);
      return;
    }
    let live = true;
    setLoading(true);
    api.productSeo.get(String(productId))
      .then(d => { if (live) hydrate(d); })
      .catch(err => { if (live) setLoadError(bulkErrorMessage(err, 'Could not load this search listing.')); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [api, productId, isLoaded, isSignedIn, hydrate]);

  const limits = detail?.limits ?? { title: 70, description: 160, handle: 80 };
  const shownTitle = title.trim() || detail?.resolved.title || '';
  const shownDescription = description.trim() || detail?.resolved.description || '';
  const shownHandle = handle.trim() || detail?.resolved.handle || detail?.suggestedHandle || '';

  async function save() {
    if (!detail || saving) return;
    setSaving(true);
    setFieldError(null);
    try {
      const next = await api.productSeo.save(detail.productId, {
        seoTitle: title.trim() || null,
        seoDescription: description.trim() || null,
        urlHandle: handle.trim().toLowerCase() || null,
        noIndex,
        socialImageUrl: image.trim() || null,
      });
      hydrate(next);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      const code = errorCode(err);
      setFieldError(bulkErrorMessage(err, code ? 'Could not save.' : 'Could not save. Check your connection and try again.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={s.root}>
      <Header
        title="Search listing"
        dividerVariant="none"
        onBack={() => goBackOr(router)}
        rightElement={detail ? (
          <Pressable onPress={save} disabled={saving} hitSlop={8} accessibilityRole="button" accessibilityLabel="Save" style={s.saveBtn}>
            {saving ? <ActivityIndicator size="small" color={theme.text} /> : <Text style={s.saveText}>{saved ? 'Saved' : 'Save'}</Text>}
          </Pressable>
        ) : undefined}
      />

      {loading ? (
        <View style={s.center}><ActivityIndicator color={theme.muted} /></View>
      ) : loadError || !detail ? (
        <View style={s.center}><Text style={s.muted}>{loadError ?? 'This product has no search listing yet.'}</Text></View>
      ) : (
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}
          contentContainerStyle={{ padding: SP.md, paddingBottom: tabBar.occupiedHeight + SP.xl }}>
          <Text style={s.productName} numberOfLines={1}>{detail.productName}</Text>

          <View style={s.preview} accessibilityLabel="Search result preview">
            <View style={s.previewSite}>
              <View style={s.favicon}><Text style={s.faviconText}>{(detail.storeName || 'B')[0].toUpperCase()}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={s.siteName} numberOfLines={1}>{detail.storeName || 'Your store'}</Text>
                <Text style={s.siteUrl} numberOfLines={1}>{SITE_HOST} › products › {shownHandle}</Text>
              </View>
            </View>
            <Text style={s.previewTitle} numberOfLines={2}>{clip(shownTitle, 60)}</Text>
            <Text style={s.previewDesc} numberOfLines={3}>{clip(shownDescription, 160)}</Text>
          </View>

          <Field label="Page title" count={title.length} max={limits.title} s={s} theme={theme}>
            <TextInput returnKeyType="done"
              value={title}
              onChangeText={v => setTitle(v.slice(0, limits.title))}
              placeholder={detail.resolved.title}
              placeholderTextColor={theme.subtle}
              style={s.input}
              accessibilityLabel="Page title"
            />
          </Field>

          <Field label="Meta description" count={description.length} max={limits.description} s={s} theme={theme}>
            <TextInput
              value={description}
              onChangeText={v => setDescription(v.slice(0, limits.description))}
              placeholder={detail.resolved.description || 'Describe this product for search results'}
              placeholderTextColor={theme.subtle}
              style={[s.input, s.multiline]}
              multiline
              textAlignVertical="top"
              accessibilityLabel="Meta description"
            />
          </Field>

          <Field label="URL handle" count={handle.length} max={limits.handle} s={s} theme={theme}>
            <View style={s.handleRow}>
              <Text style={s.handlePrefix}>/products/</Text>
              <TextInput returnKeyType="done"
                value={handle}
                onChangeText={v => { setHandle(v.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, limits.handle)); setFieldError(null); }}
                placeholder={detail.suggestedHandle}
                placeholderTextColor={theme.subtle}
                style={[s.input, { flex: 1 }]}
                autoCapitalize="none"
                autoCorrect={false}
                accessibilityLabel="URL handle"
              />
            </View>
            {handle !== detail.suggestedHandle && (
              <Pressable onPress={() => { setHandle(detail.suggestedHandle); setFieldError(null); }} hitSlop={8} accessibilityRole="button">
                <Text style={s.link}>Use “{detail.suggestedHandle}”</Text>
              </Pressable>
            )}
          </Field>
          {fieldError && <Text style={s.error}>{fieldError}</Text>}

          <Field label="Social image link" s={s} theme={theme}>
            <TextInput returnKeyType="done"
              value={image}
              onChangeText={setImage}
              placeholder={detail.resolved.image ?? 'https://'}
              placeholderTextColor={theme.subtle}
              style={s.input}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              accessibilityLabel="Social image link"
            />
          </Field>

          <View style={s.switchRow}>
            <Text style={[s.switchLabel, { flex: 1 }]}>Hide from search engines</Text>
            <HapticSwitch value={noIndex} onValueChange={setNoIndex} accessibilityLabel="Hide from search engines" />
          </View>
        </ScrollView>
      )}
    </View>
  );
}

function Field({ label, count, max, children, s, theme }: {
  label: string; count?: number; max?: number; children: React.ReactNode; s: ReturnType<typeof makeStyles>; theme: any;
}) {
  return (
    <View style={s.field}>
      <View style={s.fieldHead}>
        <Text style={s.label}>{label}</Text>
        {count !== undefined && max !== undefined && (
          <Text style={[s.counter, count >= max && { color: theme.text, fontFamily: FONT.semibold }]}>{count}/{max}</Text>
        )}
      </View>
      {children}
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
    preview: {
      backgroundColor: theme.card, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: theme.border,
      padding: SP.md, gap: 4, marginBottom: SP.sm,
    },
    previewSite: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: 6 },
    favicon: {
      width: 28, height: 28, borderRadius: 14, backgroundColor: theme.background, borderWidth: 1,
      borderColor: theme.border, alignItems: 'center', justifyContent: 'center',
    },
    faviconText: { fontFamily: FONT.bold, fontSize: 12, color: theme.text },
    siteName: { fontFamily: FONT.medium, fontSize: FS.sm, color: theme.text },
    siteUrl: { fontFamily: FONT.regular, fontSize: 12, color: theme.muted },
    previewTitle: { fontFamily: FONT.medium, fontSize: 19, lineHeight: 24, color: theme.text, textDecorationLine: 'underline' },
    previewDesc: { fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 19, color: theme.muted },
    field: { marginTop: SP.lg },
    fieldHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
    label: { fontFamily: FONT.semibold, fontSize: FS.sm, color: theme.text },
    counter: { fontFamily: FONT.regular, fontSize: FS.sm, color: theme.muted },
    input: {
      minHeight: 48, paddingHorizontal: SP.md, paddingVertical: 12, borderRadius: RADIUS.md, borderWidth: 1,
      borderColor: theme.border, backgroundColor: theme.card, fontFamily: FONT.regular, fontSize: FS.base,
      color: theme.text, outlineWidth: 0,
    } as any,
    multiline: { minHeight: 96 },
    handleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    handlePrefix: { fontFamily: FONT.regular, fontSize: FS.base, color: theme.muted },
    link: { fontFamily: FONT.semibold, fontSize: FS.sm, color: theme.text, textDecorationLine: 'underline', marginTop: 8 },
    error: { fontFamily: FONT.medium, fontSize: FS.sm, color: theme.error, marginTop: 8 },
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: SP.md, marginTop: SP.xl },
    switchLabel: { fontFamily: FONT.semibold, fontSize: FS.base, color: theme.text },
    switchHelp: { fontFamily: FONT.regular, fontSize: FS.sm, color: theme.muted, marginTop: 2 },
  });
}
