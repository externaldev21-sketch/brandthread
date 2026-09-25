/**
 * Community — freelancer marketplace.
 * Browse real freelancer profiles, filter by service, hire from their profile.
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ScrollView, View, Text, StyleSheet,
  ActivityIndicator, Image, RefreshControl,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { ScreenHeader } from '@/components/ScreenHeader';
import { PressableScale } from '@/components/BrandthreadUI';
import { useApi, type Freelancer } from '@/lib/api';
import { FREELANCER_SERVICE_TYPES, serviceLabel, formatHourlyRate, ratingLabel } from '@/lib/freelancer';
import { useColors } from '@/hooks/useColors';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';

export default function CommunityScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const api = useApi();
  const { isLoaded: authLoaded, userId } = useAuth();
  const router = useRouter();
  const [freelancers, setFreelancers] = useState<Freelancer[]>([]);
  const [me, setMe] = useState<Freelancer | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<string | null>(null);
  const loadGeneration = useRef(0);

  const load = useCallback(
    async (isRefresh = false) => {
      const generation = ++loadGeneration.current;
      if (isRefresh) setRefreshing(true);
      try {
        const [listRes, meRes] = await Promise.all([
          api.freelancers.list(filter ? { serviceType: filter } : undefined),
          // Not signed in / preview mode → just treat as "not a freelancer"
          authLoaded && userId
            ? api.freelancers.me().catch(() => ({ freelancer: null as Freelancer | null }))
            : Promise.resolve({ freelancer: null as Freelancer | null }),
        ]);
        if (loadGeneration.current !== generation) return;
        setFreelancers(listRes.freelancers);
        setMe(meRes.freelancer);
      } catch {
      } finally {
        if (loadGeneration.current === generation) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [api, filter, authLoaded, userId],
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
    <View style={[styles.container, { backgroundColor: 'transparent' }]}>
      <ScreenHeader
        title="Community"
        subtitle="Hire vetted creatives for your brand"
        rightElement={
          <PressableScale
            onPress={() => router.push('/freelancer-jobs' as any)}
            style={styles.headerBtn}
            accessibilityRole="button"
            accessibilityLabel="View freelancer jobs"
          >
            <Feather name="briefcase" size={18} color={colors.foreground} />
          </PressableScale>
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
            <PressableScale
              style={styles.ownCard}
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
                <View style={[styles.dot, { backgroundColor: colors.warning }]} />
              )}
              <Feather name="chevron-right" size={18} color={colors.subtle} />
            </PressableScale>
          ) : (
            <PressableScale
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push('/freelancer-apply' as any);
              }}
            >
              <LinearGradient
                colors={colors.gradient as any}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.ctaCard}
              >
                <View style={styles.ctaIcon}>
                  <Feather name="zap" size={20} color={colors.primaryForeground} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.ctaTitle}>List Your Skills</Text>
                  <Text style={styles.ctaSub}>
                    Offer your creative services to streetwear brand founders — get paid via Brandthread
                  </Text>
                </View>
                <Feather name="arrow-right" size={20} color={colors.primaryForeground} />
              </LinearGradient>
            </PressableScale>
          )}
        </View>

        {/* Service type filter chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginTop: SP.md }}
          contentContainerStyle={{ paddingHorizontal: SP.md + 4, gap: SP.sm }}
        >
          <PressableScale
            onPress={() => selectFilter(null)}
            style={[styles.chip, filter === null && { backgroundColor: colors.accent, borderColor: colors.primary }]}
          >
            <Text style={[styles.chipText, filter === null && { color: colors.primary }]}>All</Text>
          </PressableScale>
          {FREELANCER_SERVICE_TYPES.map((t) => (
            <PressableScale
              key={t.value}
              onPress={() => selectFilter(filter === t.value ? null : t.value)}
              style={[styles.chip, filter === t.value && { backgroundColor: colors.accent, borderColor: colors.primary }]}
            >
              <Feather name={t.icon} size={12} color={filter === t.value ? colors.primary : colors.mutedForeground} />
              <Text style={[styles.chipText, filter === t.value && { color: colors.primary }]}>
                {t.label}
              </Text>
            </PressableScale>
          ))}
        </ScrollView>

        {/* Freelancer list */}
        <View style={{ paddingHorizontal: SP.md + 4, marginTop: SP.md }}>
          {loading ? (
            <View style={styles.centerBox}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : freelancers.length === 0 ? (
            <View style={styles.centerBox}>
              <Feather name="users" size={26} color={colors.subtle} />
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
                <PressableScale
                  key={f.id}
                  style={styles.card}
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
                        <Feather name="check-circle" size={12} color={colors.success} />
                      )}
                    </View>
                    <Text style={styles.skill}>{serviceLabel(f.serviceType)}</Text>
                    <View style={styles.metaRow}>
                      {rating ? (
                        <>
                          <Feather name="star" size={11} color={colors.warning} />
                          <Text style={styles.metaText}>{rating}</Text>
                        </>
                      ) : (
                       <View style={[styles.newBadge, { backgroundColor: colors.infoDim }]}>
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
                </PressableScale>
              );
            })
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const makeStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  headerBtn: {
    width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
  },
  ownCard: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm + 4,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
    borderRadius: RADIUS.md, padding: SP.md - 2,
  },
  ownIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  ownTitle: { color: colors.foreground, fontSize: FS.sm, fontFamily: FONT.semibold },
  ownSub: { color: colors.mutedForeground, fontSize: FS.xs, fontFamily: FONT.regular, marginTop: 2 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  ctaCard: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm + 4,
    borderRadius: RADIUS.md, padding: SP.md,
  },
  ctaIcon: {
    width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    backgroundColor: `${colors.primaryForeground}2E`,
  },
  ctaTitle: { color: colors.primaryForeground, fontSize: FS.base, fontFamily: FONT.bold },
  ctaSub: { color: `${colors.primaryForeground}D9`, fontSize: FS.xs, fontFamily: FONT.regular, marginTop: 2 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: SP.sm + 4, paddingVertical: 7,
    borderRadius: RADIUS.pill, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
  },
  chipText: { color: colors.mutedForeground, fontSize: FS.xs, fontFamily: FONT.medium },
  centerBox: { alignItems: 'center', gap: SP.sm, paddingVertical: SP.xl + 8 },
  emptyTitle: { color: colors.foreground, fontSize: FS.sm, fontFamily: FONT.semibold },
  emptyText: { color: colors.mutedForeground, fontSize: FS.xs, fontFamily: FONT.regular, textAlign: 'center' },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm + 4,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
    borderRadius: RADIUS.md, padding: SP.md - 2, marginBottom: SP.sm + 2,
  },
  avatar: { width: 46, height: 46, borderRadius: 23 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { fontSize: FS.md, fontFamily: FONT.bold },
  name: { color: colors.foreground, fontSize: FS.sm, fontFamily: FONT.semibold, maxWidth: 150 },
  skill: { color: colors.mutedForeground, fontSize: FS.xs, fontFamily: FONT.regular },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  metaText: { color: colors.foreground, fontSize: FS.xs, fontFamily: FONT.semibold },
  metaMuted: { color: colors.subtle, fontSize: FS.xs, fontFamily: FONT.regular },
  newBadge: {
    paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: RADIUS.xs,
  },
  newBadgeText: { fontSize: FS.xs, fontFamily: FONT.bold, letterSpacing: 0.5 },
  rate: { color: colors.foreground, fontSize: FS.sm, fontFamily: FONT.bold },
  hireBtn: {
    paddingHorizontal: SP.md, paddingVertical: 7,
    borderRadius: RADIUS.sm,
  },
  hireBtnText: { fontSize: FS.xs, fontFamily: FONT.semibold },
});
