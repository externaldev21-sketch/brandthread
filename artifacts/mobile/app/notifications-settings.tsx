/**
 * Notification Settings — push preferences for buyers and sellers (the server
 * resolves the role from the session, so buyers get buyer-only toggles;
 * QA-0057). Every toggle is persisted through /api/notification-prefs,
 * including the promotional opt-in (App Store 4.5.4).
 * Every account gets real-time pushes; there's no frequency control in the
 * UI (the stored/API `digest` value still defaults to 'realtime' server-side
 * so nothing else that reads it breaks).
 */
import React, { useState, useEffect } from 'react';
import { ScrollView, View, Text, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { ErrorState } from '@/components/ui/ErrorState';
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
import { RetryRow } from '@/components/ui/RetryRow';
import { FONT } from '@/lib/theme';
import { useRole } from '@/contexts/RoleContext';

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
  { key: 'friend_activity',        icon: 'users',          label: 'Social',                 description: 'New followers, likes, comments and mentions' },
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
  const [loadFailed, setLoadFailed] = useState(false);
  // The server's role (from the auth token) decides which preference keys
  // apply once loaded; until then — or when the request can't run, e.g. a
  // signed-out preview — fall back to the app's active role so a buyer never
  // sees seller-only categories.
  const { role: activeRole } = useRole();
  const [serverRole, setRole] = useState<Role | null>(null);
  const role: Role = serverRole ?? (activeRole === 'buyer' ? 'buyer' : 'seller');
  const [pushEnabled, setPushEnabled] = useState(true);
  const [promotionalPush, setPromotionalPush] = useState(false);
  const [quietHours, setQuietHours] = useState<{ start: string | null; end: string | null }>({ start: null, end: null });
  const [categories, setCategories] = useState<Record<string, boolean>>({});
  // Until the saved preferences load, the switches would show defaults
  // ("all on") that may not be the account's real choices — so show a
  // loading / retry state instead.
  const [prefsState, setPrefsState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [reloadKey, setReloadKey] = useState(0);

  const rows = role === 'buyer' ? BUYER_ROWS : role === 'seller' ? SELLER_ROWS : [];

  // Load current preference from API. This screen adapts to whichever role
  // the signed-in account has — the server resolves that from the auth
  // token, so the same endpoint serves both buyer and seller accounts.
  // `digest` isn't read here: every account gets real-time pushes and
  // there's no UI to change it, so there's nothing to hydrate into state.
  const load = React.useCallback(() => {
    setLoadFailed(false);
    setPrefsState('loading');
    api.notificationPrefs.get()
      .then(data => {
        setPrefsState('ready');
        setCategories(data.categories);
        setRole(data.role);
        setPushEnabled(data.pushEnabled ?? true);
        setPromotionalPush(data.promotionalPush ?? false);
        setQuietHours({ start: data.quietHours?.start ?? null, end: data.quietHours?.end ?? null });
      })
      .catch(() => { setLoadFailed(true); setPrefsState('error'); });
  }, [api]);

  useEffect(() => { load(); }, [load, reloadKey]);

  if (prefsState !== 'ready') {
    return (
      <View style={[s.container, { backgroundColor: 'transparent' }]}>
        <ScreenHeader title="Notifications" onBack={() => goBackOr(router, '/(tabs)/more')} />
        {prefsState === 'error' ? (
          <ErrorState message="Couldn't load your notification settings." onRetry={() => setReloadKey(k => k + 1)} />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={colors.foreground} /></View>
        )}
      </View>
    );
  }

  async function handleMasterToggle(value: boolean) {
    hapticToggle();
    const prior = pushEnabled;
    setPushEnabled(value);
    try {
      await api.notificationPrefs.update({ pushEnabled: value });
    } catch {
      setPushEnabled(prior);
      Alert.alert('Couldn’t save that change', 'Check your connection and try again.');
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
      Alert.alert('Couldn’t save quiet hours', 'Check your connection and try again.');
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
      Alert.alert('Couldn’t save that change', 'Check your connection and try again.');
    }
  }

  return (
    <View style={[s.container, { backgroundColor: 'transparent' }]}>
      <ScreenHeader title="Notifications" divider={false} onBack={() => goBackOr(router, '/(tabs)/more')} />
      {!role ? (
        <View style={s.section}>
          {loadFailed
            ? <RetryRow label="Couldn't load your notification settings" onRetry={load} />
            : <ActivityIndicator color={colors.foreground} />}
        </View>
      ) : (
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 140 }} showsVerticalScrollIndicator={false}>

        {/* ── Master switch ── */}
        <View style={[s.section, s.sectionFirst]}>
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

        {/* ── Quiet hours ── */}
        <View style={s.section}>
          <QuietHoursRow start={quietHours.start} end={quietHours.end} onChange={handleQuietHoursChange} />
        </View>


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
      )}
    </View>
  );
}

function makeStyles() {
  return StyleSheet.create({
    container:        { flex: 1 },
    // One consistent 24pt gap between stacked sections (16pt below the header).
    section:          { paddingHorizontal: SPACING.md, paddingTop: SPACING.xl },
    sectionFirst:     { paddingTop: SPACING.md },
    sectionTitle:     { fontFamily: FONT.semibold, marginBottom: SPACING.xxs + 2 },
    sectionSubtitle:  { marginBottom: SPACING.sm + 2, lineHeight: 17 },
    listCard:         { padding: SPACING.sm },
    rowDivider:       { height: StyleSheet.hairlineWidth },
  });
}
