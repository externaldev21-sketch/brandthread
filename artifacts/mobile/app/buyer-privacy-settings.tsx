import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Switch, Alert, StyleSheet,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { PrimaryButton } from '@/components/BrandthreadUI';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { useRouter } from 'expo-router';
import {
  BG, CARD, BORDER, FG, MUTED, SUBTLE,
  ON_DARK,
  FONT, FS, SP, RADIUS, COMP, ICON,
} from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { getPrivacySettings, updatePrivacySettings } from '@/services/socialService';
import { PrivacySettings, AudienceOption, DmPrivacy } from '@/services/socialTypes';
import { useApi } from '@/lib/api';

export default function BuyerPrivacySettings() {
  const { theme } = useAppTheme();
  const PURPLE = theme.accent;
  const styles = makeStyles();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const api    = useApi();
  const [settings, setSettings] = useState<PrivacySettings | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  // dmPrivacy is server-backed — loaded from and saved to /api/auth/privacy
  const [dmPrivacy, setDmPrivacy] = useState<DmPrivacy>('requests');

  useFocusEffect(
    useCallback(() => {
      getPrivacySettings().then(setSettings);
      // Load server-side DM privacy setting
      api.privacy.get().then(({ dmPrivacy: p }) => setDmPrivacy(p)).catch(() => {});
    }, [])
  );

  function audienceLabel(val: AudienceOption): string {
    switch (val) {
      case 'everyone': return 'Everyone';
      case 'friends_of_friends': return 'Friends of friends';
      case 'friends': return 'Friends only';
      case 'nobody': return 'Nobody';
      case 'only_me': return 'Only me';
    }
  }

  function showAudiencePicker(
    title: string,
    current: AudienceOption,
    options: AudienceOption[],
    onSelect: (v: AudienceOption) => void
  ) {
    Alert.alert(
      title,
      undefined,
      [
        ...options.map(o => ({ text: audienceLabel(o), onPress: () => onSelect(o) })),
        { text: 'Cancel', style: 'cancel' as const },
      ]
    );
  }

  function update(key: keyof PrivacySettings, val: any) {
    setSettings(s => s ? { ...s, [key]: val } : s);
    setHasChanges(true);
  }

  async function saveSettings() {
    if (!settings) return;
    // Save local settings (stored in AsyncStorage)
    await updatePrivacySettings(settings);
    // Save server-side DM privacy setting
    await api.privacy.update({ dmPrivacy }).catch(() => {});
    setHasChanges(false);
    Alert.alert('Saved', 'Privacy settings updated.');
  }

  async function handleBack() {
    if (hasChanges) await saveSettings();
    router.back();
  }

  function PickerRow({
    icon, label, subtitle, value, onPress,
  }: { icon: string; label: string; subtitle?: string; value: string; onPress: () => void }) {
    return (
      <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
        <Feather name={icon as any} size={ICON.md} color={PURPLE} />
        <View style={styles.rowContent}>
          <Text style={styles.rowLabel}>{label}</Text>
          {subtitle ? <Text style={styles.rowSubtitle}>{subtitle}</Text> : null}
        </View>
        <View style={styles.rowRight}>
          <Text style={styles.rowValue}>{value}</Text>
          <Feather name="chevron-right" size={ICON.sm} color={SUBTLE} />
        </View>
      </TouchableOpacity>
    );
  }

  function ToggleRow({
    icon, label, subtitle, value, onToggle,
  }: { icon: string; label: string; subtitle?: string; value: boolean; onToggle: (v: boolean) => void }) {
    return (
      <View style={styles.row}>
        <Feather name={icon as any} size={ICON.md} color={PURPLE} />
        <View style={styles.rowContent}>
          <Text style={styles.rowLabel}>{label}</Text>
          {subtitle ? <Text style={styles.rowSubtitle}>{subtitle}</Text> : null}
        </View>
        <Switch
          value={value}
          onValueChange={onToggle}
          trackColor={{ false: BORDER, true: PURPLE }}
          thumbColor={ON_DARK}
        />
      </View>
    );
  }

  function SectionHeader({ title }: { title: string }) {
    return (
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionHeaderText}>{title}</Text>
      </View>
    );
  }

  if (!settings) {
    return <View style={[styles.root, { paddingTop: insets.top }]} />;
  }

  return (
    <View style={styles.root}>
      {/* HEADER */}
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <TouchableOpacity onPress={handleBack} style={styles.headerBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="arrow-left" size={ICON.lg} color={FG} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Privacy</Text>
        {hasChanges ? (
          <PrimaryButton label="Save" onPress={saveSettings} small />
        ) : (
          <View style={styles.headerBtn} />
        )}
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: SP.xxl }} showsVerticalScrollIndicator={false}>
        {/* PROFILE VISIBILITY */}
        <SectionHeader title="Profile" />
        <View style={styles.card}>
          <PickerRow
            icon="eye"
            label="Profile visibility"
            value={settings.profileVisibility === 'public' ? 'Public' : 'Private'}
            onPress={() =>
              Alert.alert('Profile Visibility', undefined, [
                { text: 'Public', onPress: () => update('profileVisibility', 'public') },
                { text: 'Private', onPress: () => update('profileVisibility', 'private') },
                { text: 'Cancel', style: 'cancel' },
              ])
            }
          />
        </View>

        {/* INTERACTIONS */}
        <SectionHeader title="Who can..." />
        <View style={[styles.card, styles.cardOverflow]}>
          <PickerRow
            icon="user-plus"
            label="Send friend requests"
            value={audienceLabel(settings.whoCanSendFriendRequests)}
            onPress={() =>
              showAudiencePicker(
                'Friend Requests',
                settings.whoCanSendFriendRequests,
                ['everyone', 'friends_of_friends', 'nobody'],
                v => update('whoCanSendFriendRequests', v)
              )
            }
          />
          <PickerRow
            icon="grid"
            label="See your posts"
            value={audienceLabel(settings.whoCanSeePosts)}
            onPress={() =>
              showAudiencePicker(
                'Post Visibility',
                settings.whoCanSeePosts,
                ['everyone', 'friends', 'only_me'],
                v => update('whoCanSeePosts', v)
              )
            }
          />
          <PickerRow
            icon="users"
            label="See your friends list"
            value={audienceLabel(settings.whoCanSeeFriendsList)}
            onPress={() =>
              showAudiencePicker(
                'Friends List',
                settings.whoCanSeeFriendsList,
                ['everyone', 'friends', 'only_me'],
                v => update('whoCanSeeFriendsList', v)
              )
            }
          />
          <PickerRow
            icon="message-square"
            label="Reply to stories"
            value={audienceLabel(settings.whoCanReplyToStories)}
            onPress={() =>
              showAudiencePicker(
                'Story Replies',
                settings.whoCanReplyToStories,
                ['everyone', 'friends', 'nobody'],
                v => update('whoCanReplyToStories', v)
              )
            }
          />
          <PickerRow
            icon="at-sign"
            label="Mention you"
            value={audienceLabel(settings.whoCanMention)}
            onPress={() =>
              showAudiencePicker(
                'Mentions',
                settings.whoCanMention,
                ['everyone', 'friends', 'nobody'],
                v => update('whoCanMention', v)
              )
            }
          />
        </View>

        {/* ACTIVITY */}
        <SectionHeader title="Activity" />
        <View style={[styles.card, styles.cardOverflow]}>
          <ToggleRow
            icon="activity"
            label="Activity status"
            subtitle="Let friends see when you're active"
            value={settings.activityStatusVisible}
            onToggle={v => update('activityStatusVisible', v)}
          />
          <ToggleRow
            icon="check-square"
            label="Read receipts"
            subtitle="Show when you've read messages"
            value={settings.readReceiptsEnabled}
            onToggle={v => update('readReceiptsEnabled', v)}
          />
        </View>

        {/* SEARCH & DISCOVERY */}
        <SectionHeader title="Search & Discovery" />
        <View style={[styles.card, styles.cardOverflow]}>
          <ToggleRow
            icon="search"
            label="Appear in search"
            subtitle="Let others find your profile in search"
            value={settings.searchable}
            onToggle={v => update('searchable', v)}
          />
          <ToggleRow
            icon="phone"
            label="Contact discovery"
            subtitle="Find friends from contacts (no contacts uploaded without permission)"
            value={settings.contactDiscovery}
            onToggle={v => update('contactDiscovery', v)}
          />
        </View>

        {/* MESSAGES */}
        <SectionHeader title="Messages" />
        <View style={[styles.card, styles.cardOverflow]}>
          <PickerRow
            icon="message-circle"
            label="Who can message you"
            subtitle={
              dmPrivacy === 'followers_only'
                ? 'Only people you follow can send you DMs'
                : 'Others go to your Requests inbox until you accept'
            }
            value={dmPrivacy === 'followers_only' ? 'Followers only' : 'Everyone (with requests)'}
            onPress={() =>
              Alert.alert(
                'Who can message you',
                'Others can always see your profile, but direct messages from non-followers are handled based on this setting.',
                [
                  {
                    text: 'Everyone (non-followers go to Requests)',
                    onPress: () => { setDmPrivacy('requests'); setHasChanges(true); },
                  },
                  {
                    text: 'Followers only (block others entirely)',
                    onPress: () => { setDmPrivacy('followers_only'); setHasChanges(true); },
                  },
                  { text: 'Cancel', style: 'cancel' },
                ]
              )
            }
          />
        </View>

        {/* BLOCKED & MUTED & RESTRICTED */}
        <SectionHeader title="Blocked & Muted" />
        <View style={[styles.card, styles.cardOverflow]}>
          <PickerRow
            icon="slash"
            label="Blocked accounts"
            value="Manage"
            onPress={() => router.push({ pathname: '/buyer-blocked' } as never)}
          />
          <PickerRow
            icon="volume-x"
            label="Muted accounts"
            value="Manage"
            onPress={() => router.push('/buyer-muted' as never)}
          />
          <PickerRow
            icon="user-x"
            label="Restricted accounts"
            value="Manage"
            onPress={() => router.push('/buyer-restricted' as never)}
          />
        </View>
      </ScrollView>
    </View>
  );
}

const makeStyles = () => StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BG,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SP.md,
    paddingBottom: SP.sm,
  },
  headerBtn: {
    width: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: FS.md,
    fontFamily: FONT.semibold,
    color: FG,
  },
  sectionHeader: {
    paddingHorizontal: SP.md,
    paddingTop: SP.lg,
    paddingBottom: SP.sm,
  },
  sectionHeaderText: {
    color: MUTED,
    fontSize: FS.xs,
    fontFamily: FONT.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  card: {
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: RADIUS.md,
    marginHorizontal: SP.md,
  },
  cardOverflow: {
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SP.md,
    paddingVertical: SP.md,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  rowContent: {
    flex: 1,
    marginLeft: SP.md,
  },
  rowLabel: {
    color: FG,
    fontFamily: FONT.medium,
    fontSize: FS.base,
  },
  rowSubtitle: {
    color: MUTED,
    fontSize: FS.xs,
    marginTop: 2,
  },
  rowRight: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.xs,
  },
  rowValue: {
    color: MUTED,
    fontSize: FS.sm,
  },
});
