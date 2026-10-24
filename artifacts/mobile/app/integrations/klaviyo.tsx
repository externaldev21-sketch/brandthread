import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, Alert, Linking } from 'react-native';

import { useColors } from '@/hooks/useColors';

import { Icon } from '@/components/ui/Icon';
import { LoadingSkeleton } from '@/components/BrandthreadUI';
import { ErrorState } from '@/components/ui/ErrorState';

import { useRouter } from 'expo-router';

import { haptics, haptic } from '@/lib/haptics';


import { useApi } from '@/hooks/useApi';
import { ApiError } from '@/lib/networkNotice';

import { ScreenHeader } from '@/components/ScreenHeader';
import { showToast } from '@/lib/toast';

import { FS, FONT, FILL_ELEVATED, TEXT_DISABLED } from '@/lib/theme';

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
  const router = useRouter();
  const api = useApi();

  const [status, setStatus] = useState<KlaviyoStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const res = await api.integrations.klaviyoStatus();
      setStatus(res);
    } catch {
      // Don't show the connect form on a failed load — a connected seller
      // would be told Klaviyo isn't connected.
      setLoadError(true);
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
    setConnecting(true);
    try {
      const res = await api.integrations.klaviyoConnect(apiKey.trim());
      setStatus(res);
      setApiKey('');
      
      showToast('Klaviyo connected', 'Your existing email & SMS subscribers are now synced.');
    } catch (err: any) {
      haptic('error');
      const msg = String(err?.message ?? '');
      const rejected = (err instanceof ApiError && (err.status === 400 || err.status === 401))
        || msg.includes('401') || msg.toLowerCase().includes('invalid');
      Alert.alert(
        'Connection failed',
        rejected
          ? 'That API key was rejected by Klaviyo. Double-check it and try again.'
          : 'Could not reach Klaviyo. Please try again in a moment.',
      );
    } finally {
      setConnecting(false);
    }
  }

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await api.integrations.klaviyoSync();
      setStatus(res);
    } catch {
      Alert.alert('Sync failed', 'Couldn’t refresh subscriber counts from Klaviyo. Try again.');
    } finally {
      setSyncing(false);
    }
  }

  function handleDisconnect() {
    Alert.alert('Disconnect Klaviyo', 'Your Klaviyo account will be disconnected from Brandthread. Your subscribers stay safe in Klaviyo.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disconnect', style: 'destructive', onPress: async () => {
          setDisconnecting(true);
          try {
            await api.integrations.klaviyoDisconnect();
            setStatus({ connected: false });
          } catch {
            Alert.alert('Couldn’t disconnect Klaviyo', 'Check your connection and try again.');
          } finally {
            setDisconnecting(false);
          }
        },
      },
    ]);
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenHeader title="Klaviyo" />

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 120 }} showsVerticalScrollIndicator={false}>
        <View style={[styles.hero, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.heroIcon, { backgroundColor: `${colors.primary}22` }]}>
            <Icon name="zap" size={22} color={colors.primary} />
          </View>
          <Text style={[styles.heroTitle, { color: colors.foreground }]}>Klaviyo email and SMS</Text>
          <Text style={[styles.heroSub, { color: colors.mutedForeground }]}>
            Connect your existing Klaviyo account so the email and SMS subscribers you already built keep working here.
          </Text>
        </View>

        {loading ? (
          <LoadingSkeleton height={180} />
        ) : loadError ? (
          <ErrorState message="Couldn’t load your Klaviyo connection." onRetry={() => { setLoading(true); load(); }} retryLabel="Try again" />
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
                <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Email subscribers</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={[styles.statVal, { color: colors.foreground }]}>{(status.smsSubscriberCount ?? 0).toLocaleString()}</Text>
                <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>SMS subscribers</Text>
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
              style={[styles.secondaryBtn, { borderColor: colors.border }]}
              onPress={handleSync}
              disabled={syncing}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityState={{ disabled: syncing, busy: syncing }}
            >
              {syncing ? <ActivityIndicator size="small" color={TEXT_DISABLED} /> : <Icon name="refresh-cw" size={15} color={colors.foreground} />}
              <Text style={[styles.secondaryBtnText, { color: syncing ? TEXT_DISABLED : colors.foreground }]}>{syncing ? 'Syncing…' : 'Sync subscribers'}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.disconnectBtn, disconnecting && { opacity: 0.6 }]}
              onPress={handleDisconnect}
              disabled={disconnecting}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityState={{ disabled: disconnecting, busy: disconnecting }}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={[styles.disconnectText, { color: colors.destructive }]}>{disconnecting ? 'Disconnecting…' : 'Disconnect Klaviyo'}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>Klaviyo Private API Key</Text>
            <TextInput returnKeyType="done"
              style={[styles.input, { backgroundColor: colors.secondary, color: colors.foreground, borderColor: colors.border }]}
              placeholder="pk_..."
              placeholderTextColor={colors.mutedForeground}
              value={apiKey}
              onChangeText={setApiKey}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              accessibilityLabel="Klaviyo private API key"
            />
            <TouchableOpacity
              style={[styles.connectBtn, { backgroundColor: connecting ? FILL_ELEVATED : colors.primary }]}
              onPress={handleConnect}
              disabled={connecting}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityState={{ disabled: connecting, busy: connecting }}
            >
              {connecting ? <ActivityIndicator size="small" color={TEXT_DISABLED} /> : <Icon name="link" size={16} color={colors.primaryForeground} />}
              <Text style={[styles.connectBtnText, { color: connecting ? TEXT_DISABLED : colors.primaryForeground }]}>{connecting ? 'Connecting…' : 'Connect Klaviyo'}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.helpRow}
              onPress={() => { Linking.openURL('https://help.klaviyo.com/hc/en-us/articles/115005062267').catch(() => {}); }}
              activeOpacity={0.7}
              accessibilityRole="link"
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Icon name="external-link" size={13} color={colors.primary} />
              <Text style={[styles.helpText, { color: colors.primary }]}>Where do I find my Private API Key?</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.infoBlock}>
          <Icon name="shield" size={14} color={colors.mutedForeground} />
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
  hero: { borderRadius: 16, borderWidth: 1, padding: 20, alignItems: 'center', marginBottom: 20, gap: 8 },
  heroIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  heroTitle: { fontSize: 17, fontFamily: FONT.bold, textAlign: 'center' },
  heroSub: { fontSize: 13, fontFamily: FONT.regular, textAlign: 'center', lineHeight: 19 },

  section: { borderRadius: 12, borderWidth: 1, padding: 18 },
  label: { fontSize: 12, fontFamily: FONT.medium, marginBottom: 8 },
  input: { borderRadius: 8, borderWidth: 1, padding: 13, fontSize: 15, fontFamily: FONT.regular, marginBottom: 14 },
  connectBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 8, paddingVertical: 14 },
  connectBtnText: { fontSize: FS.base, fontFamily: FONT.semibold },
  helpRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 14 },
  helpText: { fontSize: 12, fontFamily: FONT.medium },

  connectedRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  connectedText: { fontSize: 15, fontFamily: FONT.semibold },
  statsRow: { flexDirection: 'row', marginBottom: 12 },
  statBox: { flex: 1, alignItems: 'center', gap: 3 },
  statVal: { fontSize: 20, fontFamily: FONT.bold },
  statLabel: { fontSize: 11, fontFamily: FONT.regular },
  syncedText: { fontSize: 11, fontFamily: FONT.regular, textAlign: 'center', marginBottom: 16 },
  secondaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 8, borderWidth: 1, paddingVertical: 12, marginBottom: 10 },
  secondaryBtnText: { fontSize: 13, fontFamily: FONT.semibold },
  disconnectBtn: { alignItems: 'center', justifyContent: 'center', minHeight: 44, paddingVertical: 8 },
  disconnectText: { fontSize: 13, fontFamily: FONT.medium },

  infoBlock: { flexDirection: 'row', gap: 8, marginTop: 20, paddingHorizontal: 4 },
  infoText: { flex: 1, fontSize: 11, fontFamily: FONT.regular, lineHeight: 16 },
});
