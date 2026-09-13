/**
 * Notification Settings — seller push notification preferences.
 * Includes digest mode toggle (real-time vs daily summary) backed by real API.
 */
import React, { useState, useEffect } from 'react';
import {
  ScrollView, View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApi } from '@/hooks/useApi';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {
  BG, CARD, BORDER, FG, MUTED, SUBTLE,
  SUCCESS,
  FONT, FS, SP,
} from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { HapticSwitch } from '@/components/BrandthreadUI';

type DigestMode = 'realtime' | 'daily';

interface NotifRow {
  key: string;
  icon: keyof typeof Feather.glyphMap;
  label: string;
  description: string;
}

const ROWS: NotifRow[] = [
  { key: 'new_orders',             icon: 'shopping-bag',   label: 'New orders',             description: 'Get notified when a customer places an order' },
  { key: 'production_milestones',  icon: 'package',        label: 'Production milestones',  description: 'Sampling, production, and fulfillment progress' },
  { key: 'payout_confirmations',   icon: 'credit-card',    label: 'Payout confirmations',   description: 'Payout sent, completed, or delayed updates' },
  { key: 'customer_messages',      icon: 'message-circle', label: 'Customer messages',      description: 'New messages and replies from customers' },
  { key: 'disputes',               icon: 'alert-triangle', label: 'Disputes',               description: 'New disputes and time-sensitive case updates' },
  { key: 'subscription_trial',     icon: 'clock',          label: 'Trial reminders',        description: 'A reminder before your free trial converts to paid' },
];

export default function NotificationsSettingsScreen() {
  const insets = useSafeAreaInsets();
  const api    = useApi();
  const { theme } = useAppTheme();
  const [email, setEmail]   = useState('store@brandthread.com');
  const [digest, setDigest] = useState<DigestMode>('realtime');
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [categories, setCategories] = useState<Record<string, boolean>>({});

  // Load current preference from API
  useEffect(() => {
    api.seller.notificationPrefs.get()
      .then(data => { setDigest(data.digest); setCategories(data.categories); })
      .catch(() => {/* fallback to realtime */})
      .finally(() => setLoading(false));
  }, []);

  async function handleDigestToggle(val: boolean) {
    const next: DigestMode = val ? 'daily' : 'realtime';
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setDigest(next);
    setSaving(true);
    try {
      await api.seller.notificationPrefs.update({ digest: next });
    } catch {
      // revert on error
      setDigest(val ? 'realtime' : 'daily');
    } finally {
      setSaving(false);
    }
  }

  function haptic() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  async function handleCategory(key: string, value: boolean) {
    Haptics.selectionAsync();
    const prior = categories;
    setCategories({ ...categories, [key]: value });
    try {
      const result = await api.seller.notificationPrefs.update({ categories: { [key]: value } });
      setCategories(result.categories);
    } catch {
      setCategories(prior);
    }
  }

  return (
    <View style={[s.container, { backgroundColor: 'transparent' }]}>
      <ScreenHeader title="Notifications" />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 60 }} showsVerticalScrollIndicator={false}>

        {/* ── Sender email ── */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Sender email</Text>
          <Text style={s.sectionSubtitle}>
            The email your store uses to send and receive emails from customers
          </Text>
          <View style={[s.infoBox, { backgroundColor: theme.accentDim }]}>
            <Feather name="info" size={15} color={theme.accentLight} style={{ marginTop: 2 }} />
            <Text style={[s.infoText, { color: FG }]}>
              Public domains like Gmail don't support custom sending. Customers will see your email as{' '}
              <Text style={{ fontFamily: FONT.bold }}>store+70327206006@brandthreademail.com</Text>.{' '}
              For better brand recognition, use a custom domain.
            </Text>
          </View>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="mila@nightshiftstudio.co"
            placeholderTextColor={MUTED}
            keyboardType="email-address"
            autoCapitalize="none"
            style={[s.emailInput, { borderColor: BORDER, color: FG, backgroundColor: CARD }]}
          />
        </View>

        <View style={[s.divider, { backgroundColor: SUBTLE }]} />

        {/* ── Push frequency ── */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Push notification frequency</Text>
          <Text style={s.sectionSubtitle}>
            Control how often Brandthread sends push notifications to your device. Daily digest reduces interruptions by batching updates into a single morning summary.
          </Text>

          {loading ? (
            <View style={[s.digestCard, { backgroundColor: CARD, borderColor: BORDER }]}>
              <ActivityIndicator color={theme.accent} size="small" />
            </View>
          ) : (
            <View style={[s.digestCard, { backgroundColor: CARD, borderColor: BORDER }]}>
              {/* Real-time option */}
              <TouchableOpacity
                style={[s.digestOption, digest === 'realtime' && { backgroundColor: theme.accentDim }, { borderColor: digest === 'realtime' ? theme.accent : BORDER }]}
                onPress={() => handleDigestToggle(false)}
                activeOpacity={0.8}
              >
                <View style={[s.digestIconBox, { backgroundColor: digest === 'realtime' ? theme.accentDim : SUBTLE + '60' }]}>
                  <Feather name="bell" size={18} color={digest === 'realtime' ? theme.accentLight : MUTED} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.digestOptionLabel, { color: digest === 'realtime' ? FG : MUTED }]}>Real-time</Text>
                  <Text style={s.digestOptionDesc}>Get a push for every event as it happens</Text>
                </View>
                {digest === 'realtime' && (
                  <Feather name="check-circle" size={18} color={theme.accentLight} />
                )}
              </TouchableOpacity>

              <View style={[s.optionDivider, { backgroundColor: BORDER }]} />

              {/* Daily digest option */}
              <TouchableOpacity
                style={[s.digestOption, digest === 'daily' && { backgroundColor: theme.accentDim }, { borderColor: digest === 'daily' ? theme.accent : BORDER }]}
                onPress={() => handleDigestToggle(true)}
                activeOpacity={0.8}
              >
                <View style={[s.digestIconBox, { backgroundColor: digest === 'daily' ? theme.accentDim : SUBTLE + '60' }]}>
                  <Feather name="sun" size={18} color={digest === 'daily' ? theme.accentLight : MUTED} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.digestOptionLabel, { color: digest === 'daily' ? FG : MUTED }]}>Daily digest</Text>
                  <Text style={s.digestOptionDesc}>One morning summary of everything from the past 24 hours</Text>
                </View>
                {digest === 'daily' && (
                  <Feather name="check-circle" size={18} color={theme.accentLight} />
                )}
              </TouchableOpacity>

              {saving && (
                <View style={s.savingRow}>
                  <ActivityIndicator color={theme.accent} size="small" />
                  <Text style={s.savingText}>Saving…</Text>
                </View>
              )}
            </View>
          )}
        </View>

        <View style={[s.divider, { backgroundColor: SUBTLE }]} />

        {/* ── Notification types ── */}
        <View style={s.section}>
          <View style={[s.listCard, { backgroundColor: CARD, borderColor: BORDER }]}>
            {ROWS.map((row, i) => (
              <View
                key={row.key}
                style={[s.row, i !== ROWS.length - 1 && { borderBottomWidth: 1, borderBottomColor: BORDER }]}
              >
                <Feather name={row.icon} size={17} color={FG} style={s.rowIcon} />
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Text style={[s.rowLabel, { color: FG }]}>{row.label}</Text>
                  <Text style={[s.rowDescription, { color: MUTED }]}>{row.description}</Text>
                </View>
                <HapticSwitch
                  value={categories[row.key] ?? true}
                  onValueChange={(value) => handleCategory(row.key, value)}
                  trackColor={{ false: SUBTLE, true: theme.accent }}
                  thumbColor={FG}
                  accessibilityLabel={`${row.label} push notifications`}
                />
              </View>
            ))}
          </View>
        </View>

      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container:        { flex: 1 },
  section:          { paddingHorizontal: 20, paddingVertical: 18 },
  sectionTitle:     { fontSize: FS.sm + 1, fontFamily: FONT.semibold, color: FG, marginBottom: 6 },
  sectionSubtitle:  { fontSize: 12, fontFamily: FONT.regular, color: MUTED, lineHeight: 17, marginBottom: 14 },
  divider:          { height: 10 },

  infoBox:   { flexDirection: 'row', gap: 10, borderRadius: 12, padding: 14, marginBottom: 14 },
  infoText:  { fontSize: 12, fontFamily: FONT.regular, lineHeight: 17, flex: 1 },
  emailInput:{ borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, fontFamily: FONT.regular },

  digestCard:        { borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  digestOption:      { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  digestIconBox:     { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  digestOptionLabel: { fontSize: 14, fontFamily: FONT.semibold, marginBottom: 2 },
  digestOptionDesc:  { fontSize: 12, fontFamily: FONT.regular, color: MUTED, lineHeight: 16 },
  optionDivider:     { height: 1, marginHorizontal: 14 },
  savingRow:         { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, paddingTop: 4 },
  savingText:        { fontSize: 12, fontFamily: FONT.regular, color: MUTED },

  listCard:    { borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  row:         { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 14 },
  rowIcon:     { width: 20, marginTop: 2 },
  rowLabel:    { fontSize: 14, fontFamily: FONT.semibold },
  rowDescription: { fontSize: 12, fontFamily: FONT.regular, color: MUTED, marginTop: 3, lineHeight: 17 },
});
