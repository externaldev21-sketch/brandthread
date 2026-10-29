/**
 * Group info — /community-members?id= (opened from the chat header).
 * Instagram-style details: the group photo, name, member count and
 * description up top, quick actions, then the member list with roles.
 *
 * Roles (enforced on the server, mirrored here so controls never render for
 * someone who can't use them):
 *   creator ("owner")  set at creation, never changes; edits photo / name /
 *                      description, makes and removes admins, deletes the group
 *   admin              edits photo / name / description, moderates members
 *   member             read-only: no edit controls render at all
 * Official communities have no in-app owner tools.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, RefreshControl, Share, StyleSheet, Text, View } from 'react-native';
import { LONG_LIST_TUNING } from '@/lib/listTuning';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import { Icon } from '@/components/ui/Icon';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ModalSafeArea } from '@/components/ModalSafeArea';
import { PressableScale, SearchBar } from '@/components/BrandthreadUI';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Avatar';
import { ErrorState } from '@/components/ui/ErrorState';
import { EmptyState } from '@/components/layout/EmptyState';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { SkeletonBlock } from '@/components/ui/Skeleton';
import { showActionSheet } from '@/components/ui/ActionSheet';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { SettingsRow, SettingsSection } from '@/components/settings/SettingsKit';
import { GroupFormFields, type GroupFormErrors, type GroupFormValue } from '@/components/community/GroupFormFields';
import { SignInPrompt } from '@/components/community/SignInPrompt';
import { useBuyerTabBarInset } from '@/components/buyer-nav/buyerTabBarMetrics';
import { useCommunityClient, useCommunityMyId } from '@/lib/communities/useCommunityClient';
import { withPreviewDemo } from '@/lib/communities/previewHref';
import {
  formatMemberCount, type Community, type CommunityJoinRequest, type CommunityMember, type CommunityRole,
} from '@/lib/communities/types';
import { describeCommunityError } from '@/lib/communities/errors';
import { inviteUrlForCode } from '@/lib/communities/inviteLink';
import { useImageSourceSheet } from '@/components/profile/ImageSourceSheet';
import { CommunityAvatar } from '@/components/community/CommunityAvatar';
import { VerifiedMark } from '@/components/community/VerifiedMark';
import { validateGroupDescription, validateGroupName } from '@/lib/communities/validation';
import { haptics } from '@/lib/haptics';
import { useColors } from '@/hooks/useColors';
import { useReportSheet } from '@/components/safety/ReportSheet';
import { useBlockAction } from '@/lib/useBlockAction';
import { COMP, FONT, FS, RADIUS, SP } from '@/lib/theme';
import { fmtRelativeDay } from '@/lib/format';

const CHIP_PAD = { paddingHorizontal: 14 } as const;

/** Sheet-style confirm that also works on web (Alert.alert is a no-op there). */
function confirmAction(title: string, message: string, confirmLabel: string, onConfirm: () => void) {
  showActionSheet(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: confirmLabel, style: 'destructive', onPress: onConfirm },
  ]);
}

export default function CommunityMembersScreen() {
  const colors = useColors();
  const router = useRouter();
  const client = useCommunityClient();
  const myId = useCommunityMyId();
  const { openReport } = useReportSheet();
  const blockUser = useBlockAction();
  const barInset = useBuyerTabBarInset();
  const { id: rawId, notice: noticeParam } = useLocalSearchParams<{ id?: string; notice?: string }>();
  const id = (Array.isArray(rawId) ? rawId[0] : rawId) ?? '';
  const { open: openImageSheet, sheet: imageSourceSheet } = useImageSourceSheet();

  const [community, setCommunity] = useState<Community | null>(null);
  const [members, setMembers] = useState<CommunityMember[]>([]);
  const [memberCount, setMemberCount] = useState(0);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [requests, setRequests] = useState<CommunityJoinRequest[]>([]);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [notice, setNotice] = useState<string | null>(typeof noticeParam === 'string' ? noticeParam : null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [bansOpen, setBansOpen] = useState(false);

  const generation = useRef(0);
  const firstQuery = useRef(true);

  const role: CommunityRole | null = community?.role ?? null;
  const isOwner = role === 'owner';
  // Official communities are run by Brandthread; nobody gets owner tools in-app.
  const isStaff = community?.kind === 'user' && (role === 'owner' || role === 'admin');
  /** Creator + admins can change the photo, name and description. */
  const canEdit = isStaff;

  const loadAll = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
    // No id, or the server says the group doesn't exist: a not-found state
    // with a way out (Go back / Browse groups), never a Retry that can't help.
    if (!id) { setNotFound(true); setLoading(false); return; }
    const gen = ++generation.current;
    if (mode === 'refresh') setRefreshing(true); else setLoading(true);
    setError(null);
    setNotFound(false);
    setNeedsSignIn(false);
    try {
      const c = await client.get(id);
      const page = await client.members(id, debounced ? { q: debounced } : undefined);
      const staff = c.kind === 'user' && (c.role === 'owner' || c.role === 'admin');
      const pending = staff && c.requireApproval ? await client.requests(id).catch(() => [] as CommunityJoinRequest[]) : [];
      if (gen !== generation.current) return;
      setCommunity(c);
      setMembers(page.members);
      setMemberCount(page.memberCount);
      setNextOffset(page.nextOffset);
      setRequests(pending);
    } catch (e) {
      if (gen !== generation.current) return;
      const info = describeCommunityError(e, "Couldn't load members. Check your connection and try again.");
      if (info.authRequired) setNeedsSignIn(true);
      else if (info.status === 404) setNotFound(true);
      else setError(info.message);
    } finally {
      if (gen === generation.current) { setLoading(false); setRefreshing(false); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, id]);

  useEffect(() => { void loadAll(); }, [loadAll]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  // Search only re-fetches the member page (the community itself doesn't change).
  useEffect(() => {
    if (firstQuery.current) { firstQuery.current = false; return; }
    if (!community) return;
    const gen = ++generation.current;
    client.members(id, debounced ? { q: debounced } : undefined)
      .then((page) => {
        if (gen !== generation.current) return;
        setMembers(page.members); setMemberCount(page.memberCount); setNextOffset(page.nextOffset);
      })
      .catch((e) => { if (gen === generation.current) setNotice(describeCommunityError(e).message); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const loadMore = useCallback(async () => {
    if (nextOffset === null || loadingMore || loading) return;
    const gen = generation.current;
    setLoadingMore(true);
    try {
      const page = await client.members(id, { ...(debounced ? { q: debounced } : {}), offset: nextOffset });
      if (gen !== generation.current) return;
      setMembers((prev) => {
        const seen = new Set(prev.map((m) => m.userId));
        return [...prev, ...page.members.filter((m) => !seen.has(m.userId))];
      });
      setNextOffset(page.nextOffset);
    } catch { /* footer retry is the next scroll */ } finally { setLoadingMore(false); }
  }, [client, debounced, id, loading, loadingMore, nextOffset]);

  /** Runs a write with a busy flag and a calm inline notice on failure. */
  const run = useCallback(async (key: string, fn: () => Promise<void>): Promise<boolean> => {
    setBusy(key);
    setNotice(null);
    try { await fn(); return true; } catch (e) {
      setNotice(describeCommunityError(e).message);
      return false;
    } finally { setBusy(null); }
  }, []);

  const dropMember = (userId: string) => {
    setMembers((prev) => prev.filter((m) => m.userId !== userId));
    setMemberCount((n) => Math.max(0, n - 1));
  };

  const openProfile = (m: CommunityMember) => {
    if (m.userId === myId) return;
    if (m.accountType === 'seller') {
      router.push(`/seller-profile?id=${encodeURIComponent(m.userId)}` as never);
    } else {
      router.push({
        pathname: '/buyer-other-profile' as never,
        params: { userId: m.userId, name: m.name, handle: m.handle, initials: m.initials, color: colors.secondary },
      } as never);
    }
  };

  const openMemberMenu = (m: CommunityMember) => {
    const buttons = [];
    const manage = canManage(m);
    if (manage) buttons.push({
      text: 'Remove from group',
      onPress: () => confirmAction(`Remove ${m.name}?`, 'They can rejoin if the group is public or they have an invite link.', 'Remove', () => {
        void run(`rm-${m.userId}`, async () => { await client.removeMember(id, m.userId); dropMember(m.userId); });
      }),
    });
    if (manage) buttons.push({
      text: 'Ban from group',
      style: 'destructive' as const,
      onPress: () => confirmAction(`Ban ${m.name}?`, "They'll be removed and can't rejoin, even with an invite link. You can unban them later.", 'Ban', () => {
        void run(`ban-${m.userId}`, async () => { await client.banMember(id, m.userId); dropMember(m.userId); });
      }),
    });
    if (m.userId !== myId) {
      buttons.push({
        text: 'Report member',
        onPress: () => openReport({
          targetType: 'profile', targetId: m.userId, label: m.name, ownerId: m.userId, ownerName: m.name,
        }),
      });
      buttons.push({
        text: 'Block member',
        style: 'destructive' as const,
        onPress: () => { void blockUser({ userId: m.userId, name: m.name }).then((done) => { if (done) dropMember(m.userId); }); },
      });
    }
    buttons.push({ text: 'Cancel', style: 'cancel' as const });
    showActionSheet(m.name, undefined, buttons);
  };

  const answerRequest = (r: CommunityJoinRequest, approve: boolean) => {
    void run(`req-${r.userId}`, async () => {
      if (approve) await client.approveRequest(id, r.userId); else await client.denyRequest(id, r.userId);
      setRequests((prev) => prev.filter((x) => x.userId !== r.userId));
      if (approve) void loadAll('refresh');
    });
  };

  const leave = () => confirmAction('Leave this group?', "You'll stop getting its messages.", 'Leave', () => {
    void run('leave', async () => {
      await client.leave(id);
      router.replace(withPreviewDemo('/community') as never);
    });
  });

  const deleteGroup = () => confirmAction('Delete this group?', 'This removes the group and its messages for everyone. This can’t be undone.', 'Delete group', () => {
    void run('delete', async () => {
      await client.remove(id);
      haptics.success();
      router.replace(withPreviewDemo('/community') as never);
    });
  });

  /** Same picker + circular crop + upload path as a profile photo. */
  const changePhoto = async () => {
    if (!community || !canEdit || photoBusy) return;
    const hasPhoto = !!community.iconUrl;
    let removed = false;
    const asset = await openImageSheet({
      aspect: [1, 1], cropCircle: true,
      onRemove: hasPhoto ? () => { removed = true; } : undefined,
    });
    if (!asset && !removed) return;
    setPhotoBusy(true);
    setNotice(null);
    try {
      const updated = asset ? await client.setPhoto(id, asset) : await client.removePhoto(id);
      setCommunity((prev) => (prev ? { ...prev, iconUrl: updated.iconUrl } : updated));
      haptics.success();
    } catch (e) {
      setNotice(describeCommunityError(e, "We couldn't update the group photo. Try another one.").message);
    } finally { setPhotoBusy(false); }
  };

  const toggleMute = () => {
    if (!community) return;
    const muted = !community.muted;
    void run('mute', async () => {
      await client.setMuted(id, muted);
      setCommunity((prev) => (prev ? { ...prev, muted } : prev));
    });
  };

  const setAdmin = (m: CommunityMember, makeAdmin: boolean) => {
    void run(`role-${m.userId}`, async () => {
      await client.setRole(id, m.userId, makeAdmin ? 'admin' : 'member');
      setMembers((prev) => prev.map((x) => (x.userId === m.userId ? { ...x, role: makeAdmin ? 'admin' : 'member' } : x)));
      haptics.light();
    });
  };

  const canManage = (m: CommunityMember) => {
    if (!isStaff || m.userId === myId || m.role === 'owner') return false;
    return isOwner || m.role === 'member';
  };

  const isCreator = isOwner && community?.kind === 'user';
  const canInvite = !!community && (community.visibility === 'public' || isStaff);

  const hero = community ? (
    <View style={styles.hero}>
      <PressableScale
        onPress={canEdit ? () => { void changePhoto(); } : undefined}
        disabled={!canEdit || photoBusy}
        accessibilityRole={canEdit ? 'button' : 'image'}
        accessibilityLabel={canEdit ? 'Change group photo' : `${community.name} photo`}
        testID="group-info-photo"
      >
        <View>
          <CommunityAvatar community={community} size={96} />
          {photoBusy ? (
            <View style={[StyleSheet.absoluteFill, styles.photoBusy, { backgroundColor: colors.background + 'B3' }]}>
              <ActivityIndicator color={colors.foreground} />
            </View>
          ) : null}
          {canEdit ? (
            <View style={[styles.cameraBadge, { backgroundColor: colors.foreground, borderColor: colors.background }]} testID="group-info-photo-edit">
              <Icon name="camera" size={14} color={colors.background} />
            </View>
          ) : null}
        </View>
      </PressableScale>
      <View style={styles.heroNameRow}>
        <Text style={[styles.heroName, { color: colors.foreground }]} numberOfLines={2}>{community.name}</Text>
        {community.verified ? <VerifiedMark size={16} /> : null}
      </View>
      <Text style={[styles.heroMeta, { color: colors.mutedForeground }]}>
        {formatMemberCount(memberCount)} · {community.visibility === 'private' ? 'Private group' : 'Public group'}
      </Text>
      {community.description ? (
        <Text style={[styles.heroDesc, { color: colors.mutedForeground }]}>{community.description}</Text>
      ) : null}

      <View style={styles.actions}>
        <QuickAction icon={community.muted ? 'bell' : 'bell-off'} label={community.muted ? 'Unmute' : 'Mute'} onPress={toggleMute} busy={busy === 'mute'} />
        {canInvite ? <QuickAction icon="user-plus" label="Invite" onPress={() => setInviteOpen(true)} /> : null}
      </View>
    </View>
  ) : null;

  const listHeader = (
    <View>
      {!debounced ? hero : null}
      {notice ? <Text style={[styles.notice, { color: colors.foreground }]}>{notice}</Text> : null}

      {isStaff && requests.length > 0 && !debounced ? (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Join requests</Text>
          {requests.map((r) => (
            <View key={r.userId} style={styles.row}>
              <Avatar uri={r.avatarUrl} name={r.name} size={40} />
              <View style={styles.copy}>
                <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>{r.name}</Text>
                {r.handle ? <Text style={[styles.sub, { color: colors.mutedForeground }]} numberOfLines={1}>@{r.handle}</Text> : null}
              </View>
              <Button label="Deny" size="small" variant="secondary" style={CHIP_PAD} disabled={busy === `req-${r.userId}`} onPress={() => answerRequest(r, false)} />
              <Button label="Approve" size="small" style={CHIP_PAD} loading={busy === `req-${r.userId}`} onPress={() => answerRequest(r, true)} />
            </View>
          ))}
        </View>
      ) : null}

      {isStaff && !debounced ? (
        <SettingsSection title="Group settings" style={styles.settings}>
          <SettingsRow icon="edit-2" label="Edit group" subtitle="Name, description, photo, who can join" onPress={() => setEditOpen(true)} />
          <SettingsRow icon="slash" label="Banned members" onPress={() => setBansOpen(true)} last={!isOwner} />
          {isOwner ? <SettingsRow icon="trash-2" label="Delete group" destructive onPress={deleteGroup} last /> : null}
        </SettingsSection>
      ) : null}

      <Text style={[styles.sectionTitle, styles.membersTitle, { color: colors.foreground }]}>Members</Text>
      {community?.kind === 'user' && !debounced ? (
        <Text style={[styles.sub, styles.rolesHint, { color: colors.mutedForeground }]}>
          {isCreator ? 'Admins can change the group photo, name and description.' : 'Only the creator and admins can change the group photo, name and description.'}
        </Text>
      ) : null}
    </View>
  );

  const renderMember = ({ item: m }: { item: CommunityMember }) => {
    const hint = [m.handle ? m.handle : null, m.accountType === 'seller' ? 'Seller' : m.accountType === 'buyer' ? 'Buyer' : null]
      .filter(Boolean).join(', ');
    return (
      <View style={styles.row}>
        {/* Width-bounded wrapper (as in CommunityRow): the pressable's own box ignores flex, so
            without it a long name + role pill pushed the row's actions off-screen. */}
        <View style={styles.memberTapWrap}>
        <PressableScale onPress={() => openProfile(m)} onLongPress={m.userId === myId ? undefined : () => openMemberMenu(m)} style={styles.memberTap} accessibilityRole="button" accessibilityLabel={`Open ${m.name}'s profile`}>
          <Avatar uri={m.avatarUrl} name={m.name} size={40} />
          <View style={styles.copy}>
            <View style={styles.nameRow}>
              <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>{m.userId === myId ? `${m.name} (you)` : m.name}</Text>
              {m.role !== 'member' ? (
                <View style={[styles.badge, { borderColor: colors.border }]}>
                  <Text style={[styles.badgeText, { color: colors.mutedForeground }]}>{m.role === 'owner' ? (community?.kind === 'user' ? 'Creator' : 'Owner') : 'Admin'}</Text>
                </View>
              ) : null}
            </View>
            {hint ? <Text style={[styles.sub, { color: colors.mutedForeground }]} numberOfLines={1}>{hint}</Text> : null}
          </View>
        </PressableScale>
        </View>
        {isCreator && m.role !== 'owner' && m.userId !== myId ? (
          <RolePill
            isAdmin={m.role === 'admin'}
            busy={busy === `role-${m.userId}`}
            onPress={() => setAdmin(m, m.role !== 'admin')}
            name={m.name}
            testID={`member-role-${m.userId}`}
          />
        ) : null}
        {canManage(m) ? (
          <PressableScale
            onPress={() => openMemberMenu(m)}
            style={styles.menuBtn}
            accessibilityRole="button"
            accessibilityLabel={`Actions for ${m.name}`}
          >
            <Icon name="more-horizontal" size={20} color={colors.mutedForeground} />
          </PressableScale>
        ) : null}
      </View>
    );
  };

  const footer = (
    <View>
      {loadingMore ? <ActivityIndicator color={colors.mutedForeground} style={{ paddingVertical: SP.md }} /> : null}
      {/* The creator can't leave their own group — they delete it (Group settings). */}
      {role && !isCreator && !debounced ? (
        <PressableScale onPress={leave} style={styles.leaveRow} accessibilityRole="button" accessibilityLabel="Leave group">
          <Icon name="log-out" size={18} color={colors.destructive} />
          <Text style={[styles.leaveText, { color: colors.destructive }]}>Leave group</Text>
        </PressableScale>
      ) : null}
    </View>
  );

  const body = () => {
    if (needsSignIn) {
      return <View style={styles.pad}><SignInPrompt message="Sign in to see who's in this group." /></View>;
    }
    if (loading && !refreshing) {
      return (
        <View style={styles.pad}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <View key={i} style={styles.row}>
              <SkeletonBlock width={40} height={40} radius={20} />
              <View style={{ flex: 1, gap: 7 }}>
                <SkeletonBlock width="50%" height={13} />
                <SkeletonBlock width="30%" height={11} />
              </View>
            </View>
          ))}
        </View>
      );
    }
    if (notFound) {
      return (
        <View style={styles.notFoundWrap}>
          <EmptyState
            icon="users"
            title="Group not found"
            message="This group may have been deleted, or the link is wrong."
            actionLabel="Go back"
            // Back where they came from; with no history, the groups list.
            onAction={() => goBackOr(router, '/community')}
          />
        </View>
      );
    }
    if (error || !community) {
      return <ErrorState message={error ?? "Couldn't load members."} onRetry={() => { void loadAll(); }} />;
    }
    return (
      <FlatList
        {...LONG_LIST_TUNING}
        data={members}
        keyExtractor={(m) => m.userId}
        renderItem={renderMember}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={
          <Text style={[styles.empty, { color: colors.mutedForeground }]}>
            {debounced ? 'No members match that search.' : 'No members yet.'}
          </Text>
        }
        ListFooterComponent={footer}
        onEndReached={() => { void loadMore(); }}
        onEndReachedThreshold={0.6}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.pad, { paddingBottom: barInset + SP.lg }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void loadAll('refresh'); }} tintColor={colors.mutedForeground} />}
      />
    );
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScreenHeader divider={false} title="Group info" />
      {community && !needsSignIn ? (
        <View style={styles.searchWrap}>
          <SearchBar value={query} onChange={setQuery} placeholder="Search members" />
        </View>
      ) : null}
      {body()}

      {community ? (
        <>
          <InviteSheet visible={inviteOpen} onClose={() => setInviteOpen(false)} community={community} />
          <EditGroupModal
            visible={editOpen}
            onClose={() => setEditOpen(false)}
            community={community}
            onSaved={(c) => { setCommunity((prev) => (prev ? { ...prev, ...c } : c)); setEditOpen(false); }}
            onPhotoChanged={(c) => setCommunity((prev) => (prev ? { ...prev, iconUrl: c.iconUrl } : c))}
          />
          <BansModal visible={bansOpen} onClose={() => setBansOpen(false)} communityId={id} onUnbanned={() => { void loadAll('refresh'); }} />
        </>
      ) : null}
      {imageSourceSheet}
    </View>
  );
}

/** Creator-only role toggle on a member row: filled "Make admin", outlined "Remove admin". */
function RolePill({ isAdmin, busy, onPress, name, testID }: { isAdmin: boolean; busy: boolean; onPress: () => void; name: string; testID?: string }) {
  const colors = useColors();
  return (
    <PressableScale
      onPress={onPress}
      disabled={busy}
      noMinHeight
      hitSlop={{ top: 7, bottom: 7 }}
      style={[styles.rolePill, isAdmin
        ? { borderColor: colors.border, backgroundColor: 'transparent' }
        : { borderColor: colors.foreground, backgroundColor: colors.foreground }]}
      accessibilityRole="button"
      accessibilityLabel={isAdmin ? `Remove ${name} as admin` : `Make ${name} an admin`}
      testID={testID}
    >
      {busy ? (
        <ActivityIndicator size="small" color={isAdmin ? colors.foreground : colors.background} />
      ) : (
        <Text style={[styles.rolePillText, { color: isAdmin ? colors.foreground : colors.background }]}>
          {isAdmin ? 'Remove admin' : 'Make admin'}
        </Text>
      )}
    </PressableScale>
  );
}

function QuickAction({ icon, label, onPress, busy, testID }: { icon: React.ComponentProps<typeof Icon>['name']; label: string; onPress: () => void; busy?: boolean; testID?: string }) {
  const colors = useColors();
  return (
    <PressableScale onPress={onPress} disabled={busy} style={styles.action} accessibilityRole="button" accessibilityLabel={label} testID={testID}>
      <View style={[styles.actionIcon, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {busy ? <ActivityIndicator size="small" color={colors.foreground} /> : <Icon name={icon} size={18} color={colors.foreground} />}
      </View>
      <Text style={[styles.actionLabel, { color: colors.foreground }]}>{label}</Text>
    </PressableScale>
  );
}

// ─── Full-screen modal shell ─────────────────────────────────────────────────

function FullScreenModal({ visible, title, onClose, children }: { visible: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  const colors = useColors();
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <ModalSafeArea>
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          <ScreenHeader divider={false} title={title} variant="modal" onBack={onClose} />
          {children}
        </View>
      </ModalSafeArea>
    </Modal>
  );
}

// ─── Invite link + QR ────────────────────────────────────────────────────────

function InviteSheet({ visible, onClose, community }: { visible: boolean; onClose: () => void; community: Community }) {
  const colors = useColors();
  const client = useCommunityClient();
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchLink = useCallback(async (reset: boolean) => {
    setLoading(true);
    setMessage(null);
    try {
      const res = reset ? await client.resetInvite(community.id) : await client.invite(community.id);
      setUrl(res.url || inviteUrlForCode(res.code));
    } catch (e) {
      setMessage(describeCommunityError(e, "Couldn't load the invite link. Try again.").message);
    } finally { setLoading(false); }
  }, [client, community.id]);

  useEffect(() => { if (visible) { setCopied(false); void fetchLink(false); } }, [visible, fetchLink]);

  const copy = async () => {
    if (!url) return;
    try { await Clipboard.setStringAsync(url); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setMessage("Couldn't copy the link."); }
  };
  const share = async () => {
    if (!url) return;
    try { await Share.share({ message: `Join ${community.name} on Brandthread: ${url}` }); } catch { /* cancelled */ }
  };
  const reset = () => confirmAction('Reset invite link?', 'The current link and QR code stop working.', 'Reset link', () => { void fetchLink(true); });

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View style={styles.sheet}>
        <Text style={[styles.sheetTitle, { color: colors.foreground }]}>Invite to {community.name}</Text>
        <View style={[styles.qrBox, { backgroundColor: colors.foreground }]}>
          {loading || !url ? (
            <ActivityIndicator color={colors.background} />
          ) : (
            <QRCode value={url} size={168} backgroundColor={colors.foreground} color={colors.background} />
          )}
        </View>
        {message ? <Text style={[styles.sub, { color: colors.mutedForeground, textAlign: 'center' }]}>{message}</Text> : null}
        {url ? <Text style={[styles.sub, { color: colors.mutedForeground, textAlign: 'center' }]} numberOfLines={2} selectable>{url}</Text> : null}
        <View style={styles.sheetButtons}>
          <Button label={copied ? 'Copied' : 'Copy link'} icon={copied ? 'check' : 'copy'} variant="secondary" size="small" disabled={!url || loading} onPress={() => { void copy(); }} style={{ flex: 1 }} />
          <Button label="Share" icon="share" size="small" disabled={!url || loading} onPress={() => { void share(); }} style={{ flex: 1 }} />
        </View>
        <Button label="Reset invite link" variant="tertiary" size="small" disabled={loading} onPress={reset} />
      </View>
    </BottomSheet>
  );
}

// ─── Edit group ──────────────────────────────────────────────────────────────

function EditGroupModal({ visible, onClose, community, onSaved, onPhotoChanged }: {
  visible: boolean; onClose: () => void; community: Community; onSaved: (c: Community) => void; onPhotoChanged: (c: Community) => void;
}) {
  const client = useCommunityClient();
  const { open: openImageSheet, sheet: imageSourceSheet } = useImageSourceSheet();
  const colors = useColors();
  const barInset = useBuyerTabBarInset();
  const initial = useMemo<GroupFormValue>(() => ({
    name: community.name, description: community.description ?? '', visibility: community.visibility,
    requireApproval: community.requireApproval, photoUri: community.iconUrl,
  }), [community]);
  const [form, setForm] = useState<GroupFormValue>(initial);
  const [errors, setErrors] = useState<GroupFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) { setForm(initial); setErrors({}); setFormError(null); }
  }, [visible, initial]);

  // The photo saves on its own, straight away (the profile-photo flow); Save covers the text fields.
  const applyPhoto = async (change: () => Promise<Community>, localUri?: string) => {
    setErrors((e) => ({ ...e, photo: null }));
    const previous = form.photoUri;
    setForm((f) => ({ ...f, photoUri: localUri }));
    setUploading(true);
    try {
      const updated = await change();
      setForm((f) => ({ ...f, photoUri: updated.iconUrl }));
      onPhotoChanged(updated);
    } catch (e) {
      setForm((f) => ({ ...f, photoUri: previous }));
      setErrors((prev) => ({ ...prev, photo: describeCommunityError(e, "We couldn't upload that photo. Try another one.").message }));
    } finally { setUploading(false); }
  };

  const pick = async () => {
    const asset = await openImageSheet({ aspect: [1, 1], cropCircle: true });
    if (asset) await applyPhoto(() => client.setPhoto(community.id, asset), asset.uri);
  };

  const save = async () => {
    const nameError = validateGroupName(form.name);
    const descError = validateGroupDescription(form.description);
    if (nameError || descError) { setErrors({ name: nameError, description: descError }); return; }
    setSaving(true);
    setFormError(null);
    try {
      const updated = await client.update(community.id, {
        name: form.name.trim(),
        description: form.description.trim(),
        visibility: form.visibility,
        requireApproval: form.visibility === 'private' ? form.requireApproval : false,
      });
      haptics.success();
      onSaved(updated);
    } catch (e) {
      const info = describeCommunityError(e);
      if (info.code === 'NAME_RESERVED') setErrors((prev) => ({ ...prev, name: info.message })); else setFormError(info.message);
    } finally { setSaving(false); }
  };

  return (
    <FullScreenModal visible={visible} title="Edit group" onClose={onClose}>
      <KeyboardAwareScrollViewCompat
        contentContainerStyle={[styles.editContent, { paddingBottom: barInset + SP.xl }]}
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        <GroupFormFields
          value={form}
          onChange={(p) => { setForm((f) => ({ ...f, ...p })); if (p.name !== undefined) setErrors((e) => ({ ...e, name: null })); }}
          errors={errors}
          uploading={uploading}
          onPickPhoto={() => { void pick(); }}
          onRemovePhoto={() => { void applyPhoto(() => client.removePhoto(community.id)); }}
        />
        {formError ? <Text style={[styles.sub, { color: colors.mutedForeground }]}>{formError}</Text> : null}
        <Button label="Save changes" onPress={() => { void save(); }} loading={saving} disabled={uploading} fullWidth />
      </KeyboardAwareScrollViewCompat>
      {imageSourceSheet}
    </FullScreenModal>
  );
}

// ─── Banned members ──────────────────────────────────────────────────────────

function BansModal({ visible, onClose, communityId, onUnbanned }: { visible: boolean; onClose: () => void; communityId: string; onUnbanned: () => void }) {
  const client = useCommunityClient();
  const colors = useColors();
  const [bans, setBans] = useState<{ userId: string; name: string; bannedAt: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBans(null);
    setError(null);
    try { setBans(await client.bans(communityId)); } catch (e) { setError(describeCommunityError(e, "Couldn't load banned members.").message); }
  }, [client, communityId]);

  useEffect(() => { if (visible) void load(); }, [visible, load]);

  const unban = async (userId: string) => {
    setBusyId(userId);
    try {
      await client.unban(communityId, userId);
      setBans((prev) => (prev ? prev.filter((b) => b.userId !== userId) : prev));
      onUnbanned();
    } catch (e) { setError(describeCommunityError(e).message); } finally { setBusyId(null); }
  };

  return (
    <FullScreenModal visible={visible} title="Banned members" onClose={onClose}>
      {error && !bans ? (
        <ErrorState message={error} onRetry={() => { void load(); }} />
      ) : bans === null ? (
        <ActivityIndicator color={colors.mutedForeground} style={{ marginTop: SP.xl }} />
      ) : (
        <FlatList
          data={bans}
          keyExtractor={(b) => b.userId}
          contentContainerStyle={styles.pad}
          ListHeaderComponent={error ? <Text style={[styles.notice, { color: colors.foreground }]}>{error}</Text> : null}
          ListEmptyComponent={<Text style={[styles.empty, { color: colors.mutedForeground }]}>No one is banned from this group.</Text>}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <View style={styles.copy}>
                <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>{item.name}</Text>
                <Text style={[styles.sub, { color: colors.mutedForeground }]}>Banned {fmtRelativeDay(item.bannedAt)}</Text>
              </View>
              <Button label="Unban" size="small" variant="secondary" style={CHIP_PAD} loading={busyId === item.userId} onPress={() => { void unban(item.userId); }} />
            </View>
          )}
        />
      )}
    </FullScreenModal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  searchWrap: { paddingHorizontal: SP.md, paddingTop: SP.md },
  pad: { paddingHorizontal: SP.md, paddingTop: SP.sm },
  notFoundWrap: { flex: 1, justifyContent: 'center' },
  hero: { alignItems: 'center', paddingTop: SP.md, paddingBottom: SP.sm, gap: 6 },
  photoBusy: { alignItems: 'center', justifyContent: 'center', borderRadius: 27 },
  cameraBadge: {
    position: 'absolute', right: -4, bottom: -4, width: 30, height: 30, borderRadius: 15, borderWidth: 3,
    alignItems: 'center', justifyContent: 'center',
  },
  heroNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: SP.sm, paddingHorizontal: SP.md },
  heroName: { flexShrink: 1, fontFamily: FONT.bold, fontSize: FS.lg, letterSpacing: -0.3, textAlign: 'center' },
  heroMeta: { fontVariant: ['tabular-nums'], fontFamily: FONT.medium, fontSize: FS.sm },
  heroDesc: { fontFamily: FONT.regular, fontSize: FS.base, lineHeight: 21, textAlign: 'center', paddingHorizontal: SP.md },
  actions: { flexDirection: 'row', justifyContent: 'center', gap: SP.lg, marginTop: SP.md },
  action: { alignItems: 'center', gap: 6, minWidth: 64 },
  actionIcon: { width: 44, height: 44, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { fontFamily: FONT.medium, fontSize: FS.meta },
  rolesHint: { marginBottom: SP.xs },
  rolePill: { height: 30, minWidth: 96, paddingHorizontal: 12, borderRadius: RADIUS.pill, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  rolePillText: { fontFamily: FONT.semibold, fontSize: FS.meta },
  notice: { fontFamily: FONT.medium, fontSize: FS.sm, lineHeight: 19, marginVertical: SP.sm },
  section: { marginTop: SP.md },
  settings: { marginTop: SP.md, marginBottom: 0 },
  sectionTitle: { fontFamily: FONT.bold, fontSize: FS.md, letterSpacing: -0.2, marginBottom: SP.xs },
  membersTitle: { marginTop: SP.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: SP.sm + 2, minHeight: 60 },
  memberTapWrap: { flex: 1, minWidth: 0 },
  memberTap: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: SP.sm + 2, minHeight: 60 },
  copy: { flex: 1, minWidth: 0, gap: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { flexShrink: 1, fontFamily: FONT.semibold, fontSize: FS.base },
  sub: { fontFamily: FONT.regular, fontSize: FS.meta, lineHeight: 17 },
  badge: { borderWidth: 1, borderRadius: RADIUS.pill, paddingHorizontal: 12, paddingVertical: 1 },
  badgeText: { fontFamily: FONT.semibold, fontSize: FS.xs },
  menuBtn: { width: COMP.minTouchTarget, height: COMP.minTouchTarget, alignItems: 'center', justifyContent: 'center' },
  empty: { fontFamily: FONT.regular, fontSize: FS.sm, textAlign: 'center', paddingVertical: SP.lg },
  leaveRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.sm, minHeight: COMP.buttonH, marginTop: SP.md },
  leaveText: { fontFamily: FONT.semibold, fontSize: FS.base },
  sheet: { alignItems: 'center', gap: SP.md, paddingHorizontal: SP.md, paddingTop: SP.sm, paddingBottom: SP.md },
  sheetTitle: { fontFamily: FONT.bold, fontSize: FS.lg, letterSpacing: -0.2, textAlign: 'center' },
  sheetButtons: { flexDirection: 'row', gap: SP.sm, width: '100%' },
  qrBox: { width: 200, height: 200, borderRadius: RADIUS.lg, alignItems: 'center', justifyContent: 'center' },
  editContent: { paddingHorizontal: SP.md, paddingTop: SP.md, gap: SP.md },
});
