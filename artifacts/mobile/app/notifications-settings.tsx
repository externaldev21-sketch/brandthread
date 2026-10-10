/**
 * Settings → Notifications, for buyers and sellers (the server resolves the
 * role from the session).
 *
 * Copied 1:1 from Instagram's notification settings, reskinned
 * (Mobbin: https://mobbin.com/flows/058b1099-edb5-4d07-9493-89c5cf60a6f8,
 * https://mobbin.com/flows/4799cb36-e2d5-4893-acf2-5810f9b87e76):
 *   Push notifications
 *     Pause all      — switch; turning it on asks for 15 min … 8 hours
 *     Sleep mode     — quiet hours
 *     one row per category → a page of Off / On choices
 *       (Instagram's "Posts, stories and comments" is "Posts and comments"
 *       here so it fits the app's shared header)
 *   Other notification types
 *     Email and in-app
 * Everything is stored on the server (routes/notification-prefs.ts).
 */
import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useApi } from '@/lib/api';
import { useRole } from '@/contexts/RoleContext';
import { ScreenHeader } from '@/components/ScreenHeader';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { useColors } from '@/hooks/useColors';
import { hapticToggle } from '@/lib/haptics';
import { ListRow } from '@/components/ui';
import { OptionSheet } from '@/components/ui/OptionSheet';
import { QUIET_HOURS_PRESETS, quietHoursPresetFor } from '@/components/notifications/QuietHoursRow';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';
import { FONT } from '@/lib/theme';
import { PAUSE_OPTIONS, pagesFor, pausedUntilLabel, type Role } from '@/lib/notificationSettingsModel';

export default function NotificationsSettingsScreen() {
  const router = useRouter();
  const api = useApi();
  const colors = useColors();
  // The app's current mode until the server answers (it resolves the role
  // from the session).
  const appRole = useRole().role;
  const [role, setRole] = useState<Role>(appRole === 'seller' ? 'seller' : 'buyer');
  const [pushEnabled, setPushEnabled] = useState(true);
  const [pausedUntil, setPausedUntil] = useState<string | null>(null);
  const [quietHours, setQuietHours] = useState<{ start: string | null; end: string | null }>({ start: null, end: null });
  const [pauseSheet, setPauseSheet] = useState(false);
  const [sleepSheet, setSleepSheet] = useState(false);

  const load = useCallback(() => {
    api.notificationPrefs.get()
      .then((data) => {
        setRole(data.role);
        setPushEnabled(data.pushEnabled ?? true);
        setPausedUntil(data.pausedUntil ?? null);
        setQuietHours({ start: data.quietHours?.start ?? null, end: data.quietHours?.end ?? null });
      })
      .catch(() => { /* rows keep their defaults; each change goes to the server */ });
  }, [api]);
  useFocusEffect(load);

  const pausedLabel = pausedUntilLabel(pausedUntil);
  // "Pause all" is on while a pause is running, and also for an account that
  // switched push off entirely with the old master switch.
  const pauseOn = !!pausedLabel || !pushEnabled;

  async function resume() {
    const prior = { pushEnabled, pausedUntil };
    setPushEnabled(true);
    setPausedUntil(null);
    try {
      const saved = await api.notificationPrefs.update({ pause: null, pushEnabled: true });
      setPausedUntil(saved.pausedUntil ?? null);
    } catch {
      setPushEnabled(prior.pushEnabled);
      setPausedUntil(prior.pausedUntil);
    }
  }

  async function pauseFor(minutes: number) {
    setPauseSheet(false);
    hapticToggle();
    try {
      const saved = await api.notificationPrefs.update({ pause: { minutes }, pushEnabled: true });
      setPushEnabled(true);
      setPausedUntil(saved.pausedUntil ?? null);
    } catch {
      /* the switch stays off */
    }
  }

  function onPauseToggle(next: boolean) {
    hapticToggle();
    if (next) setPauseSheet(true);
    else void resume();
  }

  async function onSleepMode(id: string) {
    setSleepSheet(false);
    const preset = QUIET_HOURS_PRESETS.find((p) => p.id === id);
    if (!preset) return;
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

  const sleepPreset = quietHoursPresetFor(quietHours.start, quietHours.end);

  return (
    <View style={styles.container}>
      <ScreenHeader title="Notifications" divider={false} onBack={() => goBackOr(router, '/(tabs)/more')} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text accessibilityRole="header" style={[styles.sectionTitle, { color: colors.foreground }]}>Push notifications</Text>
        <ListRow
          title="Pause all"
          subtitle={pausedLabel ?? 'Temporarily pause notifications'}
          toggle={{ value: pauseOn, onChange: onPauseToggle }}
          onPress={() => onPauseToggle(!pauseOn)}
          testID="notifications-pause-all"
        />
        <ListRow
          title="Sleep mode"
          subtitle="Mute notifications at night"
          value={sleepPreset.label}
          chevron
          onPress={() => setSleepSheet(true)}
          testID="notifications-sleep-mode"
        />
        {pagesFor(role).map((page) => (
          <ListRow
            key={page.id}
            title={page.title}
            chevron
            onPress={() => router.push(`/notification-settings-page?id=${page.id}` as never)}
            testID={`notifications-page-${page.id}`}
          />
        ))}

        <Text accessibilityRole="header" style={[styles.sectionTitle, styles.sectionGap, { color: colors.foreground }]}>Other notification types</Text>
        <ListRow
          title="Email and in-app"
          chevron
          onPress={() => router.push('/notification-channels' as never)}
        />
      </ScrollView>

      <OptionSheet
        visible={pauseSheet}
        onClose={() => setPauseSheet(false)}
        title="Pause all"
        description="You won't get push notifications, but you'll see new notifications when you open Brandthread."
        options={PAUSE_OPTIONS.map((o) => ({ id: String(o.minutes), label: o.label }))}
        selectedId=""
        onSelect={(id) => void pauseFor(Number(id))}
        testID="notifications-pause-sheet"
      />
      <OptionSheet
        visible={sleepSheet}
        onClose={() => setSleepSheet(false)}
        title="Sleep mode"
        options={QUIET_HOURS_PRESETS.map(({ id, label }) => ({ id, label }))}
        selectedId={sleepPreset.id}
        onSelect={(id) => void onSleepMode(id)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  content: { paddingHorizontal: SPACING.md, paddingTop: SPACING.sm, paddingBottom: 140 },
  sectionTitle: { ...TYPE_SCALE.headline, fontFamily: FONT.semibold, marginTop: SPACING.sm, marginBottom: SPACING.xs },
  sectionGap: { marginTop: SPACING.xl },
});
