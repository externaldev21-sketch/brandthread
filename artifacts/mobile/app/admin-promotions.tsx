/**
 * Promotion review — platform admins approve or reject paid boosts and
 * Featured slots. Rejecting needs a reason the seller will see, and refunds
 * the payment in full. Backed by /api/admin/promotions (users.role = 'admin');
 * anyone else sees an access notice. Same pattern as app/admin-reports.tsx.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { haptics } from '@/lib/haptics';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useApi, type AdminPromotionItem, type AdminPromotionQueue } from '@/lib/api';
import { EmptyState, PressableScale } from '@/components/BrandthreadUI';
import { CachedImage } from '@/components/CachedImage';
import { ScreenHeader } from '@/components/ScreenHeader';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { useAuth } from '@clerk/expo';
import { isPreviewDemoMode, isSellerDevPreview } from '@/lib/devPreview';
import { formatCents } from '@/lib/money';
import { apiErrorMessage } from '@/lib/safety';

type Tab = 'in_review' | 'approved' | 'rejected';
const TABS: { key: Tab; label: string }[] = [
  { key: 'in_review', label: 'In review' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
];

const DEMO_QUEUE: AdminPromotionQueue = {
  summary: { pendingBoosts: 1, pendingFeatured: 1 },
  items: [
    { kind: 'boost', id: 'demo-boost', seller: { userId: 'd1', name: 'Maison Vela', avatarUrl: null }, state: 'in_review',
      amountCents: 2500, durationDays: 7, submittedAt: new Date().toISOString(), reviewedAt: null, rejectionReason: null, refundStatus: 'none',
      post: { id: 'p', caption: 'Spring capsule, now in store', mediaUrl: null, thumbnailUrl: null, mediaType: 'video' }, window: null },
    { kind: 'featured_slot', id: 'demo-slot', seller: { userId: 'd2', name: 'Atelier Nord', avatarUrl: null }, state: 'in_review',
      amountCents: 5900, durationDays: 7, submittedAt: new Date().toISOString(), reviewedAt: null, rejectionReason: null, refundStatus: 'none',
      post: null, window: { startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + 7 * 86_400_000).toISOString() } },
  ],
};

function day(iso: string | null | undefined) {
  return iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
}

export default function AdminPromotionsScreen() {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const router = useRouter();
  const api = useApi();
  const { isSignedIn } = useAuth();
  // Signed-out preview never calls the protected API; it renders sample rows only with &demo=1.
  const demo = !isSignedIn && isSellerDevPreview() && isPreviewDemoMode();

  const [access, setAccess] = useState<'checking' | 'granted' | 'denied'>('checking');
  const [tab, setTab] = useState<Tab>('in_review');
  const [queue, setQueue] = useState<AdminPromotionQueue | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    setError(null);
    if (!isSignedIn) {
      if (demo) { setAccess('granted'); setQueue(DEMO_QUEUE); } else setAccess('denied');
      setLoading(false); setRefreshing(false);
      return;
    }
    try {
      const me = await api.moderation.me();
      if (!me.isModerator) { setAccess('denied'); return; }
      setAccess('granted');
      setQueue(await api.adminPromotions.queue({ status: tab }));
    } catch (err) {
      setError(apiErrorMessage(err, 'We couldn’t load promotions.'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [api, tab, isSignedIn, demo]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function decide(item: AdminPromotionItem, action: 'approve' | 'reject') {
    if (demo) { setQueue((q) => q && { ...q, items: q.items.filter((i) => i.id !== item.id) }); setRejecting(null); return; }
    setBusyId(item.id);
    setError(null);
    try {
      if (action === 'approve') await api.adminPromotions.approve(item.kind, item.id);
      else await api.adminPromotions.reject(item.kind, item.id, reason.trim());
      haptics.success();
      setRejecting(null);
      setReason('');
      await load(true);
    } catch (err) {
      setError(apiErrorMessage(err, action === 'approve' ? 'Could not approve.' : 'Could not reject.'));
    } finally {
      setBusyId(null);
    }
  }

  if (access === 'denied') {
    return (
      <View style={s.screen}>
        <ScreenHeader title="Review promotions" onBack={() => goBackOr(router)} />
        <EmptyState icon="lock" title="Moderators only" description="Your account doesn’t have access to this queue." />
      </View>
    );
  }

  const pending = (queue?.summary.pendingBoosts ?? 0) + (queue?.summary.pendingFeatured ?? 0);

  return (
    <View style={s.screen}>
      <ScreenHeader title="Review promotions" onBack={() => goBackOr(router)} />
      <View style={s.tabs}>
        {TABS.map((t) => (
          <PressableScale key={t.key} onPress={() => setTab(t.key)} style={[s.tab, tab === t.key && s.tabOn]} accessibilityRole="tab">
            <Text style={[s.tabText, tab === t.key && s.tabTextOn]}>
              {t.label}{t.key === 'in_review' && pending > 0 ? ` · ${pending}` : ''}
            </Text>
          </PressableScale>
        ))}
      </View>
      {!!error && <Text style={s.error}>{error}</Text>}
      {loading || access === 'checking' ? (
        <View style={s.center}><ActivityIndicator color={theme.text} /></View>
      ) : (
        <FlatList
          data={queue?.items ?? []}
          keyExtractor={(i) => `${i.kind}:${i.id}`}
          contentContainerStyle={{ padding: SP.md, paddingBottom: SP.xxl * 2 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={theme.text} />}
          ListEmptyComponent={<EmptyState icon="check-circle" title="Nothing here" description={tab === 'in_review' ? 'New paid promotions appear here for review.' : 'No items yet.'} />}
          renderItem={({ item }) => (
            <View style={s.card} testID={`promo-${item.id}`}>
              <View style={s.cardTop}>
                {item.post?.thumbnailUrl || item.post?.mediaUrl ? (
                  <CachedImage source={{ uri: (item.post.thumbnailUrl ?? item.post.mediaUrl)! }} style={s.thumb} contentFit="cover" />
                ) : null}
                <View style={{ flex: 1 }}>
                  <Text style={s.kind}>{item.kind === 'boost' ? 'Boost' : 'Featured slot'}</Text>
                  <Text style={s.seller} numberOfLines={1}>{item.seller?.name ?? 'Seller'}</Text>
                  <Text style={s.meta}>
                    {formatCents(item.amountCents)} · {item.durationDays} days{item.window ? ` · ${day(item.window.startsAt)} – ${day(item.window.endsAt)}` : ''}
                  </Text>
                  {!!item.post?.caption && <Text style={s.caption} numberOfLines={2}>{item.post.caption}</Text>}
                </View>
              </View>

              {item.state === 'rejected' && (
                <Text style={s.meta}>{item.rejectionReason} · Refund {item.refundStatus === 'refunded' ? 'sent' : item.refundStatus === 'failed' ? 'failed, reject again to retry' : 'pending'}</Text>
              )}

              {item.state === 'in_review' && rejecting !== item.id && (
                <View style={s.actions}>
                  <View style={s.cell}><PressableScale style={[s.btn, s.btnGhost]} onPress={() => { setRejecting(item.id); setReason(''); }} accessibilityRole="button" accessibilityLabel="Reject">
                    <Text style={s.btnGhostText}>Reject</Text>
                  </PressableScale></View>
                  <View style={s.cell}><PressableScale style={[s.btn, s.btnSolid]} onPress={() => decide(item, 'approve')} disabled={busyId === item.id} accessibilityRole="button" accessibilityLabel="Approve">
                    {busyId === item.id ? <ActivityIndicator size="small" color={theme.background} /> : <Text style={s.btnSolidText}>Approve</Text>}
                  </PressableScale></View>
                </View>
              )}

              {rejecting === item.id && (
                <View>
                  <TextInput
                    value={reason}
                    onChangeText={setReason}
                    placeholder="Reason the seller will see"
                    placeholderTextColor={theme.muted}
                    style={s.input}
                    maxLength={500}
                    multiline
                  />
                  <View style={s.actions}>
                    <View style={s.cell}><PressableScale style={[s.btn, s.btnGhost]} onPress={() => setRejecting(null)} accessibilityRole="button"><Text style={s.btnGhostText}>Back</Text></PressableScale></View>
                    <View style={s.cell}><PressableScale
                      style={[s.btn, s.btnSolid, reason.trim().length < 3 && { opacity: 0.4 }]}
                      onPress={() => decide(item, 'reject')}
                      disabled={reason.trim().length < 3 || busyId === item.id}
                      accessibilityRole="button"
                      accessibilityLabel="Reject and refund"
                    >
                      {busyId === item.id ? <ActivityIndicator size="small" color={theme.background} /> : <Text style={s.btnSolidText}>Reject and refund</Text>}
                    </PressableScale></View>
                  </View>
                </View>
              )}
            </View>
          )}
        />
      )}
    </View>
  );
}

function makeStyles(theme: ReturnType<typeof useAppTheme>['theme']) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.background },
    center: { paddingTop: SP.xl, alignItems: 'center' },
    tabs: { flexDirection: 'row', gap: SP.sm, paddingHorizontal: SP.md, paddingTop: SP.md, paddingBottom: SP.sm },
    tab: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: theme.border },
    tabOn: { backgroundColor: theme.text, borderColor: theme.text },
    tabText: { fontFamily: FONT.semibold, fontSize: FS.sm, color: theme.text },
    tabTextOn: { color: theme.background },
    error: { fontFamily: FONT.regular, fontSize: FS.sm, color: theme.text, paddingHorizontal: SP.md, paddingBottom: SP.sm },
    card: { paddingVertical: SP.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border, gap: SP.sm },
    cardTop: { flexDirection: 'row', gap: SP.sm },
    thumb: { width: 64, height: 86, borderRadius: RADIUS.md, backgroundColor: theme.border },
    kind: { fontFamily: FONT.semibold, fontSize: FS.xs, color: theme.muted },
    seller: { fontFamily: FONT.bold, fontSize: FS.md, color: theme.text },
    meta: { fontFamily: FONT.regular, fontSize: FS.xs, color: theme.muted, marginTop: 2 },
    caption: { fontFamily: FONT.regular, fontSize: FS.sm, color: theme.text, marginTop: 4 },
    actions: { flexDirection: 'row', gap: SP.sm },
    cell: { flex: 1 },
    btn: { width: '100%', minHeight: 44, paddingHorizontal: 16, borderRadius: RADIUS.pill, alignItems: 'center', justifyContent: 'center' },
    btnGhost: { borderWidth: 1, borderColor: theme.border },
    btnGhostText: { fontFamily: FONT.semibold, fontSize: FS.sm, color: theme.text },
    btnSolid: { backgroundColor: theme.text },
    btnSolidText: { fontFamily: FONT.semibold, fontSize: FS.sm, color: theme.background },
    input: {
      minHeight: 64, borderWidth: 1, borderColor: theme.border, borderRadius: RADIUS.md, padding: SP.sm,
      fontFamily: FONT.regular, fontSize: FS.sm, color: theme.text, marginBottom: SP.sm, textAlignVertical: 'top',
    },
  });
}
