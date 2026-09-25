import React, { useState, useCallback } from 'react';
import {
  View, ScrollView, Alert, StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { SP } from '@/lib/theme';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SectionHeader } from '@/components/BrandthreadUI';
import { Card, ListRow, Button } from '@/components/ui';
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
      <ScreenHeader
        title="Privacy"
        variant="push"
        onBack={handleBack}
        rightElement={hasChanges ? <Button label="Save" size="small" onPress={() => saveSettings(true)} /> : undefined}
      />

      <ScrollView contentContainerStyle={{ paddingHorizontal: SP.md, paddingTop: SP.md, paddingBottom: SP.xxl }} showsVerticalScrollIndicator={false}>
        {/* PROFILE VISIBILITY */}
        <SectionHeader title="PROFILE" />
        <Card style={styles.card}>
          <ListRow
            icon="eye"
            title="Profile visibility"
            value={settings.profileVisibility === 'public' ? 'Public' : 'Private'}
            chevron
            onPress={() =>
              Alert.alert('Profile Visibility', undefined, [
                { text: 'Public', onPress: () => update('profileVisibility', 'public') },
                { text: 'Private', onPress: () => update('profileVisibility', 'private') },
                { text: 'Cancel', style: 'cancel' },
              ])
            }
          />
        </Card>

        {/* INTERACTIONS */}
        <SectionHeader title="WHO CAN..." style={styles.sectionSpacing} />
        <Card style={styles.card}>
          <ListRow
            icon="user-plus"
            title="Send friend requests"
            value={audienceLabel(settings.whoCanSendFriendRequests)}
            chevron
            onPress={() =>
              showAudiencePicker(
                'Friend Requests',
                settings.whoCanSendFriendRequests,
                ['everyone', 'friends_of_friends', 'nobody'],
                v => update('whoCanSendFriendRequests', v)
              )
            }
          />
          <View style={styles.divider} />
          <ListRow
            icon="grid"
            title="See your posts"
            value={audienceLabel(settings.whoCanSeePosts)}
            chevron
            onPress={() =>
              showAudiencePicker(
                'Post Visibility',
                settings.whoCanSeePosts,
                ['everyone', 'friends', 'only_me'],
                v => update('whoCanSeePosts', v)
              )
            }
          />
          <View style={styles.divider} />
          <ListRow
            icon="users"
            title="See your friends list"
            value={audienceLabel(settings.whoCanSeeFriendsList)}
            chevron
            onPress={() =>
              showAudiencePicker(
                'Friends List',
                settings.whoCanSeeFriendsList,
                ['everyone', 'friends', 'only_me'],
                v => update('whoCanSeeFriendsList', v)
              )
            }
          />
          <View style={styles.divider} />
          <ListRow
            icon="message-square"
            title="Reply to stories"
            value={audienceLabel(settings.whoCanReplyToStories)}
            chevron
            onPress={() =>
              showAudiencePicker(
                'Story Replies',
                settings.whoCanReplyToStories,
                ['everyone', 'friends', 'nobody'],
                v => update('whoCanReplyToStories', v)
              )
            }
          />
          <View style={styles.divider} />
          <ListRow
            icon="at-sign"
            title="Mention you"
            value={audienceLabel(settings.whoCanMention)}
            chevron
            onPress={() =>
              showAudiencePicker(
                'Mentions',
                settings.whoCanMention,
                ['everyone', 'friends', 'nobody'],
                v => update('whoCanMention', v)
              )
            }
          />
        </Card>

        {/* ACTIVITY */}
        <SectionHeader title="ACTIVITY" style={styles.sectionSpacing} />
        <Card style={styles.card}>
          <ListRow
            icon="activity"
            title="Activity status"
            subtitle="Let friends see when you're active"
            toggle={{ value: settings.activityStatusVisible, onChange: v => update('activityStatusVisible', v) }}
          />
          <View style={styles.divider} />
          <ListRow
            icon="check-square"
            title="Read receipts"
            subtitle="Show when you've read messages"
            toggle={{ value: settings.readReceiptsEnabled, onChange: v => update('readReceiptsEnabled', v) }}
          />
        </Card>

        {/* SEARCH & DISCOVERY */}
        <SectionHeader title="SEARCH & DISCOVERY" style={styles.sectionSpacing} />
        <Card style={styles.card}>
          <ListRow
            icon="search"
            title="Appear in search"
            subtitle="Let others find your profile in search"
            toggle={{ value: settings.searchable, onChange: v => update('searchable', v) }}
          />
          <View style={styles.divider} />
          <ListRow
            icon="phone"
            title="Contact discovery"
            subtitle="Find friends from contacts (no contacts uploaded without permission)"
            toggle={{ value: settings.contactDiscovery, onChange: v => update('contactDiscovery', v) }}
          />
        </Card>

        {/* MESSAGES */}
        <SectionHeader title="MESSAGES" style={styles.sectionSpacing} />
        <Card style={styles.card}>
          <ListRow
            icon="message-circle"
            title="Who can message you"
            subtitle={
              dmPrivacy === 'followers_only'
                ? 'Only people you follow can send you DMs'
                : 'Others go to your Requests inbox until you accept'
            }
            value={dmPrivacy === 'followers_only' ? 'Followers only' : 'Everyone'}
            chevron
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
        </Card>

        {/* BLOCKED & MUTED & RESTRICTED */}
        <SectionHeader title="BLOCKED & MUTED" style={styles.sectionSpacing} />
        <Card style={styles.card}>
          <ListRow
            icon="slash"
            title="Blocked accounts"
            value="Manage"
            chevron
            onPress={() => router.push({ pathname: '/buyer-blocked' } as never)}
          />
          <View style={styles.divider} />
          <ListRow
            icon="volume-x"
            title="Muted accounts"
            value="Manage"
            chevron
            onPress={() => router.push('/buyer-muted' as never)}
          />
          <View style={styles.divider} />
          <ListRow
            icon="user-x"
            title="Restricted accounts"
            value="Manage"
            chevron
            onPress={() => router.push('/buyer-restricted' as never)}
          />
        </Card>
      </ScrollView>
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.background,
    },
    sectionSpacing: { marginTop: SP.lg },
    card: { padding: 0, paddingHorizontal: SP.md },
    divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  });
}
