/**
 * Launch publish — confirm and publish the store, then the "you're live" moment
 * with the share link and a downloadable QR code. Publishing reuses
 * services/storeService.publishStore (the same call app/store-publish.tsx
 * makes); the link matches app/share-store.tsx.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Easing, Platform, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';

import { useTabBarMetrics } from '@/components/buyer-nav/buyerTabBarMetrics';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Button } from '@/components/ui/Button';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { useLaunchChecklist } from '@/hooks/useLaunchChecklist';
import { saveImageToCameraRoll } from '@/lib/aiToolMedia';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { confirmPublishWithoutPayouts } from '@/lib/payoutReadinessPrompt';
import { useApi } from '@/hooks/useApi';
import { hapticLight, hapticSuccessAction } from '@/lib/haptics';
import { completeSetupTaskWhen } from '@/lib/setupCompletion';
import { buildStoreUrl, storeQrDataUri } from '@/lib/storeQr';
import { COMP, FONT, FS, ICON, RADIUS, SP } from '@/lib/theme';
import { getStorefront, publishStore } from '@/services/storeService';

export default function LaunchPublishScreen() {
  const { theme } = useAppTheme();
  const s = useMemo(() => createStyles(theme), [theme]);
  // Seller bar (Studio + AI side circles) floats over every seller screen.
  const tabBarInset = useTabBarMetrics(2).occupiedHeight;
  const router = useRouter();
  const api = useApi();
  const { checklist } = useLaunchChecklist();

  const [live, setLive] = useState(false);
  const [checking, setChecking] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);

  const pop = useRef(new Animated.Value(0)).current;
  const ring = useRef(new Animated.Value(0)).current;

  const storeUrl = buildStoreUrl(checklist?.handle);
  const alreadyLive = checklist?.steps.find((step) => step.id === 'publish')?.done ?? false;

  useEffect(() => {
    let active = true;
    getStorefront()
      .then((store) => { if (active && store.publishStatus === 'published') setLive(true); })
      .catch(() => {})
      .finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, []);

  const isLive = live || alreadyLive;

  useEffect(() => {
    if (!isLive) return;
    const native = Platform.OS !== 'web';
    Animated.spring(pop, { toValue: 1, friction: 6, tension: 90, useNativeDriver: native }).start();
    Animated.timing(ring, { toValue: 1, duration: 1100, easing: Easing.out(Easing.cubic), useNativeDriver: native }).start();
  }, [isLive, pop, ring]);

  const publish = async () => {
    if (publishing) return;
    setPublishing(true);
    setProblem(null);
    // Going live without payouts: buyers couldn't check out (BT-206).
    if (!(await confirmPublishWithoutPayouts(api, router))) {
      setPublishing(false);
      return;
    }
    try {
      const result = await publishStore();
      if (result.success) {
        await completeSetupTaskWhen('publish_store', true);
        hapticSuccessAction();
        setLive(true);
      } else {
        setProblem(result.message);
      }
    } catch {
      setProblem('Check your connection and try again.');
    } finally {
      setPublishing(false);
    }
  };

  const copyLink = async () => {
    if (!storeUrl) return;
    hapticLight();
    await Clipboard.setStringAsync(storeUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const shareLink = async () => {
    if (!storeUrl) return;
    hapticLight();
    try {
      await Share.share({ message: `Shop ${checklist?.handle ? `@${checklist.handle}` : 'my store'} on Brandthread: ${storeUrl}`, url: storeUrl });
    } catch {
      // dismissed
    }
  };

  const downloadQr = async () => {
    if (!storeUrl) return;
    hapticLight();
    const result = await saveImageToCameraRoll(storeQrDataUri(storeUrl), 'brandthread-store-qr');
    if (result.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } else {
      Alert.alert(
        result.reason === 'permission' ? 'Photos access is off' : result.reason === 'unavailable' ? 'Photos unavailable' : 'Could not save the QR code',
        result.reason === 'permission'
          ? 'Allow Photos access in Settings to save your QR code.'
          : result.reason === 'unavailable'
            ? 'Saving to Photos is unavailable in this app build.'
            : 'Try again.',
      );
    }
  };

  const done = () => goBackOr(router, '/launch-checklist');

  return (
    <View style={s.root}>
      <ScreenHeader title={isLive ? 'Your store is live' : 'Publish your store'} />
      {checking && !checklist ? (
        <View style={s.center}><ActivityIndicator color={theme.muted} /></View>
      ) : isLive ? (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[s.scroll, { paddingBottom: tabBarInset + SP.xl }]}
        >
          <View style={s.hero}>
            <Animated.View
              style={[s.ring, {
                opacity: ring.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }),
                transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [1, 2.1] }) }],
              }]}
            />
            <Animated.View style={[s.badge, { transform: [{ scale: pop }] }]}>
              <Feather name="check" size={40} color={theme.onAccent} />
            </Animated.View>
          </View>
          <Text style={s.title}>You're live</Text>
          {storeUrl && <Text style={s.url}>{storeUrl.replace('https://', '')}</Text>}

          {storeUrl && (
            <>
              <View style={s.qrCard}>
                <QRCode value={storeUrl} size={190} backgroundColor={theme.text} color={theme.background} />
              </View>

              <View style={s.actions}>
                <View style={s.cell}>
                  <Button label={copied ? 'Copied' : 'Copy link'} icon={copied ? 'check' : 'copy'} onPress={copyLink} fullWidth />
                </View>
                <View style={s.cell}>
                  <Button label="Share link" icon="share" variant="secondary" onPress={shareLink} fullWidth />
                </View>
              </View>
              <View style={s.wide}>
                <Button
                  label={saved ? (Platform.OS === 'web' ? 'Downloaded' : 'Saved to Photos') : Platform.OS === 'web' ? 'Download QR code' : 'Save QR code'}
                  icon={saved ? 'check' : 'download'}
                  variant="secondary"
                  onPress={downloadQr}
                  fullWidth
                />
              </View>
            </>
          )}

          <View style={s.wide}>
            <Button label="Done" variant="secondary" onPress={done} fullWidth />
          </View>
        </ScrollView>
      ) : (
        <View style={[s.confirm, { paddingBottom: tabBarInset + SP.md }]}>
          <View style={s.confirmBody}>
            <Text style={s.title}>Ready to go live</Text>
            {storeUrl && <Text style={s.url}>{storeUrl.replace('https://', '')}</Text>}
            {problem && <Text style={s.problem}>{problem}</Text>}
          </View>
          {problem && (
            <View style={{ marginBottom: SP.sm }}>
              <Button label="Open publish checks" variant="secondary" onPress={() => router.push('/store-publish' as never)} fullWidth />
            </View>
          )}
          <Button label="Publish store" onPress={publish} loading={publishing} fullWidth />
        </View>
      )}
    </View>
  );
}

const createStyles = (theme: AppThemePreset) => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: SP.md, paddingTop: SP.lg },
  hero: { alignSelf: 'center', width: 96, height: 96, alignItems: 'center', justifyContent: 'center', marginBottom: SP.md },
  ring: { position: 'absolute', width: 96, height: 96, borderRadius: 48, borderWidth: 2, borderColor: theme.muted },
  badge: { width: 88, height: 88, borderRadius: 44, backgroundColor: theme.accent, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: FS.xl, fontFamily: FONT.bold, color: theme.text, textAlign: 'center' },
  url: { fontSize: FS.sm, fontFamily: FONT.medium, color: theme.muted, marginTop: 4, marginBottom: SP.lg, textAlign: 'center' },
  qrCard: { alignSelf: 'center', backgroundColor: theme.text, borderRadius: RADIUS.lg, padding: SP.md, marginBottom: SP.lg },
  actions: { flexDirection: 'row', gap: SP.sm },
  cell: { flex: 1 },
  wide: { marginTop: SP.sm },
  confirm: { flex: 1, paddingHorizontal: SP.md },
  confirmBody: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  problem: { fontSize: FS.sm, fontFamily: FONT.regular, color: theme.muted, textAlign: 'center', lineHeight: 19, maxWidth: 300 },
});
