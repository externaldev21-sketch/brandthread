/**
 * Brandthread — Integrations
 * Lists third-party integrations with real connected status from backend.
 */
import React, { useState, useCallback } from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Feather } from '@expo/vector-icons';
import { useApi } from '@/lib/api';
import * as Haptics from 'expo-haptics';
import { FONT, FS, RADIUS } from '@/lib/theme';

interface IntegrationDef {
  key: string;
  label: string;
  icon: keyof typeof Feather.glyphMap;
  iconBg: string;
  description: string;
  route?: string;
  /** No real OAuth flow exists yet — show a non-tappable "Coming soon" chip instead of a fake Connect action. */
  comingSoon?: boolean;
  /** Auto-connected by the platform; never offers a Connect/Disconnect action. */
  autoConnected?: boolean;
}

const INTEGRATION_DEFS: IntegrationDef[] = [
  { key: 'klaviyo',     label: 'Klaviyo',      icon: 'mail',         iconBg: '#1A1A1A', description: 'Email & SMS marketing automation', route: '/integrations/klaviyo' },
  { key: 'instagram',   label: 'Instagram',    icon: 'instagram',    iconBg: '#D62976', description: 'Sync products to Instagram Shopping', comingSoon: true },
  { key: 'tiktok',      label: 'TikTok Shop',  icon: 'music',        iconBg: '#0B0B0B', description: 'Sell through TikTok\'s shopping channel', comingSoon: true },
  { key: 'shopify',     label: 'Shopify',      icon: 'shopping-bag', iconBg: '#95BF47', description: 'Import your Shopify catalog and orders', comingSoon: true },
  { key: 'stripe',      label: 'Stripe',       icon: 'credit-card',  iconBg: '#635BFF', description: 'Payments and payouts (auto-connected)', autoConnected: true },
  { key: 'shipstation', label: 'ShipStation',  icon: 'truck',        iconBg: '#4A5568', description: 'Multi-carrier shipping management', comingSoon: true },
  { key: 'mailchimp',   label: 'Mailchimp',    icon: 'mail',         iconBg: '#FFE01B', description: 'Email campaigns and audience management', comingSoon: true },
  { key: 'google',      label: 'Google Ads',   icon: 'search',       iconBg: '#4285F4', description: 'Track conversions and run shopping ads', comingSoon: true },
  { key: 'meta',        label: 'Meta Ads',     icon: 'target',       iconBg: '#1877F2', description: 'Facebook and Instagram ad integration', comingSoon: true },
];

export default function IntegrationsScreen() {
  const colors = useColors();
  const router = useRouter();
  const api = useApi();
  const [connectedKeys, setConnectedKeys] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.seller.integrationStatus() as any;
      const integrations: Array<{ key: string }> = data.integrations ?? [];
      setConnectedKeys(new Set(integrations.map(i => i.key)));
    } catch {
      setConnectedKeys(new Set());
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(useCallback(() => { load(); }, []));

  async function handleConnect(item: IntegrationDef) {
    if (item.comingSoon || item.autoConnected) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (item.route) { router.push(item.route as never); return; }

    const isConnected = connectedKeys.has(item.key);
    if (isConnected) {
      Alert.alert(`Disconnect ${item.label}?`, 'This will remove the integration from your store.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect', style: 'destructive',
          onPress: async () => {
            setToggling(item.key);
            try {
              await api.seller.disconnectIntegration(item.key) as any;
              setConnectedKeys(prev => { const next = new Set(prev); next.delete(item.key); return next; });
            } catch { Alert.alert('Error', 'Could not disconnect. Try again.'); }
            finally { setToggling(null); }
          },
        },
      ]);
    } else {
      Alert.alert(
        `Connect ${item.label}`,
        `Connect your ${item.label} account to sync data with Brandthread.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Connect',
            onPress: async () => {
              setToggling(item.key);
              try {
                await api.seller.connectIntegration(item.key, {}) as any;
                setConnectedKeys(prev => new Set([...prev, item.key]));
              } catch { Alert.alert('Error', 'Could not connect. Try again.'); }
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
          <Text style={[s.sectionSubtitle, { color: colors.mutedForeground }]}>
            Connect the tools you already use to run your brand — sales channels, marketing, and shipping in one place.
          </Text>

          {loading ? (
            <View style={s.loadingRow}><ActivityIndicator color={colors.primary} /></View>
          ) : (
            <View style={[s.listCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {INTEGRATION_DEFS.map((item, i) => {
                const connected = connectedKeys.has(item.key);
                const isToggling = toggling === item.key;
                const isInert = item.comingSoon || item.autoConnected;
                return (
                  <TouchableOpacity
                    key={item.key}
                    onPress={() => handleConnect(item)}
                    activeOpacity={isInert ? 1 : 0.7}
                    disabled={item.comingSoon}
                    style={[s.row, i !== INTEGRATION_DEFS.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border }]}
                  >
                    <View style={[s.iconWrap, { backgroundColor: item.iconBg }, item.comingSoon && { opacity: 0.5 }]}>
                      <Feather name={item.icon} size={15} color="#FFFFFF" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[s.rowLabel, { color: colors.foreground }, item.comingSoon && { color: colors.mutedForeground }]}>{item.label}</Text>
                      <Text style={[s.rowDesc, { color: colors.mutedForeground }]} numberOfLines={1}>{item.description}</Text>
                    </View>
                    {item.comingSoon ? (
                      <View style={[s.connectBtn, { borderColor: colors.border }]}>
                        <Text style={[s.connectBtnText, { color: colors.mutedForeground }]}>Coming soon</Text>
                      </View>
                    ) : isToggling ? (
                      <ActivityIndicator size="small" color={colors.primary} />
                    ) : (connected || item.autoConnected) ? (
                       <View style={[s.connectedPill, { backgroundColor: `${colors.success}26` }]}>
                         <View style={[s.dot, { backgroundColor: colors.success }]} />
                         <Text style={[s.connectedText, { color: colors.success }]}>Connected</Text>
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
          {!loading && (
            <Text style={[s.footerNote, { color: colors.mutedForeground }]}>
              {connectedKeys.size} of {INTEGRATION_DEFS.length} integrations connected
            </Text>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  section: { paddingHorizontal: 20, paddingVertical: 18 },
  sectionSubtitle: { fontSize: 12, fontFamily: FONT.regular, lineHeight: 17, marginBottom: 16 },
  loadingRow: { alignItems: 'center', paddingVertical: 30 },
  listCard: { borderRadius: RADIUS.lg, borderWidth: 1, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 14 },
  iconWrap: { width: 34, height: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { fontSize: 14, fontFamily: FONT.semibold },
  rowDesc: { fontSize: 11, fontFamily: FONT.regular, marginTop: 2 },
  connectedPill: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 20, paddingHorizontal: 9, paddingVertical: 4 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  connectedText: { fontSize: 11, fontFamily: FONT.semibold },
  connectBtn: { borderWidth: 1, borderRadius: RADIUS.sm, paddingHorizontal: 12, paddingVertical: 7 },
  connectBtnText: { fontSize: 12, fontFamily: FONT.semibold },
  footerNote: { fontSize: FS.xs, fontFamily: FONT.regular, textAlign: 'center', marginTop: 12 },
});
