import React, { useState, useCallback } from 'react';
import {
  View, ScrollView, StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { SP } from '@/lib/theme';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SectionHeader } from '@/components/BrandthreadUI';
import { ListSkeleton } from '@/components/layout/Skeleton';
import { Card, ListRow, Button, OptionSheet, OptionSheetOption } from '@/components/ui';
import { getPrivacySettings, updatePrivacySettings } from '@/services/socialService';
import { PrivacySettings, AudienceOption, DmPrivacy } from '@/services/socialTypes';
import { useApi } from '@/lib/api';

const AUDIENCE_LABEL: Record<AudienceOption, string> = {
  everyone: 'Everyone',
  friends_of_friends: 'Friends of friends',
  friends: 'Friends only',
  nobody: 'Nobody',
  only_me: 'Only me',
};

const AUDIENCE_DESCRIPTION: Record<AudienceOption, string> = {
  everyone: 'Anyone on Brandthread',
  friends_of_friends: "Your friends, and their friends",
  friends: 'Only people you follow',
  nobody: 'No one — turns this off entirely',
  only_me: 'Only visible to you',
};

function audienceOptions(ids: AudienceOption[]): OptionSheetOption[] {
  return ids.map((id) => ({ id, label: AUDIENCE_LABEL[id], description: AUDIENCE_DESCRIPTION[id] }));
}

type PickerKey = keyof Pick<
  PrivacySettings,
  'profileVisibility' | 'whoCanSendFriendRequests' | 'whoCanSeePosts' | 'whoCanSeeFriendsList' | 'whoCanReplyToStories' | 'whoCanMention'
> | 'dmPrivacy';

export default function BuyerPrivacySettings() {
  const colors = useColors();
  const styles = React.useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const api    = useApi();
  const [settings, setSettings] = useState<PrivacySettings | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // dmPrivacy is server-backed — loaded from and saved to /api/auth/privacy
  const [dmPrivacy, setDmPrivacy] = useState<DmPrivacy>('requests');
  const [picker, setPicker] = useState<PickerKey | null>(null);

  useFocusEffect(
    useCallback(() => {
      getPrivacySettings().then(setSettings);
      // Load server-side DM privacy setting
      api.privacy.get().then(({ dmPrivacy: p }) => setDmPrivacy(p)).catch(() => {});
    }, [])
  );

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
      setSaveError(null);
    } catch {
      if (showConfirmation) setSaveError("Couldn't save. Try again.");
      // On silent (back-navigation) saves, leave hasChanges set so the user
      // isn't told their change was saved when it wasn't.
    }
  }

  async function handleBack() {
    if (hasChanges) await saveSettings(false);
    router.back();
  }

  if (!settings) {
    return (
      <View style={styles.root}>
        <ScreenHeader title="Privacy" variant="push" onBack={() => router.back()} />
        <ScrollView contentContainerStyle={{ paddingHorizontal: SP.md, paddingTop: SP.md }}>
          <ListSkeleton rows={7} />
        </ScrollView>
      </View>
    );
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
        {saveError ? <Card style={[styles.card, styles.errorCard]}><ListRow icon="alert-circle" iconColor={colors.destructive} title={saveError} disabled /></Card> : null}

        {/* PROFILE VISIBILITY */}
        <SectionHeader title="PROFILE" />
        <Card style={styles.card}>
          <ListRow
            icon="eye"
            title="Profile visibility"
            value={settings.profileVisibility === 'public' ? 'Public' : 'Private'}
            chevron
            onPress={() => setPicker('profileVisibility')}
          />
        </Card>

        {/* INTERACTIONS */}
        <SectionHeader title="WHO CAN SEE AND CONTACT YOU" style={styles.sectionSpacing} />
        <Card style={styles.card}>
          <ListRow
            icon="user-plus"
            title="Send friend requests"
            value={AUDIENCE_LABEL[settings.whoCanSendFriendRequests]}
            chevron
            onPress={() => setPicker('whoCanSendFriendRequests')}
          />
          <View style={styles.divider} />
          <ListRow
            icon="grid"
            title="See your posts"
            value={AUDIENCE_LABEL[settings.whoCanSeePosts]}
            chevron
            onPress={() => setPicker('whoCanSeePosts')}
          />
          <View style={styles.divider} />
          <ListRow
            icon="users"
            title="See your friends list"
            value={AUDIENCE_LABEL[settings.whoCanSeeFriendsList]}
            chevron
            onPress={() => setPicker('whoCanSeeFriendsList')}
          />
          <View style={styles.divider} />
          <ListRow
            icon="message-square"
            title="Reply to stories"
            value={AUDIENCE_LABEL[settings.whoCanReplyToStories]}
            chevron
            onPress={() => setPicker('whoCanReplyToStories')}
          />
          <View style={styles.divider} />
          <ListRow
            icon="at-sign"
            title="Mention you"
            value={AUDIENCE_LABEL[settings.whoCanMention]}
            chevron
            onPress={() => setPicker('whoCanMention')}
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
        <SectionHeader title="SEARCH AND DISCOVERY" style={styles.sectionSpacing} />
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
                ? 'Only people you follow can message you'
                : 'Others go to your requests inbox until you accept'
            }
            value={dmPrivacy === 'followers_only' ? 'Followers only' : 'Everyone'}
            chevron
            onPress={() => setPicker('dmPrivacy')}
          />
        </Card>

        {/* BLOCKED & MUTED & RESTRICTED */}
        <SectionHeader title="BLOCKED AND MUTED" style={styles.sectionSpacing} />
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

      <OptionSheet
        visible={picker === 'profileVisibility'}
        onClose={() => setPicker(null)}
        title="Profile visibility"
        options={[
          { id: 'public', label: 'Public', description: 'Anyone can see your profile and posts', icon: 'globe' },
          { id: 'private', label: 'Private', description: 'Only people you approve can see your posts', icon: 'lock' },
        ]}
        selectedId={settings.profileVisibility}
        onSelect={(id) => { update('profileVisibility', id); setPicker(null); }}
      />
      <OptionSheet
        visible={picker === 'whoCanSendFriendRequests'}
        onClose={() => setPicker(null)}
        title="Who can send friend requests"
        options={audienceOptions(['everyone', 'friends_of_friends', 'nobody'])}
        selectedId={settings.whoCanSendFriendRequests}
        onSelect={(id) => { update('whoCanSendFriendRequests', id as AudienceOption); setPicker(null); }}
      />
      <OptionSheet
        visible={picker === 'whoCanSeePosts'}
        onClose={() => setPicker(null)}
        title="Who can see your posts"
        options={audienceOptions(['everyone', 'friends', 'only_me'])}
        selectedId={settings.whoCanSeePosts}
        onSelect={(id) => { update('whoCanSeePosts', id as AudienceOption); setPicker(null); }}
      />
      <OptionSheet
        visible={picker === 'whoCanSeeFriendsList'}
        onClose={() => setPicker(null)}
        title="Who can see your friends list"
        options={audienceOptions(['everyone', 'friends', 'only_me'])}
        selectedId={settings.whoCanSeeFriendsList}
        onSelect={(id) => { update('whoCanSeeFriendsList', id as AudienceOption); setPicker(null); }}
      />
      <OptionSheet
        visible={picker === 'whoCanReplyToStories'}
        onClose={() => setPicker(null)}
        title="Who can reply to stories"
        options={audienceOptions(['everyone', 'friends', 'nobody'])}
        selectedId={settings.whoCanReplyToStories}
        onSelect={(id) => { update('whoCanReplyToStories', id as AudienceOption); setPicker(null); }}
      />
      <OptionSheet
        visible={picker === 'whoCanMention'}
        onClose={() => setPicker(null)}
        title="Who can mention you"
        options={audienceOptions(['everyone', 'friends', 'nobody'])}
        selectedId={settings.whoCanMention}
        onSelect={(id) => { update('whoCanMention', id as AudienceOption); setPicker(null); }}
      />
      <OptionSheet
        visible={picker === 'dmPrivacy'}
        onClose={() => setPicker(null)}
        title="Who can message you"
        description="Others can always see your profile, but direct messages from non-followers are handled based on this setting."
        options={[
          { id: 'requests', label: 'Everyone', description: 'Non-followers go to your requests inbox', icon: 'inbox' },
          { id: 'followers_only', label: 'Followers only', description: 'Block direct messages from everyone else', icon: 'user-check' },
        ]}
        selectedId={dmPrivacy}
        onSelect={(id) => { setDmPrivacy(id as DmPrivacy); setHasChanges(true); setPicker(null); }}
      />
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
    errorCard: { marginBottom: SP.md },
    divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  });
}
