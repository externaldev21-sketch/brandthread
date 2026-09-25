import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  ScrollView, View, Text, TouchableOpacity,
  StyleSheet, ActivityIndicator, Animated,
} from 'react-native';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Feather } from '@expo/vector-icons';
import { Badge } from '@/components/Badge';
import { useApi } from '@/lib/api';
import * as Haptics from 'expo-haptics';
import { formatCents } from '@/lib/money';
import {
  getInitialDropBroadcastStates,
  type DropBroadcastState,
} from '@/lib/dropBroadcastState';
import { FS } from '@/lib/theme';
import { EmptyState } from '@/components/BrandthreadUI';
import { useRouter } from 'expo-router';

// ─── Types ────────────────────────────────────────────────────────────────────

type DropType   = 'pre-order' | 'pre-made';
type DropStatus = 'held' | 'processing' | 'scheduled' | 'paid';

interface Drop {
  id: string;
  name: string;
  type: DropType;
  totalOrders: number;
  totalCollectedCents: number;
  payoutDate: string;
  status: DropStatus;
  releaseAt?: string;
  scheduledBroadcastAt?: string;
  releaseDate?: string;
  mfgProgress?: number;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function dropStatusFromApiStatus(status: string): DropStatus {
  if (status === 'active')    return 'processing';
  if (status === 'scheduled') return 'scheduled';
  if (status === 'ended')     return 'paid';
  return 'held';
}

// Drops start empty — a seller with no real drops sees an EmptyState, never
// fabricated financial data (§11a).
const DROPS_FALLBACK: Drop[] = [];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const statusConfig: Record<DropStatus, { variant: 'success' | 'warning' | 'info' | 'error'; label: string }> = {
  held:       { variant: 'warning', label: 'Held'       },
  processing: { variant: 'info',    label: 'Processing' },
  scheduled:  { variant: 'info',    label: 'Scheduled'  },
  paid:       { variant: 'success', label: 'Paid'       },
};

// ─── Drop Card ────────────────────────────────────────────────────────────────

type BroadcastState = DropBroadcastState | 'scheduled';

interface BroadcastPreview {
  followers: number;
}

interface DropCardProps {
  drop: Drop;
  colors: ReturnType<typeof useColors>;
  isLast: boolean;
  broadcastState: BroadcastState;
  broadcastPreview?: BroadcastPreview;
  onBroadcast: () => void;
}

function DropCard({ drop, colors, isLast, broadcastState, broadcastPreview, onBroadcast }: DropCardProps) {
  const primary = colors.primary;
  const isPreOrder = drop.type === 'pre-order';
  const s = statusConfig[drop.status];

  const typeColor   = isPreOrder ? colors.primary : colors.success;
  const typeBg      = isPreOrder ? colors.accent : `${colors.success}17`;
  const typeBorder  = isPreOrder ? colors.primary : `${colors.success}33`;
  const progressBg  = colors.border;
  const launchAt = drop.releaseAt ? new Date(drop.releaseAt) : null;
  const hasFutureLaunch = Boolean(
    launchAt &&
    !Number.isNaN(launchAt.getTime()) &&
    launchAt.getTime() > Date.now()
  );
  const canSchedule = Boolean(
    hasFutureLaunch &&
    !drop.scheduledBroadcastAt &&
    broadcastState === 'idle',
  );
  const notificationScheduled = broadcastState === 'scheduled' || Boolean(drop.scheduledBroadcastAt);

  return (
    <View style={[
      styles.dropCard,
      { backgroundColor: colors.card, borderColor: colors.border },
      !isLast && { marginBottom: 12 },
    ]}>
      {/* Top row */}
      <View style={styles.dropTop}>
        {/* Type badge */}
        <View style={[styles.typeBadge, { backgroundColor: typeBg, borderColor: typeBorder }]}>
          <Feather
            name={isPreOrder ? 'clock' : 'package'}
            size={11}
            color={typeColor}
          />
          <Text style={[styles.typeText, { color: typeColor }]}>
            {isPreOrder ? 'Pre Order' : 'Pre Made'}
          </Text>
        </View>
        <Badge label={s.label} variant={s.variant} />
      </View>

      {/* Name */}
      <Text style={[styles.dropName, { color: colors.foreground }]}>{drop.name}</Text>

      {/* Key numbers */}
      <View style={styles.dropStats}>
        <View style={styles.dropStat}>
          <Text style={[styles.dropStatVal, { color: colors.foreground }]}>{formatCents(drop.totalCollectedCents)}</Text>
          <Text style={[styles.dropStatLabel, { color: colors.mutedForeground }]}>Collected</Text>
        </View>
        <View style={[styles.dropDivider, { backgroundColor: colors.border }]} />
        <View style={styles.dropStat}>
          <Text style={[styles.dropStatVal, { color: colors.foreground }]}>{drop.totalOrders}</Text>
          <Text style={[styles.dropStatLabel, { color: colors.mutedForeground }]}>Orders</Text>
        </View>
        <View style={[styles.dropDivider, { backgroundColor: colors.border }]} />
        <View style={styles.dropStat}>
          <Text style={[styles.dropStatVal, { color: drop.status === 'paid' ? colors.success : primary }]}>
            {drop.payoutDate}
          </Text>
          <Text style={[styles.dropStatLabel, { color: colors.mutedForeground }]}>
            {drop.status === 'paid' ? 'Paid out' : 'Payout date'}
          </Text>
        </View>
      </View>

      {/* Pre Order extras: manufacturing progress + ship date */}
      {isPreOrder && drop.mfgProgress != null && (
        <View style={styles.preOrderExtra}>
          <View style={styles.progressHeader}>
            <View style={styles.progressLabelRow}>
              <Feather name="tool" size={12} color={colors.mutedForeground} />
              <Text style={[styles.progressLabel, { color: colors.mutedForeground }]}>
                Manufacturing progress
              </Text>
            </View>
            <Text style={[styles.progressPct, { color: primary }]}>
              {Math.round(drop.mfgProgress * 100)}%
            </Text>
          </View>
          <View style={[styles.progressTrack, { backgroundColor: progressBg }]}>
            <View style={[styles.progressFill, { width: `${drop.mfgProgress * 100}%`, backgroundColor: primary }]} />
          </View>
          <View style={styles.shipRow}>
            <Feather name="truck" size={12} color={colors.mutedForeground} />
            <Text style={[styles.shipText, { color: colors.mutedForeground }]}>
              Ships {drop.releaseDate} · Funds release 3 days after delivery
            </Text>
          </View>
        </View>
      )}

      {/* Pre Made: note */}
      {!isPreOrder && drop.status !== 'paid' && (
        <View style={styles.premadeNote}>
          <Feather name="info" size={12} color={colors.mutedForeground} />
          <Text style={[styles.premadeNoteText, { color: colors.mutedForeground }]}>
            Inventory ships within 24–48 hrs · Payout 2–3 business days after fulfillment
          </Text>
        </View>
      )}

      {/* Notify/schedule follower broadcast — only for active (live) drops */}
      {drop.status === 'processing' && (
        <View style={[styles.broadcastWrap, { borderTopColor: colors.border }]}>
          {notificationScheduled ? (
            <View style={[styles.scheduledNotice, { backgroundColor: `${colors.success}1A`, borderColor: `${colors.success}40` }]}>
              <Feather name="clock" size={14} color={colors.success} />
              <Text style={[styles.scheduledNoticeText, { color: colors.success }]}>
                Notification scheduled for {fmtDate(drop.scheduledBroadcastAt ?? drop.releaseAt!)}
              </Text>
            </View>
          ) : broadcastPreview?.followers === 0 && broadcastState === 'idle' && !hasFutureLaunch ? (
            <View style={styles.zeroAudience}>
              <Feather name="users" size={14} color={colors.mutedForeground} />
              <Text style={[styles.zeroAudienceText, { color: colors.mutedForeground }]}>
                0 followers — grow your audience first
              </Text>
            </View>
          ) : (
            <View style={styles.broadcastRow}>
              {broadcastPreview && (
                <View style={[styles.followerPill, { backgroundColor: colors.accent, borderColor: colors.border }]}>
                  <Feather name="users" size={12} color={primary} />
                  <Text style={[styles.followerPillText, { color: colors.foreground }]}>
                    {broadcastPreview.followers} follower{broadcastPreview.followers === 1 ? '' : 's'}
                  </Text>
                </View>
              )}
              <TouchableOpacity
                style={[
                  styles.broadcastBtn,
                  broadcastState === 'sent' || broadcastState === 'already_sent'
                    ? { backgroundColor: `${colors.success}1F`, borderColor: `${colors.success}4D` }
                    : { backgroundColor: colors.accent, borderColor: colors.primary },
                  broadcastState === 'loading' && { opacity: 0.6 },
                ]}
                activeOpacity={broadcastState === 'idle' ? 0.75 : 1}
                disabled={broadcastState !== 'idle'}
                onPress={onBroadcast}
              >
                {broadcastState === 'loading' ? (
                  <ActivityIndicator size="small" color={primary} />
                ) : broadcastState === 'sent' || broadcastState === 'already_sent' ? (
                  <Feather name="check-circle" size={14} color={colors.success} />
                ) : (
                  <Feather name="bell" size={14} color={primary} />
                )}
                <Text style={[
                  styles.broadcastBtnText,
                  { color: broadcastState === 'sent' || broadcastState === 'already_sent' ? colors.success : primary },
                ]}>
                  {broadcastState === 'sent' ? 'Followers notified' :
                   broadcastState === 'already_sent' ? 'Already notified' :
                   broadcastState === 'loading' ? (hasFutureLaunch ? 'Scheduling…' : 'Sending…') :
                   canSchedule ? 'Schedule for launch' :
                   'Notify Followers'}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

// ─── Toast component ──────────────────────────────────────────────────────────

function Toast({ message, visible }: { message: string; visible: boolean }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const colors = useColors();

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: visible ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [visible]);

  return (
    <Animated.View
      style={[
        toastStyles.wrap,
        { backgroundColor: colors.card, borderColor: `${colors.success}44`, shadowColor: colors.shadowColor },
        { opacity },
      ]}
      pointerEvents="none"
    >
      <Feather name="check-circle" size={14} color={colors.success} />
      <Text style={[toastStyles.text, { color: colors.success }]}>{message}</Text>
    </Animated.View>
  );
}

const toastStyles = StyleSheet.create({
  wrap: {
    position: 'absolute', top: 60, alignSelf: 'center', zIndex: 99,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: 24, borderWidth: 1,
    paddingHorizontal: 18, paddingVertical: 10,
    shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 4 },
  },
  text: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
});

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function PaymentsScreen() {
  const colors = useColors();
  const api    = useApi();
  const router = useRouter();
  const [drops,   setDrops]   = useState<Drop[]>(DROPS_FALLBACK);
  const [loading, setLoading] = useState(true);

  // Broadcast state per drop id
  const [broadcastStates, setBroadcastStates] = useState<Record<string, BroadcastState>>({});
  // Audience preview per active drop. Missing entries are still loading.
  const [broadcastPreviews, setBroadcastPreviews] = useState<Record<string, BroadcastPreview | undefined>>({});
  // Toast
  const [toast, setToast]       = useState<{ message: string; visible: boolean }>({ message: '', visible: false });
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, visible: true });
    toastTimer.current = setTimeout(() => setToast((t) => ({ ...t, visible: false })), 3000);
  }, []);

  const handleBroadcast = useCallback(async (dropId: string, dropName: string) => {
    const drop = drops.find((item) => item.id === dropId);
    setBroadcastStates((prev) => ({ ...prev, [dropId]: 'loading' }));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      if (drop?.releaseAt && new Date(drop.releaseAt).getTime() > Date.now()) {
        await api.drops.scheduleBroadcast(dropId, drop.releaseAt);
        setDrops((prev) => prev.map((item) =>
          item.id === dropId ? { ...item, scheduledBroadcastAt: drop.releaseAt } : item,
        ));
        setBroadcastStates((prev) => ({ ...prev, [dropId]: 'scheduled' }));
        showToast(`Notification scheduled for ${fmtDate(drop.releaseAt)}`);
        return;
      }
      const res = await api.drops.broadcast(dropId);
      setBroadcastStates((prev) => ({ ...prev, [dropId]: 'sent' }));
      if (res.sent === 0) {
        showToast('No followers to notify yet');
      } else {
        showToast(`Notified ${res.sent} follower${res.sent === 1 ? '' : 's'}`);
      }
    } catch (err: any) {
      const is409 = err?.message?.includes('409') || err?.message?.includes('already');
      if (is409) {
        setBroadcastStates((prev) => ({ ...prev, [dropId]: 'already_sent' }));
        showToast(`${dropName} followers already notified`);
      } else {
        setBroadcastStates((prev) => ({ ...prev, [dropId]: 'idle' }));
        showToast('Failed to send — please try again');
      }
    }
  }, [api, drops, showToast]);

  const load = useCallback(async () => {
    setLoading(true);
    setBroadcastPreviews({});
    try {
      // Load drops from the drops API and map to our Drop shape
      const raw = (await api.drops.list()) as any[];
      const usingDemoFallback = raw.length === 0;
      let mapped: Drop[] = DROPS_FALLBACK;
      if (raw.length > 0) {
        const initialBroadcastStates: Record<string, BroadcastState> =
          getInitialDropBroadcastStates(raw);
        mapped = raw.map((d: any) => ({
          id:             d.id,
          name:           d.name ?? d.title ?? 'Drop',
          type:           d.releaseAt ? 'pre-order' : 'pre-made',
          totalOrders:    d.orderCount ?? 0,
           totalCollectedCents: d.totalCents ?? 0,
          payoutDate:     d.releaseAt ? fmtDate(d.releaseAt) : '—',
          status:         dropStatusFromApiStatus(d.status ?? 'active'),
          releaseAt:      d.releaseAt ?? undefined,
          scheduledBroadcastAt: d.scheduledBroadcastAt ?? undefined,
          releaseDate:    d.releaseAt ? fmtDate(d.releaseAt) : undefined,
          mfgProgress:    d.mfgProgress ?? undefined,
        }));
        setDrops(mapped);
        setBroadcastStates(mapped.reduce<Record<string, BroadcastState>>((states, drop) => {
          if (states[drop.id] !== 'already_sent' && drop.scheduledBroadcastAt) {
            states[drop.id] = 'scheduled';
          }
          return states;
        }, initialBroadcastStates));
      } else {
        setBroadcastStates({});
      }
      const activeDrops = mapped.filter((drop) => drop.status === 'processing');
      const previewEntries = await Promise.all(activeDrops.map(async (drop) => {
        try {
          return [drop.id, await api.drops.broadcastPreview(drop.id)] as const;
        } catch {
          // Demo fallback IDs do not exist on the server. A real preview
          // failure must not be mistaken for an empty audience.
          return [drop.id, usingDemoFallback ? { followers: 0 } : undefined] as const;
        }
      }));
      setBroadcastPreviews(Object.fromEntries(previewEntries));
    } catch { /* stay with fallback mock data */ }
    setLoading(false);
  }, [api]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  const primary = colors.primary;

  const preOrderDrops = drops.filter((d) => d.type === 'pre-order');
  const preMadeDrops  = drops.filter((d) => d.type === 'pre-made');

  const nextPayout = [...drops]
    .filter((d) => d.status !== 'paid')
    .sort((a, b) => new Date(a.payoutDate).getTime() - new Date(b.payoutDate).getTime())[0];

  return (
    <View style={[styles.container, { backgroundColor: 'transparent' }]}>
      <Toast message={toast.message} visible={toast.visible} />
      <ScreenHeader title="Payments" subtitle="Drop payouts & methods" />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: 16, paddingBottom: 120, paddingHorizontal: 20 }}
        showsVerticalScrollIndicator={false}
      >

        {/* ── Next payout banner ── */}
        {nextPayout && (
          <View style={[styles.banner, { backgroundColor: colors.accent, borderColor: colors.primary }]}>
            <Feather name="info" size={14} color={colors.primary} />
            <Text style={[styles.bannerText, { color: colors.foreground }]}>
               Next payout on {nextPayout.payoutDate} · {formatCents(nextPayout.totalCollectedCents)} from {nextPayout.name}
            </Text>
          </View>
        )}

        {/* ── Brandthread Payments card ── */}
        <View style={styles.cardHeaderRow}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>Brandthread Payments</Text>
        </View>

        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {/* Payout account row — no real payout-account API is wired here yet, so this
              never fabricates a bank account or status; it offers to add one instead. */}
          <View style={[styles.listRow, { borderTopWidth: 0 }]}>
            <Feather name="home" size={16} color={colors.mutedForeground} />
            <View style={styles.payoutInfo}>
              <Text style={[styles.payoutLabel, { color: colors.mutedForeground }]}>Payout account</Text>
              <Text style={[styles.payoutAccount, { color: colors.foreground }]}>
                No payout account on file
              </Text>
            </View>
            <TouchableOpacity activeOpacity={0.7} onPress={() => router.push('/payouts' as never)}>
              <Text style={[styles.viewPayoutsLink, { color: primary }]}>Add account</Text>
            </TouchableOpacity>
          </View>

          {/* View payouts row */}
          <TouchableOpacity
            style={[styles.listRow, { borderTopColor: colors.border }]}
            activeOpacity={0.7}
            onPress={() => router.push('/payouts' as never)}
          >
            <Feather name="list" size={16} color={colors.mutedForeground} />
            <Text style={[styles.listRowLabel, { color: colors.foreground, flex: 1 }]}>View payouts</Text>
            <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>

        {!loading && drops.length === 0 ? (
          <EmptyState
            icon="package"
            title="No drops yet"
            description="Payouts for your drops show up here."
            action={{ label: 'Create a drop', onPress: () => router.push('/add-product' as never) }}
          />
        ) : (
          <>
            {/* ── Pre Order Drops ── */}
            {preOrderDrops.length > 0 && (
              <>
                <View style={styles.sectionHeader}>
                  <View style={[styles.sectionDot, { backgroundColor: colors.primary }]} />
                  <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Pre Order Drops</Text>
                  <Text style={[styles.sectionCount, { color: colors.mutedForeground }]}>{preOrderDrops.length}</Text>
                </View>
                <View style={[styles.preOrderNote, { backgroundColor: colors.accent, borderColor: colors.primary }]}>
                  <Feather name="clock" size={13} color={primary} />
                  <Text style={[styles.preOrderNoteText, { color: primary }]}>
                    Funds collected upfront and held until each drop ships
                  </Text>
                </View>
                {preOrderDrops.map((d, i) => (
                  <DropCard
                    key={d.id} drop={d} colors={colors}
                    isLast={i === preOrderDrops.length - 1}
                    broadcastState={broadcastStates[d.id] ?? 'idle'}
                    broadcastPreview={broadcastPreviews[d.id]}
                    onBroadcast={() => handleBroadcast(d.id, d.name)}
                  />
                ))}
              </>
            )}

            {/* ── Pre Made Drops ── */}
            {preMadeDrops.length > 0 && (
              <>
                <View style={[styles.sectionHeader, { marginTop: 28 }]}>
                  <View style={[styles.sectionDot, { backgroundColor: colors.success }]} />
                  <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Pre Made Drops</Text>
                  <Text style={[styles.sectionCount, { color: colors.mutedForeground }]}>{preMadeDrops.length}</Text>
                </View>
                <View style={[styles.preOrderNote, { backgroundColor: `${colors.success}17`, borderColor: `${colors.success}33` }]}>
                  <Feather name="package" size={13} color={colors.success} />
                  <Text style={[styles.preOrderNoteText, { color: colors.success }]}>
                    Standard payout 2–3 business days after order fulfillment
                  </Text>
                </View>
                {preMadeDrops.map((d, i) => (
                  <DropCard
                    key={d.id} drop={d} colors={colors}
                    isLast={i === preMadeDrops.length - 1}
                    broadcastState={broadcastStates[d.id] ?? 'idle'}
                    broadcastPreview={broadcastPreviews[d.id]}
                    onBroadcast={() => handleBroadcast(d.id, d.name)}
                  />
                ))}
              </>
            )}
          </>
        )}

      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },

  // Banner
  banner: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 20 },
  bannerText: { fontSize: 12, fontFamily: 'Inter_500Medium', flex: 1, lineHeight: 17 },

  // Card header row (title + Manage button)
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  cardTitle: { fontSize: 17, fontFamily: 'Inter_600SemiBold' },
  manageBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8, borderWidth: 1 },
  manageBtnText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },

  // Status row
  statusRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  statusItem: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 7 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  statusDivider: { width: 1, height: 16 },

  // Generic list row (used inside cards)
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderTopWidth: 1 },
  listRowLabel: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  chipRow: { flexDirection: 'row', gap: 4 },
  chip: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 5 },
  chipText: { fontSize: FS.xs, fontFamily: 'Inter_700Bold', letterSpacing: 0.3 },

  payoutInfo: { flex: 1 },
  payoutLabel: { fontSize: FS.xs, fontFamily: 'Inter_500Medium', marginBottom: 3, letterSpacing: 0.3 },
  payoutAccount: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  viewPayoutsLink: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },


  // Additional providers
  groupTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', marginTop: 28, marginBottom: 4 },
  groupSubtitle: { fontSize: 12, fontFamily: 'Inter_400Regular', marginBottom: 12, lineHeight: 17 },
  addProviderBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 12, borderWidth: 1, paddingVertical: 14, borderStyle: 'dashed' },
  addProviderText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },

  // Payment configuration rows
  configRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14 },

  // Section headers
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  sectionDot: { width: 8, height: 8, borderRadius: 4 },
  sectionTitle: { fontSize: 17, fontFamily: 'Inter_600SemiBold', flex: 1 },
  sectionCount: { fontSize: 13, fontFamily: 'Inter_400Regular' },

  // Note banners
  preOrderNote: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9, marginBottom: 12 },
  preOrderNoteText: { fontSize: 12, fontFamily: 'Inter_500Medium', flex: 1 },

  // Drop card
  dropCard: { borderRadius: 16, borderWidth: 1, padding: 16 },
  dropTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  typeBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8, borderWidth: 1 },
  typeText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  dropName: { fontSize: 15, fontFamily: 'Inter_600SemiBold', marginBottom: 14 },
  dropStats: { flexDirection: 'row', alignItems: 'center' },
  dropStat: { flex: 1, alignItems: 'center' },
  dropStatVal: { fontSize: 14, fontFamily: 'Inter_700Bold', marginBottom: 2 },
  dropStatLabel: { fontSize: FS.xs, fontFamily: 'Inter_400Regular' },
  dropDivider: { width: 1, height: 28 },

  // Pre Order progress
  preOrderExtra: { marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: 'transparent' },
  progressHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  progressLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  progressLabel: { fontSize: 11, fontFamily: 'Inter_500Medium' },
  progressPct: { fontSize: 12, fontFamily: 'Inter_700Bold' },
  progressTrack: { height: 6, borderRadius: 3, overflow: 'hidden', marginBottom: 10 },
  progressFill: { height: 6, borderRadius: 3 },
  shipRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 5 },
  shipText: { fontSize: 11, fontFamily: 'Inter_400Regular', flex: 1, lineHeight: 16 },

  // Pre Made note
  premadeNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 5, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: 'transparent' },
  premadeNoteText: { fontSize: 11, fontFamily: 'Inter_400Regular', flex: 1, lineHeight: 16 },

  // Broadcast button
  broadcastWrap: { marginTop: 14, paddingTop: 14, borderTopWidth: 1 },
  broadcastRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  followerPill: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 999, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 8 },
  followerPillText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  zeroAudience: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 9 },
  zeroAudienceText: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  broadcastBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 7, borderRadius: 10, borderWidth: 1,
    paddingVertical: 10, paddingHorizontal: 14,
  },
  broadcastBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  scheduledNotice: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 10, borderWidth: 1, paddingVertical: 10, paddingHorizontal: 14 },
  scheduledNoticeText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },

  // Shared card container
  section: { borderRadius: 14, borderWidth: 1, marginBottom: 24 },
});
