/**
 * Notification Settings — seller push notification preferences.
 * Includes digest mode toggle (real-time vs daily summary) backed by real API.
 */
import React, { useState, useEffect } from 'react';
import {
  ScrollView, View, Text, TouchableOpacity, StyleSheet, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApi } from '@/hooks/useApi';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { FONT, FS, SP } from '@/lib/theme';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { HapticSwitch } from '@/components/BrandthreadUI';
import { TYPE_SCALE } from '@/constants/typography';
import { RADII } from '@/constants/radii';

type DigestMode = 'realtime' | 'daily';
type Role = 'buyer' | 'seller';

interface NotifRow {
  key: string;
  icon: keyof typeof Feather.glyphMap;
  label: string;
  description: string;
}

const SELLER_ROWS: NotifRow[] = [
  { key: 'new_orders',             icon: 'shopping-bag',   label: 'New orders',             description: 'Get notified when a customer places an order' },
  { key: 'production_milestones',  icon: 'package',        label: 'Production milestones',  description: 'Sampling, production, and fulfillment progress' },
  { key: 'payout_confirmations',   icon: 'credit-card',    label: 'Payout confirmations',   description: 'Payout sent, completed, or delayed updates' },
  { key: 'customer_messages',      icon: 'message-circle', label: 'Customer messages',      description: 'New messages and replies from customers' },
  { key: 'disputes',               icon: 'alert-triangle', label: 'Disputes',               description: 'New disputes and time-sensitive case updates' },
  { key: 'inventory_alerts',       icon: 'archive',        label: 'Inventory alerts',       description: 'Low stock and out-of-stock warnings' },
  { key: 'subscription_trial',     icon: 'clock',          label: 'Trial reminders',        description: 'A reminder before your free trial converts to paid' },
];

const BUYER_ROWS: NotifRow[] = [
  { key: 'order_updates',   icon: 'shopping-bag',   label: 'Order updates',      description: 'Confirmed, shipped, delivered, and return/refund updates' },
  { key: 'messages',        icon: 'message-circle', label: 'Messages',          description: 'New messages from sellers and friends' },
  { key: 'new_drops',       icon: 'zap',             label: 'Drops',             description: 'When a brand you follow launches a new drop' },
  { key: 'friend_activity', icon: 'users',           label: 'Social',            description: 'New followers, likes, and friend activity' },
  { key: 'price_alerts',    icon: 'tag',             label: 'Price & stock alerts', description: 'Price drops and back-in-stock alerts on saved items' },
  { key: 'return_updates',  icon: 'refresh-ccw',     label: 'Returns',           description: 'Updates on your return and refund requests' },
];

const QUIET_HOURS_PRESETS: { start: string; end: string; label: string }[] = [
  { start: '22:00', end: '07:00', label: '10 PM – 7 AM' },
  { start: '23:00', end: '08:00', label: '11 PM – 8 AM' },
  { start: '21:00', end: '06:00', label: '9 PM – 6 AM' },
];

export default function NotificationsSettingsScreen() {
  const insets = useSafeAreaInsets();
  const api    = useApi();
  const { theme } = useAppTheme();
  const s = React.useMemo(() => makeStyles(theme), [theme]);
  const [role, setRole] = useState<Role>('seller');
  const [digest, setDigest] = useState<DigestMode>('realtime');
  const [pushEnabled, setPushEnabled] = useState(true);
  const [quietHours, setQuietHours] = useState<{ start: string | null; end: string | null }>({ start: null, end: null });
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [categories, setCategories] = useState<Record<string, boolean>>({});

  const rows = role === 'buyer' ? BUYER_ROWS : SELLER_ROWS;

  // Load current preference from API. This screen adapts to whichever role
  // the signed-in account has — the server resolves that from the auth
  // token, so the same endpoint serves both buyer and seller accounts.
  useEffect(() => {
    api.notificationPrefs.get()
      .then(data => {
        setDigest(data.digest);
        setCategories(data.categories);
        setRole(data.role);
        setPushEnabled(data.pushEnabled ?? true);
        setQuietHours({ start: data.quietHours?.start ?? null, end: data.quietHours?.end ?? null });
      })
      .catch(() => {/* fallback to realtime, push on, quiet hours off */})
      .finally(() => setLoading(false));
  }, []);

  async function handleDigestToggle(val: boolean) {
    const next: DigestMode = val ? 'daily' : 'realtime';
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setDigest(next);
    setSaving(true);
    try {
      await api.notificationPrefs.update({ digest: next });
    } catch {
      // revert on error
      setDigest(val ? 'realtime' : 'daily');
    } finally {
      setSaving(false);
    }
  }

  async function handleMasterToggle(value: boolean) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const prior = pushEnabled;
    setPushEnabled(value);
    try {
      await api.notificationPrefs.update({ pushEnabled: value });
    } catch {
      setPushEnabled(prior);
    }
  }

  async function handleQuietHoursPreset(preset: { start: string; end: string } | null) {
    Haptics.selectionAsync();
    const prior = quietHours;
    const next = preset ? { start: preset.start, end: preset.end } : { start: null, end: null };
    setQuietHours(next);
    try {
      await api.notificationPrefs.update({ quietHours: preset ? preset : null });
    } catch {
      setQuietHours(prior);
    }
  }

  async function handleCategory(key: string, value: boolean) {
    Haptics.selectionAsync();
    const prior = categories;
    setCategories({ ...categories, [key]: value });
    try {
      const result = await api.notificationPrefs.update({ categories: { [key]: value } });
      setCategories(result.categories);
    } catch {
      setCategories(prior);
    }
  }

  return (
    <View style={[s.container, { backgroundColor: 'transparent' }]}>
      <ScreenHeader title="Notifications" />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 60 }} showsVerticalScrollIndicator={false}>

        {/* ── Master switch ── */}
        <View style={s.section}>
          <View style={[s.masterRow, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <View style={[s.digestIconBox, { backgroundColor: pushEnabled ? theme.accentDim : theme.subtle + '60' }]}>
              <Feather name={pushEnabled ? 'bell' : 'bell-off'} size={18} color={pushEnabled ? theme.accentLight : theme.muted} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[s.digestOptionLabel, { color: theme.text }]}>Push notifications</Text>
              <Text style={s.digestOptionDesc}>Turn all push notifications on or off for this device</Text>
            </View>
            <HapticSwitch
              value={pushEnabled}
              onValueChange={handleMasterToggle}
              trackColor={{ false: theme.border, true: theme.accent }}
              thumbColor={theme.background}
              accessibilityLabel="All push notifications"
            />
          </View>
        </View>

        {/* ── Quiet hours ── */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Quiet hours</Text>
          <Text style={s.sectionSubtitle}>
            Push notifications are held silently during this window and delivered to your in-app feed instead. Time-sensitive events still show up when you open the app.
          </Text>
          <View style={s.presetRow}>
            <TouchableOpacity
              style={[s.presetChip, !quietHours.start && { backgroundColor: theme.accentDim, borderColor: theme.accent }, { borderColor: theme.border }]}
              onPress={() => handleQuietHoursPreset(null)}
              activeOpacity={0.8}
            >
              <Text style={[s.presetChipLabel, { color: !quietHours.start ? theme.text : theme.muted }]}>Off</Text>
            </TouchableOpacity>
            {QUIET_HOURS_PRESETS.map((preset) => {
              const active = quietHours.start === preset.start && quietHours.end === preset.end;
              return (
                <TouchableOpacity
                  key={preset.label}
                  style={[s.presetChip, active && { backgroundColor: theme.accentDim, borderColor: theme.accent }, { borderColor: theme.border }]}
                  onPress={() => handleQuietHoursPreset(preset)}
                  activeOpacity={0.8}
                >
                  <Text style={[s.presetChipLabel, { color: active ? theme.text : theme.muted }]}>{preset.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View style={[s.divider, { backgroundColor: theme.borderSubtle }]} />

        {/* ── Push frequency ── */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Push notification frequency</Text>
          <Text style={s.sectionSubtitle}>
            Control how often Brandthread sends push notifications to your device. Daily digest reduces interruptions by batching updates into a single morning summary.
          </Text>

          {loading ? (
            <View style={[s.digestCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
              <ActivityIndicator color={theme.accent} size="small" />
            </View>
          ) : (
            <View style={[s.digestCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
              {/* Real-time option */}
              <TouchableOpacity
                style={[s.digestOption, digest === 'realtime' && { backgroundColor: theme.accentDim }, { borderColor: digest === 'realtime' ? theme.accent : theme.border }]}
                onPress={() => handleDigestToggle(false)}
                activeOpacity={0.8}
              >
                <View style={[s.digestIconBox, { backgroundColor: digest === 'realtime' ? theme.accentDim : theme.subtle + '60' }]}>
                  <Feather name="bell" size={18} color={digest === 'realtime' ? theme.accentLight : theme.muted} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.digestOptionLabel, { color: digest === 'realtime' ? theme.text : theme.muted }]}>Real-time</Text>
                  <Text style={s.digestOptionDesc}>Get a push for every event as it happens</Text>
                </View>
                {digest === 'realtime' && (
                  <Feather name="check-circle" size={18} color={theme.accentLight} />
                )}
              </TouchableOpacity>

              <View style={[s.optionDivider, { backgroundColor: theme.border }]} />

              {/* Daily digest option */}
              <TouchableOpacity
                style={[s.digestOption, digest === 'daily' && { backgroundColor: theme.accentDim }, { borderColor: digest === 'daily' ? theme.accent : theme.border }]}
                onPress={() => handleDigestToggle(true)}
                activeOpacity={0.8}
              >
                <View style={[s.digestIconBox, { backgroundColor: digest === 'daily' ? theme.accentDim : theme.subtle + '60' }]}>
                  <Feather name="sun" size={18} color={digest === 'daily' ? theme.accentLight : theme.muted} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.digestOptionLabel, { color: digest === 'daily' ? theme.text : theme.muted }]}>Daily digest</Text>
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

        <View style={[s.divider, { backgroundColor: theme.borderSubtle }]} />

        {/* ── Notification types ── */}
        <View style={s.section}>
          <View style={[s.listCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
            {rows.map((row, i) => (
              <View
                key={row.key}
                style={[s.row, i !== rows.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border }]}
              >
                <Feather name={row.icon} size={17} color={theme.text} style={s.rowIcon} />
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Text style={[s.rowLabel, { color: theme.text }]}>{row.label}</Text>
                  <Text style={[s.rowDescription, { color: theme.muted }]}>{row.description}</Text>
                </View>
                <HapticSwitch
                  value={categories[row.key] ?? true}
                  onValueChange={(value) => handleCategory(row.key, value)}
                  trackColor={{ false: theme.border, true: theme.accent }}
                  thumbColor={theme.background}
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

function makeStyles(theme: AppThemePreset) {
  return StyleSheet.create({
    container:        { flex: 1 },
    section:          { paddingHorizontal: 20, paddingVertical: 18 },
    sectionTitle:     { fontSize: FS.sm + 1, lineHeight: 18, fontFamily: FONT.semibold, color: theme.text, marginBottom: 6 },
    sectionSubtitle:  { fontSize: TYPE_SCALE.footnote.fontSize, fontFamily: FONT.regular, color: theme.muted, lineHeight: TYPE_SCALE.footnote.lineHeight, marginBottom: 14 },
    divider:          { height: 10 },

    digestCard:        { borderRadius: RADII.card, borderWidth: 1, overflow: 'hidden' },
    digestOption:      { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, minHeight: 52 },
    digestIconBox:     { width: 38, height: 38, borderRadius: RADII.chip, alignItems: 'center', justifyContent: 'center' },
    digestOptionLabel: { fontSize: TYPE_SCALE.callout.fontSize, lineHeight: 18, fontFamily: FONT.semibold, marginBottom: 2 },
    digestOptionDesc:  { fontSize: TYPE_SCALE.footnote.fontSize, fontFamily: FONT.regular, color: theme.muted, lineHeight: 16 },
    optionDivider:     { height: StyleSheet.hairlineWidth, marginHorizontal: 14 },
    savingRow:         { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, paddingTop: 4 },
    savingText:        { fontSize: TYPE_SCALE.footnote.fontSize, fontFamily: FONT.regular, color: theme.muted },

    masterRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: RADII.card, borderWidth: 1, minHeight: 52 },
    presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    presetChip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: RADII.pill, borderWidth: 1 },
    presetChipLabel: { fontSize: TYPE_SCALE.footnote.fontSize, lineHeight: 17, fontFamily: FONT.medium },

    listCard:    { borderRadius: RADII.card, borderWidth: 1, overflow: 'hidden' },
    row:         { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 14, minHeight: 52 },
    rowIcon:     { width: 20, marginTop: 2 },
    rowLabel:    { fontSize: TYPE_SCALE.callout.fontSize, lineHeight: 18, fontFamily: FONT.semibold },
    rowDescription: { fontSize: TYPE_SCALE.footnote.fontSize, fontFamily: FONT.regular, color: theme.muted, marginTop: 3, lineHeight: 17 },
  });
}
