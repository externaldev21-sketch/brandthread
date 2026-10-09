/**
 * Community members — /community-members?id=
 * Everyone sees the member list (search, pagination, tap → profile).
 * Owners/admins of USER-created groups also get per-member moderation, join
 * requests and group settings (edit, invite link + QR, banned members, delete).
 * Official communities have no owner tools. Members can leave at the bottom.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, RefreshControl, Share, StyleSheet, Text, View } from 'react-native';
import { LONG_LIST_TUNING } from '@/lib/listTuning';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import { Feather } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ModalSafeArea } from '@/components/ModalSafeArea';
import { PressableScale, SearchBar } from '@/components/BrandthreadUI';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Avatar';
import { ErrorState } from '@/components/ui/ErrorState';
import { SkeletonBlock } from '@/components/ui/Skeleton';
import { showActionSheet } from '@/components/ui/ActionSheet';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { SettingsRow, SettingsSection } from '@/components/settings/SettingsKit';
import { GroupFormFields, type GroupFormErrors, type GroupFormValue } from '@/components/community/GroupFormFields';
import { SignInPrompt } from '@/components/community/SignInPrompt';
import { useBuyerTabBarInset } from '@/components/buyer-nav/buyerTabBarMetrics';
import { useCommunityClient, useCommunityMyId } from '@/lib/communities/useCommunityClient';
import {
  formatMemberCount, type Community, type CommunityJoinRequest, type CommunityMember, type CommunityRole,
} from '@/lib/communities/types';
import { describeCommunityError } from '@/lib/communities/errors';
import { inviteUrlForCode } from '@/lib/communities/inviteLink';
import { pickAndUploadCommunityPhoto } from '@/lib/communities/pickPhoto';
import { validateGroupDescription, validateGroupName } from '@/lib/communities/validation';
import { hapticLight, hapticSuccess } from '@/lib/haptics';
import { useColors } from '@/hooks/useColors';
import { useReportSheet } from '@/components/safety/ReportSheet';
import { useBlockAction } from '@/lib/useBlockAction';
import { COMP, FONT, FS, RADIUS, SP } from '@/lib/theme';

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
  const { id: rawId } = useLocalSearchParams<{ id?: string }>();
  const id = (Array.isArray(rawId) ? rawId[0] : rawId) ?? '';

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
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
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

  const loadAll = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
    if (!id) { setError("This group couldn't be found."); setLoading(false); return; }
    const gen = ++generation.current;
    if (mode === 'refresh') setRefreshing(true); else setLoading(true);
    setError(null);
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
      if (info.authRequired) setNeedsSignIn(true); else setError(info.message);
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
    hapticLight();
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
    if (isOwner && manage) {
      const makeAdmin = m.role !== 'admin';
      buttons.push({
        text: makeAdmin ? 'Make admin' : 'Remove admin',
        onPress: () => { void run(`role-${m.userId}`, async () => {
          await client.setRole(id, m.userId, makeAdmin ? 'admin' : 'member');
          setMembers((prev) => prev.map((x) => (x.userId === m.userId ? { ...x, role: makeAdmin ? 'admin' : 'member' } : x)));
        }); },
      });
    }
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
      router.replace('/community' as never);
    });
  });

  const deleteGroup = () => confirmAction('Delete this group?', 'This removes the group and its messages for everyone. This can’t be undone.', 'Delete group', () => {
    void run('delete', async () => {
      await client.remove(id);
      hapticSuccess();
      router.replace('/community' as never);
    });
  });

  const canManage = (m: CommunityMember) => {
    if (!isStaff || m.userId === myId || m.role === 'owner') return false;
    return isOwner || m.role === 'member';
  };

  const listHeader = (
    <View>
      <Text style={[styles.count, { color: colors.mutedForeground }]}>{formatMemberCount(memberCount)}</Text>
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
          <SettingsRow icon="share-2" label="Share invite link" subtitle="Link and QR code" onPress={() => setInviteOpen(true)} />
          <SettingsRow icon="slash" label="Banned members" onPress={() => setBansOpen(true)} last={!isOwner} />
          {isOwner ? <SettingsRow icon="trash-2" label="Delete group" destructive onPress={deleteGroup} last /> : null}
        </SettingsSection>
      ) : null}

      <Text style={[styles.sectionTitle, styles.membersTitle, { color: colors.foreground }]}>Members</Text>
    </View>
  );

  const renderMember = ({ item: m }: { item: CommunityMember }) => {
    const hint = [m.handle ? m.handle : null, m.accountType === 'seller' ? 'Seller' : m.accountType === 'buyer' ? 'Buyer' : null]
      .filter(Boolean).join(', ');
    return (
      <View style={styles.row}>
        <PressableScale onPress={() => openProfile(m)} onLongPress={m.userId === myId ? undefined : () => openMemberMenu(m)} style={styles.memberTap} accessibilityRole="button" accessibilityLabel={`Open ${m.name}'s profile`}>
          <Avatar uri={m.avatarUrl} name={m.name} size={40} />
          <View style={styles.copy}>
            <View style={styles.nameRow}>
              <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>{m.userId === myId ? `${m.name} (you)` : m.name}</Text>
              {m.role !== 'member' ? (
                <View style={[styles.badge, { borderColor: colors.border }]}>
                  <Text style={[styles.badgeText, { color: colors.mutedForeground }]}>{m.role === 'owner' ? 'Owner' : 'Admin'}</Text>
                </View>
              ) : null}
            </View>
            {hint ? <Text style={[styles.sub, { color: colors.mutedForeground }]} numberOfLines={1}>{hint}</Text> : null}
          </View>
        </PressableScale>
        {canManage(m) ? (
          <PressableScale
            onPress={() => openMemberMenu(m)}
            style={styles.menuBtn}
            accessibilityRole="button"
            accessibilityLabel={`Actions for ${m.name}`}
          >
            <Feather name="more-horizontal" size={20} color={colors.mutedForeground} />
          </PressableScale>
        ) : null}
      </View>
    );
  };

  const footer = (
    <View>
      {loadingMore ? <ActivityIndicator color={colors.mutedForeground} style={{ paddingVertical: SP.md }} /> : null}
      {role && !debounced ? (
        <PressableScale onPress={leave} style={styles.leaveRow} accessibilityRole="button" accessibilityLabel="Leave group">
          <Feather name="log-out" size={18} color={colors.destructive} />
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
      <ScreenHeader divider={false} title="Members" />
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
          />
          <BansModal visible={bansOpen} onClose={() => setBansOpen(false)} communityId={id} onUnbanned={() => { void loadAll('refresh'); }} />
        </>
      ) : null}
    </View>
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
    hapticLight();
    try { await Clipboard.setStringAsync(url); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setMessage("Couldn't copy the link."); }
  };
  const share = async () => {
    if (!url) return;
    hapticLight();
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

function EditGroupModal({ visible, onClose, community, onSaved }: { visible: boolean; onClose: () => void; community: Community; onSaved: (c: Community) => void }) {
  const client = useCommunityClient();
  const colors = useColors();
  const barInset = useBuyerTabBarInset();
  const initial = useMemo<GroupFormValue>(() => ({
    name: community.name, description: community.description ?? '', visibility: community.visibility,
    requireApproval: community.requireApproval, photoUri: community.iconUrl,
  }), [community]);
  const [form, setForm] = useState<GroupFormValue>(initial);
  const [photoUrl, setPhotoUrl] = useState<string | null>(community.iconUrl ?? null);
  const [errors, setErrors] = useState<GroupFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) { setForm(initial); setPhotoUrl(community.iconUrl ?? null); setErrors({}); setFormError(null); }
  }, [visible, initial, community.iconUrl]);

  const pick = async () => {
    setErrors((e) => ({ ...e, photo: null }));
    setUploading(true);
    try {
      const picked = await pickAndUploadCommunityPhoto(client);
      if (picked) { setPhotoUrl(picked.url); setForm((f) => ({ ...f, photoUri: picked.uri })); }
    } catch (e) {
      setErrors((prev) => ({ ...prev, photo: describeCommunityError(e, "We couldn't upload that photo. Try another one.").message }));
    } finally { setUploading(false); }
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
        iconUrl: photoUrl,
      });
      hapticSuccess();
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
          onRemovePhoto={() => { setPhotoUrl(null); setForm((f) => ({ ...f, photoUri: undefined })); }}
        />
        {formError ? <Text style={[styles.sub, { color: colors.mutedForeground }]}>{formError}</Text> : null}
        <Button label="Save changes" onPress={() => { void save(); }} loading={saving} disabled={uploading} fullWidth />
      </KeyboardAwareScrollViewCompat>
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
                <Text style={[styles.sub, { color: colors.mutedForeground }]}>Banned {new Date(item.bannedAt).toLocaleDateString()}</Text>
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
  count: { fontFamily: FONT.medium, fontSize: FS.sm, marginBottom: SP.xs },
  notice: { fontFamily: FONT.medium, fontSize: FS.sm, lineHeight: 19, marginVertical: SP.sm },
  section: { marginTop: SP.md },
  settings: { marginTop: SP.md, marginBottom: 0 },
  sectionTitle: { fontFamily: FONT.bold, fontSize: FS.md, letterSpacing: -0.2, marginBottom: SP.xs },
  membersTitle: { marginTop: SP.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: SP.sm + 2, minHeight: 60 },
  memberTap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: SP.sm + 2, minHeight: 60 },
  copy: { flex: 1, gap: 1 },
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
