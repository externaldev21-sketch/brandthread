import React, { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Dimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import * as Haptics from 'expo-haptics';
import { useApi } from '@/lib/api';
import { useAppTheme } from '@/contexts/AppThemeContext';
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

export default function StorePreview() {
  const router = useRouter();
  const { theme } = useAppTheme();
  const styles = React.useMemo(() => makeStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const api = useApi();
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [device, setDevice] = useState<DeviceMode>('mobile');

  const load = useCallback(async () => {
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
  }, [api]);

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
