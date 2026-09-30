import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Dimensions, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import { WebView } from 'react-native-webview';
import * as Haptics from 'expo-haptics';
import { useApi } from '@/lib/api';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { EmptyState } from '@/components/BrandthreadUI';
import { isSellerDevPreview, isBuyerDevPreview, isPreviewDemoMode } from '@/lib/devPreview';
import { isAuthError } from '@/lib/networkNotice';
import { buildPreviewStorefrontHtml } from '@/lib/previewStorefrontHtml';

/**
 * Store Preview — a clean, full-screen render of the seller's actual store,
 * exactly as a customer would see it: the same server-rendered HTML served
 * by GET /api/store/preview (and, once published, GET /api/store/site/:slug)
 * that already contains the real catalog, cart, and checkout. No editor
 * chrome here — just the site, a close button, and a mobile/desktop toggle.
 *
 * Fresh preview (`?bt_preview=seller`, no `&demo=1`) never calls the real
 * backend — there's nothing real to preview yet for a brand-new account,
 * and hitting a real endpoint from an unauthenticated preview session just
 * produces a network/auth error the person can't do anything about. It
 * goes straight to the real "no products yet" empty state instead, the
 * same thing a genuinely fresh seller with zero products would see.
 */

type DeviceMode = 'mobile' | 'desktop';
const DESKTOP_WIDTH = 1280;

// react-native-webview has no real web implementation (its own source is a
// "does not support this platform" dummy component on web — see
// node_modules/react-native-webview/src/WebView.tsx). Using <WebView> on
// web silently rendered that dummy view with no width/height set inside a
// scaled, clipped container, which is how this screen went fully blank
// with no error: the loading/error states were working fine, it was only
// ever the "html loaded, show it" branch that had nothing real to show.
// On web, render the HTML in a genuine DOM <iframe> instead.
function HtmlSurface({ html, width, height, injectedJS }: {
  html: string; width: number; height: number; injectedJS?: string;
}) {
  if (Platform.OS === 'web') {
    return React.createElement('iframe', {
      srcDoc: html,
      style: { width, height, border: 'none', display: 'block', backgroundColor: '#FFFFFF' },
      title: 'Store preview',
    });
  }
  return (
    <WebView
      source={{ html }}
      style={{ width, height }}
      scalesPageToFit={false}
      injectedJavaScriptBeforeContentLoaded={injectedJS}
    />
  );
}

export default function StorePreview() {
  const router = useRouter();
  const { theme } = useAppTheme();
  const styles = React.useMemo(() => makeStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const api = useApi();
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  // GET /api/store/preview requires a real signed-in session server-side
  // (see artifacts/api-server/src/routes/store.ts: router.use(requireAuth)
  // runs before the /preview route is registered). A dev/web preview
  // session that bypasses real Clerk sign-in has no such session, so this
  // call 401s there even when freshPreview's own gate (below) doesn't
  // catch it — e.g. isSellerDevPreview() can't detect every host this app
  // gets tested from. Track that distinctly from a generic load failure so
  // it reads as "nothing to preview yet", not as a broken screen.
  const [authRequired, setAuthRequired] = useState(false);
  const [device, setDevice] = useState<DeviceMode>('mobile');
  // Guards against overlapping calls: useFocusEffect can re-fire in quick
  // succession (focus/blur churn, StrictMode's double-invoke in dev), and
  // without this a second in-flight call's state updates could land after
  // the first's, or after the screen has lost focus/unmounted.
  const inFlight = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  // Fresh preview (no &demo=1) never has a real store to fetch — see the
  // file doc comment.
  //
  // Demo preview (&demo=1) ALSO never calls the real endpoint: GET
  // /api/store/preview requires a real signed-in session server-side (see
  // artifacts/api-server/src/routes/store.ts's router.use(requireAuth)),
  // which a dev/web preview session never has by construction — that call
  // cannot structurally succeed here, so routing demo mode through it was
  // always going to fail one way or another (a 401, or nothing visible).
  // Demo mode instead renders a local, self-contained storefront built
  // from the same seeded catalog every other demo-gated seller screen
  // uses (lib/previewSellerProducts.ts) — see lib/previewStorefrontHtml.ts.
  //
  // This screen is seller-only, but the dev/web preview bypass can still
  // land here under `?bt_preview=buyer` (e.g. a route crawl testing every
  // screen under both roles, or a persisted 'buyer' role from earlier
  // testing in the same browser) with no real session either — checking
  // only isSellerDevPreview() missed that case and let the real endpoint
  // fire every time. Only a real signed-in account outside preview mode
  // calls the network.
  //
  // Computed fresh on every render (not memoized with a frozen `[]` dep
  // array) and, critically, re-checked again with its own direct calls
  // inside load() itself below rather than trusted from a closure — a
  // real, live-observed failure mode was the real network branch firing
  // despite the URL genuinely carrying `?bt_preview=seller`. A captured
  // closure value computed once at mount can go stale; a fresh,
  // synchronous check made right before the fetch decision cannot — it
  // always reflects the actual current window.location/localStorage state
  // at the exact moment that decision is made, so there is no window in
  // which a cached/real response can reach the render before this check
  // has run.
  const inDevPreview  = isSellerDevPreview() || isBuyerDevPreview();
  const freshPreview  = inDevPreview && !isPreviewDemoMode();
  const demoPreview   = inDevPreview && isPreviewDemoMode();

  const load = useCallback(async () => {
    // Re-derive at call time — see the comment above these consts for why
    // this isn't just "freshPreview"/"demoPreview" from the render closure.
    const devPreviewNow = isSellerDevPreview() || isBuyerDevPreview();
    if (devPreviewNow && !isPreviewDemoMode()) {
      setLoading(false); setError(false); setAuthRequired(false); setHtml(null); return;
    }
    if (devPreviewNow && isPreviewDemoMode()) {
      setLoading(false); setError(false); setAuthRequired(false); setHtml(buildPreviewStorefrontHtml()); return;
    }
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    setError(false);
    setAuthRequired(false);
    try {
      const raw = await (api as any).store.previewHtml() as string;
      if (!mountedRef.current) return;
      setHtml(raw);
    } catch (err) {
      if (!mountedRef.current) return;
      if (isAuthError(err)) setAuthRequired(true);
      else setError(true);
    } finally {
      inFlight.current = false;
      if (mountedRef.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const screenWidth = Dimensions.get('window').width;
  const screenHeight = Dimensions.get('window').height - insets.top - insets.bottom - 52;
  const containerWidth = device === 'desktop' ? DESKTOP_WIDTH : screenWidth;
  const scale = device === 'desktop' ? screenWidth / DESKTOP_WIDTH : 1;
  const desktopInjectedJS = "var m=document.querySelector('meta[name=viewport]'); if(m){m.setAttribute('content','width=" + DESKTOP_WIDTH + "');} true;";

  return (
    <View style={[styles.root, { paddingTop: useHeaderTopInset() }]}>
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
              accessibilityLabel={mode === 'mobile' ? 'Mobile preview' : 'Desktop preview'}
              accessibilityRole="button"
              accessibilityState={{ selected: device === mode }}
            >
              <Feather name={mode === 'mobile' ? 'smartphone' : 'monitor'} size={ICON.sm} color={device === mode ? '#000000' : theme.text} />
            </TouchableOpacity>
          ))}
        </View>

        <View style={{ width: 36 }} />
      </View>

      {freshPreview ? (
        <View style={styles.center}>
          <EmptyState
            icon="shopping-bag"
            title="Your store is empty"
            description="Add a product to see your store come to life here."
            action={{ label: 'Add product', onPress: () => router.push('/add-product' as never), icon: 'plus' }}
          />
        </View>
      ) : loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.text} size="large" />
        </View>
      ) : authRequired ? (
        <View style={styles.center}>
          <EmptyState
            icon="shopping-bag"
            title="Your store is empty"
            description="Add a product to see your store come to life here."
            action={{ label: 'Add product', onPress: () => router.push('/add-product' as never), icon: 'plus' }}
          />
        </View>
      ) : error || !html ? (
        <View style={styles.center}>
          <Feather name="alert-circle" size={ICON.lg} color={theme.muted} />
          <Text style={styles.errorText}>Couldn't load your store preview.</Text>
          <TouchableOpacity onPress={load} style={styles.retryBtn}>
            <Text style={styles.retryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={[styles.webviewClip, { height: screenHeight }]}>
          <View
            style={{
              width: containerWidth,
              height: screenHeight / scale,
              transform: [{ scale }],
              // Scale from the top-left, not the default center — a
              // center-origin scale shifts a 1280px-wide desktop frame
              // sideways/upward by half the shrink amount, pushing most of
              // it off-screen instead of shrinking it in place to fit.
              transformOrigin: 'top left',
            } as any}
          >
            <HtmlSurface
              html={html}
              width={containerWidth}
              height={screenHeight / scale}
              injectedJS={device === 'desktop' ? desktopInjectedJS : undefined}
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
  // Monochrome rule: black/white/silver only — was theme.borderSubtle (a
  // grey fill) with a theme.muted (grey) inactive icon.
  deviceToggle: {
    flexDirection: 'row', borderRadius: RADIUS.pill,
    backgroundColor: '#000000', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)',
    padding: 3, gap: 3,
  },
  deviceBtn: {
    width: 34, height: 30, borderRadius: RADIUS.pill,
    alignItems: 'center', justifyContent: 'center',
  },
  deviceBtnActive: { backgroundColor: theme.text },
  webviewClip: { overflow: 'hidden', width: '100%' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: SP.md, paddingHorizontal: SP.xl },
  errorText: { fontSize: FS.base, fontFamily: FONT.medium, color: theme.muted, textAlign: 'center' },
  retryBtn: { paddingHorizontal: SP.lg, paddingVertical: SP.sm, borderRadius: RADIUS.md, backgroundColor: theme.accent },
  retryText: { fontSize: FS.sm, fontFamily: FONT.bold, color: theme.onAccent },
});
