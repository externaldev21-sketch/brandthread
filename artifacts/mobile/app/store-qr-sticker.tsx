/**
 * QR sticker — printable black-and-white store QR stickers and a table sign
 * for pop-ups. Route: /store-qr-sticker
 *
 * Layout copied 1:1 from MD Vinyl "Customizing a song image" (Mobbin
 * https://mobbin.com/flows/1b79fdfc-c1c1-4dd8-9d1c-a582b4d8ba24): the artwork
 * preview on top, a segmented layout picker under it, a settings group with
 * an "Include link" switch, and three round actions along the bottom
 * (theirs: Copy Link · Save Image · More; ours: Copy link · Save image · Print).
 *
 * The QR encodes the seller's tracked pop-up link (utm_source=popup,
 * utm_medium=qr), so every scan is counted here and in Links.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, Pressable, Platform, useWindowDimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { SvgXml } from 'react-native-svg';
import { useAuth } from '@clerk/expo';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ListRow } from '@/components/ui/ListRow';
import { RetryRow } from '@/components/ui/RetryRow';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { PrimaryButton } from '@/components/BrandthreadUI';
import { CenteredToast } from '@/components/social/CenteredToast';
import { isPreviewDemoMode, isSellerDevPreview } from '@/lib/devPreview';
import { hapticLight, hapticSuccess } from '@/lib/haptics';
import { buildStoreUrl } from '@/lib/storeQr';
import {
  STICKER_LAYOUTS, shortDisplayUrl, stickerLayout, stickerSvg, stickersPerPage, type StickerLayoutId,
} from '@/lib/qrSticker';
import { printSticker, saveStickerImage } from '@/lib/qrStickerOutput';
import { getQrStickerLink, type QrStickerLink } from '@/services/sellerToolsService';

type State =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'not-live' }
  | { kind: 'ready'; link: QrStickerLink };

/** Demo-only (web preview with demo=1). */
const DEMO_LINK: QrStickerLink = {
  id: 'demo', code: 'demo', qrUrl: 'https://brandthread.app/store/northline?utm_source=popup&utm_medium=qr',
  clicks: 14, orders: 2, username: 'northline', storeName: 'Northline Studio',
};

export default function StoreQrStickerScreen() {
  const { theme } = useAppTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const { isLoaded, isSignedIn } = useAuth();
  const previewOnly = isSellerDevPreview() && (!isLoaded || !isSignedIn);

  const [state, setState] = useState<State>({ kind: 'loading' });
  const [layoutId, setLayoutId] = useState<StickerLayoutId>('round2');
  const [showLink, setShowLink] = useState(true);
  const [busy, setBusy] = useState<'save' | 'print' | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewRef = useRef<View>(null);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);
  const showToast = useCallback((m: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(m);
    toastTimer.current = setTimeout(() => setToast(null), 1600);
  }, []);

  const load = useCallback(async () => {
    if (previewOnly) {
      setState(isPreviewDemoMode() ? { kind: 'ready', link: DEMO_LINK } : { kind: 'not-live' });
      return;
    }
    try {
      setState({ kind: 'ready', link: await getQrStickerLink() });
    } catch (e: any) {
      setState(e?.status === 409 || /STORE_NOT_LIVE/.test(String(e?.body ?? e?.message ?? '')) ? { kind: 'not-live' } : { kind: 'error' });
    }
  }, [previewOnly]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const link = state.kind === 'ready' ? state.link : null;
  const content = useMemo(() => link ? {
    storeName: link.storeName,
    qrUrl: link.qrUrl,
    displayUrl: showLink ? shortDisplayUrl(buildStoreUrl(link.username)) : null,
  } : null, [link, showLink]);

  const layout = stickerLayout(layoutId);
  const previewWidth = Math.min(screenWidth - SP.md * 2 - 48, layout.shape === 'sign' ? 168 : 220);
  const previewHeight = Math.round((previewWidth * layout.heightIn) / layout.widthIn);
  const svg = useMemo(() => (content ? stickerSvg(layoutId, content) : ''), [content, layoutId]);

  const copyLink = async () => {
    if (!link) return;
    hapticLight();
    await Clipboard.setStringAsync(link.qrUrl);
    showToast('Link copied');
  };

  const save = async () => {
    if (!content) return;
    setBusy('save');
    try {
      const r = await saveStickerImage(layoutId, content, { ref: previewRef, previewSize: previewWidth });
      if (r.ok) { hapticSuccess(); showToast(Platform.OS === 'web' ? 'Image downloaded' : 'Saved to Photos'); }
      else showToast("Couldn't save the image");
    } catch { showToast("Couldn't save the image"); }
    finally { setBusy(null); }
  };

  const print = async () => {
    if (!content) return;
    setBusy('print');
    try { await printSticker(layoutId, content); }
    catch { showToast("Couldn't open printing"); }
    finally { setBusy(null); }
  };

  const s = useMemo(() => StyleSheet.create({
    content: { paddingHorizontal: SP.md, paddingTop: SP.md },
    stage: {
      alignItems: 'center', justifyContent: 'center', borderRadius: RADIUS.lg, backgroundColor: theme.surface,
      paddingVertical: SP.md, minHeight: 252, marginBottom: SP.md,
    },
    group: { borderRadius: 14, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.card, overflow: 'hidden', marginTop: SP.md },
    actions: { flexDirection: 'row', justifyContent: 'space-around', marginTop: SP.md },
    action: { alignItems: 'center', width: 96 },
    actionCircle: {
      width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center',
      backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border,
    },
    actionLabel: { fontFamily: FONT.medium, fontSize: FS.sm, color: theme.text, marginTop: 8 },
    emptyTitle: { fontFamily: FONT.semibold, fontSize: FS.lg, color: theme.text, marginBottom: SP.sm },
    emptyBody: { fontFamily: FONT.regular, fontSize: FS.sm, color: theme.muted, lineHeight: 18, marginBottom: SP.lg },
  }), [theme]);

  const Action = ({ icon, label, onPress, loading, testID }: {
    icon: keyof typeof Feather.glyphMap; label: string; onPress: () => void; loading?: boolean; testID: string;
  }) => (
    <Pressable onPress={onPress} disabled={!!busy} style={s.action} accessibilityRole="button" accessibilityLabel={label} testID={testID}>
      <View style={[s.actionCircle, !!busy && !loading && { opacity: 0.5 }]}>
        {loading ? <ActivityIndicator color={theme.text} /> : <Feather name={icon} size={22} color={theme.text} />}
      </View>
      <Text style={s.actionLabel}>{label}</Text>
    </Pressable>
  );

  const perSheet = stickersPerPage(layoutId);

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <ScreenHeader title="QR sticker" />
      <ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 120 }]}>
        {state.kind === 'loading' ? <ActivityIndicator color={theme.text} /> : state.kind === 'error' ? (
          <RetryRow label="Couldn't load your store link" onRetry={load} />
        ) : state.kind === 'not-live' ? (
          <>
            <Text style={s.emptyTitle}>Your store needs a link first</Text>
            <Text style={s.emptyBody}>Set a username or publish your store, then come back to print stickers.</Text>
            <PrimaryButton label="Edit profile" onPress={() => router.push('/edit-profile' as never)} disabled={previewOnly} testID="qr-sticker-edit-profile" />
          </>
        ) : (
          <>
            <View style={s.stage}>
              <View ref={previewRef} collapsable={false} style={{ width: previewWidth, height: previewHeight }} testID="qr-sticker-preview">
                <SvgXml xml={svg} width={previewWidth} height={previewHeight} />
              </View>
            </View>
            <SegmentedControl
              options={STICKER_LAYOUTS.map((l) => ({ id: l.id, label: l.label }))}
              selectedId={layoutId}
              onChange={(id) => setLayoutId(id as StickerLayoutId)}
              size="compact"
              testID="qr-sticker-layout"
            />
            <View style={s.group}>
              <ListRow icon="link" title="Show link" toggle={{ value: showLink, onChange: setShowLink }} testID="qr-sticker-show-link" />
              <ListRow icon="file" title="Per page" value={layout.shape === 'sign' ? '1 sign' : `${perSheet} stickers`} />
              <ListRow icon="maximize" title="Scans" value={String(link?.clicks ?? 0)} onPress={() => router.push('/growth-links' as never)} chevron />
            </View>
            <View style={s.actions}>
              <Action icon="link" label="Copy link" onPress={copyLink} testID="qr-sticker-copy" />
              <Action icon="download" label="Save image" onPress={save} loading={busy === 'save'} testID="qr-sticker-save" />
              <Action icon="printer" label="Print" onPress={print} loading={busy === 'print'} testID="qr-sticker-print" />
            </View>
          </>
        )}
      </ScrollView>
      <CenteredToast message={toast} />
    </View>
  );
}
