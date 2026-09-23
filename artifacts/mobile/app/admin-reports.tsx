/**
 * Review queue — platform moderators review member reports and content held
 * by the automatic filter, then dismiss, remove the content, or suspend the
 * account. Resolving one report resolves every open report on the same item.
 *
 * Backed by /api/moderation (moderators only: users.role = 'admin').
 * Non-moderators see an access notice instead of the queue.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, FlatList, ScrollView, StyleSheet, RefreshControl, ActivityIndicator,
  Modal, Pressable, TextInput,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { useApi } from '@/lib/api';
import { EmptyState, PressableScale, PrimaryButton } from '@/components/BrandthreadUI';
import { CachedImage } from '@/components/CachedImage';
import {
  REPORT_REASONS, TARGET_ICONS, TARGET_LABELS, apiErrorMessage, normalizeReportTarget, shortRelativeTime,
} from '@/lib/safety';
import type {
  ModerationAction, ModerationQueue, ModerationQueueItem, ProfileSummary, ReportTargetType,
} from '@/lib/safetyTypes';

type Status = 'open' | 'resolved';
type TypeFilter = 'all' | ReportTargetType;

const TYPE_FILTERS: { key: TypeFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'comment', label: 'Comments' },
  { key: 'post', label: 'Posts' },
  { key: 'video', label: 'Videos' },
  { key: 'live', label: 'Live' },
  { key: 'story', label: 'Stories' },
  { key: 'product', label: 'Products' },
  { key: 'profile', label: 'Profiles' },
  { key: 'message', label: 'Messages' },
];

const ACTION_LABELS: Record<string, string> = {
  dismiss: 'Dismissed',
  remove_content: 'Content removed',
  suspend_user: 'Account suspended',
};

function reasonLabel(reason: string) {
  return REPORT_REASONS.find((r) => r.id === reason)?.label ?? reason.replace(/_/g, ' ');
}

export default function ReviewQueueScreen() {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const api = useApi();

  const [access, setAccess] = useState<'checking' | 'granted' | 'denied'>('checking');
  const [status, setStatus] = useState<Status>('open');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [queue, setQueue] = useState<ModerationQueue | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ModerationQueueItem | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const me = await api.moderation.me();
      if (!me.isModerator) { setAccess('denied'); return; }
      setAccess('granted');
      const data = await api.moderation.queue({
        status,
        ...(typeFilter !== 'all' ? { type: typeFilter } : {}),
      });
      setQueue(data);
    } catch (err) {
      setError(apiErrorMessage(err, 'We couldn’t load the review queue.'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [api, status, typeFilter]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast((current) => (current === message ? null : current)), 2600);
  }

  async function resolve(item: ModerationQueueItem, action: ModerationAction, note: string) {
    const result = await api.moderation.resolve(item.id, action, note || undefined);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setSelected(null);
    setQueue((prev) => prev ? {
      ...prev,
      items: prev.items.filter((row) => !(row.targetType === item.targetType && row.targetId === item.targetId)),
      summary: {
        ...prev.summary,
        open: Math.max(0, prev.summary.open - result.resolvedReports),
        resolvedToday: prev.summary.resolvedToday + result.resolvedReports,
        heldByFilter: item.source === 'auto_filter' ? Math.max(0, prev.summary.heldByFilter - 1) : prev.summary.heldByFilter,
      },
    } : prev);
    showToast(action === 'dismiss'
      ? (item.source === 'auto_filter' ? 'Approved and published' : 'Report dismissed')
      : action === 'remove_content' ? 'Content removed' : `${item.owner?.name ?? 'Account'} suspended`);
  }

  async function reinstate(owner: ProfileSummary) {
    await api.moderation.reinstate(owner.userId);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setSelected(null);
    showToast(`${owner.name} reinstated`);
    load(true);
  }

  const summary = queue?.summary;
  const items = queue?.items ?? [];

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <PressableScale onPress={() => router.back()} style={s.headerBtn} accessibilityLabel="Back" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="arrow-left" size={ICON.lg} color={theme.text} />
        </PressableScale>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle}>Review queue</Text>
          {summary ? (
            <Text style={s.headerSub}>
              {summary.open} open · {summary.heldByFilter} held by filter · {summary.resolvedToday} resolved today
            </Text>
          ) : null}
        </View>
        <PressableScale onPress={() => router.push('/community-guidelines' as never)} style={s.headerBtn} accessibilityLabel="Community Guidelines">
          <Feather name="book-open" size={ICON.md} color={theme.text} />
        </PressableScale>
      </View>

      {access === 'denied' ? (
        <EmptyState
          icon="lock"
          title="Moderator access required"
          description="The review queue is available to Brandthread safety moderators. If you think you should have access, contact support."
          action={{ label: 'Go back', onPress: () => router.back() }}
          style={{ marginTop: SP.xxl }}
        />
      ) : (
        <>
          <View style={s.segment} accessibilityRole="tablist">
            {(['open', 'resolved'] as const).map((key) => {
              const active = status === key;
              return (
                <PressableScale
                  key={key}
                  onPress={() => { Haptics.selectionAsync(); setStatus(key); }}
                  style={[s.segmentItem, active && s.segmentItemActive]}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[s.segmentText, active && s.segmentTextActive]}>
                    {key === 'open' ? `Open${summary ? ` · ${summary.open}` : ''}` : 'Resolved'}
                  </Text>
                </PressableScale>
              );
            })}
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filters} style={{ flexGrow: 0 }}>
            {TYPE_FILTERS.map((filter) => {
              const active = typeFilter === filter.key;
              return (
                <PressableScale
                  key={filter.key}
                  onPress={() => { Haptics.selectionAsync(); setTypeFilter(filter.key); }}
                  style={[s.filterChip, active && s.filterChipActive]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[s.filterText, active && s.filterTextActive]}>{filter.label}</Text>
                </PressableScale>
              );
            })}
          </ScrollView>

          {loading || access === 'checking' ? (
            <View style={s.center}><ActivityIndicator color={theme.text} /></View>
          ) : error ? (
            <EmptyState
              icon="wifi-off"
              title="Queue unavailable"
              description={error}
              action={{ label: 'Try again', onPress: () => load() }}
              style={{ marginTop: SP.xl }}
            />
          ) : (
            <FlatList
              data={items}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{ paddingHorizontal: SP.md, paddingBottom: insets.bottom + SP.xxl, gap: SP.sm }}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={theme.text} />}
              renderItem={({ item }) => <QueueCard item={item} onPress={() => setSelected(item)} />}
              ListEmptyComponent={(
                <EmptyState
                  icon="check-circle"
                  title={status === 'open' ? 'Queue is clear' : 'Nothing resolved yet'}
                  description={status === 'open'
                    ? 'New reports and filter holds appear here. Aim to review everything within 24 hours.'
                    : 'Resolved reports and the actions taken will show here.'}
                  style={{ marginTop: SP.xl }}
                />
              )}
            />
          )}
        </>
      )}

      {toast ? (
        <View style={[s.toast, { bottom: insets.bottom + SP.lg }]} pointerEvents="none" accessibilityLiveRegion="polite">
          <Feather name="check" size={14} color={theme.onAccent} />
          <Text style={s.toastText}>{toast}</Text>
        </View>
      ) : null}

      <ReviewSheet
        item={selected}
        onClose={() => setSelected(null)}
        onResolve={resolve}
        onReinstate={reinstate}
      />
    </View>
  );
}

// ─── Queue card ───────────────────────────────────────────────────────────────

function QueueCard({ item, onPress }: { item: ModerationQueueItem; onPress: () => void }) {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const type = normalizeReportTarget(item.targetType);
  const auto = item.source === 'auto_filter';
  return (
    <PressableScale onPress={onPress} style={s.card} accessibilityRole="button" accessibilityLabel={`Review ${TARGET_LABELS[type]} report`}>
      <View style={s.cardTop}>
        <View style={s.typeIcon}><Feather name={TARGET_ICONS[type]} size={15} color={theme.text} /></View>
        <Text style={s.cardType}>{TARGET_LABELS[type].replace(/^\w/, (c) => c.toUpperCase())}</Text>
        <View style={[s.badge, auto ? s.badgeWarn : s.badgeNeutral]}>
          <Text style={[s.badgeText, auto && { color: theme.warning }]}>{auto ? 'Held by filter' : reasonLabel(item.reason)}</Text>
        </View>
        <View style={{ flex: 1 }} />
        <Text style={s.cardTime}>{shortRelativeTime(item.createdAt)}</Text>
      </View>

      {item.contentExcerpt ? (
        <Text style={s.excerpt} numberOfLines={3}>“{item.contentExcerpt}”</Text>
      ) : (
        <Text style={[s.excerpt, { fontStyle: 'italic' }]} numberOfLines={1}>{item.targetLabel ?? 'No text content'}</Text>
      )}

      <View style={s.cardBottom}>
        {item.owner ? (
          <View style={s.ownerRow}>
            <MiniAvatar profile={item.owner} />
            <Text style={s.ownerName} numberOfLines={1}>{item.owner.name}</Text>
            {item.owner.suspended ? <Text style={s.suspendedTag}>Suspended</Text> : null}
          </View>
        ) : <View style={{ flex: 1 }} />}
        {item.status === 'pending' ? (
          item.openReportsOnTarget > 1
            ? <Text style={s.countTag}>{item.openReportsOnTarget} reports</Text>
            : null
        ) : (
          <Text style={s.countTag}>{ACTION_LABELS[item.resolution?.action ?? ''] ?? item.status}</Text>
        )}
      </View>
    </PressableScale>
  );
}

function MiniAvatar({ profile, size = 22 }: { profile: ProfileSummary; size?: number }) {
  const { theme } = useAppTheme();
  if (profile.avatarUrl) {
    return <CachedImage source={{ uri: profile.avatarUrl }} style={{ width: size, height: size, borderRadius: size / 2 }} contentFit="cover" />;
  }
  return (
    <View style={{
      width: size, height: size, borderRadius: size / 2, backgroundColor: theme.cardElevated,
      borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center',
    }}>
      <Text style={{ color: theme.text, fontFamily: FONT.bold, fontSize: size * 0.38 }}>{profile.initials}</Text>
    </View>
  );
}

// ─── Review sheet ─────────────────────────────────────────────────────────────

function ReviewSheet({
  item, onClose, onResolve, onReinstate,
}: {
  item: ModerationQueueItem | null;
  onClose: () => void;
  onResolve: (item: ModerationQueueItem, action: ModerationAction, note: string) => Promise<void>;
  onReinstate: (owner: ProfileSummary) => Promise<void>;
}) {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<ModerationAction | 'reinstate' | null>(null);
  const [confirmSuspend, setConfirmSuspend] = useState(false);
  const [error, setError] = useState<string | null>(null);

  React.useEffect(() => { setNote(''); setBusy(null); setConfirmSuspend(false); setError(null); }, [item?.id]);

  if (!item) return null;
  const type = normalizeReportTarget(item.targetType);
  const auto = item.source === 'auto_filter';
  const open = item.status === 'pending';

  async function run(action: ModerationAction) {
    if (!item) return;
    setBusy(action);
    setError(null);
    try {
      await onResolve(item, action, note.trim());
    } catch (err) {
      setError(apiErrorMessage(err, 'That action didn’t go through. Try again.'));
      setBusy(null);
    }
  }

  async function reinstateOwner() {
    if (!item?.owner) return;
    setBusy('reinstate');
    try {
      await onReinstate(item.owner);
    } catch (err) {
      setError(apiErrorMessage(err, 'Couldn’t reinstate this account.'));
      setBusy(null);
    }
  }

  const Row = ({ label, value }: { label: string; value: string }) => (
    <View style={s.detailRow}>
      <Text style={s.detailLabel}>{label}</Text>
      <Text style={s.detailValue}>{value}</Text>
    </View>
  );

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.scrim} onPress={onClose} accessibilityLabel="Close review" />
      <View style={[s.sheet, { paddingBottom: insets.bottom + SP.md }]}>
        <View style={s.sheetHandle} />
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={s.sheetHeader}>
            <View style={s.typeIconLg}><Feather name={TARGET_ICONS[type]} size={18} color={theme.text} /></View>
            <View style={{ flex: 1 }}>
              <Text style={s.sheetTitle}>{auto ? 'Held by the content filter' : `${reasonLabel(item.reason)} report`}</Text>
              <Text style={s.sheetSub}>{TARGET_LABELS[type]} · {new Date(item.createdAt).toLocaleString()}</Text>
            </View>
          </View>

          <View style={s.contentBox}>
            <Text style={s.contentEyebrow}>REPORTED CONTENT</Text>
            <Text style={s.contentText}>{item.contentExcerpt || item.targetLabel || 'No text — open the item in the app to review media.'}</Text>
          </View>

          {item.note ? (
            <View style={s.contentBox}>
              <Text style={s.contentEyebrow}>{auto ? 'FILTER NOTE' : 'REPORTER’S NOTE'}</Text>
              <Text style={s.contentText}>{item.note}</Text>
            </View>
          ) : null}

          <View style={s.detailCard}>
            <Row label="Posted by" value={item.owner ? `${item.owner.name}${item.owner.handle ? ` (${item.owner.handle})` : ''}` : 'Unknown'} />
            <Row label="Reported by" value={auto ? 'Automatic filter' : item.reporter ? item.reporter.name : 'Deleted account'} />
            <Row label="Open reports on this item" value={String(item.openReportsOnTarget)} />
            <Row label="Prior actions against owner" value={String(item.ownerPriorActions)} />
            {item.owner?.suspended ? <Row label="Account status" value="Suspended" /> : null}
            {!open && item.resolution ? (
              <Row label="Resolution" value={`${ACTION_LABELS[item.resolution.action ?? ''] ?? item.status}${item.resolution.note ? ` — ${item.resolution.note}` : ''}`} />
            ) : null}
          </View>

          {open ? (
            <>
              <Text style={s.noteLabel}>Internal note <Text style={{ color: theme.subtle }}>(optional)</Text></Text>
              <TextInput
                style={s.noteInput}
                value={note}
                onChangeText={setNote}
                placeholder="Why you took this action"
                placeholderTextColor={theme.subtle}
                multiline
                maxLength={1000}
              />
              {error ? <Text style={s.errorText}>{error}</Text> : null}

              {confirmSuspend ? (
                <View style={s.confirmCard}>
                  <Text style={s.confirmTitle}>Suspend {item.owner?.name ?? 'this account'}?</Text>
                  <Text style={s.confirmBody}>
                    They’ll be signed out everywhere, can’t post, comment or message, and all their public content is hidden until reinstated.
                  </Text>
                  <PressableScale
                    onPress={() => run('suspend_user')}
                    style={[s.dangerBtn, busy && { opacity: 0.6 }]}
                    disabled={!!busy}
                    accessibilityRole="button"
                  >
                    {busy === 'suspend_user' ? <ActivityIndicator color="#FFFFFF" /> : <Text style={s.dangerText}>Suspend account</Text>}
                  </PressableScale>
                  <PressableScale onPress={() => setConfirmSuspend(false)} style={s.ghostBtn} accessibilityRole="button">
                    <Text style={s.ghostText}>Cancel</Text>
                  </PressableScale>
                </View>
              ) : (
                <View style={s.actions}>
                  <PrimaryButton
                    label={auto ? 'Approve & publish' : 'Dismiss — no violation'}
                    icon="check"
                    onPress={() => run('dismiss')}
                    loading={busy === 'dismiss'}
                    disabled={!!busy}
                  />
                  <PressableScale
                    onPress={() => run('remove_content')}
                    style={[s.outlineBtn, busy && { opacity: 0.6 }]}
                    disabled={!!busy}
                    accessibilityRole="button"
                  >
                    {busy === 'remove_content'
                      ? <ActivityIndicator color={theme.text} />
                      : <><Feather name="trash-2" size={16} color={theme.text} /><Text style={s.outlineText}>Remove {TARGET_LABELS[type]}</Text></>}
                  </PressableScale>
                  {item.owner && !item.owner.suspended && !item.owner.deleted ? (
                    <PressableScale
                      onPress={() => setConfirmSuspend(true)}
                      style={[s.outlineBtn, { borderColor: theme.error + '88' }]}
                      disabled={!!busy}
                      accessibilityRole="button"
                    >
                      <Feather name="user-x" size={16} color={theme.error} />
                      <Text style={[s.outlineText, { color: theme.error }]}>Suspend {item.owner.name}</Text>
                    </PressableScale>
                  ) : null}
                </View>
              )}
            </>
          ) : item.owner?.suspended ? (
            <View style={s.actions}>
              {error ? <Text style={s.errorText}>{error}</Text> : null}
              <PressableScale onPress={reinstateOwner} style={s.outlineBtn} disabled={!!busy} accessibilityRole="button">
                {busy === 'reinstate'
                  ? <ActivityIndicator color={theme.text} />
                  : <><Feather name="user-check" size={16} color={theme.text} /><Text style={s.outlineText}>Reinstate {item.owner.name}</Text></>}
              </PressableScale>
            </View>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

const makeStyles = (theme: AppThemePreset) => StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  header: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingHorizontal: SP.md, paddingVertical: SP.sm },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: theme.text, fontFamily: FONT.bold, fontSize: FS.lg, letterSpacing: -0.3 },
  headerSub: { color: theme.muted, fontFamily: FONT.regular, fontSize: FS.xs, marginTop: 2 },
  segment: {
    flexDirection: 'row', marginHorizontal: SP.md, marginTop: SP.xs, padding: 4,
    backgroundColor: theme.card, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: theme.border,
  },
  segmentItem: { flex: 1, height: 36, borderRadius: RADIUS.pill, alignItems: 'center', justifyContent: 'center' },
  segmentItemActive: { backgroundColor: theme.accent },
  segmentText: { color: theme.muted, fontFamily: FONT.semibold, fontSize: FS.sm },
  segmentTextActive: { color: theme.onAccent },
  filters: { paddingHorizontal: SP.md, paddingVertical: SP.md, gap: SP.sm },
  filterChip: { height: 32, paddingHorizontal: 14, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: theme.border, justifyContent: 'center', backgroundColor: theme.card },
  filterChipActive: { borderColor: theme.text, backgroundColor: theme.cardElevated },
  filterText: { color: theme.muted, fontFamily: FONT.medium, fontSize: FS.xs + 1 },
  filterTextActive: { color: theme.text, fontFamily: FONT.semibold },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: { backgroundColor: theme.card, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: theme.border, padding: SP.md, gap: 10 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  typeIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: theme.cardElevated, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' },
  typeIconLg: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.cardElevated, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' },
  cardType: { color: theme.text, fontFamily: FONT.semibold, fontSize: FS.sm },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: RADIUS.pill, borderWidth: 1 },
  badgeNeutral: { borderColor: theme.border, backgroundColor: theme.cardElevated },
  badgeWarn: { borderColor: theme.warning + '55', backgroundColor: theme.warning + '14' },
  badgeText: { color: theme.muted, fontFamily: FONT.medium, fontSize: 11 },
  cardTime: { color: theme.subtle, fontFamily: FONT.regular, fontSize: FS.xs },
  excerpt: { color: theme.text, fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 20 },
  cardBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SP.sm },
  ownerRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
  ownerName: { color: theme.muted, fontFamily: FONT.medium, fontSize: FS.xs + 1, flexShrink: 1 },
  suspendedTag: { color: theme.error, fontFamily: FONT.semibold, fontSize: 11 },
  countTag: { color: theme.subtle, fontFamily: FONT.semibold, fontSize: 11 },
  toast: {
    position: 'absolute', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: theme.accent, borderRadius: RADIUS.pill, paddingHorizontal: 16, paddingVertical: 10,
  },
  toastText: { color: theme.onAccent, fontFamily: FONT.semibold, fontSize: FS.sm },
  scrim: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '88%',
    backgroundColor: theme.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    borderWidth: 1, borderBottomWidth: 0, borderColor: theme.border, paddingHorizontal: SP.md,
  },
  sheetHandle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: theme.border, marginTop: SP.sm, marginBottom: SP.md },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: SP.md, marginBottom: SP.md },
  sheetTitle: { color: theme.text, fontFamily: FONT.bold, fontSize: FS.lg },
  sheetSub: { color: theme.muted, fontFamily: FONT.regular, fontSize: FS.xs, marginTop: 2 },
  contentBox: { backgroundColor: theme.card, borderRadius: RADIUS.md, borderWidth: 1, borderColor: theme.border, padding: SP.md, marginBottom: SP.sm },
  contentEyebrow: { color: theme.subtle, fontFamily: FONT.semibold, fontSize: 10, letterSpacing: 1, marginBottom: 6 },
  contentText: { color: theme.text, fontFamily: FONT.regular, fontSize: FS.base, lineHeight: 22 },
  detailCard: { backgroundColor: theme.card, borderRadius: RADIUS.md, borderWidth: 1, borderColor: theme.border, paddingHorizontal: SP.md, marginBottom: SP.md },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', gap: SP.md, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.borderSubtle },
  detailLabel: { color: theme.muted, fontFamily: FONT.regular, fontSize: FS.sm },
  detailValue: { flex: 1, textAlign: 'right', color: theme.text, fontFamily: FONT.medium, fontSize: FS.sm },
  noteLabel: { color: theme.text, fontFamily: FONT.semibold, fontSize: FS.sm, marginBottom: 6 },
  noteInput: {
    minHeight: 72, backgroundColor: theme.card, borderRadius: RADIUS.md, borderWidth: 1, borderColor: theme.border,
    color: theme.text, fontFamily: FONT.regular, fontSize: FS.sm, padding: SP.sm + 4, textAlignVertical: 'top',
  },
  errorText: { color: theme.error, fontFamily: FONT.medium, fontSize: FS.sm, marginTop: SP.sm },
  actions: { gap: SP.sm, marginTop: SP.md },
  outlineBtn: {
    height: 50, borderRadius: RADIUS.md, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.card,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.sm,
  },
  outlineText: { color: theme.text, fontFamily: FONT.semibold, fontSize: FS.base },
  confirmCard: { marginTop: SP.md, padding: SP.md, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: theme.error + '66', backgroundColor: theme.card, gap: SP.sm },
  confirmTitle: { color: theme.text, fontFamily: FONT.bold, fontSize: FS.md },
  confirmBody: { color: theme.muted, fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 20 },
  dangerBtn: { height: 50, borderRadius: RADIUS.md, backgroundColor: theme.error, alignItems: 'center', justifyContent: 'center', marginTop: SP.xs },
  dangerText: { color: '#1A0A0A', fontFamily: FONT.bold, fontSize: FS.base },
  ghostBtn: { height: 44, alignItems: 'center', justifyContent: 'center' },
  ghostText: { color: theme.muted, fontFamily: FONT.semibold, fontSize: FS.base },
});
