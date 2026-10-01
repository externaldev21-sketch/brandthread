/**
 * Invite landing for /community-join?code=… — previews the group (public
 * endpoint, works signed out) and lets the person join or request to join.
 * Signed-out visitors see the preview plus a sign-in prompt; the code is
 * stashed so AuthGate brings them back here after sign-in.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyState } from '@/components/BrandthreadUI';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { SkeletonBlock } from '@/components/ui/Skeleton';
import { CachedImage } from '@/components/CachedImage';
import { CommunityAvatar } from '@/components/community/CommunityAvatar';
import { SignInPrompt } from '@/components/community/SignInPrompt';
import { VerifiedMark } from '@/components/community/VerifiedMark';
import { useBuyerTabBarInset } from '@/components/buyer-nav/buyerTabBarMetrics';
import { useCommunityClient } from '@/lib/communities/useCommunityClient';
import { formatMemberCount, type CommunityInvitePreview } from '@/lib/communities/types';
import { describeCommunityError } from '@/lib/communities/errors';
import { hapticSuccess } from '@/lib/haptics';
import { useColors } from '@/hooks/useColors';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';

export const PENDING_COMMUNITY_INVITE_KEY = 'bt:pendingCommunityInvite';

type LoadState = 'loading' | 'ready' | 'invalid' | 'error';

export default function CommunityJoinScreen() {
  const colors = useColors();
  const router = useRouter();
  const client = useCommunityClient();
  const barInset = useBuyerTabBarInset();
  const { code: rawCode } = useLocalSearchParams<{ code?: string }>();
  const code = (Array.isArray(rawCode) ? rawCode[0] : rawCode)?.trim().toLowerCase() ?? '';

  const [state, setState] = useState<LoadState>('loading');
  const [group, setGroup] = useState<CommunityInvitePreview | null>(null);
  const [joining, setJoining] = useState(false);
  const [requested, setRequested] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);

  // Arriving here consumes any pending-invite redirect from AuthGate.
  useEffect(() => { AsyncStorage.removeItem(PENDING_COMMUNITY_INVITE_KEY).catch(() => {}); }, []);

  const load = useCallback(async () => {
    if (!code) { setState('invalid'); return; }
    setState('loading');
    try {
      setGroup(await client.invitePreview(code));
      setState('ready');
    } catch (e) {
      const info = describeCommunityError(e);
      setState(info.code === 'INVITE_INVALID' || info.status === 404 ? 'invalid' : 'error');
    }
  }, [client, code]);

  useEffect(() => { void load(); }, [load]);

  const join = async () => {
    if (!group) return;
    setJoining(true);
    setMessage(null);
    setNeedsSignIn(false);
    try {
      const res = await client.joinByCode(code);
      if (res.status === 'requested') { hapticSuccess(); setRequested(true); return; }
      hapticSuccess();
      router.replace(`/community-chat?id=${encodeURIComponent(res.community?.id ?? group.id)}` as never);
    } catch (e) {
      const info = describeCommunityError(e);
      if (info.authRequired) setNeedsSignIn(true);
      else setMessage(info.message);
    } finally {
      setJoining(false);
    }
  };

  const browse = () => router.replace('/community' as never);

  const body = () => {
    if (state === 'loading') {
      return (
        <View style={styles.center}>
          <SkeletonBlock width={88} height={88} radius={24} />
          <SkeletonBlock width={180} height={18} />
          <SkeletonBlock width={110} height={12} />
          <SkeletonBlock width="80%" height={12} />
        </View>
      );
    }
    if (state === 'invalid') {
      return (
        <EmptyState
          icon="link"
          title="This invite link isn't valid"
          description="It may have been reset or removed by the group's admins."
          action={{ label: 'Browse groups', onPress: browse }}
        />
      );
    }
    if (state === 'error' || !group) {
      return <ErrorState message="Couldn't load this invite. Check your connection and try again." onRetry={() => { void load(); }} />;
    }
    const isPrivate = group.visibility === 'private';
    return (
      <View style={styles.center}>
        {group.coverUrl ? (
          <CachedImage source={{ uri: group.coverUrl }} style={[styles.cover, { backgroundColor: colors.secondary }]} />
        ) : null}
        <CommunityAvatar community={group} size={88} />
        <View style={styles.nameRow}>
          <Text style={[styles.name, { color: colors.foreground }]}>{group.name}</Text>
          {group.verified ? <VerifiedMark size={17} /> : null}
        </View>
        <Text style={[styles.meta, { color: colors.mutedForeground }]}>
          {formatMemberCount(group.memberCount)} · {isPrivate ? 'Private group' : 'Public group'}
        </Text>
        {group.description ? <Text style={[styles.desc, { color: colors.mutedForeground }]}>{group.description}</Text> : null}

        {requested ? (
          <Text style={[styles.note, { color: colors.foreground }]}>Request sent - an admin will review it.</Text>
        ) : (
          <>
            {isPrivate && group.requireApproval ? (
              <Text style={[styles.note, { color: colors.mutedForeground }]}>Admins approve new members in this group.</Text>
            ) : null}
            {message ? <Text style={[styles.note, { color: colors.mutedForeground }]}>{message}</Text> : null}
            {needsSignIn ? (
              <View style={styles.full}>
                <SignInPrompt
                  message="Sign in to join this group."
                  onBeforeNavigate={() => AsyncStorage.setItem(PENDING_COMMUNITY_INVITE_KEY, code)}
                />
              </View>
            ) : null}
            <View style={styles.full}>
              <Button
                label={isPrivate && group.requireApproval ? 'Request to join' : 'Join group'}
                onPress={() => { void join(); }}
                loading={joining}
                fullWidth
              />
            </View>
          </>
        )}
        <Button label="Browse groups" variant="tertiary" size="small" onPress={browse} />
      </View>
    );
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScreenHeader divider={false} title="Group invite" />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: barInset + SP.xl }]}
        showsVerticalScrollIndicator={false}
      >
        {body()}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: SP.md, paddingTop: SP.lg },
  center: { alignItems: 'center', gap: SP.sm },
  cover: { width: '100%', height: 140, borderRadius: RADIUS.lg, marginBottom: SP.xs },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: SP.xs },
  name: { fontFamily: FONT.bold, fontSize: FS.xl, letterSpacing: -0.3, textAlign: 'center', flexShrink: 1 },
  meta: { fontFamily: FONT.regular, fontSize: FS.sm },
  desc: { fontFamily: FONT.regular, fontSize: FS.base, lineHeight: 22, textAlign: 'center', marginTop: SP.xs },
  note: { fontFamily: FONT.medium, fontSize: FS.sm, lineHeight: 19, textAlign: 'center', marginTop: SP.sm },
  full: { width: '100%', marginTop: SP.sm },
});
