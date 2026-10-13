/**
 * Product feed — secret catalog URLs to paste into Meta Commerce Manager
 * (Instagram / Facebook Shopping) and a TikTok catalog. Route: /product-feed
 *
 * Flow copied 1:1 from beehiiv "Generating an RSS feed" (Mobbin
 * https://mobbin.com/flows/081c2deb-1f40-4b77-96e9-960cef88b3f2): a single
 * "Generate" button, then the feed URL with a Copy action, its last-updated
 * line, and one destructive-style action under it (theirs deletes; ours
 * regenerates behind a confirm sheet, which revokes the old URL).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, Pressable } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { useAuth } from '@clerk/expo';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import { ScreenHeader } from '@/components/ScreenHeader';
import { PrimaryButton } from '@/components/BrandthreadUI';
import { RetryRow } from '@/components/ui/RetryRow';
import { showActionSheet } from '@/components/ui/ActionSheet';
import { CenteredToast } from '@/components/social/CenteredToast';
import { isPreviewDemoMode, isSellerDevPreview } from '@/lib/devPreview';
import { relativeTime } from '@/lib/activity';
import { hapticLight, hapticSuccess } from '@/lib/haptics';
import {
  createProductFeed, getProductFeed, regenerateProductFeed, type ProductFeedOverview,
} from '@/services/sellerToolsService';

const EMPTY: ProductFeedOverview = { feed: null, productCount: 0, itemCount: 0 };

/** Demo-only (web preview with demo=1): never a real token. */
function demoOverview(): ProductFeedOverview {
  const base = 'https://brandthread.app/api/v1/public/feeds/demo-preview-token-not-real-0000000000000';
  return {
    feed: {
      metaUrl: `${base}/meta.csv`,
      tiktokUrl: `${base}/tiktok.csv`,
      createdAt: new Date(Date.now() - 6 * 864e5).toISOString(),
      rotatedAt: new Date(Date.now() - 6 * 864e5).toISOString(),
      metaFetchedAt: new Date(Date.now() - 2 * 36e5).toISOString(),
      tiktokFetchedAt: null,
    },
    productCount: 12,
    itemCount: 38,
  };
}

const PLATFORMS = [
  { key: 'meta' as const, label: 'Instagram & Facebook', where: 'Meta Commerce Manager' },
  { key: 'tiktok' as const, label: 'TikTok', where: 'TikTok catalog' },
];

export default function ProductFeedScreen() {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { isLoaded, isSignedIn } = useAuth();
  const previewOnly = isSellerDevPreview() && (!isLoaded || !isSignedIn);

  const [data, setData] = useState<ProductFeedOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);
  const showToast = useCallback((m: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(m);
    toastTimer.current = setTimeout(() => setToast(null), 1600);
  }, []);

  const load = useCallback(async () => {
    if (previewOnly) {
      setData(isPreviewDemoMode() ? demoOverview() : EMPTY);
      setLoading(false);
      return;
    }
    try {
      setData(await getProductFeed());
      setError(false);
    } catch { setError(true); }
    finally { setLoading(false); }
  }, [previewOnly]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const generate = async () => {
    if (previewOnly) return;
    setBusy(true); setMsg(null);
    try {
      setData(await createProductFeed());
      hapticSuccess();
      showToast('Feed URL generated');
    } catch (e: any) { setMsg(e?.message ?? "Couldn't generate the feed URL."); }
    finally { setBusy(false); }
  };

  const regenerate = () => {
    showActionSheet('Regenerate feed URLs?', 'The current URLs stop working. Paste the new ones into Meta and TikTok.', [
      {
        text: 'Regenerate',
        style: 'destructive',
        onPress: async () => {
          if (previewOnly) return;
          setBusy(true); setMsg(null);
          try {
            setData(await regenerateProductFeed());
            hapticSuccess();
            showToast('New URLs generated');
          } catch (e: any) { setMsg(e?.message ?? "Couldn't regenerate the feed URLs."); }
          finally { setBusy(false); }
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const copy = async (url: string) => {
    hapticLight();
    await Clipboard.setStringAsync(url);
    showToast('Copied');
  };

  const s = useMemo(() => StyleSheet.create({
    content: { paddingHorizontal: SP.md, paddingTop: SP.md },
    title: { fontFamily: FONT.semibold, fontSize: FS.lg, color: theme.text },
    body: { fontFamily: FONT.regular, fontSize: FS.sm, color: theme.muted, lineHeight: 20, marginTop: 6, marginBottom: SP.lg },
    block: { marginBottom: SP.lg },
    labelRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SP.md },
    label: { fontFamily: FONT.semibold, fontSize: FS.sm, color: theme.text },
    url: { fontFamily: FONT.regular, fontSize: FS.sm, color: theme.muted, marginTop: 4, lineHeight: 19 },
    copy: { fontFamily: FONT.semibold, fontSize: FS.sm, color: theme.text, paddingTop: 2 },
    meta: { fontFamily: FONT.regular, fontSize: FS.xs, color: theme.muted, marginTop: 6 },
    counts: {
      fontFamily: FONT.medium, fontSize: FS.sm, color: theme.text, marginBottom: SP.lg,
    },
    outline: {
      alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: theme.border,
      borderRadius: RADIUS.sm, paddingHorizontal: SP.md, paddingVertical: 10,
    },
    outlineText: { fontFamily: FONT.semibold, fontSize: FS.sm, color: theme.text },
    error: { fontFamily: FONT.medium, color: theme.error, marginTop: SP.sm },
  }), [theme]);

  const counts = data ? `${data.productCount} ${data.productCount === 1 ? 'product' : 'products'} · ${data.itemCount} ${data.itemCount === 1 ? 'item' : 'items'}` : '';

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <ScreenHeader title="Product feed" />
      <ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 120 }]}>
        {loading ? <ActivityIndicator color={theme.text} /> : error ? <RetryRow label="Couldn't load your product feed" onRetry={load} /> : !data?.feed ? (
          <>
            <Text style={s.title}>Catalog feed</Text>
            <Text style={s.body}>Add a URL as a scheduled data feed in Meta Commerce Manager or a TikTok catalog.</Text>
            <Text style={s.counts}>{counts}</Text>
            <PrimaryButton label="Generate feed URLs" icon="rss" onPress={generate} loading={busy} disabled={busy || previewOnly} testID="product-feed-generate" />
            {msg ? <Text style={s.error}>{msg}</Text> : null}
          </>
        ) : (
          <>
            <Text style={s.title}>Catalog feed</Text>
            <Text style={s.body}>Add a URL as a scheduled data feed in Meta Commerce Manager or a TikTok catalog.</Text>
            {PLATFORMS.map((p) => {
              const url = p.key === 'meta' ? data.feed!.metaUrl : data.feed!.tiktokUrl;
              const fetched = p.key === 'meta' ? data.feed!.metaFetchedAt : data.feed!.tiktokFetchedAt;
              return (
                <View key={p.key} style={s.block}>
                  <View style={s.labelRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.label}>{p.label}</Text>
                      <Text style={s.url} selectable numberOfLines={2}>{url}</Text>
                    </View>
                    <Pressable onPress={() => copy(url)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Copy ${p.label} feed URL`} testID={`product-feed-copy-${p.key}`}>
                      <Text style={s.copy}>Copy</Text>
                    </Pressable>
                  </View>
                  <Text style={s.meta}>{fetched ? `Last fetched by ${p.where} ${relativeTime(fetched)}` : `Not fetched by ${p.where} yet`}</Text>
                </View>
              );
            })}
            <Text style={s.counts}>{counts}</Text>
            <Pressable onPress={regenerate} disabled={busy} style={[s.outline, busy && { opacity: 0.5 }]} accessibilityRole="button" accessibilityLabel="Regenerate feed URLs" testID="product-feed-regenerate">
              {busy ? <ActivityIndicator size="small" color={theme.text} /> : null}
              <Text style={s.outlineText}>Regenerate URLs</Text>
            </Pressable>
            {msg ? <Text style={s.error}>{msg}</Text> : null}
          </>
        )}
      </ScrollView>
      <CenteredToast message={toast} />
    </View>
  );
}
