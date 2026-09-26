import React, { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Dimensions, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@clerk/expo';
import { useApi } from '@/lib/api';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { isSellerDevPreview } from '@/lib/devPreview';
import { FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';
import { goBackOr } from '@/lib/navigation/goBackOr';

/**
 * Store Preview — a clean, full-screen render of the seller's actual store,
 * exactly as a customer would see it: the same server-rendered HTML served
 * by GET /api/store/preview (and, once published, GET /api/store/site/:slug)
 * that already contains the real catalog, cart, and checkout. No editor
 * chrome here — just the site, a close button, and a mobile/desktop toggle.
 */

type DeviceMode = 'mobile' | 'desktop';
const DESKTOP_WIDTH = 1280;

const LOCAL_STORE_PREVIEW = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Your Store</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; color: #24251f; background: #fbfaf7; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    header { height: 68px; display: flex; align-items: center; justify-content: space-between; padding: 0 7%; border-bottom: 1px solid #e9e7e0; }
    .brand { font-family: Georgia, serif; font-size: 22px; letter-spacing: .02em; }
    .nav { display: flex; align-items: center; gap: 28px; color: #65665e; font-size: 13px; }
    .cart { color: #24251f; font-size: 12px; }
    main { max-width: 1120px; margin: 0 auto; padding: 0 7%; }
    .hero { min-height: 330px; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; border-bottom: 1px solid #e9e7e0; }
    .eyebrow { margin: 0 0 17px; color: #85867d; text-transform: uppercase; letter-spacing: .18em; font-size: 10px; }
    h1 { max-width: 620px; margin: 0; font-family: Georgia, serif; font-weight: 400; font-size: clamp(38px, 6vw, 64px); line-height: 1.08; }
    .intro { max-width: 410px; margin: 18px 0 0; color: #73746d; font-size: 14px; line-height: 1.7; }
    .catalog { padding: 48px 0 70px; }
    .catalog-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 25px; }
    h2 { margin: 0; font-family: Georgia, serif; font-size: 25px; font-weight: 400; }
    .count { color: #898a82; font-size: 12px; }
    .empty { min-height: 190px; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; background: #f2f0ea; padding: 30px; }
    .empty strong { font-family: Georgia, serif; font-weight: 400; font-size: 20px; }
    .empty span { margin-top: 9px; color: #77786f; font-size: 13px; }
    footer { padding: 24px 7%; border-top: 1px solid #e9e7e0; color: #77786f; font-size: 11px; text-align: center; }
    @media (max-width: 560px) { header { height: 58px; padding: 0 20px; } .brand { font-size: 19px; } .nav { gap: 13px; font-size: 11px; } main { padding: 0 20px; } .hero { min-height: 300px; } .catalog { padding: 34px 0 48px; } .catalog-head { margin-bottom: 18px; } }
  </style>
</head>
<body>
  <header><div class="brand">Your Store</div><nav class="nav"><span>Shop</span><span>About</span><span class="cart">Bag (0)</span></nav></header>
  <main>
    <section class="hero"><p class="eyebrow">A store preview</p><h1>Made for the things you love.</h1><p class="intro">A considered space for your brand. Your products and story will appear here.</p></section>
    <section class="catalog"><div class="catalog-head"><h2>Shop the collection</h2><span class="count">0 items</span></div><div class="empty"><strong>Your collection is taking shape</strong><span>Products added to your store will appear here.</span></div></section>
  </main>
  <footer>Your Store · A preview of your storefront</footer>
</body>
</html>`;

export default function StorePreview() {
  const router = useRouter();
  const { theme } = useAppTheme();
  const styles = React.useMemo(() => makeStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const { isLoaded: authLoaded, isSignedIn } = useAuth();
  const isPreview = isSellerDevPreview() && (!authLoaded || !isSignedIn);
  const api = useApi();
  const [html, setHtml] = useState<string | null>(() => isPreview ? LOCAL_STORE_PREVIEW : null);
  const [loading, setLoading] = useState(() => !isPreview);
  const [error, setError] = useState(false);
  const [device, setDevice] = useState<DeviceMode>('mobile');

  const load = useCallback(async () => {
    if (isPreview) {
      setHtml(LOCAL_STORE_PREVIEW);
      setError(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(false);
    try {
      const raw = await (api as any).store.previewHtml() as string;
      setHtml(raw);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [api, isPreview]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const screenWidth = Dimensions.get('window').width;
  const screenHeight = Dimensions.get('window').height - insets.top - insets.bottom - 52;
  const containerWidth = device === 'desktop' ? DESKTOP_WIDTH : screenWidth;
  const scale = device === 'desktop' ? screenWidth / DESKTOP_WIDTH : 1;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.bar}>
        <TouchableOpacity
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); goBackOr(router); }}
          style={styles.closeBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityLabel="Close preview"
        >
          <Feather name="x" size={ICON.md} color={theme.text} />
        </TouchableOpacity>

        <View style={styles.deviceToggle}>
          {(['mobile', 'desktop'] as DeviceMode[]).map((mode) => (
            <TouchableOpacity
              key={mode}
              onPress={() => { Haptics.selectionAsync(); setDevice(mode); }}
              style={[styles.deviceBtn, device === mode && styles.deviceBtnActive]}
            >
              <Feather name={mode === 'mobile' ? 'smartphone' : 'monitor'} size={ICON.sm} color={device === mode ? theme.background : theme.muted} />
            </TouchableOpacity>
          ))}
        </View>

        <View style={{ width: 36 }} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.text} size="large" />
        </View>
      ) : error || !html ? (
        <View style={styles.center}>
          <Feather name="alert-circle" size={ICON.lg} color={theme.muted} />
          <Text style={styles.errorText}>Couldn't load your store preview.</Text>
          <TouchableOpacity onPress={load} style={styles.retryBtn}>
            <Text style={styles.retryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : Platform.OS === 'web' && isPreview ? (
        <View style={[styles.webviewClip, { height: screenHeight }]}>
          <View
            style={{
              width: containerWidth,
              height: screenHeight / scale,
              transform: [{ scale }],
            }}
          >
            {React.createElement('iframe' as any, {
              srcDoc: html,
              title: 'Store preview',
              sandbox: '',
              style: { width: '100%', height: '100%', border: 0, display: 'block' },
            })}
          </View>
        </View>
      ) : (
        <View style={[styles.webviewClip, { height: screenHeight }]}>
          <View
            style={{
              width: containerWidth,
              height: screenHeight / scale,
              transform: [{ scale }],
            }}
          >
            <WebView
              source={{ html }}
              style={{ width: containerWidth, height: screenHeight / scale }}
              scalesPageToFit={false}
              injectedJavaScriptBeforeContentLoaded={
                device === 'desktop'
                  ? "var m=document.querySelector('meta[name=viewport]'); if(m){m.setAttribute('content','width=" + DESKTOP_WIDTH + "');} true;"
                  : undefined
              }
            />
          </View>
        </View>
      )}
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.background },
  bar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SP.md, paddingVertical: SP.sm, height: 52,
  },
  closeBtn: {
    width: 36, height: 36, borderRadius: RADIUS.pill,
    alignItems: 'center', justifyContent: 'center',
  },
  deviceToggle: {
    flexDirection: 'row', borderRadius: RADIUS.pill,
    backgroundColor: theme.borderSubtle, padding: 3, gap: 3,
  },
  deviceBtn: {
    width: 34, height: 30, borderRadius: RADIUS.pill,
    alignItems: 'center', justifyContent: 'center',
  },
  deviceBtnActive: { backgroundColor: theme.text },
  webviewClip: { overflow: 'hidden', width: '100%' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: SP.md, paddingHorizontal: SP.xl },
  errorText: { fontSize: FS.base, fontFamily: FONT.medium, color: theme.muted, textAlign: 'center' },
  retryBtn: { paddingHorizontal: SP.lg, paddingVertical: SP.sm, borderRadius: RADIUS.md, backgroundColor: theme.text },
  retryText: { fontSize: FS.sm, fontFamily: FONT.bold, color: theme.background },
});
