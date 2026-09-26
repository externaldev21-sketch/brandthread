/**
 * Product transfer (A): "Import from Shopify" — connect (read-only scopes),
 * pick products, one tap import. Never touches orders — separate from
 * Fulfillment via Shopify (see app/integrations/shopify-fulfillment.tsx).
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, FlatList,
  ActivityIndicator, Alert, Image, Linking, Switch,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { Header } from '@/components/layout';
import { useApi } from '@/hooks/useApi';

type ShopifyProductRow = {
  shopifyProductId: string;
  title: string;
  image: string | null;
  variantCount: number;
  alreadyImported: boolean;
};

export default function ShopifyImportScreen() {
  const colors = useColors();
  const api = useApi();

  const [loadingStatus, setLoadingStatus] = useState(true);
  const [connected, setConnected] = useState(false);
  const [shopDomain, setShopDomain] = useState('');
  const [connecting, setConnecting] = useState(false);

  const [products, setProducts] = useState<ShopifyProductRow[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [publishActive, setPublishActive] = useState(false);
  const [importing, setImporting] = useState(false);
  const [summary, setSummary] = useState<{ imported: number; updated: number; skipped: Array<{ shopifyProductId: string; reason: string }> } | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const status = await api.shopify.status();
      setConnected(Boolean(status.connected));
    } catch {
      setConnected(false);
    } finally {
      setLoadingStatus(false);
    }
  }, [api]);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  const loadProducts = useCallback(async () => {
    setLoadingProducts(true);
    try {
      const res = await api.shopify.products();
      setProducts(res.products);
      // Select-all default, minus anything already imported.
      setSelected(new Set(res.products.filter((p) => !p.alreadyImported).map((p) => p.shopifyProductId)));
    } catch {
      Alert.alert('Could not load products', 'We could not reach your Shopify store. Try reconnecting.');
    } finally {
      setLoadingProducts(false);
    }
  }, [api]);

  useEffect(() => { if (connected) loadProducts(); }, [connected, loadProducts]);

  async function handleConnect() {
    if (shopDomain.trim().length < 3) {
      Alert.alert('Enter your store', 'Enter your Shopify store domain, e.g. my-brand.myshopify.com');
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setConnecting(true);
    try {
      const { authorizeUrl } = await api.shopify.connectStart(shopDomain.trim(), 'import');
      await Linking.openURL(authorizeUrl);
      // The seller approves in the browser and lands on our callback page.
      // Poll status once they return to the app.
      setTimeout(loadStatus, 4000);
    } catch (err: any) {
      Alert.alert('Could not start connection', String(err?.message ?? 'Please try again.'));
    } finally {
      setConnecting(false);
    }
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleImport() {
    if (selected.size === 0) {
      Alert.alert('Select products', 'Choose at least one product to import.');
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setImporting(true);
    setSummary(null);
    try {
      const result = await api.shopify.importProducts([...selected], publishActive ? 'active' : 'draft');
      setSummary(result);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await loadProducts();
    } catch (err: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Import failed', String(err?.message ?? 'Please try again.'));
    } finally {
      setImporting(false);
    }
  }

  const allSelectableSelected = products.length > 0
    && products.filter((p) => !p.alreadyImported).every((p) => selected.has(p.shopifyProductId));

  return (
    <View style={{ flex: 1 }}>
      <Header title="Import from Shopify" />
      {loadingStatus ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />
      ) : !connected ? (
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
          <View style={[styles.hero, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.heroIcon, { backgroundColor: '#95BF4722' }]}>
              <Feather name="shopping-bag" size={22} color="#5E8E3E" />
            </View>
            <Text style={[styles.heroTitle, { color: colors.foreground }]}>Bring your Shopify catalog over</Text>
            <Text style={[styles.heroSub, { color: colors.mutedForeground }]}>
              Connect your Shopify store to import titles, photos, variants, prices and stock. This only reads your
              catalog — it never touches or forwards orders.
            </Text>
          </View>
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
          <TouchableOpacity
            style={[styles.connectBtn, { backgroundColor: colors.primary, opacity: connecting ? 0.7 : 1 }]}
            onPress={handleConnect}
            disabled={connecting}
            activeOpacity={0.85}
          >
            {connecting ? <ActivityIndicator size="small" color={colors.primaryForeground} /> : <Feather name="link" size={16} color={colors.primaryForeground} />}
            <Text style={[styles.connectBtnText, { color: colors.primaryForeground }]}>{connecting ? 'Opening Shopify…' : 'Connect Shopify'}</Text>
          </TouchableOpacity>
          <Text style={[styles.infoText, { color: colors.mutedForeground }]}>
            Brandthread only asks for read access to your products and inventory here — never order permissions.
          </Text>
        </ScrollView>
      ) : (
        <View style={{ flex: 1 }}>
          <View style={[styles.toolbar, { borderBottomColor: colors.border }]}>
            <TouchableOpacity
              onPress={() => setSelected(allSelectableSelected
                ? new Set()
                : new Set(products.filter((p) => !p.alreadyImported).map((p) => p.shopifyProductId)))}
            >
              <Text style={[styles.toolbarAction, { color: colors.primary }]}>
                {allSelectableSelected ? 'Deselect all' : 'Select all'}
              </Text>
            </TouchableOpacity>
            <View style={styles.publishToggleRow}>
              <Text style={[styles.publishLabel, { color: colors.mutedForeground }]}>Publish as active</Text>
              <Switch value={publishActive} onValueChange={setPublishActive} />
            </View>
          </View>

          {loadingProducts ? (
            <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />
          ) : (
            <FlatList
              data={products}
              keyExtractor={(item) => item.shopifyProductId}
              contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.productRow, { borderColor: colors.border }]}
                  onPress={() => !item.alreadyImported && toggleSelected(item.shopifyProductId)}
                  activeOpacity={item.alreadyImported ? 1 : 0.7}
                >
                  {item.image ? (
                    <Image source={{ uri: item.image }} style={styles.productImage} />
                  ) : (
                    <View style={[styles.productImage, { backgroundColor: colors.secondary, alignItems: 'center', justifyContent: 'center' }]}>
                      <Feather name="image" size={16} color={colors.mutedForeground} />
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.productTitle, { color: colors.foreground }]} numberOfLines={1}>{item.title}</Text>
                    <Text style={[styles.productMeta, { color: colors.mutedForeground }]}>
                      {item.variantCount} variant{item.variantCount === 1 ? '' : 's'}{item.alreadyImported ? ' · Already imported' : ''}
                    </Text>
                  </View>
                  {!item.alreadyImported && (
                    <Feather
                      name={selected.has(item.shopifyProductId) ? 'check-square' : 'square'}
                      size={20}
                      color={selected.has(item.shopifyProductId) ? colors.primary : colors.mutedForeground}
                    />
                  )}
                </TouchableOpacity>
              )}
              ListEmptyComponent={<Text style={[styles.infoText, { color: colors.mutedForeground, marginTop: 30 }]}>No products found in your Shopify store.</Text>}
            />
          )}

          {summary && (
            <View style={[styles.summaryBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.summaryText, { color: colors.foreground }]}>
                Imported {summary.imported} · Updated {summary.updated}{summary.skipped.length ? ` · Skipped ${summary.skipped.length}` : ''}
              </Text>
              {summary.skipped.length > 0 && (
                <Text style={[styles.summarySkipped, { color: colors.mutedForeground }]} numberOfLines={2}>
                  {summary.skipped.map((s) => s.reason).join(' · ')}
                </Text>
              )}
            </View>
          )}

          <View style={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.background }]}>
            <TouchableOpacity
              style={[styles.importBtn, { backgroundColor: colors.primary, opacity: importing || selected.size === 0 ? 0.6 : 1 }]}
              onPress={handleImport}
              disabled={importing || selected.size === 0}
              activeOpacity={0.85}
            >
              {importing ? <ActivityIndicator size="small" color={colors.primaryForeground} /> : <Feather name="download" size={16} color={colors.primaryForeground} />}
              <Text style={[styles.importBtnText, { color: colors.primaryForeground }]}>
                {importing ? 'Importing…' : `Import ${selected.size || ''} product${selected.size === 1 ? '' : 's'}`}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { borderRadius: 16, borderWidth: 1, padding: 20, alignItems: 'center', marginBottom: 20, gap: 8 },
  heroIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  heroTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', textAlign: 'center' },
  heroSub: { fontSize: 13, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 19 },
  label: { fontSize: 12, fontFamily: 'Inter_500Medium', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { borderRadius: 10, borderWidth: 1, padding: 13, fontSize: 14, fontFamily: 'Inter_400Regular', marginBottom: 14 },
  connectBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 10, paddingVertical: 14 },
  connectBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  infoText: { fontSize: 11, fontFamily: 'Inter_400Regular', lineHeight: 16, marginTop: 14, textAlign: 'center' },
  toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1 },
  toolbarAction: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  publishToggleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  publishLabel: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  productRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 12, padding: 10, marginBottom: 8 },
  productImage: { width: 44, height: 44, borderRadius: 8 },
  productTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  productMeta: { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 2 },
  summaryBar: { position: 'absolute', bottom: 76, left: 16, right: 16, borderWidth: 1, borderRadius: 12, padding: 12 },
  summaryText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  summarySkipped: { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 4 },
  footer: { position: 'absolute', bottom: 0, left: 0, right: 0, borderTopWidth: 1, padding: 16 },
  importBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 10, paddingVertical: 14 },
  importBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
});
