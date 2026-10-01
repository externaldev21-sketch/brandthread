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
import { ListRow } from '@/components/ui';
import { QuietHoursRow, type QuietHoursPreset } from '@/components/notifications/QuietHoursRow';
import { Card } from '@/components/ui/Card';
import { SPACING } from '@/constants/spacing';

type Role = 'buyer' | 'seller';

interface NotifRow {
  key: string;
  icon: React.ComponentProps<typeof ListRow>['icon'];
  label: string;
  description: string;
}

const SELLER_ROWS: NotifRow[] = [
  { key: 'new_orders',             icon: 'shopping-bag',   label: 'New orders',             description: 'A customer places an order' },
  { key: 'production_milestones',  icon: 'package',        label: 'Production milestones',  description: 'Sampling and production' },
  { key: 'payout_confirmations',   icon: 'credit-card',    label: 'Payout confirmations',   description: 'Payout sent or delayed' },
  { key: 'customer_messages',      icon: 'message-circle', label: 'Customer messages',      description: 'Messages from customers' },
  { key: 'disputes',               icon: 'alert-triangle', label: 'Disputes',               description: 'Disputes and case updates' },
  { key: 'inventory_alerts',       icon: 'archive',        label: 'Inventory alerts',       description: 'Low and out of stock' },
  { key: 'seller_announcements', icon: 'bell', label: 'Brand announcements', description: 'Pushes that brands you follow send to their followers' },
  { key: 'subscription_trial',     icon: 'clock',          label: 'Trial reminders',        description: 'Before your trial converts' },
];

const BUYER_ROWS: NotifRow[] = [
  { key: 'order_updates',   icon: 'shopping-bag',   label: 'Order updates',      description: 'Shipped, delivered, refunds' },
  { key: 'messages',        icon: 'message-circle', label: 'Messages',          description: 'Sellers and friends' },
  { key: 'new_drops',       icon: 'zap',             label: 'Drops',             description: 'Drops from brands you follow' },
  { key: 'friend_activity', icon: 'users',           label: 'Social',            description: 'Follows, likes, and comments' },
  { key: 'price_alerts',    icon: 'tag',             label: 'Price & stock alerts', description: 'Price drops and restocks' },
  { key: 'return_updates',  icon: 'refresh-ccw',     label: 'Returns',           description: 'Return and refund requests' },
  { key: 'seller_announcements', icon: 'bell', label: 'Brand announcements', description: 'Pushes that brands you follow send to their followers' },
];

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

  async function handleQuietHoursChange(preset: QuietHoursPreset) {
    const prior = quietHours;
    setQuietHours({ start: preset.start, end: preset.end });
    try {
      await api.notificationPrefs.update({
        quietHours: preset.start && preset.end ? { start: preset.start, end: preset.end } : null,
      });
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

  return (
    <View style={[s.container, { backgroundColor: 'transparent' }]}>
      <ScreenHeader title="Notifications" divider={false} onBack={() => goBackOr(router, '/(tabs)/more')} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 140 }} showsVerticalScrollIndicator={false}>

        {/* ── Master switch ── */}
        <View style={s.section}>
          <Card>
            <ListRow
              icon={pushEnabled ? 'bell' : 'bell-off'}
              title="Push notifications"
              subtitle="All push on this device"
              subtitleNumberOfLines={1}
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
                  subtitleNumberOfLines={1}
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
          <QuietHoursRow start={quietHours.start} end={quietHours.end} onChange={handleQuietHoursChange} />
        </View>

        <View style={s.divider} />

        {/* ── Other channels ── */}
        <View style={s.section}>
          <Card>
            <ListRow
              icon="mail"
              title="Email & in-app"
              subtitle="Choose what reaches you"
              subtitleNumberOfLines={1}
              chevron
              onPress={() => router.push('/notification-channels' as never)}
            />
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
    divider:          { height: 10 },
    listCard:         { padding: SPACING.sm },
    rowDivider:       { height: StyleSheet.hairlineWidth },
  });
}
