import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Dimensions,
  Animated,
  ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { PostAnalyticsResponse, useApi } from '@/lib/api';
import { EmptyState } from '@/components/BrandthreadUI';
import { useColors } from '@/hooks/useColors';
import { FS } from '@/lib/theme';

// ─── Design Tokens ─────────────────────────────────────────────────────────────

const { width: SCREEN_WIDTH } = Dimensions.get('window');

type DateRange = '7d' | '14d' | '30d' | 'All';
const DATE_RANGES: DateRange[] = ['7d', '14d', '30d', 'All'];

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

function formatRevenue(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPeakHour(hour: number): string {
  const period = hour >= 12 ? 'PM' : 'AM';
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}:00 ${period}`;
}

function postTypeGradient(type: string, primary: string, colors: ReturnType<typeof useColors>): [string, string] {
  if (type === 'video' || type === 'behind_scenes') return [primary, colors.background];
  if (type === 'slideshow') return [colors.info, colors.background];
  if (type === 'announcement') return [colors.success, `${colors.success}2E`];
  return [colors.warning, colors.background];
}

function retentionBarColor(pct: number, colors: ReturnType<typeof useColors>): string {
  if (pct > 0.7) return colors.success;
  if (pct > 0.4) return colors.warning;
  return colors.destructive;
}

function countryInitials(country: string): string {
  const words = country.trim().split(/\s+/);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return country.slice(0, 2).toUpperCase();
}

// ─── Section Title ─────────────────────────────────────────────────────────────

function SectionTitle({ title }: { title: string }) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return <Text style={styles.sectionTitle}>{title}</Text>;
}

// ─── Engagement Bar ────────────────────────────────────────────────────────────

interface EngagementBarProps {
  label: string;
  value: number;
  maxValue: number;
}

function EngagementBar({ label, value, maxValue }: EngagementBarProps) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const pct = maxValue > 0 ? value / maxValue : 0;
  return (
    <View style={styles.engRow}>
      <Text style={styles.engLabel}>{label}</Text>
      <View style={styles.engBarBg}>
        <LinearGradient
          colors={[colors.primary, colors.info]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={[styles.engBarFill, { width: `${Math.max(pct * 100, 1)}%` }]}
        />
      </View>
      <Text style={styles.engValue}>{formatNumber(value)}</Text>
    </View>
  );
}

// ─── Country Bar ───────────────────────────────────────────────────────────────

interface CountryBarProps {
  country: string;
  pct: number;
}

function CountryBar({ country, pct }: CountryBarProps) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.countryRow}>
      <View style={styles.countryInitialsCircle}>
        <Text style={styles.countryInitialsText}>{countryInitials(country)}</Text>
      </View>
      <Text style={styles.countryName}>{country}</Text>
      <View style={styles.engBarBg}>
        <LinearGradient
          colors={[colors.primary, colors.info]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={[styles.engBarFill, { width: `${Math.max(pct * 100, 1)}%` }]}
        />
      </View>
      <Text style={styles.countryPct}>{(pct * 100).toFixed(0)}%</Text>
    </View>
  );
}

// ─── Main Screen ───────────────────────────────────────────────────────────────

export default function PostAnalyticsScreen() {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
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

  const [activeRange, setActiveRange] = useState<DateRange>('7d');

  const cycleRange = useCallback(() => {
    setActiveRange(prev => {
      const idx = DATE_RANGES.indexOf(prev);
      return DATE_RANGES[(idx + 1) % DATE_RANGES.length];
    });
  }, []);

  if (loading) {
    return (
      <View style={styles.notFound}>
        <ActivityIndicator color={colors.primary} />
        <Text style={styles.notFoundText}>Loading post…</Text>
      </View>
    );
  }

  if (!analytics) {
    return (
      <View style={styles.root}>
        <View style={[styles.header, { paddingTop: insets.top }]}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Feather name="arrow-left" size={20} color={colors.text} />
          </TouchableOpacity>
        </View>
        <View style={styles.notFound}>
          <EmptyState
            icon="bar-chart-2"
            title="Couldn't load stats"
            description="Pull to refresh or try again."
            action={{ label: 'Try again', onPress: loadPost }}
          />
        </View>
      </View>
    );
  }

  const { post, metrics } = analytics;
  const gradColors = postTypeGradient(post.mediaType ?? 'image', colors.primary, colors);

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={20} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Post Analytics</Text>
        <View style={styles.rangePill}>
          <Text style={styles.rangePillText}>Live</Text>
        </View>
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.previewCard}>
          <LinearGradient colors={gradColors} style={styles.previewThumb} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} />
          <View style={styles.previewMeta}>
            <Text style={styles.previewCaption} numberOfLines={2}>{post.caption ?? ''}</Text>
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
            value={formatRevenue(metrics.conversions.revenueCents / 100)}
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
        </View>

        {(!metrics.views.tracked || !metrics.retention.tracked) && (
          <View style={styles.availabilityNote}>
            <Feather name="info" size={18} color={colors.primary} />
            <Text style={styles.unavailableText}>
              Unavailable metrics are labeled “Not tracked.” Brandthread never estimates post performance from demo data.
            </Text>
          </View>
        )}

        <View style={styles.quickActionsRow}>
          <TouchableOpacity
            style={styles.quickActionBoostWrap}
            activeOpacity={0.85}
            onPress={() => router.push(('/boost?targetType=post&targetId=' + encodeURIComponent(post.id)) as never)}
          >
            <LinearGradient colors={colors.gradient as any} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.quickActionGradient}>
              <Feather name="zap" size={18} color={colors.primaryForeground} />
              <Text style={styles.quickActionText}>Boost Post</Text>
            </LinearGradient>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickActionShare} activeOpacity={0.85} onPress={() => router.back()}>
             <Feather name="arrow-left" size={18} color={colors.primaryForeground} />
            <Text style={styles.quickActionText}>Back</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );

  /* Retired demo analytics layout retained only as a source reference.
  const engMaxValue = 1;
  const hasRetention = false;
  const conversionPct = '0.00';
  return (
    <View style={styles.root}>
      {/* ─── Fixed Header ──────────────────────────────────────────────────── * /}
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={20} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Post Analytics</Text>
        <TouchableOpacity style={styles.rangePill} onPress={cycleRange}>
          <Text style={styles.rangePillText}>{activeRange}</Text>
          <Feather name="chevron-down" size={12} color={colors.muted} style={{ marginLeft: 2 }} />
        </TouchableOpacity>
      </View>

      {/* ─── Scrollable Content ─────────────────────────────────────────────── * /}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* 1. Post Preview Card * /}
        <View style={styles.previewCard}>
          <LinearGradient
            colors={gradColors}
            style={styles.previewThumb}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          />
          <View style={styles.previewMeta}>
            <Text style={styles.previewCaption} numberOfLines={2}>{post.caption}</Text>
            <View style={styles.previewBadgeRow}>
              <View style={styles.typeBadge}>
                <Text style={styles.typeBadgeText}>{post.type.replace('_', ' ')}</Text>
              </View>
              <View style={[
                styles.statusBadge,
                {
                  backgroundColor:
                    post.status === 'published' ? colors.success :
                    post.status === 'draft' ? colors.warning : colors.info,
                },
              ]}>
                <Text style={styles.statusBadgeText}>{post.status}</Text>
              </View>
            </View>
          </View>
          <TouchableOpacity style={styles.openBtn} onPress={() => router.back()}>
            <Text style={styles.openBtnText}>Open</Text>
          </TouchableOpacity>
        </View>

        {/* 2. Hero Metrics 2x2 * /}
        <View style={styles.heroGrid}>
          <HeroCard
            icon="eye"
            iconColor={colors.success}
            label="Views"
            value={formatNumber(analytics.views)}
          />
          <HeroCard
            icon="heart"
            iconColor={colors.primary}
            label="Likes"
            value={formatNumber(analytics.likes)}
          />
          <HeroCard
            icon="bookmark"
            iconColor={colors.info}
            label="Saves"
            value={formatNumber(analytics.saves)}
          />
          <HeroCard
            icon="share-2"
            iconColor={colors.warning}
            label="Shares"
            value={formatNumber(analytics.shares)}
          />
        </View>

        {/* 3. Engagement Breakdown * /}
        <SectionTitle title="Engagement" />
        <View style={styles.card}>
          <EngagementBar label="Comments" value={analytics.comments} maxValue={engMaxValue} />
          <EngagementBar label="Reposts" value={analytics.reposts} maxValue={engMaxValue} />
          <EngagementBar label="Profile Visits" value={analytics.profileVisits} maxValue={engMaxValue} />
          <EngagementBar label="Product Clicks" value={analytics.productClicks} maxValue={engMaxValue} />
          <EngagementBar label="Add to Cart" value={analytics.addToCartActions} maxValue={engMaxValue} />
        </View>

        {/* 4. Video Retention Chart * /}
        {hasRetention && (
          <>
            <SectionTitle title="Audience Retention" />
            <View style={styles.card}>
              <RetentionChart data={analytics.retentionData} />
              <View style={styles.retentionXAxis}>
                <Text style={styles.retentionXLabel}>0s</Text>
                <Text style={styles.retentionXLabel}>{Math.round(analytics.retentionData.length / 2)}s</Text>
                <Text style={styles.retentionXLabel}>{analytics.retentionData.length - 1}s</Text>
              </View>
              <View style={styles.retentionStats}>
                <Text style={styles.retentionStat}>
                  Avg watch time: {analytics.avgWatchTime.toFixed(1)}s
                </Text>
                <Text style={styles.retentionStat}>
                  Completion rate: {(analytics.completionRate * 100).toFixed(0)}%
                </Text>
              </View>
            </View>
          </>
        )}

        {/* 5. Revenue & Conversions * /}
        <SectionTitle title="Revenue" />
        <View style={styles.revenueRow}>
          <View style={[styles.revenueCard, { flex: 1 }]}>
            <Text style={[styles.revenueLabel, { color: colors.success }]}>Revenue</Text>
            <Text style={styles.revenueValue}>{formatRevenue(analytics.revenue)}</Text>
          </View>
          <View style={[styles.revenueCard, { flex: 1 }]}>
            <Text style={[styles.revenueLabel, { color: colors.muted }]}>Purchases</Text>
            <Text style={styles.revenueValue}>{analytics.purchases}</Text>
          </View>
          <View style={[styles.revenueCard, { flex: 1 }]}>
            <Text style={[styles.revenueLabel, { color: colors.muted }]}>Conversion</Text>
            <Text style={styles.revenueValue}>{conversionPct}%</Text>
          </View>
        </View>

        {/* 6. Audience Breakdown * /}
        <SectionTitle title="Top Audience" />
        <View style={styles.card}>
          {analytics.topCountries.map((item) => (
            <CountryBar key={item.country} country={item.country} pct={item.pct} />
          ))}
        </View>

        {/* 7. Peak Hour * /}
        <SectionTitle title="Peak Engagement Hour" />
        <View style={[styles.card, styles.peakHourCard]}>
          <View style={styles.peakHourLeft}>
            <Feather name="clock" size={20} color={colors.success} />
            <Text style={styles.peakHourTime}>{formatPeakHour(analytics.peakHour)}</Text>
          </View>
          <Text style={styles.peakHourSub}>Most viewers are active at this hour</Text>
        </View>

        {/* 8. Quick Actions * /}
        <View style={styles.quickActionsRow}>
          <TouchableOpacity style={styles.quickActionBoostWrap} activeOpacity={0.85}>
            <LinearGradient
              colors={[colors.primary, colors.info]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.quickActionGradient}
            >
              <Feather name="zap" size={18} color={colors.primaryForeground} />
              <Text style={styles.quickActionText}>Boost Post</Text>
            </LinearGradient>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickActionShare} activeOpacity={0.85}>
              <Feather name="share-2" size={18} color={colors.primaryForeground} />
            <Text style={styles.quickActionText}>Share Results</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
  */
}

// ─── Hero Card ─────────────────────────────────────────────────────────────────

interface HeroCardProps {
  icon: keyof typeof Feather.glyphMap;
  iconColor: string;
  label: string;
  value: string;
}

function HeroCard({ icon, iconColor, label, value }: HeroCardProps) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.heroCard}>
      <Feather name={icon} size={16} color={iconColor} />
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

// ─── Retention Chart ───────────────────────────────────────────────────────────

interface RetentionChartProps {
  data: { second: number; viewerPct: number }[];
}

function RetentionChart({ data }: RetentionChartProps) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const chartWidth = SCREEN_WIDTH - 32 - 28 - 16; // account for padding + card padding
  const barWidth = 2;
  const gap = 1;
  const totalPerBar = barWidth + gap;
  const maxBars = Math.floor(chartWidth / totalPerBar);
  const displayData = data.slice(0, maxBars);

  return (
    <View style={styles.retentionChart}>
      {displayData.map((point, i) => (
        <View
          key={i}
          style={[
            styles.retentionBar,
            {
              height: `${Math.max(point.viewerPct * 100, 2)}%`,
               backgroundColor: retentionBarColor(point.viewerPct, colors),
              marginRight: gap,
            },
          ]}
        />
      ))}
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
    color: colors.text,
    fontSize: 16,
    textAlign: 'center',
  },

  // ── Header ──
  header: {
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  rangePill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  rangePillText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '500',
  },

  // ── Scroll ──
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 120,
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
    borderRadius: 10,
  },
  previewMeta: {
    flex: 1,
    gap: 6,
  },
  previewCaption: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 19,
  },
  previewBadgeRow: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
  },
  typeBadge: {
    backgroundColor: colors.border,
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  typeBadgeText: {
    color: colors.muted,
    fontSize: 11,
    textTransform: 'capitalize',
  },
  statusBadge: {
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  statusBadgeText: {
    color: colors.primaryForeground,
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  openBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  openBtnText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '500',
  },

  // ── Hero Metrics ──
  heroGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 16,
  },
  heroCard: {
    width: (SCREEN_WIDTH - 32 - 10) / 2,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 14,
    gap: 4,
  },
  heroValue: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '700',
    marginTop: 6,
  },
  heroLabel: {
    color: colors.muted,
    fontSize: 12,
  },
  heroChange: {
    color: colors.success,
    fontSize: 11,
    marginTop: 2,
  },

  // ── Section Title ──
  sectionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
    marginTop: 24,
    marginBottom: 12,
  },

  // ── Card ──
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 14,
    gap: 12,
  },
  unavailableTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  unavailableText: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
  },
  availabilityNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
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
    fontSize: 14,
    fontWeight: '600',
  },
  analyticsDetail: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 16,
  },
  analyticsValue: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'right',
  },

  // ── Engagement Bars ──
  engRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  engLabel: {
    color: colors.muted,
    fontSize: 13,
    width: 110,
  },
  engBarBg: {
    flex: 1,
    height: 6,
    backgroundColor: colors.background,
    borderRadius: 3,
    overflow: 'hidden',
  },
  engBarFill: {
    height: 6,
    borderRadius: 3,
  },
  engValue: {
    color: colors.text,
    fontSize: 12,
    width: 50,
    textAlign: 'right',
  },

  // ── Retention Chart ──
  retentionChart: {
    height: 100,
    flexDirection: 'row',
    alignItems: 'flex-end',
    overflow: 'hidden',
  },
  retentionBar: {
    width: 2,
    borderRadius: 1,
  },
  retentionXAxis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  retentionXLabel: {
    color: colors.muted,
    fontSize: FS.xs,
  },
  retentionStats: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 4,
  },
  retentionStat: {
    color: colors.muted,
    fontSize: 12,
  },

  // ── Revenue ──
  revenueRow: {
    flexDirection: 'row',
    gap: 10,
  },
  revenueCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 12,
    alignItems: 'center',
  },
  revenueLabel: {
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 4,
  },
  revenueValue: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
  },

  // ── Country Bars ──
  countryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  countryInitialsCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countryInitialsText: {
    color: colors.muted,
    fontSize: FS.xs,
    fontWeight: '700',
  },
  countryName: {
    color: colors.text,
    fontSize: 13,
    width: 110,
  },
  countryPct: {
    color: colors.text,
    fontSize: 12,
    width: 36,
    textAlign: 'right',
  },

  // ── Peak Hour ──
  peakHourCard: {
    flexDirection: 'column',
    gap: 8,
  },
  peakHourLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  peakHourTime: {
    color: colors.success,
    fontSize: 28,
    fontWeight: '700',
  },
  peakHourSub: {
    color: colors.muted,
    fontSize: 12,
  },

  // ── Quick Actions ──
  quickActionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 24,
  },
  quickActionBoostWrap: {
    flex: 1,
    borderRadius: 14,
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
    borderRadius: 14,
    padding: 14,
    gap: 8,
  },
  quickActionText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
});
