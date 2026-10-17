import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert, Linking, PixelRatio, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FONT, SP } from '@/lib/theme';
import { useColors } from '@/hooks/useColors';
import { BuyerSettingsState, loadBuyerSettings, patchBuyerSettings } from '@/lib/buyerSettings';
import { hydrateBuyerSettings, updateBuyerSettings } from '@/lib/buyerSettingsSync';
import { apiErrorMessage } from '@/lib/safety';
import { useApi } from '@/hooks/useApi';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card, ListRow, OptionSheet, OptionSheetOption } from '@/components/ui';
import { goBackOr } from '@/lib/navigation/goBackOr';

type ToggleKey = keyof { [K in keyof BuyerSettingsState as BuyerSettingsState[K] extends boolean ? K : never]: true };
type PickerKey = 'groupAdds' | 'storyReplies' | 'sensitiveContent';
type Item = {
  label: string; sub?: string; icon?: keyof typeof Feather.glyphMap; toggle?: ToggleKey; value?: string;
  action?: () => void; picker?: PickerKey;
};

type Ctx = { router: ReturnType<typeof useRouter>; resetSuggestions: () => void; showTextSize: () => void };
type Config = { title: string; intro?: string; items: (s: BuyerSettingsState, ctx: Ctx) => Item[] };

const PICKERS: Record<PickerKey, { title: string; description?: string; options: OptionSheetOption[] }> = {
  groupAdds: {
    title: 'Who can add you to groups',
    options: [
      { id: 'everyone', label: 'Everyone', description: 'Anyone who can message you' },
      { id: 'friends', label: 'Only people you follow' },
    ],
  },
  storyReplies: {
    title: 'Story replies',
    description: 'Applies to new stories you share.',
    options: [
      { id: 'everyone', label: 'Everyone' },
      { id: 'friends', label: 'People you follow' },
      { id: 'off', label: 'Off', description: 'Nobody can reply to your stories' },
    ],
  },
  sensitiveContent: {
    title: 'Sensitive content',
    description: 'Saved to your account and applied as Brandthread adds sensitive-content filtering.',
    options: [
      { id: 'less', label: 'Less' },
      { id: 'standard', label: 'Standard' },
      { id: 'more', label: 'More' },
    ],
  },
};

function pickerLabel(key: PickerKey, s: BuyerSettingsState): string {
  return PICKERS[key].options.find((o) => o.id === s[key])?.label ?? String(s[key]);
}

function textScaleLabel(): string {
  const scale = PixelRatio.getFontScale();
  return `Device · ${Math.round((Number.isFinite(scale) && scale > 0 ? scale : 1) * 100)}%`;
}

const CONFIG: Record<string, Config> = {
  activity: { title: 'Your activity', intro: 'Review and manage the things you do on Brandthread.', items: () => [
    { label: 'Likes', icon: 'heart' }, { label: 'Comments', icon: 'message-square' }, { label: 'Story replies', icon: 'corner-up-left' }, { label: 'Search history', icon: 'search' }, { label: 'Links you visited', icon: 'link' }, { label: 'Recently deleted', icon: 'trash-2' }, { label: 'Time spent', icon: 'clock', value: 'Daily average' },
  ]},
  archive: { title: 'Archive', items: () => [{ label: 'Posts archive', icon: 'grid' }, { label: 'Stories archive', icon: 'clock' }, { label: 'Live archive', icon: 'video' }] },
  qr: { title: 'QR code', intro: 'Your unique profile code. Share it so people can find you on Brandthread.', items: (_s, { router }) => [{ label: 'Share QR code', icon: 'share-2', action: () => router.push('/buyer-qr-code' as never) }] },
  'close-friends': { title: 'Close Friends', intro: 'Only people you add can see Close Friends stories and posts.', items: (_s, { router }) => [{ label: 'Manage close friends', icon: 'user-plus', action: () => router.push('/buyer-close-friends' as never) }] },
  story: { title: 'Story and live', items: s => [{ label: 'Allow story replies', icon: 'message-circle', picker: 'storyReplies', value: pickerLabel('storyReplies', s) }, { label: 'Allow sharing to messages', toggle: 'storySharing' }, { label: 'Hide story from people', icon: 'eye-off', value: '0 people' }, { label: 'Close Friends', icon: 'star' }] },
  messages: { title: 'Messages and story replies', items: s => [
    { label: 'Message requests', sub: s.messageRequests ? 'People you don’t follow land in your requests' : 'Only people you follow can message you', toggle: 'messageRequests' },
    { label: 'Read receipts', sub: 'When off, people won’t see when you’ve read their messages', toggle: 'readReceipts' },
    { label: 'Show activity status', sub: 'Saved to your account. Brandthread doesn’t show online status yet.', toggle: 'activityStatus' },
    { label: 'Who can add you to groups', picker: 'groupAdds', value: pickerLabel('groupAdds', s) },
    { label: 'Story replies', picker: 'storyReplies', value: pickerLabel('storyReplies', s) },
  ] },
  tags: { title: 'Tags and mentions', items: s => [{ label: 'Who can mention you', value: s.allowMentions }, { label: 'Who can tag you', value: s.allowTags }, { label: 'Manually approve tags', toggle: 'manualTagApproval' }, { label: 'Pending tags', value: '0' }] },
  comments: { title: 'Comments', items: () => [{ label: 'Allow comments from', value: 'Everyone' }, { label: 'Block comments from', value: '0 people' }, { label: 'Hide offensive comments', icon: 'shield' }, { label: 'Filter specific words', icon: 'filter' }] },
  sharing: { title: 'Sharing and remixes', items: s => [{ label: 'Allow people to share your posts to stories', toggle: 'storySharing' }, { label: 'Allow reposts', value: 'On' }, { label: 'Allow remixes of videos', value: 'Friends' }, { label: 'Allow downloads of your content', value: 'Off' }] },
  'hidden-words': { title: 'Hidden Words', intro: 'Automatically filter comments and message requests containing offensive or custom words.', items: s => [{ label: 'Hide offensive comments', toggle: 'hiddenWords' }, { label: 'Advanced comment filtering', toggle: 'hiddenWords' }, { label: 'Custom words and phrases', value: 'Manage list' }] },
  muted: { title: 'Muted accounts', items: () => [{ label: 'No muted accounts', sub: 'People you mute will appear here.', icon: 'volume-x' }] },
  restricted: { title: 'Restricted accounts', items: () => [{ label: 'No restricted accounts', sub: 'Restricted people cannot see when you are online or when you read their messages.', icon: 'user-x' }] },
  favorites: { title: 'Favorites', intro: 'Follow sellers and brands to see more from them in Discover.', items: () => [] },
  content: { title: 'Content preferences', items: (s, { resetSuggestions }) => [
    { label: 'Hide like and share counts', toggle: 'hideLikeCounts' },
    { label: 'Sensitive content', picker: 'sensitiveContent', value: pickerLabel('sensitiveContent', s) },
    { label: 'Personalized recommendations', sub: s.personalizedRecommendations ? 'For You is ranked from what you like and follow' : 'For You shows the newest and most popular posts', toggle: 'personalizedRecommendations' },
    { label: 'Reset suggested content', icon: 'refresh-cw', action: resetSuggestions },
  ] },
  suggested: { title: 'Suggested content', items: (s, { router, resetSuggestions }) => [{ label: 'Personalized recommendations', toggle: 'personalizedRecommendations' }, { label: 'Snooze suggested posts', value: 'Off' }, { label: 'Specific words and phrases', value: 'Manage', action: () => router.push('/muted-words' as never) }, { label: 'Reset recommendations', icon: 'refresh-cw', action: resetSuggestions }] },
  payments: { title: 'Addresses and payments', items: () => [{ label: 'Shipping addresses', icon: 'map-pin', value: '1 saved' }, { label: 'Payment methods', icon: 'credit-card', value: 'Manage' }, { label: 'Autofill checkout info', icon: 'zap', value: 'On' }, { label: 'Purchase protection', icon: 'shield', value: 'Brandthread protected' }] },
  notifications: { title: 'Push notifications', intro: 'Choose which updates Brandthread may send to this device.', items: (_s, { router }) => [
    { label: 'New drops', sub: 'Drops from sellers you follow', toggle: 'dropAlerts' },
    { label: 'Messages', sub: 'New direct messages and replies', toggle: 'messageNotifications' },
    { label: 'Order updates', sub: 'Shipping, delivery, returns, and refunds', toggle: 'orderUpdates' },
    { label: 'Friend activity', sub: 'Requests, follows, and social activity', toggle: 'friendActivity' },
    { label: 'Email & in-app', sub: 'Choose what reaches your inbox and your activity feed', icon: 'mail', action: () => router.push('/notification-channels' as never) },
  ] },
  accessibility: { title: 'Accessibility', items: (_s, { showTextSize }) => [
    { label: 'Reduce motion', sub: 'Tone down animations across the app', toggle: 'reduceMotion' },
    { label: 'Always show captions', toggle: 'captions' },
    { label: 'Text size', value: textScaleLabel(), action: showTextSize },
    { label: 'High contrast', sub: 'Stronger secondary text and dividers', toggle: 'highContrast' },
    { label: 'Use less cellular data', toggle: 'dataSaver' },
    { label: 'Upload at highest quality', sub: 'Off makes photo uploads smaller and faster', toggle: 'highQualityUploads' },
    { label: 'Autoplay videos', toggle: 'autoplayVideos' },
  ] },
  language: { title: 'Language', items: s => [{ label: 'App language', value: s.language }, { label: 'Translation language', value: 'English' }, { label: 'Auto-translate captions', value: 'On' }] },
  media: { title: 'Media quality and data usage', items: s => [{ label: 'Use less cellular data', toggle: 'dataSaver' }, { label: 'Upload at highest quality', toggle: 'highQualityUploads' }, { label: 'Autoplay videos', toggle: 'autoplayVideos' }] },
  appearance: { title: 'Appearance', items: s => [{ label: 'Theme', value: s.theme }, { label: 'Reduce motion', toggle: 'reduceMotion' }] },
  'privacy-center': { title: 'Privacy Center', items: () => [{ label: 'Privacy policy', icon: 'file-text' }, { label: 'How Brandthread uses your data', icon: 'database' }, { label: 'Ad and recommendation controls', icon: 'sliders' }, { label: 'Download your information', icon: 'download' }] },
  about: { title: 'About Brandthread', items: (_s, { router }) => [{ label: 'App version', value: '1.0.0' }, { label: 'Terms of service', icon: 'file-text', action: () => router.push('/terms' as never) }, { label: 'Community guidelines', icon: 'users', action: () => router.push('/community-guidelines' as never) }, { label: 'Privacy policy', icon: 'lock', action: () => router.push('/privacy' as never) }, { label: 'Refund policy', icon: 'rotate-ccw', action: () => router.push('/refund-policy' as never) }, { label: 'Seller agreement', icon: 'briefcase', action: () => router.push('/seller-agreement' as never) }, { label: 'Open-source licenses', icon: 'code', action: () => router.push('/open-source-licenses' as never) }] },
};

/** Sections whose rows are server-backed and should be refreshed from /api/me/settings on open. */
const SERVER_SECTIONS = new Set(['messages', 'content', 'suggested', 'accessibility', 'media', 'appearance', 'story']);

export default function BuyerSettingsDetail() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { section = 'content' } = useLocalSearchParams<{ section?: string }>();
  const router = useRouter(); const insets = useSafeAreaInsets();
  const api = useApi();
  const [settings, setSettings] = useState<BuyerSettingsState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [picker, setPicker] = useState<PickerKey | null>(null);
  const cfg = CONFIG[section] ?? CONFIG.content;
  const load = useCallback(async () => {
    setLoadError(null);
    try {
      let local = await loadBuyerSettings();
      setSettings(local);
      if (section === 'notifications') {
        const remote = await api.notificationPrefs.get();
        local.dropAlerts = remote.categories.new_drops ?? true;
        local.messageNotifications = remote.categories.messages ?? true;
        local.orderUpdates = remote.categories.order_updates ?? true;
        local.friendActivity = remote.categories.friend_activity ?? true;
        local = await patchBuyerSettings(local);
      } else if (SERVER_SECTIONS.has(section)) {
        local = await hydrateBuyerSettings(api);
      }
      setSettings(local);
    } catch (error) {
      setLoadError(apiErrorMessage(error, 'Couldn’t load your saved settings. Changes may not save until you’re back online.'));
    } finally {
      setLoading(false);
    }
  }, [api, section]);
  useEffect(() => { load(); }, [load]);

  const save = useCallback(async (patch: Partial<BuyerSettingsState>) => {
    const prior = settings;
    if (prior) setSettings({ ...prior, ...patch });
    try {
      if (section === 'notifications') {
        const [key, value] = Object.entries(patch)[0] ?? [];
        const category = ({
          dropAlerts: 'new_drops',
          messageNotifications: 'messages',
          orderUpdates: 'order_updates',
          friendActivity: 'friend_activity',
        } as Record<string, string>)[key as string];
        if (category) await api.notificationPrefs.update({ categories: { [category]: Boolean(value) } });
        setSettings(await patchBuyerSettings(patch));
      } else {
        setSettings(await updateBuyerSettings(api, patch));
      }
    } catch (error) {
      setSettings(prior);
      Alert.alert('Couldn’t update setting', apiErrorMessage(error, 'Check your connection and try again.'));
    }
  }, [api, section, settings]);

  const resetSuggestions = useCallback(() => {
    Alert.alert(
      'Reset suggested content?',
      'For You will forget what it learned from your activity and start fresh. Brands you follow and styles you picked stay.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset', style: 'destructive', onPress: async () => {
            try {
              await api.meSettings.resetRecommendations();
              Alert.alert('Suggestions reset', 'Your For You feed will start fresh.');
            } catch (error) {
              Alert.alert('Couldn’t reset suggestions', apiErrorMessage(error, 'Check your connection and try again.'));
            }
          },
        },
      ],
    );
  }, [api]);

  const showTextSize = useCallback(() => {
    Alert.alert(
      'Text size',
      `Brandthread follows your device’s text size (currently ${Math.round(PixelRatio.getFontScale() * 100)}%). Change it in your device’s ${Platform.OS === 'ios' ? 'Display & Text Size' : 'Display'} settings.`,
      Platform.OS === 'web'
        ? [{ text: 'OK' }]
        : [{ text: 'Not now', style: 'cancel' }, { text: 'Open Settings', onPress: () => { void Linking.openSettings().catch(() => {}); } }],
    );
  }, []);

  const items = useMemo(
    () => settings ? cfg.items(settings, { router, resetSuggestions, showTextSize }) : [],
    [cfg, settings, router, resetSuggestions, showTextSize],
  );
  const activePicker = picker ? PICKERS[picker] : null;

  return <View style={styles.page}>
    <ScreenHeader title={cfg.title} variant="push" onBack={() => goBackOr(router, '/buyer-settings-menu')} />
    <ScrollView contentContainerStyle={{ padding: SP.md, paddingBottom: insets.bottom + 40 }}>
      {cfg.intro ? <Text style={styles.intro}>{cfg.intro}</Text> : null}
      {loadError ? <Card style={[styles.card, styles.errorCard]}>
        <ListRow icon="alert-circle" iconColor={colors.destructive} title={loadError} value="Retry" onPress={() => { void load(); }} />
      </Card> : null}
      {loading && !settings ? <Text style={styles.intro}>Loading settings…</Text> : settings && items.length > 0 ? <Card style={styles.card}>{items.map((item, i) => {
        const isActionable = !!item.toggle || !!item.action || !!item.picker;
        const onPress = item.picker ? () => setPicker(item.picker!) : item.action;
        return <React.Fragment key={`${item.label}-${i}`}>
          <ListRow
            icon={item.icon}
            title={item.label}
            subtitle={item.sub}
            value={!item.toggle ? item.value : undefined}
            chevron={!item.toggle && (!!item.action || !!item.picker)}
            toggle={item.toggle && settings ? { value: Boolean(settings[item.toggle]), onChange: (v) => { void save({ [item.toggle!]: v } as Partial<BuyerSettingsState>); } } : undefined}
            onPress={!item.toggle && onPress ? onPress : undefined}
            disabled={!isActionable}
          />
          {i < items.length - 1 && <View style={styles.divider} />}
        </React.Fragment>;
      })}</Card> : null}
    </ScrollView>
    {activePicker && settings ? (
      <OptionSheet
        visible={!!picker}
        onClose={() => setPicker(null)}
        title={activePicker.title}
        description={activePicker.description}
        options={activePicker.options}
        selectedId={String(settings[picker!])}
        onSelect={(id) => { const key = picker!; setPicker(null); void save({ [key]: id } as Partial<BuyerSettingsState>); }}
      />
    ) : null}
  </View>;
}
const makeStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  intro: { color: colors.mutedForeground, fontFamily: FONT.regular, fontSize: 13, lineHeight: 19, marginBottom: SP.md },
  card: { padding: 0, paddingHorizontal: SP.md },
  errorCard: { marginBottom: SP.md },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
});
