/**
 * Find friends from contacts — permission-gated, feature-flagged (default off).
 *
 * Flow: pre-permission screen (what happens, what never does) -> explicit tap
 * -> OS contacts prompt -> contacts are hashed ON DEVICE (SHA-256 of normalized
 * email / E.164 phone) -> only hashes go to POST /api/social/contacts/match ->
 * "Friends on Brandthread" list with Follow. Optional "Let friends find me"
 * switch stores hashes of my OWN email/phone server-side (off by default,
 * removable any time). Raw contacts never leave the device.
 *
 * Web / Expo Go without the native module fall back to NativeOnlyFeature.
 * `&demo=1` (preview only) shows the UI with sample people and no network.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/ScreenHeader';
import NativeOnlyFeature from '@/components/NativeOnlyFeature';
import { Button } from '@/components/ui';
import { Avatar } from '@/components/ui/Avatar';
import { Toast } from '@/components/BrandthreadUI';
import { useColors } from '@/hooks/useColors';
import { useApi, type ContactMatch } from '@/lib/api';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { isPreviewDemoMode } from '@/lib/devPreview';
import { CONTACT_SYNC_ENABLED } from '@/lib/contactSyncFlag';
import { chunkHashes, hashContactPoints } from '@/lib/contactHashing';
import {
  getContactsPermission, readContactPoints, requestContactsPermission, sha256Hex,
  type ContactsPermission,
} from '@/lib/contactsAccess';
import { requestContextualPushPermission } from '@/lib/contextualPushPermission';
import { useAuth } from '@clerk/expo';
import { hapticSuccess } from '@/lib/haptics';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';
import { RADII } from '@/constants/radii';

type Phase = 'intro' | 'denied' | 'working' | 'results' | 'error';

const DEMO_MATCHES: ContactMatch[] = [
  { userId: 'demo-1', name: 'Maya Chen', username: 'mayachen', avatarUrl: null, initials: 'MC', color: '#3B3B40', handle: '@mayachen', isFollowing: false },
  { userId: 'demo-2', name: 'Jordan Ellis', username: 'jellis', avatarUrl: null, initials: 'JE', color: '#55555C', handle: '@jellis', isFollowing: false },
  { userId: 'demo-3', name: 'Sam Okafor', username: 'samokafor', avatarUrl: null, initials: 'SO', color: '#2A2A2E', handle: '@samokafor', isFollowing: true },
];

const POINTS = [
  { icon: 'smartphone', text: 'Contacts are scrambled into codes on your phone.' },
  { icon: 'upload-cloud', text: 'Only the codes are sent, never names or numbers.' },
  { icon: 'eye-off', text: 'Nothing is stored, and people only see you if you opt in.' },
] as const;

export default function FindFriendsContacts() {
  const palette = useColors();
  const s = makeStyles(palette);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const api = useApi();
  const { userId } = useAuth();
  // `?demo=1` comes from the route params (the URL is not always settled at first render);
  // isPreviewDemoMode() still gates it to dev/web preview builds, so it is always false on device.
  const { demo: demoParam } = useLocalSearchParams<{ demo?: string }>();
  const demo = demoParam === '1' ? isPreviewDemoMode('?bt_preview=buyer&demo=1') : isPreviewDemoMode();

  const [phase, setPhase] = useState<Phase>('intro');
  const [matches, setMatches] = useState<ContactMatch[]>([]);
  const [followed, setFollowed] = useState<Set<string>>(new Set());
  const [optedIn, setOptedIn] = useState(false);
  const [optBusy, setOptBusy] = useState(false);
  const [toast, setToast] = useState<{ message: string; variant: 'success' | 'error' } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);
  function flash(message: string, variant: 'success' | 'error' = 'success') {
    setToast({ message, variant });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1800);
  }

  // Already-granted permission still waits for the tap; we only learn if the OS blocked us.
  useEffect(() => {
    if (demo || !CONTACT_SYNC_ENABLED) return;
    api.social.contacts.status().then((st) => setOptedIn(st.optedIn)).catch(() => {});
  }, [api, demo]);

  const runMatch = useCallback(async () => {
    setPhase('working');
    try {
      if (demo) {
        await new Promise((r) => setTimeout(r, 400));
        setMatches(DEMO_MATCHES);
        setPhase('results');
        return;
      }
      const points = await readContactPoints();
      const hashes = await hashContactPoints(points, sha256Hex);
      const found = new Map<string, ContactMatch>();
      for (const chunk of chunkHashes(hashes)) {
        const res = await api.social.contacts.match(chunk);
        res.matches.forEach((m) => found.set(m.userId, m));
      }
      setMatches([...found.values()]);
      setPhase('results');
    } catch {
      setPhase('error');
    }
  }, [api, demo]);

  async function onContinue() {
    if (demo) { void runMatch(); return; }
    const current = await getContactsPermission();
    const next: ContactsPermission = current === 'granted' ? current : await requestContactsPermission();
    if (next === 'granted') void runMatch();
    else setPhase('denied');
  }

  async function follow(m: ContactMatch) {
    setFollowed((prev) => new Set(prev).add(m.userId));
    if (demo) return;
    try {
      await api.social.follow(m.userId);
      hapticSuccess();
      void requestContextualPushPermission(userId, api);
    } catch {
      setFollowed((prev) => { const n = new Set(prev); n.delete(m.userId); return n; });
      flash("Couldn't follow. Try again.", 'error');
    }
  }

  async function toggleOptIn(next: boolean) {
    setOptBusy(true);
    try {
      if (!demo) {
        if (next) await api.social.contacts.optIn();
        else await api.social.contacts.revoke();
      }
      setOptedIn(next);
      flash(next ? 'Friends can find you' : 'Removed. Friends can no longer find you');
    } catch {
      flash("Couldn't update this. Try again.", 'error');
    } finally {
      setOptBusy(false);
    }
  }

  if (!CONTACT_SYNC_ENABLED && !demo) {
    return (
      <View style={s.page}>
        <ScreenHeader title="Find friends" onBack={() => goBackOr(router)} />
        <View style={s.center}>
          <Text style={s.body}>Finding friends from contacts isn't available right now.</Text>
        </View>
      </View>
    );
  }

  if (Platform.OS === 'web' && !demo) {
    return (
      <NativeOnlyFeature
        title="Find friends from contacts"
        description="Checking your contacts works in the Brandthread app on iOS and Android."
        icon="users"
      />
    );
  }

  const bottom = Math.max(insets.bottom, SPACING.md) + SPACING.md;

  return (
    <View style={s.page}>
      <ScreenHeader title="Find friends" onBack={() => goBackOr(router)} />

      {phase === 'intro' && (
        <View style={s.flex}>
          <ScrollView contentContainerStyle={s.introScroll} showsVerticalScrollIndicator={false}>
            <View style={s.iconWrap}><Icon name="users" size={28} color={palette.foreground} /></View>
            <Text style={s.title}>Find friends you know</Text>
            <Text style={s.body}>See which of your contacts are already on Brandthread.</Text>
            <View style={s.points}>
              {POINTS.map((p) => (
                <View key={p.icon} style={s.pointRow}>
                  <View style={s.pointIcon}><Icon name={p.icon} size={18} color={palette.foreground} /></View>
                  <Text style={s.pointText}>{p.text}</Text>
                </View>
              ))}
            </View>
          </ScrollView>
          <View style={[s.footer, { paddingBottom: bottom }]}>
            <Button label="Continue" onPress={() => { void onContinue(); }} fullWidth testID="contacts-continue" />
            <Button label="Not now" variant="tertiary" onPress={() => goBackOr(router)} fullWidth testID="contacts-not-now" />
          </View>
        </View>
      )}

      {phase === 'denied' && (
        <View style={s.flex}>
          <View style={s.center}>
            <View style={s.iconWrap}><Icon name="lock" size={28} color={palette.foreground} /></View>
            <Text style={s.title}>Contacts access is off</Text>
            <Text style={s.body}>Turn on Contacts for Brandthread in Settings to find friends.</Text>
          </View>
          <View style={[s.footer, { paddingBottom: bottom }]}>
            <Button label="Open Settings" onPress={() => { void Linking.openSettings(); }} fullWidth />
            <Button label="Not now" variant="tertiary" onPress={() => goBackOr(router)} fullWidth />
          </View>
        </View>
      )}

      {phase === 'working' && (
        <View style={s.center}>
          <ActivityIndicator color={palette.foreground} />
          <Text style={[s.body, { marginTop: SPACING.md }]}>Checking your contacts</Text>
        </View>
      )}

      {phase === 'error' && (
        <View style={s.flex}>
          <View style={s.center}>
            <Text style={s.title}>Couldn't check your contacts</Text>
            <Text style={s.body}>Check your connection and try again.</Text>
          </View>
          <View style={[s.footer, { paddingBottom: bottom }]}>
            <Button label="Try again" onPress={() => { void runMatch(); }} fullWidth />
          </View>
        </View>
      )}

      {phase === 'results' && (
        <ScrollView contentContainerStyle={{ paddingBottom: bottom + SPACING.lg }} showsVerticalScrollIndicator={false}>
          <Text style={s.sectionTitle}>Friends on Brandthread</Text>
          {matches.length === 0 ? (
            <View style={s.emptyWrap}>
              <Text style={s.emptyTitle}>No friends found yet</Text>
              <Text style={s.body}>People appear here once they've chosen to be found by their email or phone.</Text>
            </View>
          ) : (
            matches.map((m) => {
              const isFollowing = m.isFollowing || followed.has(m.userId);
              return (
                <View key={m.userId} style={s.row}>
                  <Avatar uri={m.avatarUrl} name={m.name} size={48} />
                  <View style={s.rowText}>
                    <Text style={s.rowName} numberOfLines={1}>{m.name}</Text>
                    <Text style={s.rowHandle} numberOfLines={1}>{m.handle}</Text>
                  </View>
                  {isFollowing ? (
                    <View style={s.followingPill}><Text style={s.followingText}>Following</Text></View>
                  ) : (
                    <Button
                      label="Follow" size="compact" onPress={() => { void follow(m); }}
                      accessibilityLabel={`Follow ${m.name}`} style={s.followBtn}
                    />
                  )}
                </View>
              );
            })
          )}

          <View style={s.optCard}>
            <View style={s.optText}>
              <Text style={s.rowName}>Let friends find me</Text>
              <Text style={s.optSub}>People with your email or phone can find you. You can turn this off any time.</Text>
            </View>
            <Switch
              value={optedIn}
              disabled={optBusy}
              onValueChange={(v) => { void toggleOptIn(v); }}
              trackColor={{ false: palette.border, true: palette.success }}
              accessibilityLabel="Let friends find me"
              testID="contacts-opt-in"
            />
          </View>
        </ScrollView>
      )}

      <Toast message={toast?.message ?? ''} visible={!!toast} variant={toast?.variant ?? 'success'} />
    </View>
  );
}

const makeStyles = (p: ReturnType<typeof useColors>) => StyleSheet.create({
  page: { flex: 1, backgroundColor: p.background },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SPACING.lg },
  introScroll: { flexGrow: 1, paddingHorizontal: SPACING.lg, paddingTop: SPACING.xl },
  iconWrap: {
    width: 64, height: 64, borderRadius: RADII.pill, alignItems: 'center', justifyContent: 'center',
    backgroundColor: p.card, borderWidth: StyleSheet.hairlineWidth, borderColor: p.border, marginBottom: SPACING.md,
    alignSelf: 'center',
  },
  title: { ...TYPE_SCALE.title2, color: p.foreground, textAlign: 'center' },
  body: { ...TYPE_SCALE.body, color: p.mutedForeground, textAlign: 'center', marginTop: SPACING.xs },
  points: { marginTop: SPACING.xl, gap: SPACING.md },
  pointRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  pointIcon: {
    width: 40, height: 40, borderRadius: RADII.pill, alignItems: 'center', justifyContent: 'center',
    backgroundColor: p.card, borderWidth: StyleSheet.hairlineWidth, borderColor: p.border,
  },
  pointText: { ...TYPE_SCALE.body, color: p.foreground, flex: 1 },
  footer: { paddingHorizontal: SPACING.md, gap: SPACING.xs, paddingTop: SPACING.sm },
  sectionTitle: { ...TYPE_SCALE.headline, color: p.foreground, paddingHorizontal: SPACING.md, paddingTop: SPACING.sm, paddingBottom: SPACING.xs },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm,
  },
  rowText: { flex: 1, gap: 2 },
  rowName: { ...TYPE_SCALE.headline, color: p.foreground },
  rowHandle: { ...TYPE_SCALE.footnote, color: p.mutedForeground },
  followBtn: { minWidth: 96 },
  followingPill: {
    minWidth: 96, height: 36, borderRadius: RADII.pill, alignItems: 'center', justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth, borderColor: p.border,
  },
  followingText: { ...TYPE_SCALE.caption, color: p.mutedForeground },
  emptyWrap: { paddingHorizontal: SPACING.lg, paddingVertical: SPACING.xl, alignItems: 'center' },
  emptyTitle: { ...TYPE_SCALE.headline, color: p.foreground, textAlign: 'center' },
  optCard: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.md, marginHorizontal: SPACING.md, marginTop: SPACING.lg,
    padding: SPACING.md, borderRadius: RADII.card, backgroundColor: p.card, borderWidth: StyleSheet.hairlineWidth, borderColor: p.border,
  },
  optText: { flex: 1, gap: 4 },
  optSub: { ...TYPE_SCALE.footnote, color: p.mutedForeground },
});
