/**
 * Notification Settings — seller push notification preferences.
 * Every account gets real-time pushes; there's no frequency control in the
 * UI (the stored/API `digest` value still defaults to 'realtime' server-side
 * so nothing else that reads it breaks).
 */
import React, { useState, useEffect } from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useApi } from '@/hooks/useApi';
import { ScreenHeader } from '@/components/ScreenHeader';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { useColors } from '@/hooks/useColors';
import { hapticToggle } from '@/lib/haptics';
import { ListRow, ChipGroup } from '@/components/ui';
import { Card } from '@/components/ui/Card';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';
import { FONT } from '@/lib/theme';

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
  { key: 'seller_announcements', icon: 'bell', label: 'Brand announcements', description: 'Pushes that brands you follow send to their followers' },
  { key: 'subscription_trial',     icon: 'clock',          label: 'Trial reminders',        description: 'A reminder before your free trial converts to paid' },
];

const BUYER_ROWS: NotifRow[] = [
  { key: 'order_updates',   icon: 'shopping-bag',   label: 'Order updates',      description: 'Confirmed, shipped, delivered, and return/refund updates' },
  { key: 'messages',        icon: 'message-circle', label: 'Messages',          description: 'New messages from sellers and friends' },
  { key: 'new_drops',       icon: 'zap',             label: 'Drops',             description: 'When a brand you follow launches a new drop' },
  { key: 'friend_activity', icon: 'users',           label: 'Social',            description: 'New followers, likes, and friend activity' },
  { key: 'price_alerts',    icon: 'tag',             label: 'Price & stock alerts', description: 'Price drops and back-in-stock alerts on saved items' },
  { key: 'return_updates',  icon: 'refresh-ccw',     label: 'Returns',           description: 'Updates on your return and refund requests' },
  { key: 'seller_announcements', icon: 'bell', label: 'Brand announcements', description: 'Pushes that brands you follow send to their followers' },
];

const QUIET_HOURS_PRESETS: { id: string; start: string; end: string; label: string }[] = [
  { id: 'preset-22-07', start: '22:00', end: '07:00', label: '10 PM – 7 AM' },
  { id: 'preset-23-08', start: '23:00', end: '08:00', label: '11 PM – 8 AM' },
  { id: 'preset-21-06', start: '21:00', end: '06:00', label: '9 PM – 6 AM' },
];

const QUIET_HOURS_OPTIONS = [{ id: 'off', label: 'Off' }, ...QUIET_HOURS_PRESETS.map(p => ({ id: p.id, label: p.label }))];

export default function NotificationsSettingsScreen() {
  const router = useRouter();
  const api    = useApi();
  const colors = useColors();
  const s = React.useMemo(() => makeStyles(), []);
  const [role, setRole] = useState<Role>('seller');
  const [pushEnabled, setPushEnabled] = useState(true);
  const [promotionalPush, setPromotionalPush] = useState(false);
  const [quietHours, setQuietHours] = useState<{ start: string | null; end: string | null }>({ start: null, end: null });
  const [categories, setCategories] = useState<Record<string, boolean>>({});

  const rows = role === 'buyer' ? BUYER_ROWS : SELLER_ROWS;

  // Load current preference from API. This screen adapts to whichever role
  // the signed-in account has — the server resolves that from the auth
  // token, so the same endpoint serves both buyer and seller accounts.
  // `digest` isn't read here: every account gets real-time pushes and
  // there's no UI to change it, so there's nothing to hydrate into state.
  useEffect(() => {
    api.notificationPrefs.get()
      .then(data => {
        setCategories(data.categories);
        setRole(data.role);
        setPushEnabled(data.pushEnabled ?? true);
        setPromotionalPush(data.promotionalPush ?? false);
        setQuietHours({ start: data.quietHours?.start ?? null, end: data.quietHours?.end ?? null });
      })
      .catch(() => {/* fallback to push on, quiet hours off */});
  }, []);

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

  async function handlePromotionalToggle(value: boolean) {
    hapticToggle();
    const prior = promotionalPush;
    setPromotionalPush(value);
    try {
      const result = await api.notificationPrefs.update({ promotionalPush: value });
      setPromotionalPush(result.promotionalPush ?? value);
    } catch {
      setPromotionalPush(prior);
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
      <ScreenHeader title="Notifications" onBack={() => goBackOr(router, '/(tabs)/more')} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 60 }} showsVerticalScrollIndicator={false}>

        {/* ── Master switch ── */}
        <View style={s.section}>
          <Card>
            <ListRow
              icon={pushEnabled ? 'bell' : 'bell-off'}
              title="Push notifications"
              subtitle="Turn all push notifications on or off for this device"
              subtitleNumberOfLines={2}
              toggle={{ value: pushEnabled, onChange: handleMasterToggle }}
            />
          </Card>
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
                  subtitleNumberOfLines={2}
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

        <View style={s.divider} />

        {/* ── Promotions (explicit opt-in, off by default; Guideline 4.5.4) ── */}
        <View style={s.section}>
          <Card>
            <ListRow
              icon="gift"
              title="Promotions & offers"
              subtitle="Drop launches, new products, and price or restock alerts"
              subtitleNumberOfLines={2}
              toggle={{ value: promotionalPush, onChange: handlePromotionalToggle }}
            />
          </Card>
        </View>

        <View style={s.divider} />

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
    listCard:         { padding: SPACING.sm },
    rowDivider:       { height: StyleSheet.hairlineWidth },
  });
}
