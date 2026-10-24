import { Button } from '@/components/ui/Button';

/**
 * Brandthread — Integrations
 * Lists third-party integrations with real connected status from backend.
 */
import React, { useState, useCallback } from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Linking } from 'react-native';

import { useFocusEffect, useRouter } from 'expo-router';

import { useColors } from '@/hooks/useColors';

import { ScreenHeader } from '@/components/ScreenHeader';
import { LoadingSkeleton } from '@/components/BrandthreadUI';

import { Icon, type IconName } from '@/components/ui/Icon';

import { useApi } from '@/lib/api';

import { ApiError } from '@/lib/networkNotice';

import * as Haptics from 'expo-haptics';
import { FONT, FS, ICON, RADIUS, SP } from '@/lib/theme';

import { isStripeFullyConnected, normalizeConnectStatus, type ConnectStatus } from '@/lib/stripeConnectStatus';

interface IntegrationDef {
  key: string;
  label: string;
  icon: IconName;
  description: string;
  route?: string;
  /** Connect/Disconnect is a Stripe Connect onboarding link, not the generic flow. */
  isStripe?: boolean;
  /** Status comes from the Shopify fulfillment endpoint, not the generic integrations list. */
  isShopifyFulfillment?: boolean;
}

// Only integrations with a real, working connect flow ship here — no
// "Coming soon" placeholder rows for OAuth flows that don't exist yet.
const INTEGRATION_DEFS: IntegrationDef[] = [
  { key: 'klaviyo', label: 'Klaviyo', icon: 'mail', description: 'Email and SMS marketing', route: '/integrations/klaviyo' },
  { key: 'stripe', label: 'Stripe', icon: 'credit-card', description: 'Payments and payouts', isStripe: true },
  { key: 'shopify-fulfillment', label: 'Shopify fulfillment', icon: 'truck', description: 'Send paid orders to your Shopify fulfillment app', route: '/integrations/shopify-fulfillment', isShopifyFulfillment: true },
];

export default function IntegrationsScreen() {
  const colors = useColors();
  const router = useRouter();
  const api = useApi();
  const [connectedKeys, setConnectedKeys] = useState<Set<string>>(new Set());
  const [stripeStatus, setStripeStatus] = useState<ConnectStatus | null>(null);
  const [shopifyFulfillmentOn, setShopifyFulfillmentOn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const [integrationsData, connectData, shopifyData] = await Promise.all([
        api.seller.integrationStatus() as any,
        api.seller.connect.status().catch(() => null),
        api.shopify.status().catch(() => null),
      ]);
      const integrations: Array<{ key: string }> = integrationsData.integrations ?? [];
      setConnectedKeys(new Set(integrations.map(i => i.key)));
      setStripeStatus(normalizeConnectStatus(connectData));
      setShopifyFulfillmentOn(Boolean(shopifyData?.connected && shopifyData?.fulfillmentEnabled));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        // No session yet (e.g. a fresh/demo preview) — that just means
        // nothing is connected, not that the list failed to load.
        setConnectedKeys(new Set());
        setStripeStatus(null);
        setShopifyFulfillmentOn(false);
      } else {
        setLoadError(true);
      }
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(useCallback(() => { load(); }, []));

  // Count only the integrations this screen lists: the server can report
  // other keys (e.g. a Shopify import), which used to read "3 of 2".
  const connectedCount = INTEGRATION_DEFS.filter((item) => (
    item.isStripe ? isStripeFullyConnected(stripeStatus) : connectedKeys.has(item.key)
  )).length;

  async function handleConnectStripe() {
    setToggling('stripe');
    try {
      const data = await api.seller.connect.onboard();
      if (!data || typeof data.url !== 'string' || !/^https:\/\//i.test(data.url)) {
        Alert.alert("Couldn't open Stripe", "Stripe didn't send a setup link. Try again.");
        return;
      }
      const canOpen = await Linking.canOpenURL(data.url);
      if (!canOpen) throw new Error('Unable to open onboarding link');
      await Linking.openURL(data.url);
      // The seller finishes onboarding in an external browser tab/window;
      // useFocusEffect's load() re-checks real status on return.
    } catch {
      Alert.alert("Couldn't open Stripe", 'Try again.');
    } finally {
      setToggling(null);
    }
  }

  function isConnected(item: IntegrationDef): boolean {
    if (item.isStripe) return isStripeFullyConnected(stripeStatus);
    if (item.isShopifyFulfillment) return shopifyFulfillmentOn;
    return connectedKeys.has(item.key);
  }

  async function handleConnect(item: IntegrationDef) {
    if (item.isStripe) {
      if (!isStripeFullyConnected(stripeStatus)) await handleConnectStripe();
      return;
    }
    if (item.route) { router.push(item.route as never); return; }

    const isConnected = connectedKeys.has(item.key);
    if (isConnected) {
      Alert.alert(`Disconnect ${item.label}?`, 'This will remove the integration from your store.', [
        { text: 'Stay connected', style: 'cancel' },
        {
          text: `Disconnect ${item.label}`, style: 'destructive',
          onPress: async () => {
            setToggling(item.key);
            try {
              await api.seller.disconnectIntegration(item.key) as any;
              setConnectedKeys(prev => { const next = new Set(prev); next.delete(item.key); return next; });
            } catch { Alert.alert(`Couldn't disconnect ${item.label}`, 'Try again.'); }
            finally { setToggling(null); }
          },
        },
      ]);
    } else {
      Alert.alert(
        `Connect ${item.label}`,
        `Connect your ${item.label} account to sync data with Brandthread.`,
        [
          { text: 'Not now', style: 'cancel' },
          {
            text: `Connect ${item.label}`,
            onPress: async () => {
              setToggling(item.key);
              try {
                await api.seller.connectIntegration(item.key, {}) as any;
                setConnectedKeys(prev => new Set([...prev, item.key]));
              } catch { Alert.alert(`Couldn't connect ${item.label}`, 'Try again.'); }
              finally { setToggling(null); }
            },
          },
        ],
      );
    }
  }

  return (
    <View style={[s.container, { backgroundColor: colors.background }]}>
      <ScreenHeader title="Integrations" />
      <ScrollView contentContainerStyle={{ paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
        <View style={s.section}>
          {loading ? (
            <View style={s.loadingRow} accessibilityLabel="Loading integrations">{[0, 1].map((i) => <LoadingSkeleton key={i} height={66} />)}</View>
          ) : loadError ? (
            <View style={s.errorBox}>
              <Icon name="alert-circle" size={ICON.md} color={colors.mutedForeground} />
              <Text style={[s.errorText, { color: colors.mutedForeground }]}>Couldn't load your integrations.</Text>
              <Button label="Retry" variant="secondary" size="compact" onPress={load} style={s.retryBtn} />
            </View>
          ) : (
            <View style={[s.listCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {INTEGRATION_DEFS.map((item, i) => {
                const connected = isConnected(item);
                const isToggling = toggling === item.key;
                return (
                  <TouchableOpacity
                    key={item.key}
                    onPress={() => handleConnect(item)}
                    accessibilityRole="button"
                    accessibilityLabel={`${item.label}, ${connected ? 'connected' : 'not connected'}`}
                    accessibilityHint={connected ? (item.route ? `Opens ${item.label} settings` : undefined) : `Connect ${item.label}`}
                    activeOpacity={connected && !item.route ? 1 : 0.7}
                    accessibilityRole="button"
                    accessibilityLabel={`${item.label}, ${connected ? 'connected' : 'not connected'}`}
                    accessibilityState={{ busy: isToggling }}
                    style={[s.row, i !== INTEGRATION_DEFS.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border }]}
                  >
                    <View style={s.iconWrap}>
                      <Icon name={item.icon} size={ICON.sm} color="#FFFFFF" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[s.rowLabel, { color: colors.foreground }]}>{item.label}</Text>
                      <Text style={[s.rowDesc, { color: colors.mutedForeground }]} numberOfLines={1}>{item.description}</Text>
                    </View>
                    {isToggling ? (
                      <ActivityIndicator size="small" color={colors.primary} />
                    ) : connected ? (
                       <View style={[s.connectedPill, { borderColor: colors.border }]}>
                         <Icon name="check" size={11} color={colors.foreground} />
                         <Text style={[s.connectedText, { color: colors.foreground }]}>Connected</Text>
                      </View>
                    ) : (
                      <View style={[s.connectBtn, { borderColor: colors.border }]}>
                        <Text style={[s.connectBtnText, { color: colors.foreground }]}>Connect</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {/* Connected count summary */}
          {!loading && !loadError && (
            <Text style={[s.footerNote, { color: colors.mutedForeground }]}>
              {INTEGRATION_DEFS.filter(isConnected).length} of {INTEGRATION_DEFS.length} integrations connected
            </Text>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  section: { paddingHorizontal: SP.md, paddingVertical: 18 },
  loadingRow: { gap: SP.sm },
  errorBox: { alignItems: 'center', gap: 10, paddingVertical: 30 },
  errorText: { fontSize: FS.sm, fontFamily: FONT.regular },
  retryBtn: { borderWidth: 1, borderRadius: RADIUS.sm, paddingHorizontal: 16, minHeight: 44, justifyContent: 'center', marginTop: 2 },
  retryBtnText: { fontSize: FS.sm, fontFamily: FONT.semibold },
  listCard: { borderRadius: RADIUS.lg, borderWidth: 1, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 16 },
  iconWrap: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { fontSize: FS.sm, fontFamily: FONT.semibold },
  rowDesc: { fontSize: 11, fontFamily: FONT.regular, marginTop: 2 },
  connectedPill: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 16, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 4 },
  connectedText: { fontSize: 11, fontFamily: FONT.semibold },
  connectBtn: { borderWidth: 1, borderRadius: RADIUS.sm, paddingHorizontal: 12, paddingVertical: 7 },
  connectBtnText: { fontSize: FS.sm, fontFamily: FONT.semibold },
  footerNote: { fontSize: FS.xs, fontFamily: FONT.regular, textAlign: 'center', marginTop: 12 },
});
