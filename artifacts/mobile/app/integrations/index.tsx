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
import { ApiError } from '@/lib/networkNotice';
import * as Haptics from 'expo-haptics';
import { FONT, FS, ICON, RADIUS } from '@/lib/theme';

interface IntegrationDef {
  key: string;
  label: string;
  icon: keyof typeof Feather.glyphMap;
  description: string;
  route?: string;
  /** Auto-connected by the platform; never offers a Connect/Disconnect action. */
  autoConnected?: boolean;
}

// Only integrations with a real, working connect flow ship here — no
// "Coming soon" placeholder rows for OAuth flows that don't exist yet.
const INTEGRATION_DEFS: IntegrationDef[] = [
  { key: 'klaviyo', label: 'Klaviyo', icon: 'mail', description: 'Email & SMS marketing automation', route: '/integrations/klaviyo' },
  // Description omits "(auto-connected)" — it clipped at the row's
  // available width, and the "Connected" pill already says as much.
  { key: 'stripe', label: 'Stripe', icon: 'credit-card', description: 'Payments and payouts', autoConnected: true },
];

export default function IntegrationsScreen() {
  const colors = useColors();
  const router = useRouter();
  const api = useApi();
  const [connectedKeys, setConnectedKeys] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const data = await api.seller.integrationStatus() as any;
      const integrations: Array<{ key: string }> = data.integrations ?? [];
      setConnectedKeys(new Set(integrations.map(i => i.key)));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        // No session yet (e.g. a fresh/demo preview) — that just means
        // nothing is connected, not that the list failed to load.
        setConnectedKeys(new Set());
      } else {
        setLoadError(true);
      }
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(useCallback(() => { load(); }, []));

  async function handleConnect(item: IntegrationDef) {
    if (item.autoConnected) return;
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
          ) : loadError ? (
            <View style={s.errorBox}>
              <Feather name="alert-circle" size={ICON.md} color={colors.mutedForeground} />
              <Text style={[s.errorText, { color: colors.mutedForeground }]}>Couldn't load your integrations.</Text>
              <TouchableOpacity onPress={load} style={[s.retryBtn, { borderColor: colors.border }]}>
                <Text style={[s.retryBtnText, { color: colors.foreground }]}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={[s.listCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {INTEGRATION_DEFS.map((item, i) => {
                const connected = connectedKeys.has(item.key);
                const isToggling = toggling === item.key;
                return (
                  <TouchableOpacity
                    key={item.key}
                    onPress={() => handleConnect(item)}
                    activeOpacity={item.autoConnected ? 1 : 0.7}
                    style={[s.row, i !== INTEGRATION_DEFS.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border }]}
                  >
                    <View style={s.iconWrap}>
                      <Feather name={item.icon} size={ICON.sm} color="#FFFFFF" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[s.rowLabel, { color: colors.foreground }]}>{item.label}</Text>
                      <Text style={[s.rowDesc, { color: colors.mutedForeground }]} numberOfLines={1}>{item.description}</Text>
                    </View>
                    {isToggling ? (
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
          {!loading && !loadError && (
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
  errorBox: { alignItems: 'center', gap: 10, paddingVertical: 30 },
  errorText: { fontSize: FS.sm, fontFamily: FONT.regular },
  retryBtn: { borderWidth: 1, borderRadius: RADIUS.sm, paddingHorizontal: 16, paddingVertical: 8, marginTop: 2 },
  retryBtnText: { fontSize: FS.sm, fontFamily: FONT.semibold },
  listCard: { borderRadius: RADIUS.lg, borderWidth: 1, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 14 },
  iconWrap: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { fontSize: FS.sm, fontFamily: FONT.semibold },
  rowDesc: { fontSize: 11, fontFamily: FONT.regular, marginTop: 2 },
  connectedPill: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 20, paddingHorizontal: 9, paddingVertical: 4 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  connectedText: { fontSize: 11, fontFamily: FONT.semibold },
  connectBtn: { borderWidth: 1, borderRadius: RADIUS.sm, paddingHorizontal: 12, paddingVertical: 7 },
  connectBtnText: { fontSize: 12, fontFamily: FONT.semibold },
  footerNote: { fontSize: FS.xs, fontFamily: FONT.regular, textAlign: 'center', marginTop: 12 },
});
