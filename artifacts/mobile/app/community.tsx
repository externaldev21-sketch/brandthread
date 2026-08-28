/**
 * Community — freelancer marketplace.
 * Browse real freelancer profiles, filter by service, hire from their profile.
 */
import React, { useCallback, useState } from 'react';
import {
  ScrollView, View, Text, TouchableOpacity, StyleSheet,
  ActivityIndicator, Image, RefreshControl,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { ScreenHeader } from '@/components/ScreenHeader';
import { useApi, type Freelancer } from '@/lib/api';
import { FREELANCER_SERVICE_TYPES, serviceLabel, formatHourlyRate, ratingLabel } from '@/lib/freelancer';
import { useColors } from '@/hooks/useColors';
import {
  BG, CARD, BORDER, FG, MUTED, SUBTLE, PURPLE, PURPLE_DIM, CYAN,
  GOLD, SUCCESS, ORANGE, FONT, FS, SP, RADIUS, GRAD_PRIMARY, ON_DARK,
} from '@/lib/theme';

export default function CommunityScreen() {
  const colors = useColors();
  const api = useApi();
  const router = useRouter();
  const [freelancers, setFreelancers] = useState<Freelancer[]>([]);
  const [me, setMe] = useState<Freelancer | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      try {
        setError(null);
        const [listRes, meRes] = await Promise.all([
          api.freelancers.list(filter ? { serviceType: filter } : undefined),
          // Not signed in / preview mode → just treat as "not a freelancer"
          api.freelancers.me().catch(() => ({ freelancer: null as Freelancer | null })),
        ]);
        setFreelancers(listRes.freelancers);
        setMe(meRes.freelancer);
      } catch {
        setError('Could not load freelancers. Pull to retry.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [api, filter],
  );

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const selectFilter = (value: string | null) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setFilter(value);
  };

  const openProfile = (id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(`/freelancer-profile?id=${id}` as any);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenHeader
        title="Community"
        subtitle="Hire vetted creatives for your brand"
        rightElement={
          <TouchableOpacity
            onPress={() => router.push('/freelancer-jobs' as any)}
            activeOpacity={0.7}
            style={styles.headerBtn}
          >
            <Feather name="briefcase" size={18} color={FG} />
          </TouchableOpacity>
        }
      />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: SP.md, paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.primary} />
        }
      >
        {/* Own status / become-a-freelancer CTA */}
        <View style={{ paddingHorizontal: SP.md + 4 }}>
          {me ? (
            <TouchableOpacity
              style={styles.ownCard}
              activeOpacity={0.85}
              onPress={() => openProfile(me.id)}
            >
              <View style={[styles.ownIcon, { backgroundColor: colors.accent }]}>
                <Feather name="user-check" size={18} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.ownTitle}>Your freelancer profile</Text>
                <Text style={styles.ownSub}>
                  {!me.isActive
                    ? 'Listing deactivated — tap to reactivate'
                    : me.hasConnectedAccount
                      ? `${serviceLabel(me.serviceType)} · ${formatHourlyRate(me.hourlyRateCents)}`
                      : 'Finish payout setup to accept jobs'}
                </Text>
              </View>
              {me.isActive && !me.hasConnectedAccount && (
                <View style={[styles.dot, { backgroundColor: ORANGE }]} />
              )}
              <Feather name="chevron-right" size={18} color={SUBTLE} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              activeOpacity={0.9}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push('/freelancer-apply' as any);
              }}
            >
              <LinearGradient
                colors={[colors.primary, colors.accentForeground]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.ctaCard}
              >
                <View style={styles.ctaIcon}>
                  <Feather name="zap" size={20} color={ON_DARK} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.ctaTitle}>List Your Skills</Text>
                  <Text style={styles.ctaSub}>
                    Offer your creative services to streetwear brand founders — get paid via Brandthread
                  </Text>
                </View>
                <Feather name="arrow-right" size={20} color={ON_DARK} />
              </LinearGradient>
            </TouchableOpacity>
          )}
        </View>

        {/* Service type filter chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginTop: SP.md }}
          contentContainerStyle={{ paddingHorizontal: SP.md + 4, gap: SP.sm }}
        >
          <TouchableOpacity
            onPress={() => selectFilter(null)}
            style={[styles.chip, filter === null && [styles.chipActive, { backgroundColor: colors.accent, borderColor: colors.primary }]]}
            activeOpacity={0.8}
          >
            <Text style={[styles.chipText, filter === null && [styles.chipTextActive, { color: colors.primary }]]}>All</Text>
          </TouchableOpacity>
          {FREELANCER_SERVICE_TYPES.map((t) => (
            <TouchableOpacity
              key={t.value}
              onPress={() => selectFilter(filter === t.value ? null : t.value)}
              style={[styles.chip, filter === t.value && [styles.chipActive, { backgroundColor: colors.accent, borderColor: colors.primary }]]}
              activeOpacity={0.8}
            >
              <Feather name={t.icon} size={12} color={filter === t.value ? colors.primary : MUTED} />
              <Text style={[styles.chipText, filter === t.value && [styles.chipTextActive, { color: colors.primary }]]}>
                {t.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Freelancer list */}
        <View style={{ paddingHorizontal: SP.md + 4, marginTop: SP.md }}>
          {loading ? (
            <View style={styles.centerBox}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : error ? (
            <View style={styles.centerBox}>
              <Feather name="wifi-off" size={22} color={SUBTLE} />
              <Text style={styles.emptyText}>{error}</Text>
            </View>
          ) : freelancers.length === 0 ? (
            <View style={styles.centerBox}>
              <Feather name="users" size={26} color={SUBTLE} />
              <Text style={styles.emptyTitle}>
                {filter ? `No ${serviceLabel(filter).toLowerCase()} freelancers yet` : 'No freelancers yet'}
              </Text>
              {!me && (
                <Text style={styles.emptyText}>
                  Be the first — list your skills and get hired by brands on Brandthread.
                </Text>
              )}
            </View>
          ) : (
            freelancers.map((f) => {
              const rating = ratingLabel(f.avgRatingTenths);
              return (
                <TouchableOpacity
                  key={f.id}
                  style={styles.card}
                  activeOpacity={0.85}
                  onPress={() => openProfile(f.id)}
                >
                  {f.avatarUrl ? (
                    <Image source={{ uri: f.avatarUrl }} style={styles.avatar} />
                  ) : (
                    <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: colors.accent }]}>
                      <Text style={[styles.avatarInitial, { color: colors.primary }]}>{(f.name || 'F')[0].toUpperCase()}</Text>
                    </View>
                  )}
                  <View style={{ flex: 1, gap: 2 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={styles.name} numberOfLines={1}>{f.name}</Text>
                      {f.payoutsReady && (
                        <Feather name="check-circle" size={12} color={SUCCESS} />
                      )}
                    </View>
                    <Text style={styles.skill}>{serviceLabel(f.serviceType)}</Text>
                    <View style={styles.metaRow}>
                      {rating ? (
                        <>
                          <Feather name="star" size={11} color={GOLD} />
                          <Text style={styles.metaText}>{rating}</Text>
                        </>
                      ) : (
                        <View style={styles.newBadge}>
                         <Text style={[styles.newBadgeText, { color: colors.info }]}>NEW</Text>
                        </View>
                      )}
                      {f.totalJobsCompleted > 0 && (
                        <Text style={styles.metaMuted}>
                          · {f.totalJobsCompleted} job{f.totalJobsCompleted === 1 ? '' : 's'}
                        </Text>
                      )}
                    </View>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: SP.sm }}>
                    <Text style={styles.rate}>{formatHourlyRate(f.hourlyRateCents)}</Text>
                    <View style={[styles.hireBtn, { backgroundColor: colors.accent }]}>
                      <Text style={[styles.hireBtnText, { color: colors.primary }]}>{me?.id === f.id ? 'View' : 'Hire'}</Text>
                    </View>
                  </View>
                </TouchableOpacity>
              );
            })
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  headerBtn: {
    width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    backgroundColor: CARD, borderWidth: 1, borderColor: BORDER,
  },
  ownCard: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm + 4,
    backgroundColor: CARD, borderWidth: 1, borderColor: BORDER,
    borderRadius: RADIUS.md, padding: SP.md - 2,
  },
  ownIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  ownTitle: { color: FG, fontSize: FS.sm, fontFamily: FONT.semibold },
  ownSub: { color: MUTED, fontSize: FS.xs, fontFamily: FONT.regular, marginTop: 2 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  ctaCard: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm + 4,
    borderRadius: RADIUS.md, padding: SP.md,
  },
  ctaIcon: {
    width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  ctaTitle: { color: ON_DARK, fontSize: FS.base, fontFamily: FONT.bold },
  ctaSub: { color: 'rgba(255,255,255,0.85)', fontSize: FS.xs, fontFamily: FONT.regular, marginTop: 2 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: SP.sm + 4, paddingVertical: 7,
    borderRadius: RADIUS.pill, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER,
  },
  chipActive: { backgroundColor: PURPLE_DIM, borderColor: 'rgba(139,92,246,0.45)' },
  chipText: { color: MUTED, fontSize: FS.xs, fontFamily: FONT.medium },
  chipTextActive: { color: PURPLE },
  centerBox: { alignItems: 'center', gap: SP.sm, paddingVertical: SP.xl + 8 },
  emptyTitle: { color: FG, fontSize: FS.sm, fontFamily: FONT.semibold },
  emptyText: { color: MUTED, fontSize: FS.xs, fontFamily: FONT.regular, textAlign: 'center' },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm + 4,
    backgroundColor: CARD, borderWidth: 1, borderColor: BORDER,
    borderRadius: RADIUS.md, padding: SP.md - 2, marginBottom: SP.sm + 2,
  },
  avatar: { width: 46, height: 46, borderRadius: 23 },
  avatarFallback: { backgroundColor: PURPLE_DIM, alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { color: PURPLE, fontSize: FS.md, fontFamily: FONT.bold },
  name: { color: FG, fontSize: FS.sm, fontFamily: FONT.semibold, maxWidth: 150 },
  skill: { color: MUTED, fontSize: FS.xs, fontFamily: FONT.regular },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  metaText: { color: FG, fontSize: FS.xs, fontFamily: FONT.semibold },
  metaMuted: { color: SUBTLE, fontSize: FS.xs, fontFamily: FONT.regular },
  newBadge: {
    backgroundColor: 'rgba(34,211,238,0.15)', paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: RADIUS.xs,
  },
  newBadgeText: { color: CYAN, fontSize: 9, fontFamily: FONT.bold, letterSpacing: 0.5 },
  rate: { color: FG, fontSize: FS.sm, fontFamily: FONT.bold },
  hireBtn: {
    backgroundColor: PURPLE_DIM, paddingHorizontal: SP.md, paddingVertical: 7,
    borderRadius: RADIUS.sm,
  },
  hireBtnText: { color: PURPLE, fontSize: FS.xs, fontFamily: FONT.semibold },
});
