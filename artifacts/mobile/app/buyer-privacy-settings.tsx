import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Alert, StyleSheet,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { PrimaryButton } from '@/components/BrandthreadUI';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { useRouter } from 'expo-router';
import { FONT, FS, SP, ICON } from '@/lib/theme';
import { useColors } from '@/hooks/useColors';
import { SettingsSection, SettingsRow } from '@/components/settings/SettingsKit';
import { getPrivacySettings, updatePrivacySettings } from '@/services/socialService';
import { PrivacySettings, AudienceOption, DmPrivacy } from '@/services/socialTypes';
import { useApi } from '@/lib/api';

export default function BuyerPrivacySettings() {
  const colors = useColors();
  const styles = React.useMemo(() => makeStyles(colors), [colors]);
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

  async function saveSettings(showConfirmation: boolean) {
    if (!settings) return;
    try {
      // Save local settings (stored in AsyncStorage)
      await updatePrivacySettings(settings);
      // Save server-side DM privacy setting
      await api.privacy.update({ dmPrivacy });
      setHasChanges(false);
      if (showConfirmation) Alert.alert('Saved', 'Privacy updated.');
    } catch {
      if (showConfirmation) Alert.alert('Error', "Couldn't save. Try again.");
      // On silent (back-navigation) saves, leave hasChanges set so the user
      // isn't told their change was saved when it wasn't.
    }
  }

  async function handleBack() {
    if (hasChanges) await saveSettings(false);
    router.back();
  }

  if (!settings) {
    return <View style={[styles.root, { paddingTop: insets.top }]} />;
  }

  return (
    <View style={styles.root}>
      {/* HEADER */}
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <TouchableOpacity onPress={handleBack} style={styles.headerBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="arrow-left" size={ICON.lg} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Privacy</Text>
        {hasChanges ? (
          <PrimaryButton label="Save" onPress={() => saveSettings(true)} small />
        ) : (
          <View style={styles.headerBtn} />
        )}
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: SP.md, paddingBottom: SP.xxl }} showsVerticalScrollIndicator={false}>
        {/* PROFILE VISIBILITY */}
        <SettingsSection title="Profile">
          <SettingsRow
            icon="eye"
            label="Profile visibility"
            value={settings.profileVisibility === 'public' ? 'Public' : 'Private'}
            last
            onPress={() =>
              Alert.alert('Profile Visibility', undefined, [
                { text: 'Public', onPress: () => update('profileVisibility', 'public') },
                { text: 'Private', onPress: () => update('profileVisibility', 'private') },
                { text: 'Cancel', style: 'cancel' },
              ])
            }
          />
        </SettingsSection>

        {/* INTERACTIONS */}
        <SettingsSection title="Who can...">
          <SettingsRow
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
          <SettingsRow
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
          <SettingsRow
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
          <SettingsRow
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
          <SettingsRow
            icon="at-sign"
            label="Mention you"
            value={audienceLabel(settings.whoCanMention)}
            last
            onPress={() =>
              showAudiencePicker(
                'Mentions',
                settings.whoCanMention,
                ['everyone', 'friends', 'nobody'],
                v => update('whoCanMention', v)
              )
            }
          />
        </SettingsSection>

        {/* ACTIVITY */}
        <SettingsSection title="Activity">
          <SettingsRow
            icon="activity"
            label="Activity status"
            subtitle="Let friends see when you're active"
            switchValue={settings.activityStatusVisible}
            onSwitchChange={v => update('activityStatusVisible', v)}
          />
          <SettingsRow
            icon="check-square"
            label="Read receipts"
            subtitle="Show when you've read messages"
            switchValue={settings.readReceiptsEnabled}
            onSwitchChange={v => update('readReceiptsEnabled', v)}
            last
          />
        </SettingsSection>

        {/* SEARCH & DISCOVERY */}
        <SettingsSection title="Search & Discovery">
          <SettingsRow
            icon="search"
            label="Appear in search"
            subtitle="Let others find your profile in search"
            switchValue={settings.searchable}
            onSwitchChange={v => update('searchable', v)}
          />
          <SettingsRow
            icon="phone"
            label="Contact discovery"
            subtitle="Find friends from contacts (no contacts uploaded without permission)"
            switchValue={settings.contactDiscovery}
            onSwitchChange={v => update('contactDiscovery', v)}
            last
          />
        </SettingsSection>

        {/* MESSAGES */}
        <SettingsSection title="Messages">
          <SettingsRow
            icon="message-circle"
            label="Who can message you"
            subtitle={
              dmPrivacy === 'followers_only'
                ? 'Only people you follow can send you DMs'
                : 'Others go to your Requests inbox until you accept'
            }
            value={dmPrivacy === 'followers_only' ? 'Followers only' : 'Everyone (with requests)'}
            last
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
        </SettingsSection>

        {/* BLOCKED & MUTED & RESTRICTED */}
        <SettingsSection title="Blocked & Muted">
          <SettingsRow
            icon="slash"
            label="Blocked accounts"
            value="Manage"
            onPress={() => router.push({ pathname: '/buyer-blocked' } as never)}
          />
          <SettingsRow
            icon="volume-x"
            label="Muted accounts"
            value="Manage"
            onPress={() => router.push('/buyer-muted' as never)}
          />
          <SettingsRow
            icon="user-x"
            label="Restricted accounts"
            value="Manage"
            last
            onPress={() => router.push('/buyer-restricted' as never)}
          />
        </SettingsSection>
      </ScrollView>
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: 'transparent',
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
      lineHeight: 21,
      fontFamily: FONT.semibold,
      color: colors.foreground,
    },
  });
}
