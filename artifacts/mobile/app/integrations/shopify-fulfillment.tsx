/**
 * Fulfillment via Shopify (B) — Seller Settings. Opt-in: turning this on
 * upgrades the seller's Shopify connection (or starts one) with order-write
 * scopes, then forwards paid Brandthread orders to Shopify so a fulfillment
 * app already installed there (Tapstitch, Printful, Printify, …) fulfills
 * them automatically, with tracking synced back. Separate from "Import from
 * Shopify" on the Products page — this never touches the catalog.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, Switch, Linking, TextInput } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { Header } from '@/components/layout';
import { useApi } from '@/hooks/useApi';
import { BrandthreadCard, LoadingSkeleton, SkeletonText } from '@/components/BrandthreadUI';
import { COMP } from '@/lib/theme';

export default function ShopifyFulfillmentScreen() {
  const colors = useColors();
  const api = useApi();

  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<{
    connected: boolean; shopDomain?: string; fulfillmentEnabled: boolean; fulfillmentEligible: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [shopDomain, setShopDomain] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await api.shopify.status();
      setStatus(res);
    } catch {
      setStatus({ connected: false, fulfillmentEnabled: false, fulfillmentEligible: false });
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { load(); }, [load]);

  async function handleToggle(value: boolean) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
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
        setTimeout(load, 4000);
        return;
      }
      const res = await api.shopify.fulfillmentEnable();
      if (res.needsUpgrade) {
        const { authorizeUrl } = await api.shopify.connectStart(status.shopDomain ?? '', 'fulfillment');
        await Linking.openURL(authorizeUrl);
        setTimeout(load, 4000);
        return;
      }
      await load();
    } catch (err: any) {
      Alert.alert('Could not update fulfillment', String(err?.message ?? 'Please try again.'));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <View style={{ flex: 1 }}>
        <Header title="Fulfillment connections" />
        <View style={{ padding: 20, gap: 16 }}>
          <LoadingSkeleton height={92} />
          <LoadingSkeleton height={160} />
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <Header title="Fulfillment connections" />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
        <BrandthreadCard>
          <View style={styles.rowHeader}>
            <View style={[styles.iconWrap, { backgroundColor: '#95BF4722' }]}>
              <Feather name="shopping-bag" size={18} color="#5E8E3E" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>Fulfill orders through my Shopify store</Text>
              <Text style={[styles.cardSub, { color: colors.mutedForeground }]}>
                {status?.connected ? `Connected to ${status.shopDomain}` : 'Not connected'}
              </Text>
            </View>
            <Switch
              value={Boolean(status?.fulfillmentEnabled)}
              onValueChange={handleToggle}
              disabled={busy}
            />
          </View>

          {!status?.connected && (
            <>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>Shopify store domain</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.secondary, color: colors.foreground, borderColor: colors.border }]}
                placeholder="my-brand.myshopify.com"
                placeholderTextColor={colors.mutedForeground}
                value={shopDomain}
                onChangeText={setShopDomain}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </>
          )}
        </BrandthreadCard>

        <BrandthreadCard style={{ marginTop: 16 }}>
          <View style={styles.rowHeader}>
            <View style={[styles.iconWrap, { backgroundColor: `${colors.primary}18` }]}>
              <Feather name="package" size={18} color={colors.primary} />
            </View>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Using Tapstitch, Printful, or Printify?</Text>
          </View>
          {[
            'Turn this on and connect (or reuse) your Shopify store.',
            'Keep your fulfillment app (Tapstitch, Printful, Printify, …) installed and configured on that Shopify store, same as today.',
            'When a Brandthread order for a linked product is paid, we create it in your Shopify store — your fulfillment app picks it up and ships it automatically, and tracking flows back here.',
          ].map((step, i) => (
            <View key={i} style={styles.stepRow}>
              <View style={[styles.stepBadge, { backgroundColor: `${colors.primary}18` }]}>
                <Text style={[styles.stepBadgeText, { color: colors.primary }]}>{i + 1}</Text>
              </View>
              <Text style={[styles.explainerStep, { color: colors.mutedForeground }]}>{step}</Text>
            </View>
          ))}
          <Text style={[styles.footNote, { color: colors.mutedForeground }]}>
            Tapstitch doesn't offer a direct API — this is how orders reach it (and any other Shopify fulfillment app) from Brandthread.
          </Text>
        </BrandthreadCard>

        {status?.connected && (
          <TouchableOpacity
            style={styles.disconnectBtn}
            onPress={() => Alert.alert('Disconnect Shopify?', 'This turns off fulfillment forwarding and disconnects your store.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Disconnect', style: 'destructive', onPress: async () => { await api.shopify.disconnect(); await load(); } },
            ])}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
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
  iconWrap: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  cardSub: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  label: { fontSize: 11, fontFamily: 'Inter_500Medium', marginTop: 6, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { borderRadius: 10, borderWidth: 1, padding: 12, fontSize: 14, fontFamily: 'Inter_400Regular' },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 10 },
  stepBadge: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  stepBadgeText: { fontSize: 11, fontFamily: 'Inter_700Bold' },
  explainerStep: { flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 18 },
  footNote: { fontSize: 11, fontFamily: 'Inter_400Regular', lineHeight: 16, marginTop: 4, fontStyle: 'italic' },
  disconnectBtn: { alignItems: 'center', justifyContent: 'center', minHeight: COMP.minTouchTarget, paddingVertical: 16 },
  disconnectText: { fontSize: 13, fontFamily: 'Inter_500Medium' },
});
