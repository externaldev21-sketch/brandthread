import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView,
  ActivityIndicator, Alert, Linking, Platform,
} from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useApi } from '@/hooks/useApi';

type KlaviyoStatus = {
  connected: boolean;
  companyName?: string | null;
  emailSubscriberCount?: number;
  smsSubscriberCount?: number;
  listCount?: number;
  lastSyncedAt?: string | null;
};

export default function KlaviyoIntegrationScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const api = useApi();

  const [status, setStatus] = useState<KlaviyoStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [apiKey, setApiKey] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.integrations.klaviyoStatus();
      setStatus(res);
    } catch {
      setStatus({ connected: false });
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { load(); }, [load]);

  async function handleConnect() {
    if (apiKey.trim().length < 6) {
      Alert.alert('Enter your API key', 'Paste the Private API Key from your Klaviyo account settings.');
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setConnecting(true);
    try {
      const res = await api.integrations.klaviyoConnect(apiKey.trim());
      setStatus(res);
      setApiKey('');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Connected', 'Your existing Klaviyo email & SMS subscribers are now synced.');
    } catch (err: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const msg = String(err?.message ?? '');
      Alert.alert(
        'Connection failed',
        msg.includes('401') || msg.toLowerCase().includes('invalid')
          ? 'That API key was rejected by Klaviyo. Double-check it and try again.'
          : 'Could not reach Klaviyo. Please try again in a moment.',
      );
    } finally {
      setConnecting(false);
    }
  }

  async function handleSync() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSyncing(true);
    try {
      const res = await api.integrations.klaviyoSync();
      setStatus(res);
    } catch {
      Alert.alert('Sync failed', 'Could not refresh subscriber counts from Klaviyo.');
    } finally {
      setSyncing(false);
    }
  }

  function handleDisconnect() {
    Alert.alert('Disconnect Klaviyo', 'Your Klaviyo account will be disconnected from Brandthread. Your subscribers stay safe in Klaviyo.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disconnect', style: 'destructive', onPress: async () => {
          await api.integrations.klaviyoDisconnect();
          setStatus({ connected: false });
        },
      },
    ]);
  }

  const topPad = Platform.OS === 'web' ? 24 : insets.top;

  return (
    <View style={[styles.container, { backgroundColor: 'transparent' }]}>
      <View style={[styles.header, { paddingTop: topPad + 12 }]}>
        <TouchableOpacity hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} onPress={() => router.back()}>
          <Feather name="chevron-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Klaviyo</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
        <View style={[styles.hero, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.heroIcon, { backgroundColor: `${colors.primary}22` }]}>
            <Feather name="zap" size={22} color={colors.primary} />
          </View>
          <Text style={[styles.heroTitle, { color: colors.foreground }]}>Klaviyo: Email Marketing & SMS</Text>
          <Text style={[styles.heroSub, { color: colors.mutedForeground }]}>
            Connect your existing Klaviyo account so the email and SMS subscribers you already built keep working here.
          </Text>
        </View>

        {loading ? (
          <ActivityIndicator style={{ marginTop: 24 }} color={colors.primary} />
        ) : status?.connected ? (
          <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.connectedRow}>
              <View style={[styles.dot, { backgroundColor: colors.success }]} />
              <Text style={[styles.connectedText, { color: colors.foreground }]}>
                Connected{status.companyName ? ` · ${status.companyName}` : ''}
              </Text>
            </View>

            <View style={styles.statsRow}>
              <View style={styles.statBox}>
                <Text style={[styles.statVal, { color: colors.foreground }]}>{(status.emailSubscriberCount ?? 0).toLocaleString()}</Text>
                <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Email subs</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={[styles.statVal, { color: colors.foreground }]}>{(status.smsSubscriberCount ?? 0).toLocaleString()}</Text>
                <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>SMS subs</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={[styles.statVal, { color: colors.foreground }]}>{status.listCount ?? 0}</Text>
                <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Lists</Text>
              </View>
            </View>

            {status.lastSyncedAt != null && (
              <Text style={[styles.syncedText, { color: colors.mutedForeground }]}>
                Last synced {new Date(status.lastSyncedAt).toLocaleString()}
              </Text>
            )}

            <TouchableOpacity
              style={[styles.secondaryBtn, { borderColor: colors.border, opacity: syncing ? 0.6 : 1 }]}
              onPress={handleSync}
              disabled={syncing}
              activeOpacity={0.8}
            >
              {syncing ? <ActivityIndicator size="small" color={colors.foreground} /> : <Feather name="refresh-cw" size={15} color={colors.foreground} />}
              <Text style={[styles.secondaryBtnText, { color: colors.foreground }]}>{syncing ? 'Syncing…' : 'Sync subscribers'}</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.disconnectBtn} onPress={handleDisconnect} activeOpacity={0.7}>
              <Text style={[styles.disconnectText, { color: colors.destructive }]}>Disconnect Klaviyo</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>Klaviyo Private API Key</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.secondary, color: colors.foreground, borderColor: colors.border }]}
              placeholder="pk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              placeholderTextColor={colors.mutedForeground}
              value={apiKey}
              onChangeText={setApiKey}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
            />
            <TouchableOpacity
              style={[styles.connectBtn, { backgroundColor: colors.primary, opacity: connecting ? 0.7 : 1 }]}
              onPress={handleConnect}
              disabled={connecting}
              activeOpacity={0.85}
            >
              {connecting ? <ActivityIndicator size="small" color={colors.primaryForeground} /> : <Feather name="link" size={16} color={colors.primaryForeground} />}
              <Text style={[styles.connectBtnText, { color: colors.primaryForeground }]}>{connecting ? 'Connecting…' : 'Connect Klaviyo'}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.helpRow}
              onPress={() => Linking.openURL('https://help.klaviyo.com/hc/en-us/articles/115005062267')}
              activeOpacity={0.7}
            >
              <Feather name="external-link" size={13} color={colors.primary} />
              <Text style={[styles.helpText, { color: colors.primary }]}>Where do I find my Private API Key?</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.infoBlock}>
          <Feather name="shield" size={14} color={colors.mutedForeground} />
          <Text style={[styles.infoText, { color: colors.mutedForeground }]}>
            Your key is stored securely and only used to sync subscriber data from your Klaviyo account. We never post on your behalf.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 16 },
  headerTitle: { fontSize: 17, fontFamily: 'Inter_600SemiBold' },

  hero: { borderRadius: 16, borderWidth: 1, padding: 20, alignItems: 'center', marginBottom: 20, gap: 8 },
  heroIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  heroTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', textAlign: 'center' },
  heroSub: { fontSize: 13, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 19 },

  section: { borderRadius: 14, borderWidth: 1, padding: 18 },
  label: { fontSize: 12, fontFamily: 'Inter_500Medium', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { borderRadius: 10, borderWidth: 1, padding: 13, fontSize: 14, fontFamily: 'Inter_400Regular', marginBottom: 14 },
  connectBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 10, paddingVertical: 14 },
  connectBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  helpRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 14 },
  helpText: { fontSize: 12, fontFamily: 'Inter_500Medium' },

  connectedRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  connectedText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  statsRow: { flexDirection: 'row', marginBottom: 12 },
  statBox: { flex: 1, alignItems: 'center', gap: 3 },
  statVal: { fontSize: 20, fontFamily: 'Inter_700Bold' },
  statLabel: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  syncedText: { fontSize: 11, fontFamily: 'Inter_400Regular', textAlign: 'center', marginBottom: 16 },
  secondaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 10, borderWidth: 1, paddingVertical: 12, marginBottom: 10 },
  secondaryBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  disconnectBtn: { alignItems: 'center', paddingVertical: 8 },
  disconnectText: { fontSize: 13, fontFamily: 'Inter_500Medium' },

  infoBlock: { flexDirection: 'row', gap: 8, marginTop: 20, paddingHorizontal: 4 },
  infoText: { flex: 1, fontSize: 11, fontFamily: 'Inter_400Regular', lineHeight: 16 },
});
