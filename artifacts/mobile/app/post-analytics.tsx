import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { goBackOr } from '@/lib/navigation/goBackOr';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  useWindowDimensions,
  Dimensions,
  ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { Icon, type IconName } from '@/components/ui/Icon';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { PostAnalyticsResponse, useApi } from '@/lib/api';
import { EmptyState } from '@/components/BrandthreadUI';
import { ScreenHeader } from '@/components/ScreenHeader';
import { useColors } from '@/hooks/useColors';
import { FS, FONT, SP } from '@/lib/theme';
import { formatCompactCount } from '@/lib/compactFormat';
import { formatMoney } from '@/lib/format';

// ─── Design Tokens ─────────────────────────────────────────────────────────────


// ─── Helpers ───────────────────────────────────────────────────────────────────

const formatNumber = formatCompactCount;

function formatRevenue(n: number): string {
  return formatMoney(Math.round(n * 100));
}

function postTypeGradient(type: string, primary: string, colors: ReturnType<typeof useColors>): [string, string] {
  if (type === 'video' || type === 'behind_scenes') return [primary, colors.background];
  if (type === 'slideshow') return [colors.info, colors.background];
  if (type === 'announcement') return [colors.success, `${colors.success}2E`];
  return [colors.warning, colors.background];
}

// ─── Section Title ─────────────────────────────────────────────────────────────

function SectionTitle({ title }: { title: string }) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return <Text style={styles.sectionTitle}>{title}</Text>;
}

// ─── Main Screen ───────────────────────────────────────────────────────────────

export default function PostAnalyticsScreen() {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();

  const api = useApi();
  const postId = typeof params.id === 'string' ? params.id : '';
  const [analytics, setAnalytics] = useState<PostAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(Boolean(postId));

  const loadPost = useCallback(async () => {
    if (!postId) return;
    setLoading(true);
    try {
      setAnalytics(await api.posts.analytics(postId));
    } catch {
      setAnalytics(null);
    } finally {
      setLoading(false);
    }
  }, [api, postId]);

  useEffect(() => { loadPost(); }, [loadPost]);

  if (loading) {
    return (
      <View style={styles.root}>
        <ScreenHeader title="Post Analytics" onBack={() => goBackOr(router)} />
        <View style={styles.notFound}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.notFoundText}>Loading stats…</Text>
        </View>
      </View>
    );
  }

  if (!analytics) {
    return (
      <View style={styles.root}>
        <ScreenHeader title="Post Analytics" onBack={() => goBackOr(router)} />
        <View style={styles.notFound}>
          {postId ? (
            <EmptyState
              icon="bar-chart-2"
              title="Couldn't load stats"
              description="Check your connection and try again."
              action={{ label: 'Try again', onPress: loadPost }}
            />
          ) : (
            <EmptyState
              icon="bar-chart-2"
              title="Post not found"
              description="Open stats from one of your posts."
            />
          )}
        </View>
      </View>
    );
  }

  const { post, metrics } = analytics;
  const gradColors = postTypeGradient(post.mediaType ?? 'image', colors.primary, colors);
  const caption = post.caption?.trim();
  // Watch time only means something for video; a photo post never records it.
  const showWatchTime = metrics.retention.tracked || post.mediaType === 'video' || post.mediaType === 'behind_scenes';

  return (
    <View style={styles.root}>
      <ScreenHeader
        title="Post Analytics"
        onBack={() => goBackOr(router)}
        rightElement={
          <View style={styles.rangePill}>
            <Text style={styles.rangePillText}>Live</Text>
          </View>
        }
      />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.previewCard}>
          <LinearGradient colors={gradColors} style={styles.previewThumb} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} />
          <View style={styles.previewMeta}>
            <Text style={[styles.previewCaption, !caption && { color: colors.mutedForeground }]} numberOfLines={2}>{caption || 'No caption'}</Text>
            <View style={styles.previewBadgeRow}>
              <View style={styles.typeBadge}>
                <Text style={styles.typeBadgeText}>{String(post.mediaType ?? 'post').replace('_', ' ')}</Text>
              </View>
              <View style={[styles.statusBadge, { backgroundColor: colors.success }]}>
                <Text style={styles.statusBadgeText}>Published</Text>
              </View>
            </View>
          </View>
        </View>

        <View style={styles.heroGrid}>
           <HeroCard icon="eye" iconColor={colors.success} label="Views" value={metrics.views.tracked ? formatNumber(metrics.views.count ?? 0) : 'Not tracked'} />
          <HeroCard icon="heart" iconColor={colors.primary} label="Likes" value={formatNumber(metrics.likes)} />
           <HeroCard icon="bookmark" iconColor={colors.info} label="Saves" value={formatNumber(metrics.saves.count)} />
           <HeroCard icon="repeat" iconColor={colors.warning} label="Reposts" value={formatNumber(metrics.reposts)} />
        </View>

        <SectionTitle title="Performance data" />
        <View style={styles.card}>
          <AnalyticsRow
            label="Product clicks"
            value={formatNumber(metrics.productClicks.count)}
            detail={`${formatNumber(metrics.productClicks.uniqueClickers)} unique shoppers`}
          />
          <AnalyticsRow
            label="Conversions"
            value={formatNumber(metrics.conversions.orders)}
            detail={metrics.conversions.rate == null
              ? 'Rate unavailable until a product click is recorded'
              : `${(metrics.conversions.rate * 100).toFixed(1)}% of product clicks`}
          />
          <AnalyticsRow
            label="Attributed revenue"
            value={formatMoney(metrics.conversions.revenueCents)}
            detail="From non-cancelled attributed orders"
          />
          <AnalyticsRow
            label="Average watch time"
            value={metrics.retention.tracked
              ? `${(metrics.retention.averageWatchTimeSeconds ?? 0).toFixed(1)}s`
              : 'Not tracked'}
            detail={metrics.retention.tracked
              ? `${formatNumber(metrics.retention.sampleCount)} watch samples`
              : 'Shown after valid watch-time events are recorded'}
          />
          {showWatchTime && (
            <AnalyticsRow
              label="Average watch time"
              value={metrics.retention.tracked
                ? `${(metrics.retention.averageWatchTimeSeconds ?? 0).toFixed(1)}s`
                : 'Not tracked'}
              detail={metrics.retention.tracked
                ? `Based on ${formatNumber(metrics.retention.sampleCount)} views`
                : 'Shown once viewers watch this video'}
            />
          )}
        </View>

        {(!metrics.views.tracked || (showWatchTime && !metrics.retention.tracked)) && (
          <View style={styles.availabilityNote}>
            <Icon name="info" size={18} color={colors.primary} />
            <Text style={styles.unavailableText}>
              Metrics marked “Not tracked” have no recorded data for this post yet. We never estimate post performance.
            </Text>
          </View>
        )}

        <View style={styles.quickActionsRow}>
          <TouchableOpacity
            style={styles.quickActionBoostWrap}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Boost post"
            onPress={() => router.push(('/boost?targetType=post&targetId=' + encodeURIComponent(post.id)) as never)}
          >
            <LinearGradient colors={colors.gradient as any} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.quickActionGradient}>
              <Icon name="zap" size={18} color={colors.primaryForeground} />
              <Text style={styles.quickActionText}>Boost Post</Text>
            </LinearGradient>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickActionShare} activeOpacity={0.85} onPress={() => goBackOr(router)}>
             <Icon name="arrow-left" size={18} color={colors.primaryForeground} />
            <Text style={styles.quickActionText}>Back</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

// ─── Hero Card ─────────────────────────────────────────────────────────────────

interface HeroCardProps {
  icon: IconName;
  iconColor: string;
  label: string;
  value: string;
}

function HeroCard({ icon, iconColor, label, value }: HeroCardProps) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { width: SCREEN_WIDTH } = useWindowDimensions();
  return (
    <View style={styles.heroCard}>
      <Icon name={icon} size={16} color={iconColor} />
      <Text style={styles.heroValue}>{value}</Text>
      <Text style={styles.heroLabel}>{label}</Text>
    </View>
  );
}

function AnalyticsRow({ label, value, detail }: { label: string; value: string; detail: string }) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.analyticsRow}>
      <View style={styles.analyticsRowCopy}>
        <Text style={styles.analyticsLabel}>{label}</Text>
        <Text style={styles.analyticsDetail}>{detail}</Text>
      </View>
      <Text style={styles.analyticsValue}>{value}</Text>
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const createStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },

  // ── Not Found ──
  notFound: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    gap: 12,
  },
  notFoundText: {
    color: colors.mutedForeground,
    fontSize: FS.base,
    fontFamily: FONT.regular,
    textAlign: 'center',
  },

  // ── Header ──
  // No divider under the header (app-wide header rule).
  rangePill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  rangePillText: {
    color: colors.mutedForeground,
    fontSize: 13,
    fontFamily: FONT.medium,
  },

  // ── Scroll ──
  scroll: {
    flex: 1,
  },
  // The stack scene already ends above the floating seller tab bar.
  scrollContent: {
    paddingHorizontal: SP.md,
    paddingBottom: SP.lg,
  },

  // ── Post Preview Card ──
  previewCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 14,
    marginTop: 16,
    gap: 12,
  },
  previewThumb: {
    width: 48,
    height: 48,
    borderRadius: 8,
  },
  previewMeta: {
    flex: 1,
    gap: 6,
  },
  previewCaption: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 19,
  },
  previewBadgeRow: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
  },
  typeBadge: {
    backgroundColor: colors.border,
    borderRadius: 16,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  typeBadgeText: {
    color: colors.mutedForeground,
    fontSize: FS.xs,
    fontFamily: FONT.medium,
    textTransform: 'capitalize',
  },
  statusBadge: {
    borderRadius: 16,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  statusBadgeText: {
    color: colors.primaryForeground,
    fontSize: 11,
    fontFamily: FONT.semibold,
    textTransform: 'capitalize',
  },

  // ── Hero Metrics ──
  heroGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 16,
  },
  heroCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 14,
    gap: 4,
  },
  heroValue: {
    color: colors.text,
    fontSize: 22,
    fontFamily: FONT.bold,
    marginTop: 6,
  },
  heroLabel: {
    color: colors.mutedForeground,
    fontSize: FS.meta,
    fontFamily: FONT.medium,
  },

  // ── Section Title ──
  sectionTitle: {
    color: colors.text,
    fontSize: FS.base,
    fontFamily: FONT.semibold,
    marginTop: SP.lg,
    marginBottom: 12,
  },

  // ── Card ──
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 14,
    gap: 12,
  },
  unavailableText: {
    flex: 1,
    color: colors.mutedForeground,
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    lineHeight: 19,
  },
  availabilityNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 14,
    gap: 10,
    marginTop: 12,
  },
  analyticsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    paddingVertical: 4,
  },
  analyticsRowCopy: {
    flex: 1,
    gap: 3,
  },
  analyticsLabel: {
    color: colors.text,
    fontSize: 15,
    fontFamily: FONT.semibold,
  },
  analyticsDetail: {
    color: colors.mutedForeground,
    fontSize: FS.meta,
    fontFamily: FONT.regular,
    lineHeight: 16,
  },
  analyticsValue: {
    color: colors.text,
    fontSize: FS.base,
    fontFamily: FONT.bold,
    textAlign: 'right',
  },

  // ── Quick Actions ──
  quickActionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 24,
  },
  quickActionBoostWrap: {
    flex: 1,
    borderRadius: 12,
    overflow: 'hidden',
  },
  quickActionGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 14,
    gap: 8,
  },
  quickActionShare: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 14,
    gap: 8,
  },
  quickActionText: {
    color: colors.text,
    fontSize: 15,
    fontFamily: FONT.semibold,
  },
});
