/**
 * Fulfillment via Shopify (B) — Seller Settings. Opt-in: turning this on
 * upgrades the seller's Shopify connection (or starts one) with order-write
 * scopes, then forwards paid Brandthread orders to Shopify so a fulfillment
 * app already installed there (Tapstitch, Printful, Printify, …) fulfills
 * them automatically, with tracking synced back. Separate from "Import from
 * Shopify" on the Products page — this never touches the catalog.
 */
import React, { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, Linking, TextInput, AppState } from 'react-native';

import { useFocusEffect } from 'expo-router';

import { RetryRow } from '@/components/ui/RetryRow';

import { Icon } from '@/components/ui/Icon';

import { Feather } from '@expo/vector-icons';

import { useColors } from '@/hooks/useColors';

import { ScreenHeader } from '@/components/ScreenHeader';

import { useApi } from '@/hooks/useApi';

import { BrandthreadCard, LoadingSkeleton, SkeletonText, HapticSwitch } from '@/components/BrandthreadUI';

import { COMP, FS, SP, FONT } from '@/lib/theme';

export default function ShopifyFulfillmentScreen() {
  const colors = useColors();
  const api = useApi();

  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<{
    connected: boolean; shopDomain?: string; fulfillmentEnabled: boolean; fulfillmentEligible: boolean;
    lastError?: string | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [shopDomain, setShopDomain] = useState('');
  // A failed status call is not "Not connected": keep the last known status
  // (if any) and offer a retry instead.
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.shopify.status();
      setStatus(res);
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [api]);

  const retry = useCallback(() => {
    // Nothing on screen yet: show the skeleton while retrying.
    if (!status) setLoading(true);
    void load();
  }, [load, status]);

  // Shopify's OAuth runs in the browser: re-check whenever the seller comes
  // back to this screen or to the app, instead of guessing with a timer.
  useFocusEffect(useCallback(() => {
    void load();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void load();
    });
    return () => sub.remove();
  }, [load]));

  async function handleToggle(value: boolean) {
    setBusy(true);
    try {
      if (!value) {
        await api.shopify.fulfillmentDisable();
        await load();
        return;
      }
      if (!status?.connected) {
        if (shopDomain.trim().length < 3) {
          Alert.alert('Enter your store', 'Enter your Shopify store domain to connect it first.');
          return;
        }
        const { authorizeUrl } = await api.shopify.connectStart(shopDomain.trim(), 'fulfillment');
        await Linking.openURL(authorizeUrl);
        return;
      }
      const res = await api.shopify.fulfillmentEnable();
      if (res.needsUpgrade) {
        const { authorizeUrl } = await api.shopify.connectStart(status.shopDomain ?? '', 'fulfillment');
        await Linking.openURL(authorizeUrl);
        return;
      }
      if (res.warning) Alert.alert('Tracking sync not set up', String(res.warning));
      await load();
    } catch (err: any) {
      // Show the server's reason (e.g. "Shopify connections are not configured yet") without the "API 503:" wire prefix.
      Alert.alert('Could not update fulfillment', String(err?.message ?? 'Please try again.').replace(/^API \d{3}:\s*/, '') || 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <ScreenHeader title="Fulfillment connections" />
        <View style={{ padding: SP.md, gap: 16 }}>
          <LoadingSkeleton height={92} />
          <LoadingSkeleton height={160} />
        </View>
      </View>
    );
  }

  if (!status) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <ScreenHeader title="Fulfillment connections" />
        <View style={{ padding: SP.md }}>
          <RetryRow label="Couldn't load your Shopify connection" onRetry={retry} testID="shopify-fulfillment-retry" />
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader title="Fulfillment connections" />
      <ScrollView contentContainerStyle={{ padding: SP.md, paddingBottom: 60 }}>
        {loadError && (
          <RetryRow label="Couldn't refresh your Shopify connection" onRetry={retry} style={{ marginBottom: 16 }} testID="shopify-fulfillment-refresh-retry" />
        )}
        <BrandthreadCard>
          <View style={styles.rowHeader}>
            <View style={[styles.iconWrap, { backgroundColor: `${colors.primary}18` }]}>
              <Icon name="shopping-bag" size={18} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>Fulfill orders through my Shopify store</Text>
              <Text style={[styles.cardSub, { color: colors.mutedForeground }]}>
                {status?.connected ? `Connected to ${status.shopDomain}` : 'Not connected'}
              </Text>
              {status?.connected && status.lastError ? (
                <Text style={[styles.cardSub, { color: colors.destructive }]}>{status.lastError}</Text>
              ) : null}
            </View>
            <HapticSwitch
              value={Boolean(status?.fulfillmentEnabled)}
              onValueChange={handleToggle}
              disabled={busy}
              accessibilityLabel="Fulfill orders through my Shopify store"
            />
          </View>

          {!status?.connected && (
            <>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>Shopify store domain</Text>
              <TextInput returnKeyType="done"
                style={[styles.input, { backgroundColor: colors.secondary, color: colors.foreground, borderColor: colors.border }]}
                placeholder="my-brand.myshopify.com"
                placeholderTextColor={colors.mutedForeground}
                value={shopDomain}
                onChangeText={setShopDomain}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                accessibilityLabel="Shopify store domain"
              />
            </>
          )}
        </BrandthreadCard>

        <BrandthreadCard style={{ marginTop: 16 }}>
          <View style={styles.rowHeader}>
            <View style={[styles.iconWrap, { backgroundColor: `${colors.primary}18` }]}>
              <Icon name="package" size={18} color={colors.primary} />
            </View>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Using Tapstitch, Printful, or Printify?</Text>
          </View>
          {[
            'Turn this on and connect your Shopify store.',
            'Keep your fulfillment app installed on that store.',
            'Paid orders are sent to Shopify, your app ships them, and tracking syncs back here.',
          ].map((step, i) => (
            <View key={i} style={styles.stepRow}>
              <View style={[styles.stepBadge, { backgroundColor: `${colors.primary}18` }]}>
                <Text style={[styles.stepBadgeText, { color: colors.primary }]}>{i + 1}</Text>
              </View>
              <Text style={[styles.explainerStep, { color: colors.mutedForeground }]}>{step}</Text>
            </View>
          ))}
        </BrandthreadCard>

        {status?.connected && (
          <TouchableOpacity
            style={styles.disconnectBtn}
            onPress={() => Alert.alert('Disconnect Shopify?', 'This turns off fulfillment forwarding and disconnects your store.', [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Disconnect', style: 'destructive', onPress: async () => {
                  try { await api.shopify.disconnect(); await load(); }
                  catch { Alert.alert('Couldn’t disconnect Shopify', 'Check your connection and try again.'); }
                },
              },
            ])}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
          >
            <Text style={[styles.disconnectText, { color: colors.destructive }]}>Disconnect Shopify</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  rowHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10, minHeight: COMP.minTouchTarget },
  iconWrap: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: FS.base, fontFamily: FONT.semibold },
  cardSub: { fontSize: 12, fontFamily: FONT.regular, marginTop: 2 },
  label: { fontSize: 11, fontFamily: FONT.medium, marginTop: 6, marginBottom: 8 },
  input: { borderRadius: 8, borderWidth: 1, padding: 12, fontSize: 15, fontFamily: FONT.regular },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 10 },
  stepBadge: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  stepBadgeText: { fontSize: 11, fontFamily: FONT.bold },
  explainerStep: { flex: 1, fontSize: 12, fontFamily: FONT.regular, lineHeight: 18 },
  disconnectBtn: { alignItems: 'center', justifyContent: 'center', minHeight: COMP.minTouchTarget, paddingVertical: 16 },
  disconnectText: { fontSize: 13, fontFamily: FONT.medium },
});
