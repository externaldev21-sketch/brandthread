import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Switch, StyleSheet, Alert } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { BuyerSettingsState, loadBuyerSettings, patchBuyerSettings } from '@/lib/buyerSettings';
import { reportNetworkError } from '@/lib/networkNotice';
import { useApi } from '@/hooks/useApi';

type ToggleKey = keyof { [K in keyof BuyerSettingsState as BuyerSettingsState[K] extends boolean ? K : never]: true };
type Item = { label: string; sub?: string; icon?: keyof typeof Feather.glyphMap; toggle?: ToggleKey; value?: string; action?: () => void };

type Config = { title: string; intro?: string; items: (s: BuyerSettingsState) => Item[] };

const CONFIG: Record<string, Config> = {
  activity: { title: 'Your activity', intro: 'Review and manage the things you do on Brandthread.', items: () => [
    { label: 'Likes', icon: 'heart' }, { label: 'Comments', icon: 'message-square' }, { label: 'Story replies', icon: 'corner-up-left' }, { label: 'Search history', icon: 'search' }, { label: 'Links you visited', icon: 'link' }, { label: 'Recently deleted', icon: 'trash-2' }, { label: 'Time spent', icon: 'clock', value: 'Daily average' },
  ]},
  archive: { title: 'Archive', items: () => [{ label: 'Posts archive', icon: 'grid' }, { label: 'Stories archive', icon: 'clock' }, { label: 'Live archive', icon: 'video' }] },
  qr: { title: 'QR code', intro: 'Your unique profile code. Share it so people can find you on Brandthread.', items: () => [{ label: '@jordan', icon: 'user', value: 'Profile QR ready' }, { label: 'Share QR code', icon: 'share-2' }] },
  'close-friends': { title: 'Close Friends', intro: 'Only people you add can see Close Friends stories and posts.', items: () => [{ label: 'Maya Chen', icon: 'user', value: 'Added' }, { label: 'Kai Nakamura', icon: 'user', value: 'Added' }, { label: 'Add people', icon: 'user-plus' }] },
  story: { title: 'Story and live', items: s => [{ label: 'Allow story replies', icon: 'message-circle', value: s.storyReplies }, { label: 'Allow sharing to messages', toggle: 'storySharing' }, { label: 'Hide story from people', icon: 'eye-off', value: '0 people' }, { label: 'Close Friends', icon: 'star' }] },
  messages: { title: 'Messages and story replies', items: s => [{ label: 'Message requests', toggle: 'messageRequests' }, { label: 'Read receipts', toggle: 'readReceipts' }, { label: 'Show activity status', toggle: 'activityStatus' }, { label: 'Who can add you to groups', value: s.groupAdds }, { label: 'Story replies', value: s.storyReplies }] },
  tags: { title: 'Tags and mentions', items: s => [{ label: 'Who can mention you', value: s.allowMentions }, { label: 'Who can tag you', value: s.allowTags }, { label: 'Manually approve tags', toggle: 'manualTagApproval' }, { label: 'Pending tags', value: '0' }] },
  comments: { title: 'Comments', items: () => [{ label: 'Allow comments from', value: 'Everyone' }, { label: 'Block comments from', value: '0 people' }, { label: 'Hide offensive comments', icon: 'shield' }, { label: 'Filter specific words', icon: 'filter' }] },
  sharing: { title: 'Sharing and remixes', items: s => [{ label: 'Allow people to share your posts to stories', toggle: 'storySharing' }, { label: 'Allow reposts', value: 'On' }, { label: 'Allow remixes of videos', value: 'Friends' }, { label: 'Allow downloads of your content', value: 'Off' }] },
  'hidden-words': { title: 'Hidden Words', intro: 'Automatically filter comments and message requests containing offensive or custom words.', items: s => [{ label: 'Hide offensive comments', toggle: 'hiddenWords' }, { label: 'Advanced comment filtering', toggle: 'hiddenWords' }, { label: 'Custom words and phrases', value: 'Manage list' }] },
  muted: { title: 'Muted accounts', items: () => [{ label: 'No muted accounts', sub: 'People you mute will appear here.', icon: 'volume-x' }] },
  restricted: { title: 'Restricted accounts', items: () => [{ label: 'No restricted accounts', sub: 'Restricted people cannot see when you are online or when you read their messages.', icon: 'user-x' }] },
  favorites: { title: 'Favorites', intro: 'Posts and drops from favorites are shown higher in Discover and your following views.', items: () => [{ label: 'Vault Studios', icon: 'star', value: 'Brand' }, { label: 'NxGen', icon: 'star', value: 'Brand' }, { label: 'Add favorites', icon: 'plus' }] },
  content: { title: 'Content preferences', items: s => [{ label: 'Hide like and share counts', toggle: 'hideLikeCounts' }, { label: 'Sensitive content', value: s.sensitiveContent }, { label: 'Personalized recommendations', toggle: 'personalizedRecommendations' }, { label: 'Reset suggested content', icon: 'refresh-cw' }] },
  suggested: { title: 'Suggested content', items: s => [{ label: 'Personalized recommendations', toggle: 'personalizedRecommendations' }, { label: 'Snooze suggested posts', value: 'Off' }, { label: 'Specific words and phrases', value: 'Manage' }, { label: 'Reset recommendations', icon: 'refresh-cw' }] },
  payments: { title: 'Addresses and payments', items: () => [{ label: 'Shipping addresses', icon: 'map-pin', value: '1 saved' }, { label: 'Payment methods', icon: 'credit-card', value: 'Manage' }, { label: 'Autofill checkout info', icon: 'zap', value: 'On' }, { label: 'Purchase protection', icon: 'shield', value: 'Brandthread protected' }] },
  notifications: { title: 'Push notifications', intro: 'Choose which updates Brandthread may send to this device.', items: s => [
    { label: 'New drops', sub: 'Drops from sellers you follow', toggle: 'dropAlerts' },
    { label: 'Messages', sub: 'New direct messages and replies', toggle: 'messageNotifications' },
    { label: 'Order updates', sub: 'Shipping, delivery, returns, and refunds', toggle: 'orderUpdates' },
    { label: 'Friend activity', sub: 'Requests, follows, and social activity', toggle: 'friendActivity' },
  ] },
  accessibility: { title: 'Accessibility', items: s => [{ label: 'Reduce motion', toggle: 'reduceMotion' }, { label: 'Always show captions', toggle: 'captions' }, { label: 'Text size', value: 'Default' }, { label: 'High contrast icons', value: 'Off' }] },
  language: { title: 'Language', items: s => [{ label: 'App language', value: s.language }, { label: 'Translation language', value: 'English' }, { label: 'Auto-translate captions', value: 'On' }] },
  media: { title: 'Media quality and data usage', items: s => [{ label: 'Use less cellular data', toggle: 'dataSaver' }, { label: 'Upload at highest quality', toggle: 'highQualityUploads' }, { label: 'Autoplay videos', toggle: 'autoplayVideos' }] },
  appearance: { title: 'Appearance', items: s => [{ label: 'Theme', value: s.theme }, { label: 'Reduce motion', toggle: 'reduceMotion' }] },
  'privacy-center': { title: 'Privacy Center', items: () => [{ label: 'Privacy policy', icon: 'file-text' }, { label: 'How Brandthread uses your data', icon: 'database' }, { label: 'Ad and recommendation controls', icon: 'sliders' }, { label: 'Download your information', icon: 'download' }] },
  about: { title: 'About Brandthread', items: () => [{ label: 'App version', value: '1.0.0' }, { label: 'Terms of service', icon: 'file-text' }, { label: 'Community guidelines', icon: 'users' }, { label: 'Open-source licenses', icon: 'code' }] },
};

export default function BuyerSettingsDetail() {
  const { theme } = useAppTheme();
  const PURPLE = theme.accent;
  const styles = makeStyles(theme);
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
    Haptics.selectionAsync();
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
  const items = useMemo(() => settings ? cfg.items(settings) : [], [cfg, settings]);

  return <View style={[styles.page, { paddingTop: insets.top }]}>
     <View style={styles.header}><TouchableOpacity style={styles.back} onPress={() => router.back()}><Feather name="arrow-left" size={21} color={theme.text}/></TouchableOpacity><Text style={styles.title}>{cfg.title}</Text><View style={styles.back}/></View>
    <ScrollView contentContainerStyle={{ padding: SP.md, paddingBottom: insets.bottom + 40 }}>
      {cfg.intro ? <Text style={styles.intro}>{cfg.intro}</Text> : null}
      {loading ? <Text style={styles.intro}>Loading settings…</Text> : settings ? <View style={styles.card}>{items.map((item, i) => <TouchableOpacity key={`${item.label}-${i}`} activeOpacity={item.toggle ? 1 : 0.7} style={[styles.row, i < items.length - 1 && styles.divider]} onPress={() => { if (!item.toggle) { Haptics.selectionAsync(); item.action?.(); if (!item.action && !item.value?.toLowerCase().includes('off')) Alert.alert(item.label, 'This control is ready for backend wiring.'); } }}>
         {item.icon ? <View style={styles.itemIcon}><Feather name={item.icon} size={19} color={theme.text}/></View> : null}
        <View style={{ flex: 1 }}><Text style={styles.label}>{item.label}</Text>{item.sub ? <Text style={styles.sub}>{item.sub}</Text> : null}</View>
         {item.toggle && settings ? <Switch value={Boolean(settings[item.toggle])} onValueChange={(v) => toggle(item.toggle!, v)} trackColor={{ false: theme.cardElevated, true: PURPLE }} thumbColor={theme.onAccent} /> : <><Text style={styles.value}>{item.value}</Text><Feather name="chevron-right" size={18} color={theme.subtle}/></>}
      </TouchableOpacity>)}</View> : null}
    </ScrollView>
  </View>;
}
const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({ page:{flex:1,backgroundColor:theme.background}, header:{height:58,flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:SP.md,borderBottomWidth:1,borderBottomColor:theme.border},back:{width:40,height:40,alignItems:'center',justifyContent:'center'},title:{color:theme.text,fontFamily:FONT.bold,fontSize:FS.md},intro:{color:theme.muted,fontFamily:FONT.regular,fontSize:13,lineHeight:19,marginBottom:SP.md},card:{backgroundColor:theme.card,borderWidth:1,borderColor:theme.border,borderRadius:RADIUS.lg,overflow:'hidden'},row:{minHeight:60,paddingHorizontal:14,paddingVertical:12,flexDirection:'row',alignItems:'center',gap:10},divider:{borderBottomWidth:1,borderBottomColor:theme.border},itemIcon:{width:28,alignItems:'center'},label:{color:theme.text,fontFamily:FONT.medium,fontSize:14},sub:{color:theme.muted,fontFamily:FONT.regular,fontSize:11.5,marginTop:3,lineHeight:16},value:{color:theme.muted,fontFamily:FONT.regular,fontSize:12,textTransform:'capitalize',maxWidth:110},});
