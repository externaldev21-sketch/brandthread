import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FONT, SP } from '@/lib/theme';
import { useColors } from '@/hooks/useColors';
import { BuyerSettingsState, loadBuyerSettings, patchBuyerSettings } from '@/lib/buyerSettings';
import { reportNetworkError } from '@/lib/networkNotice';
import { useApi } from '@/hooks/useApi';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card, ListRow } from '@/components/ui';
import { goBackOr } from '@/lib/navigation/goBackOr';

type ToggleKey = keyof { [K in keyof BuyerSettingsState as BuyerSettingsState[K] extends boolean ? K : never]: true };
type Item = { label: string; sub?: string; icon?: keyof typeof Feather.glyphMap; toggle?: ToggleKey; value?: string; action?: () => void };

type Config = { title: string; intro?: string; items: (s: BuyerSettingsState, router?: ReturnType<typeof useRouter>) => Item[] };

const CONFIG: Record<string, Config> = {
  qr: { title: 'QR code', intro: 'Your unique profile code. Share it so people can find you on Brandthread.', items: (_s, router) => [{ label: 'Share QR code', icon: 'share-2', action: () => router?.push('/buyer-qr-code' as never) }] },
  'close-friends': { title: 'Close Friends', intro: 'Only people you add can see Close Friends stories and posts.', items: (_s, router) => [{ label: 'Manage close friends', icon: 'user-plus', action: () => router?.push('/buyer-close-friends' as never) }] },
  messages: { title: 'Messages and story replies', items: s => [{ label: 'Message requests', toggle: 'messageRequests' }, { label: 'Read receipts', toggle: 'readReceipts' }, { label: 'Show activity status', toggle: 'activityStatus' }, { label: 'Who can add you to groups', value: s.groupAdds }, { label: 'Story replies', value: s.storyReplies }] },
  muted: { title: 'Muted accounts', items: () => [{ label: 'No muted accounts', sub: 'People you mute will appear here.', icon: 'volume-x' }] },
  restricted: { title: 'Restricted accounts', items: () => [{ label: 'No restricted accounts', sub: 'Restricted people cannot see when you are online or when you read their messages.', icon: 'user-x' }] },
  favorites: { title: 'Favorites', intro: 'Follow sellers and brands to see more from them in Discover.', items: () => [] },
  content: { title: 'Content preferences', items: s => [{ label: 'Hide like and share counts', toggle: 'hideLikeCounts' }, { label: 'Sensitive content', value: s.sensitiveContent }, { label: 'Personalized recommendations', toggle: 'personalizedRecommendations' }, { label: 'Reset suggested content', icon: 'refresh-cw' }] },
  notifications: { title: 'Push notifications', intro: 'Choose which updates Brandthread may send to this device.', items: (s, router) => [
    { label: 'New drops', sub: 'Drops from sellers you follow', toggle: 'dropAlerts' },
    { label: 'Messages', sub: 'New direct messages and replies', toggle: 'messageNotifications' },
    { label: 'Order updates', sub: 'Shipping, delivery, returns, and refunds', toggle: 'orderUpdates' },
    { label: 'Friend activity', sub: 'Requests, follows, and social activity', toggle: 'friendActivity' },
    { label: 'Email & in-app', sub: 'Choose what reaches your inbox and your activity feed', icon: 'mail', action: () => router?.push('/notification-channels' as never) },
  ] },
  accessibility: { title: 'Accessibility', items: s => [{ label: 'Reduce motion', toggle: 'reduceMotion' }, { label: 'Always show captions', toggle: 'captions' }, { label: 'Text size', value: 'Default' }, { label: 'High contrast icons', value: 'Off' }] },
  appearance: { title: 'Appearance', items: s => [{ label: 'Theme', value: s.theme }, { label: 'Reduce motion', toggle: 'reduceMotion' }] },
  about: { title: 'About Brandthread', items: (_s, router) => [{ label: 'App version', value: '1.0.0' }, { label: 'Terms of service', icon: 'file-text', action: () => router?.push('/terms' as never) }, { label: 'Community guidelines', icon: 'users', action: () => router?.push('/community-guidelines' as never) }, { label: 'Privacy policy', icon: 'lock', action: () => router?.push('/privacy' as never) }, { label: 'Refund policy', icon: 'rotate-ccw', action: () => router?.push('/refund-policy' as never) }, { label: 'Seller agreement', icon: 'briefcase', action: () => router?.push('/seller-agreement' as never) }, { label: 'Open-source licenses', icon: 'code' }] },
};

export default function BuyerSettingsDetail() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { section = 'content' } = useLocalSearchParams<{ section?: string }>();
  const router = useRouter(); const insets = useSafeAreaInsets();
  const api = useApi();
  const [settings, setSettings] = useState<BuyerSettingsState | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [loading, setLoading] = useState(true);
  const cfg = CONFIG[section] ?? CONFIG.content;
  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const local = await loadBuyerSettings();
      if (section === 'notifications') {
        const remote = await api.notificationPrefs.get();
        local.dropAlerts = remote.categories.new_drops ?? true;
        local.messageNotifications = remote.categories.messages ?? true;
        local.orderUpdates = remote.categories.order_updates ?? true;
        local.friendActivity = remote.categories.friend_activity ?? true;
        await patchBuyerSettings(local);
      }
      setSettings(local);
    } catch (error) {
      setLoadError(true);
      reportNetworkError(error, () => load());
    } finally {
      setLoading(false);
    }
  }, [api, section]);
  useEffect(() => { load(); }, [load]);
  const toggle = useCallback(async (key: ToggleKey, value: boolean) => {
    const prior = settings;
    if (prior) setSettings({ ...prior, [key]: value });
    try {
      if (section === 'notifications') {
        const category = {
          dropAlerts: 'new_drops',
          messageNotifications: 'messages',
          orderUpdates: 'order_updates',
          friendActivity: 'friend_activity',
        }[key as string];
        if (category) await api.notificationPrefs.update({ categories: { [category]: value } });
      }
      const next = await patchBuyerSettings({ [key]: value } as Partial<BuyerSettingsState>);
      setSettings(next);
    } catch {
      setSettings(prior);
      Alert.alert('Could not update setting', 'Try again.');
    }
  }, [api, section, settings]);
  const items = useMemo(() => settings ? cfg.items(settings, router) : [], [cfg, settings, router]);

  return <View style={styles.page}>
    <ScreenHeader title={cfg.title} variant="push" onBack={() => goBackOr(router, '/buyer-settings-menu')} />
    <ScrollView contentContainerStyle={{ padding: SP.md, paddingBottom: insets.bottom + 40 }}>
      {cfg.intro ? <Text style={styles.intro}>{cfg.intro}</Text> : null}
      {loading ? <Text style={styles.intro}>Loading settings…</Text> : settings && items.length > 0 ? <Card style={styles.card}>{items.map((item, i) => {
        const isActionable = !!item.toggle || !!item.action;
        return <React.Fragment key={`${item.label}-${i}`}>
          <ListRow
            icon={item.icon}
            title={item.label}
            subtitle={item.sub}
            value={!item.toggle ? item.value : undefined}
            chevron={!item.toggle && !!item.action}
            toggle={item.toggle && settings ? { value: Boolean(settings[item.toggle]), onChange: (v) => toggle(item.toggle!, v) } : undefined}
            onPress={isActionable && item.action ? item.action : undefined}
            disabled={!isActionable}
          />
          {i < items.length - 1 && <View style={styles.divider} />}
        </React.Fragment>;
      })}</Card> : null}
    </ScrollView>
  </View>;
}
const makeStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  intro: { color: colors.mutedForeground, fontFamily: FONT.regular, fontSize: 13, lineHeight: 19, marginBottom: SP.md },
  card: { padding: 0, paddingHorizontal: SP.md },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
});
