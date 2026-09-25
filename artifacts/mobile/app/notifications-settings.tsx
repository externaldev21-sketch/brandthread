/**
 * Notification Settings — seller push notification preferences.
 * Includes digest mode toggle (real-time vs daily summary) backed by real API.
 */
import React, { useState, useEffect } from 'react';
import { ScrollView, View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useApi } from '@/hooks/useApi';
import { ScreenHeader } from '@/components/ScreenHeader';
import { useColors } from '@/hooks/useColors';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { hapticToggle } from '@/lib/haptics';
import { ListRow, SegmentedControl, ChipGroup } from '@/components/ui';
import { Card } from '@/components/ui/Card';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';
import { FONT } from '@/lib/theme';

type DigestMode = 'realtime' | 'daily';
type Role = 'buyer' | 'seller';

interface NotifRow {
  key: string;
  icon: React.ComponentProps<typeof ListRow>['icon'];
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

const QUIET_HOURS_PRESETS: { id: string; start: string; end: string; label: string }[] = [
  { id: 'preset-22-07', start: '22:00', end: '07:00', label: '10 PM – 7 AM' },
  { id: 'preset-23-08', start: '23:00', end: '08:00', label: '11 PM – 8 AM' },
  { id: 'preset-21-06', start: '21:00', end: '06:00', label: '9 PM – 6 AM' },
];

const QUIET_HOURS_OPTIONS = [{ id: 'off', label: 'Off' }, ...QUIET_HOURS_PRESETS.map(p => ({ id: p.id, label: p.label }))];

const DIGEST_OPTIONS = [
  { id: 'realtime', label: 'Real-time' },
  { id: 'daily', label: 'Daily digest' },
];

export default function NotificationsSettingsScreen() {
  const api    = useApi();
  const colors = useColors();
  const { theme } = useAppTheme();
  const s = React.useMemo(() => makeStyles(), []);
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

  async function handleDigestChange(id: string) {
    const next: DigestMode = id === 'daily' ? 'daily' : 'realtime';
    if (next === digest) return;
    const prior = digest;
    setDigest(next);
    setSaving(true);
    try {
      await api.notificationPrefs.update({ digest: next });
    } catch {
      setDigest(prior);
    } finally {
      setSaving(false);
    }
  }

  async function handleMasterToggle(value: boolean) {
    hapticToggle();
    const prior = pushEnabled;
    setPushEnabled(value);
    try {
      await api.notificationPrefs.update({ pushEnabled: value });
    } catch {
      setPushEnabled(prior);
    }
  }

  async function handleQuietHoursChange(ids: string[]) {
    const id = ids[0];
    const preset = QUIET_HOURS_PRESETS.find(p => p.id === id);
    const prior = quietHours;
    const next = preset ? { start: preset.start, end: preset.end } : { start: null, end: null };
    setQuietHours(next);
    try {
      await api.notificationPrefs.update({ quietHours: preset ? { start: preset.start, end: preset.end } : null });
    } catch {
      setQuietHours(prior);
    }
  }

  async function handleCategory(key: string, value: boolean) {
    hapticToggle();
    const prior = categories;
    setCategories({ ...categories, [key]: value });
    try {
      const result = await api.notificationPrefs.update({ categories: { [key]: value } });
      setCategories(result.categories);
    } catch {
      setCategories(prior);
    }
  }

  const selectedQuietHoursId = quietHours.start
    ? (QUIET_HOURS_PRESETS.find(p => p.start === quietHours.start && p.end === quietHours.end)?.id ?? 'off')
    : 'off';

  return (
    <View style={[s.container, { backgroundColor: 'transparent' }]}>
      <ScreenHeader title="Notifications" />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 60 }} showsVerticalScrollIndicator={false}>

        {/* ── Master switch ── */}
        <View style={s.section}>
          <Card>
            <ListRow
              icon={pushEnabled ? 'bell' : 'bell-off'}
              title="Push notifications"
              subtitle="Turn all push notifications on or off for this device"
              toggle={{ value: pushEnabled, onChange: handleMasterToggle }}
            />
          </Card>
        </View>

        {/* ── Quiet hours ── */}
        <View style={s.section}>
          <Text style={[TYPE_SCALE.footnote, s.sectionTitle, { color: colors.foreground }]}>Quiet hours</Text>
          <Text style={[TYPE_SCALE.footnote, s.sectionSubtitle, { color: colors.mutedForeground }]}>
            Push notifications are held silently during this window and delivered to your in-app feed instead. Time-sensitive events still show up when you open the app.
          </Text>
          <ChipGroup
            options={QUIET_HOURS_OPTIONS}
            selectedIds={[selectedQuietHoursId]}
            onChange={handleQuietHoursChange}
          />
        </View>

        <View style={s.divider} />

        {/* ── Push frequency ── */}
        <View style={s.section}>
          <Text style={[TYPE_SCALE.footnote, s.sectionTitle, { color: colors.foreground }]}>Push notification frequency</Text>
          <Text style={[TYPE_SCALE.footnote, s.sectionSubtitle, { color: colors.mutedForeground }]}>
            Control how often Brandthread sends push notifications to your device. Daily digest reduces interruptions by batching updates into a single morning summary.
          </Text>

          {loading ? (
            <Card style={s.loadingCard}>
              <ActivityIndicator color={theme.accent} size="small" />
            </Card>
          ) : (
            <>
              <SegmentedControl
                options={DIGEST_OPTIONS}
                selectedId={digest}
                onChange={handleDigestChange}
              />
              <Text style={[TYPE_SCALE.footnote, s.digestHint, { color: colors.mutedForeground }]}>
                {digest === 'realtime'
                  ? 'Get a push for every event as it happens.'
                  : 'One morning summary of everything from the past 24 hours.'}
              </Text>
              {saving && (
                <View style={s.savingRow}>
                  <ActivityIndicator color={theme.accent} size="small" />
                  <Text style={[TYPE_SCALE.footnote, { color: colors.mutedForeground }]}>Saving…</Text>
                </View>
              )}
            </>
          )}
        </View>

        <View style={s.divider} />

        {/* ── Notification types ── */}
        <View style={s.section}>
          <Card style={s.listCard}>
            {rows.map((row, i) => (
              <React.Fragment key={row.key}>
                <ListRow
                  icon={row.icon}
                  title={row.label}
                  subtitle={row.description}
                  toggle={{
                    value: categories[row.key] ?? true,
                    onChange: (value) => handleCategory(row.key, value),
                  }}
                />
                {i !== rows.length - 1 && <View style={[s.rowDivider, { backgroundColor: colors.border }]} />}
              </React.Fragment>
            ))}
          </Card>
        </View>

      </ScrollView>
    </View>
  );
}

function makeStyles() {
  return StyleSheet.create({
    container:        { flex: 1 },
    section:          { paddingHorizontal: SPACING.md, paddingVertical: SPACING.md + 2 },
    sectionTitle:     { fontFamily: FONT.semibold, marginBottom: SPACING.xxs + 2 },
    sectionSubtitle:  { marginBottom: SPACING.sm + 2, lineHeight: 17 },
    divider:          { height: 10 },
    loadingCard:      { alignItems: 'center', justifyContent: 'center', minHeight: 52 },
    digestHint:       { marginTop: SPACING.sm, lineHeight: 17 },
    savingRow:        { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, marginTop: SPACING.sm },
    listCard:         { padding: SPACING.sm },
    rowDivider:       { height: StyleSheet.hairlineWidth },
  });
}
