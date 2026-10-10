/**
 * Share store — the one sheet every "Share store" entry point opens (the
 * Dashboard header, the setup checklist, after publishing a product, the
 * profile; all route to app/share-store.tsx, which renders this).
 *
 * Reference, copied 1:1 and reskinned black / white / silver: Linktree
 * "Share your Linktree" sheet (https://mobbin.com/flows/cf5e6683-9d98-4eda-a2e2-ec734e742ca5,
 * step 5): grabber, centered title with a close button, a preview card of the
 * page, then the link, then a row of round share targets.
 *   1. Preview card — the live store website, drawn natively and scaled down.
 *   2. The link — tapping it copies (haptic + "Link copied").
 *   3. Copy link — full-width primary button, same result.
 *   4. Messages · Instagram · TikTok · WhatsApp · Snapchat · More.
 *   5. QR code row — reveals a scannable code for the link.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Linking, Modal, Platform, Pressable, ScrollView, Share, StyleSheet, Text, View,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FontAwesome6 } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { ListRow } from '@/components/ui/ListRow';
import { useSheetTransition } from '@/components/ui/BottomSheet';
import { StoreSiteThumbnail } from '@/components/store/StoreSitePreview';
import { useStoreLink } from '@/hooks/useStoreLink';
import { useStoreSite } from '@/hooks/useStoreSite';
import { hapticLight } from '@/lib/haptics';
import { displayStoreLink } from '@/lib/storeShare';
import { SHARE_TARGETS, shareTargetUrls, type ShareTargetKey } from '@/lib/shareTargets';
import { useIsWebShell, WEB_SHELL_MAX_WIDTH } from '@/components/web/WebAppShell';
import { RADII } from '@/constants/radii';
import { FILL_ELEVATED } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { QR_DARK, QR_LIGHT } from '@/lib/storeSiteDesign';

const QRCode = React.lazy(() => import('react-native-qrcode-svg'));


const TARGET_ICON: Record<ShareTargetKey, { brand?: string; icon?: 'message-circle' | 'more-horizontal' }> = {
  messages: { icon: 'message-circle' },
  instagram: { brand: 'instagram' },
  tiktok: { brand: 'tiktok' },
  whatsapp: { brand: 'whatsapp' },
  snapchat: { brand: 'snapchat' },
  more: { icon: 'more-horizontal' },
};

interface Props {
  visible: boolean;
  /** Asks to close (sets `visible` false). Must be safe to call twice. */
  onClose: () => void;
  /** After the close animation has finished. */
  onClosed?: () => void;
}

interface ContentProps {
  /** Shows "Link copied" etc. (the sheet floats it over the screen). */
  onToast: (message: string) => void;
  /** Called before leaving to set a username. */
  onLeave?: () => void;
  /** Preview card size. */
  previewWidth?: number;
  previewHeight?: number;
  /** Load the site preview (sheets load when they open). */
  active?: boolean;
}

/** The sheet's body; the /share-store page renders the same thing. */
export function ShareStoreContent({ onToast, onLeave, previewWidth = 188, previewHeight = 248, active = true }: ContentProps) {
  const { theme } = useAppTheme();
  const router = useRouter();
  const link = useStoreLink();
  const { site } = useStoreSite(active);
  const [showQr, setShowQr] = useState(false);

  const copy = useCallback(async () => {
    if (!link.url) return;
    await link.copy(); // haptic + clipboard (hooks/useStoreLink)
    onToast('Link copied');
  }, [onToast, link]);

  const systemShare = useCallback(async () => {
    if (!link.url) return;
    hapticLight();
    if (Platform.OS === 'web') {
      const nav = typeof navigator !== 'undefined' ? navigator : null;
      if (nav?.share) { await nav.share({ url: link.url }).catch(() => {}); return; }
      await link.copy();
      onToast('Link copied');
      return;
    }
    await Share.share(Platform.OS === 'ios' ? { url: link.url } : { message: link.url }).catch(() => {});
  }, [onToast, link]);

  const shareTo = useCallback(async (key: ShareTargetKey) => {
    if (!link.url) return;
    const target = SHARE_TARGETS.find((t) => t.key === key)!;
    const urls = shareTargetUrls(key, link.url, Platform.OS);
    if (!urls.length) { await systemShare(); return; }
    hapticLight();
    if (target.copyFirst) { await link.copy(); onToast('Link copied'); }
    for (const url of urls) {
      try {
        if (Platform.OS === 'web') { window.open(url, '_blank', 'noopener'); return; }
        await Linking.openURL(url);
        return;
      } catch { /* not installed — try the next, then the share sheet */ }
    }
    await systemShare();
  }, [onToast, link, systemShare]);

  if (link.loading) return <View style={{ height: previewHeight + 160 }} />;
  if (!link.url) {
    // No username, no link — never an invented one.
    return (
      <View style={s.noLink} testID="share-store-no-username">
        <Text style={[s.noLinkTitle, { color: theme.text }]}>Pick a username to get your store link</Text>
        <Button label="Set username" onPress={() => { onLeave?.(); router.push('/edit-profile' as never); }} fullWidth />
      </View>
    );
  }
  return (
    <View testID="share-store-content">
      {site ? (
        <View style={s.previewWrap}>
          <View style={[s.previewFrame, { borderColor: theme.borderSubtle }]}>
            <StoreSiteThumbnail site={site} width={previewWidth} height={previewHeight} radius={14} maxProducts={4} testID="share-store-preview" />
          </View>
        </View>
      ) : <View style={{ height: previewHeight + 4 }} />}

      <Pressable onPress={copy} style={s.linkRow} accessibilityRole="button" accessibilityLabel={`Copy ${displayStoreLink(link.url)}`} testID="share-store-link">
        <Text style={[s.linkText, { color: theme.text }]} numberOfLines={1} ellipsizeMode="middle">{displayStoreLink(link.url)}</Text>
        <Icon name="copy" size={15} color={theme.muted} />
      </Pressable>

      <Button label="Copy link" onPress={copy} fullWidth style={s.copyBtn} testID="share-store-copy" />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.targets} style={s.targetsScroll}>
        {SHARE_TARGETS.map((t) => {
          const ic = TARGET_ICON[t.key];
          return (
            <Pressable key={t.key} onPress={() => { void shareTo(t.key); }} style={s.target} accessibilityRole="button" accessibilityLabel={t.key === 'more' ? 'More sharing options' : `Share to ${t.label}`} testID={`share-store-target-${t.key}`}>
              <View style={[s.circle, { backgroundColor: theme.background }]}>
                {ic.brand
                  ? <FontAwesome6 name={ic.brand as never} brand size={22} color={theme.text} />
                  : <Icon name={ic.icon!} size={22} color={theme.text} />}
              </View>
              <Text style={[s.targetLabel, { color: theme.muted }]} numberOfLines={1}>{t.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={[s.divider, { backgroundColor: theme.borderSubtle }]} />
      <ListRow icon="grid" title="QR code" chevron={!showQr} onPress={() => setShowQr((v) => !v)} testID="share-store-qr-row" />
      {showQr && (
        <View style={s.qrWrap} testID="share-store-qr">
          <View style={[s.qrTile, { backgroundColor: QR_LIGHT }]} accessible accessibilityRole="image" accessibilityLabel="Store QR code">
            <React.Suspense fallback={<View style={{ width: 168, height: 168 }} />}>
              {/* A QR must stay dark-on-light to scan, whatever the app theme. */}
              <QRCode value={link.url} size={168} backgroundColor={QR_LIGHT} color={QR_DARK} />
            </React.Suspense>
          </View>
          <Button label={link.saved ? 'Saved' : 'Save QR code'} variant="tertiary" onPress={() => { void link.saveQr(); }} testID="share-store-save-qr" />
        </View>
      )}
    </View>
  );
}

/** Floating confirmation ("Link copied") shown at the top of the screen. */
export function ShareStoreToast({ message, top }: { message: string | null; top: number }) {
  const { theme } = useAppTheme();
  if (!message) return null;
  return (
    <View style={[s.toast, { top, borderColor: theme.borderSubtle }]} pointerEvents="none" accessibilityLiveRegion="polite" testID="share-store-toast">
      <Icon name="check-circle" size={17} color={theme.text} />
      <Text style={[s.toastText, { color: theme.text }]}>{message}</Text>
    </View>
  );
}

export function useToast(): [string | null, (message: string) => void] {
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const flash = useCallback((message: string) => {
    setToast(message);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 1600);
  }, []);
  return [toast, flash];
}

export function ShareStoreSheet({ visible, onClose, onClosed }: Props) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const isWebShell = useIsWebShell();
  const [toast, flash] = useToast();
  const { modalVisible, sheetStyle, backdropStyle, panGesture, onSheetLayout } = useSheetTransition(visible, () => { onClose(); onClosed?.(); });

  return (
    <Modal visible={modalVisible} transparent animationType="none" onRequestClose={onClose} testID="share-store-sheet">
      <View style={s.root}>
        <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
          <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: theme.background, opacity: 0.6 }]} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
        </Animated.View>
        <GestureDetector gesture={panGesture}>
          <Animated.View
            onLayout={onSheetLayout}
            style={[s.sheet, isWebShell && s.sheetWeb, { paddingBottom: Math.max(insets.bottom, 16) }, sheetStyle]}
            accessibilityViewIsModal
          >
            <View style={s.grabberWrap}><View style={[s.grabber, { backgroundColor: theme.subtle }]} /></View>
            <View style={s.header}>
              <View style={s.headerSide} />
              <Text style={[s.title, { color: theme.text }]} accessibilityRole="header">Share your store</Text>
              <Pressable onPress={onClose} style={[s.headerSide, s.close, { backgroundColor: theme.background }]} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close" testID="share-store-close">
                <Icon name="x" size={17} color={theme.text} />
              </Pressable>
            </View>
            <ScrollView bounces={false} showsVerticalScrollIndicator={false} contentContainerStyle={s.body}>
              <ShareStoreContent onToast={flash} onLeave={onClose} active={visible} />
            </ScrollView>
          </Animated.View>
        </GestureDetector>
        <ShareStoreToast message={toast} top={insets.top + 8} />
      </View>
    </Modal>
  );
}
const s = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  // Solid sheet surface (BRANDTHREAD_DESIGN.md addendum: inputs and sheets #1C1C1E).
  sheet: { backgroundColor: FILL_ELEVATED, borderTopLeftRadius: RADII.sheet, borderTopRightRadius: RADII.sheet, maxHeight: '92%' },
  sheetWeb: { width: '100%', maxWidth: WEB_SHELL_MAX_WIDTH, alignSelf: 'center' },
  grabberWrap: { alignItems: 'center', paddingTop: 6, paddingBottom: 2 },
  grabber: { width: 36, height: 5, borderRadius: 3, opacity: 0.5 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, height: 44 },
  headerSide: { width: 30, height: 30 },
  close: { borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '600' },
  body: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  previewWrap: { alignItems: 'center' },
  previewFrame: { borderRadius: 16, borderWidth: 1, padding: 1 },
  linkRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44, marginTop: 12, paddingHorizontal: 8 },
  linkText: { fontSize: 17, fontWeight: '600', flexShrink: 1 },
  copyBtn: { marginTop: 8 },
  targetsScroll: { marginTop: 20, marginHorizontal: -16 },
  targets: { paddingHorizontal: 12, gap: 4 },
  target: { width: 68, alignItems: 'center' },
  circle: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  targetLabel: { fontSize: 12, marginTop: 6 },
  divider: { height: StyleSheet.hairlineWidth, marginTop: 20, marginBottom: 4 },
  qrWrap: { alignItems: 'center', paddingVertical: 12, gap: 4 },
  qrTile: { padding: 12, borderRadius: 12 },
  noLink: { paddingVertical: 24, gap: 16 },
  noLinkTitle: { fontSize: 17, fontWeight: '600', textAlign: 'center' },
  toast: {
    position: 'absolute', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: FILL_ELEVATED, borderWidth: 1, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 10,
  },
  toastText: { fontSize: 15, fontWeight: '600' },
});
