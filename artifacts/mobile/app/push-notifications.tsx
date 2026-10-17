/**
 * Seller push notifications. Toggles are saved server-side through
 * /api/notification-prefs (the same store notifications-settings uses), and
 * lib/push.ts honours them before sending. Seller-only: buyers are pointed
 * to their own notification settings.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, View, Text, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { useApi } from '@/hooks/useApi';
import { ScreenHeader } from '@/components/ScreenHeader';
import { hapticToggle } from '@/lib/haptics';
import { ListRow } from '@/components/ui/ListRow';
import { Card } from '@/components/ui/Card';
import { ErrorState } from '@/components/ui/ErrorState';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';
import { FONT } from '@/lib/theme';
import { apiErrorMessage } from '@/lib/safety';
import { SELLER_PUSH_GROUPS, categoryValue } from '@/lib/sellerPushPrefs';

export default function PushNotificationsScreen() {
  const colors = useColors();
  const api = useApi();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [role, setRole] = useState<'buyer' | 'seller'>('seller');
  const [pushEnabled, setPushEnabled] = useState(true);
  const [categories, setCategories] = useState<Record<string, boolean>>({});

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(false);
    api.notificationPrefs.get()
      .then((data) => {
        setRole(data.role);
        setPushEnabled(data.pushEnabled ?? true);
        setCategories(data.categories ?? {});
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, [api]);

  useEffect(() => { load(); }, [load]);

  async function toggleMaster(value: boolean) {
    hapticToggle();
    const prior = pushEnabled;
    setPushEnabled(value);
    try {
      const result = await api.notificationPrefs.update({ pushEnabled: value });
      setPushEnabled(result.pushEnabled ?? value);
    } catch (e) {
      setPushEnabled(prior);
      Alert.alert('Couldn’t save', apiErrorMessage(e, 'Your change wasn’t saved. Please try again.'));
    }
  }

  async function toggle(key: string, value: boolean) {
    hapticToggle();
    const prior = categories;
    setCategories({ ...categories, [key]: value });
    try {
      const result = await api.notificationPrefs.update({ categories: { [key]: value } });
      setCategories(result.categories ?? { ...prior, [key]: value });
    } catch (e) {
      setCategories(prior);
      Alert.alert('Couldn’t save', apiErrorMessage(e, 'Your change wasn’t saved. Please try again.'));
    }
  }

  let body: React.ReactNode;
  if (loading) {
    body = <ActivityIndicator style={{ marginTop: SPACING.xl }} color={colors.mutedForeground} />;
  } else if (loadError) {
    body = <ErrorState message="Couldn't load your notification settings" onRetry={load} />;
  } else if (role === 'buyer') {
    body = (
      <Card style={styles.card}>
        <ListRow
          icon="bell"
          title="Notification settings"
          subtitle="These order alerts are for seller accounts. Manage your notifications here."
          subtitleNumberOfLines={2}
          chevron
          onPress={() => router.replace('/notifications-settings' as never)}
        />
      </Card>
    );
  } else {
    body = (
      <>
        <View style={styles.group}>
          <Card style={styles.card}>
            <ListRow
              icon={pushEnabled ? 'bell' : 'bell-off'}
              title="Push notifications"
              subtitle="All push on this device"
              toggle={{ value: pushEnabled, onChange: toggleMaster }}
            />
          </Card>
        </View>
        {SELLER_PUSH_GROUPS.map((group) => (
          <View key={group.title} style={styles.group}>
            <Text style={[TYPE_SCALE.footnote, styles.groupTitle, { color: colors.foreground }]}>{group.title}</Text>
            {group.subtitle && (
              <Text style={[TYPE_SCALE.footnote, styles.groupSubtitle, { color: colors.mutedForeground }]}>{group.subtitle}</Text>
            )}
            <Card style={styles.card}>
              {group.rows.map((row, i) => (
                <React.Fragment key={row.key}>
                  <ListRow
                    title={row.label}
                    subtitle={row.description}
                    disabled={!pushEnabled}
                    toggle={{ value: categoryValue(categories, row.key), onChange: (v) => toggle(row.key, v) }}
                  />
                  {i !== group.rows.length - 1 && (
                    <View style={[styles.rowDivider, { backgroundColor: colors.border }]} />
                  )}
                </React.Fragment>
              ))}
            </Card>
          </View>
        ))}
        <Card style={styles.card}>
          <ListRow
            icon="sliders"
            title="All notification settings"
            subtitle="Quiet hours, promotions, email and in-app"
            chevron
            onPress={() => router.push('/notifications-settings' as never)}
          />
        </Card>
      </>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: 'transparent' }]}>
      <ScreenHeader title="Push notifications" />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: SPACING.md + 4, paddingBottom: 60, paddingHorizontal: SPACING.md + 4 }}
        showsVerticalScrollIndicator={false}
      >
        {body}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  group: { marginBottom: SPACING.xl - 2 },
  groupTitle: { fontFamily: FONT.semibold, marginBottom: SPACING.xxs },
  groupSubtitle: { marginBottom: SPACING.sm - 2 },
  card: { padding: SPACING.sm },
  rowDivider: { height: StyleSheet.hairlineWidth },
});
