import React, { useState, useCallback, useRef } from 'react';
import { goBackOr } from '@/lib/navigation/goBackOr';
import {
  Animated, View, ScrollView, StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { SP } from '@/lib/theme';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { useLargeTitleCollapse } from '@/hooks/useLargeTitleCollapse';
import { SectionHeader } from '@/components/BrandthreadUI';
import { ListSkeleton } from '@/components/layout/Skeleton';
import { Card, ListRow, Button, OptionSheet, OptionSheetOption } from '@/components/ui';
import { cachePrivacySettings, getPrivacySettings, updatePrivacySettings } from '@/services/socialService';
import { PrivacySettings, AudienceOption, DmPrivacy, DEFAULT_PRIVACY_SETTINGS } from '@/services/socialTypes';
import { useApi } from '@/lib/api';
import { friendlyError } from '@/lib/friendlyError';

// Brandthread's social graph is follow-based (POST /api/social/follow), so
// the labels speak in follows. The stored keys (friends, friends_of_friends,
// whoCanSendFriendRequests…) are unchanged.
const AUDIENCE_LABEL: Record<AudienceOption, string> = {
  everyone: 'Everyone',
  friends_of_friends: 'Your network',
  friends: 'Following',
  nobody: 'Nobody',
  only_me: 'Only me',
};

const AUDIENCE_DESCRIPTION: Record<AudienceOption, string> = {
  everyone: 'Anyone on Brandthread',
  friends_of_friends: 'People you follow, and the people they follow',
  friends: 'Only people you follow',
  nobody: 'No one — turns this off entirely',
  only_me: 'Only visible to you',
};

function audienceOptions(ids: AudienceOption[]): OptionSheetOption[] {
  return ids.map((id) => ({ id, label: AUDIENCE_LABEL[id], description: AUDIENCE_DESCRIPTION[id] }));
}

// The settings badge reads one page of requests; at the cap there may be more.
const FOLLOW_REQUEST_CAP = 50;

function formatRequestCount(count: number, cap: number = FOLLOW_REQUEST_CAP): string | undefined {
  if (count <= 0) return undefined;
  return count >= cap ? `${cap}+` : String(count);
}

// The Privacy-screen choices the server stores and enforces
// (users.privacy_settings via PATCH /api/auth/privacy { settings }).
const SERVER_SETTING_KEYS = [
  'whoCanSendFriendRequests', 'whoCanSeePosts', 'whoCanSeeFriendsList', 'whoCanReplyToStories', 'whoCanMention', 'searchable',
] as const satisfies readonly (keyof PrivacySettings)[];

type PickerKey = keyof Pick<
  PrivacySettings,
  'profileVisibility' | 'whoCanSendFriendRequests' | 'whoCanSeePosts' | 'whoCanSeeFriendsList' | 'whoCanReplyToStories' | 'whoCanMention'
> | 'dmPrivacy';

export default function BuyerPrivacySettings() {
  const colors = useColors();
  const styles = React.useMemo(() => makeStyles(colors), [colors]);
  const titleCollapse = useLargeTitleCollapse();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const api    = useApi();
  const [settings, setSettings] = useState<PrivacySettings | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // dmPrivacy is server-backed — loaded from and saved to /api/auth/privacy
  const [dmPrivacy, setDmPrivacy] = useState<DmPrivacy>('requests');
  const [picker, setPicker] = useState<PickerKey | null>(null);
  // Private account is server-backed (follow requests); null until loaded, then it wins over the local value.
  const [serverPrivate, setServerPrivate] = useState<boolean | null>(null);
  const [privateBusy, setPrivateBusy] = useState(false);
  const [requestCount, setRequestCount] = useState(0);
  // The server only lets some account types go private (canBePrivate). null until loaded.
  const [canBePrivate, setCanBePrivate] = useState<boolean | null>(null);
  // "Saved by people you follow" on product pages — server-backed, written on toggle.
  const [showSaves, setShowSaves] = useState(true);
  // Contact discovery is server-backed (/api/social/contacts): null until loaded.
  const [contacts, setContacts] = useState<{ enabled: boolean; optedIn: boolean } | null>(null);
  const [contactsBusy, setContactsBusy] = useState(false);
  // GET /api/auth/privacy failed: nothing server-backed is shown as editable.
  const [loadFailed, setLoadFailed] = useState(false);
  const backSaveFailed = useRef(false);
  // Unsaved edits survive a round trip to a sub-screen (Blocked, Close friends…):
  // a refocus must not reload the server values over them.
  const hasChangesRef = useRef(false);
  hasChangesRef.current = hasChanges;

  useFocusEffect(
    useCallback(() => {
      // Server values (DM privacy, read receipts) win over the local copy.
      // A failed local read falls back to defaults instead of leaving the skeleton up.
      Promise.all([
        getPrivacySettings().catch(() => ({ ...DEFAULT_PRIVACY_SETTINGS })),
        api.privacy.get().catch(() => null),
      ]).then(([local, server]) => {
        if (hasChangesRef.current) return;
        setLoadFailed(!server);
        if (server) {
          setDmPrivacy(server.dmPrivacy);
          if (typeof server.isPrivate === 'boolean') setServerPrivate(server.isPrivate);
          if (typeof server.canBePrivate === 'boolean') setCanBePrivate(server.canBePrivate);
          if (typeof server.showSavesToFollowers === 'boolean') setShowSaves(server.showSavesToFollowers);
        }
        // The server copy wins for every choice it holds: the local cache can be
        // another account's or stale (it is user-scoped only after sign-in settles).
        const fromServer: Partial<PrivacySettings> = {};
        for (const key of SERVER_SETTING_KEYS) {
          const value = server?.settings?.[key];
          if (value !== undefined && typeof value === typeof DEFAULT_PRIVACY_SETTINGS[key]) (fromServer as Record<string, unknown>)[key] = value;
        }
        setSettings({ ...local, ...fromServer,
          ...(typeof server?.readReceipts === 'boolean' ? { readReceiptsEnabled: server.readReceipts } : {}),
          ...(typeof server?.showActivityStatus === 'boolean' ? { activityStatusVisible: server.showActivityStatus } : {}),
        });
      });
      api.followRequests.list(FOLLOW_REQUEST_CAP, 0).then((rows) => setRequestCount(Array.isArray(rows) ? rows.length : 0)).catch(() => {});
      api.social.contacts.status().then(setContacts).catch(() => setContacts(null));
    }, [])
  );

  function update(key: keyof PrivacySettings, val: any) {
    setSettings(s => s ? { ...s, [key]: val } : s);
    setHasChanges(true);
    backSaveFailed.current = false;
  }

  /** Resolves true when everything saved. */
  async function saveSettings(showConfirmation: boolean): Promise<boolean> {
    if (!settings) return false;
    try {
      // One server write for everything on this screen (the server enforces
      // all of it: audiences, search, DM privacy, read receipts, activity).
      const serverSettings: Record<string, unknown> = {};
      for (const key of SERVER_SETTING_KEYS) serverSettings[key] = settings[key];
      await api.privacy.update({
        dmPrivacy, readReceipts: settings.readReceiptsEnabled, showActivityStatus: settings.activityStatusVisible, settings: serverSettings,
      });
      // Then the device cache, which never decides whether the save worked.
      await cachePrivacySettings(settings).catch(() => {});
      setHasChanges(false);
      setSaveError(null);
      backSaveFailed.current = false;
      return true;
    } catch (err) {
      // Leave hasChanges set so the change isn't silently dropped.
      setSaveError(showConfirmation
        ? friendlyError(err, "Couldn't save. Try again.")
        : `${friendlyError(err, "Couldn't save your changes.")} Try again, or go back again to discard them.`);
      return false;
    }
  }

  // Writes the private-account flag through to the server immediately (not via
  // Save) and mirrors it into the local profileVisibility value. Optimistic,
  // rolled back if the request fails.
  async function applyPrivate(next: boolean) {
    if (privateBusy) return;
    setPrivateBusy(true);
    const before = serverPrivate ?? settings?.profileVisibility === 'private';
    setServerPrivate(next);
    let value: boolean;
    try {
      const res = await api.privacy.update({ isPrivate: next });
      value = typeof res.isPrivate === 'boolean' ? res.isPrivate : next;
      setServerPrivate(value);
      setSaveError(null);
    } catch (err) {
      setServerPrivate(before);
      // The server's reason (e.g. only buyer accounts can be private), not a generic retry.
      setSaveError(friendlyError(err, "Couldn't update your account privacy. Try again."));
      setPrivateBusy(false);
      return;
    }
    // The server change stands; the device cache is best effort and never rolls it back.
    try {
      await cachePrivacySettings({ profileVisibility: value ? 'private' : 'public' });
      setSettings((s) => (s ? { ...s, profileVisibility: value ? 'private' : 'public' } : s));
    } catch {
      // ignored: the next load reads the server value
    } finally {
      setPrivateBusy(false);
    }
  }

  async function applyShowSaves(next: boolean) {
    setShowSaves(next);
    try {
      const res = await api.privacy.update({ showSavesToFollowers: next });
      if (typeof res.showSavesToFollowers === 'boolean') setShowSaves(res.showSavesToFollowers);
      setSaveError(null);
    } catch {
      setShowSaves(!next);
      setSaveError("Couldn't save. Try again.");
    }
  }
  // "Contact discovery" = the server's "let friends find me" opt-in. Applied
  // immediately (not via Save), optimistic and rolled back on failure.
  async function applyContactDiscovery(next: boolean) {
    if (contactsBusy || !contacts?.enabled) return;
    setContactsBusy(true);
    const before = contacts.optedIn;
    setContacts({ ...contacts, optedIn: next });
    try {
      if (next) await api.social.contacts.optIn();
      else await api.social.contacts.revoke();
      const saved = await updatePrivacySettings({ contactDiscovery: next });
      setSettings((s) => (s ? { ...s, contactDiscovery: saved.contactDiscovery } : s));
      setSaveError(null);
    } catch {
      setContacts((c) => (c ? { ...c, optedIn: before } : c));
      setSaveError("Couldn't update contact discovery. Try again.");
    } finally {
      setContactsBusy(false);
    }
  }

  // Back saves pending changes first; if that save fails, stay on the screen
  // and show the error (a second Back discards).
  async function handleBack() {
    if (hasChanges && !backSaveFailed.current) {
      const ok = await saveSettings(false);
      if (!ok) { backSaveFailed.current = true; return; }
    }
    goBackOr(router, '/buyer-settings');
  }

  const isPrivateNow = serverPrivate ?? settings?.profileVisibility === 'private';
  // Shown only once the server says this account can go private — or already
  // is, so it can still be switched off. Unknown (load failed) means hidden,
  // never a switch the server will refuse.
  const showPrivateRow = canBePrivate === true || serverPrivate === true;

  if (!settings) {
    return (
      <View style={styles.root}>
        <ScreenHeader title="Privacy" variant="push" onBack={() => goBackOr(router, '/buyer-settings')} />
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
        collapse={titleCollapse}
      />

      <Animated.ScrollView contentContainerStyle={{ paddingHorizontal: SP.md, paddingTop: SP.md, paddingBottom: SP.xxl + insets.bottom }} showsVerticalScrollIndicator={false} onScroll={titleCollapse.onScroll} scrollEventThrottle={16}>
        {loadFailed ? <Card style={[styles.card, styles.errorCard]}><ListRow icon="alert-circle" iconColor={colors.destructive} title="Couldn't load your privacy settings. Leave and reopen this screen to try again." titleNumberOfLines={3} disabled /></Card> : null}
        {saveError ? <Card style={[styles.card, styles.errorCard]}><ListRow icon="alert-circle" iconColor={colors.destructive} title={saveError} disabled /></Card> : null}

        {/* PROFILE VISIBILITY */}
        <SectionHeader title="PROFILE" />
        <Card style={styles.card}>
          {showPrivateRow ? (
            <>
              <ListRow
                icon="lock"
                title="Private account"
                subtitle="Approve who can follow you"
                toggle={{ value: isPrivateNow, onChange: (v) => { void applyPrivate(v); } }}
                disabled={privateBusy}
                testID="private-account-switch"
              />
              <View style={styles.divider} />
            </>
          ) : null}
          <ListRow
            icon="user-plus"
            title="Follow requests"
            value={formatRequestCount(requestCount)}
            chevron
            onPress={() => router.push('/buyer-friend-requests' as never)}
          />
          <View style={styles.divider} />
          <ListRow
            icon="star"
            title="Close friends"
            chevron
            onPress={() => router.push('/buyer-close-friends' as never)}
          />
        </Card>

        {/* INTERACTIONS */}
        <SectionHeader title="WHO CAN" style={styles.sectionSpacing} />
        <Card style={styles.card}>
          <ListRow
            icon="user-plus"
            title="Follow you"
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
            title="See who you follow"
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
            toggle={{ value: settings.activityStatusVisible, onChange: v => update('activityStatusVisible', v) }}
          />
          <View style={styles.divider} />
          <ListRow
            icon="check-square"
            title="Read receipts"
            toggle={{ value: settings.readReceiptsEnabled, onChange: v => update('readReceiptsEnabled', v) }}
          />
          <View style={styles.divider} />
          <ListRow
            icon="bookmark"
            title="Show your saves"
            subtitle="Followers can see products you save"
            toggle={{ value: showSaves, onChange: applyShowSaves }}
            testID="privacy-show-saves"
          />
        </Card>

        {/* SEARCH & DISCOVERY */}
        <SectionHeader title="DISCOVERY" style={styles.sectionSpacing} />
        <Card style={styles.card}>
          <ListRow
            icon="search"
            title="Appear in search"
            toggle={{ value: settings.searchable, onChange: v => update('searchable', v) }}
          />
          <View style={styles.divider} />
          <ListRow
            icon="phone"
            title="Contact discovery"
            subtitle={contacts && !contacts.enabled
              ? "Contact discovery isn't available right now"
              : 'Let people who have your email or number in their contacts find you'}
            subtitleNumberOfLines={2}
            toggle={{ value: contacts?.optedIn ?? false, onChange: (v) => { void applyContactDiscovery(v); } }}
            disabled={contactsBusy || !contacts?.enabled}
          />
        </Card>

        {/* MESSAGES */}
        <SectionHeader title="MESSAGES" style={styles.sectionSpacing} />
        <Card style={styles.card}>
          <ListRow
            icon="message-circle"
            title="Who can message you"
            subtitleNumberOfLines={3}
            subtitle={
              dmPrivacy === 'followers_only'
                ? 'Only people you follow can message you'
                : 'Others go to your requests inbox until you accept'
            }
            value={dmPrivacy === 'followers_only' ? 'People you follow' : 'Everyone'}
            chevron
            onPress={() => setPicker('dmPrivacy')}
          />
        </Card>

        {/* BLOCKED & MUTED & RESTRICTED */}
        <SectionHeader title="SAFETY" style={styles.sectionSpacing} />
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
          <View style={styles.divider} />
          <ListRow
            icon="eye-off"
            title="Hidden posts"
            value="Manage"
            chevron
            onPress={() => router.push('/buyer-hidden-posts' as never)}
          />
        </Card>
      </Animated.ScrollView>

      <OptionSheet
        visible={picker === 'whoCanSendFriendRequests'}
        onClose={() => setPicker(null)}
        title="Who can follow you"
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
        title="Who can see who you follow"
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
          { id: 'followers_only', label: 'People you follow', description: 'Block direct messages from everyone else', icon: 'user-check' },
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
