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
import { useApi } from '@/lib/api';

// ─── Design Tokens ─────────────────────────────────────────────────────────────
const BG        = '#07070F';
const CARD      = '#12121F';
const BORDER    = 'rgba(255,255,255,0.07)';
const FG        = '#F4F4FF';
const MUTED     = 'rgba(244,244,255,0.50)';
const GREEN     = '#8B5CF6';
const GREEN_DIM = 'rgba(139,92,246,0.18)';
const PURPLE    = '#8B5CF6';
const BLUE      = '#3B82F6';
const ORANGE    = '#F97316';
const ERR       = '#F87171';

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

function postTypeGradient(type: string): [string, string] {
  if (type === 'video' || type === 'behind_scenes') return [PURPLE, '#1E1540'];
  if (type === 'slideshow') return [BLUE, '#0A1828'];
  if (type === 'announcement') return [GREEN, 'rgba(139,92,246,0.18)'];
  return ['#3D1F0F', '#1A0A05'];
}

function retentionBarColor(pct: number): string {
  if (pct > 0.7) return GREEN;
  if (pct > 0.4) return ORANGE;
  return ERR;
}

function countryInitials(country: string): string {
  const words = country.trim().split(/\s+/);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return country.slice(0, 2).toUpperCase();
}

// ─── Section Title ─────────────────────────────────────────────────────────────

function SectionTitle({ title }: { title: string }) {
  return <Text style={styles.sectionTitle}>{title}</Text>;
}

// ─── Engagement Bar ────────────────────────────────────────────────────────────

interface EngagementBarProps {
  label: string;
  value: number;
  maxValue: number;
}

function EngagementBar({ label, value, maxValue }: EngagementBarProps) {
  const pct = maxValue > 0 ? value / maxValue : 0;
  return (
    <View style={styles.engRow}>
      <Text style={styles.engLabel}>{label}</Text>
      <View style={styles.engBarBg}>
        <LinearGradient
          colors={[GREEN, '#00D4FF']}
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
  return (
    <View style={styles.countryRow}>
      <View style={styles.countryInitialsCircle}>
        <Text style={styles.countryInitialsText}>{countryInitials(country)}</Text>
      </View>
      <Text style={styles.countryName}>{country}</Text>
      <View style={styles.engBarBg}>
        <LinearGradient
          colors={[GREEN, '#00D4FF']}
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
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();

  const api = useApi();
  const postId = typeof params.id === 'string' ? params.id : '';
  const [post, setPost] = useState<any | null>(null);
  const [loading, setLoading] = useState(Boolean(postId));
  const [loadError, setLoadError] = useState<string | null>(
    postId ? null : 'Choose a post from your content library first.',
  );

  const loadPost = useCallback(async () => {
    if (!postId) return;
    setLoading(true);
    setLoadError(null);
    try {
      setPost(await api.posts.get(postId));
    } catch {
      setPost(null);
      setLoadError('We couldn’t load this post. It may have been removed, or your connection may be offline.');
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
        <ActivityIndicator color={GREEN} />
        <Text style={styles.notFoundText}>Loading post…</Text>
      </View>
    );
  }

  if (!post || loadError) {
    return (
      <View style={styles.notFound}>
        <Feather name="alert-circle" size={30} color={ERR} />
        <Text style={styles.notFoundText}>{loadError ?? 'Post not found'}</Text>
        <TouchableOpacity style={styles.quickActionShare} onPress={postId ? loadPost : () => router.back()}>
          <Text style={styles.quickActionText}>{postId ? 'Try again' : 'Back to content'}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const analytics: any = null;
  const gradColors = postTypeGradient(post.mediaType ?? 'image');

  // The live post API currently reports only durable like and repost counts.
  // Keep this screen honest rather than deriving views, revenue, or retention.
  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={20} color={FG} />
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
              <View style={[styles.statusBadge, { backgroundColor: GREEN }]}>
                <Text style={styles.statusBadgeText}>Published</Text>
              </View>
            </View>
          </View>
        </View>

        <View style={styles.heroGrid}>
          <HeroCard icon="heart" iconColor={PURPLE} label="Likes" value={formatNumber(Number(post.likeCount ?? post.likesCount ?? 0))} />
          <HeroCard icon="repeat" iconColor={ORANGE} label="Reposts" value={formatNumber(Number(post.repostCount ?? post.repostsCount ?? 0))} />
        </View>

        <SectionTitle title="Performance data" />
        <View style={styles.card}>
          <Feather name="bar-chart-2" size={26} color={PURPLE} />
          <Text style={styles.unavailableTitle}>More post analytics are coming soon</Text>
          <Text style={styles.unavailableText}>
            Views, saves, product clicks, conversions, and audience insights are not available from the live API yet. We only show verified counts above.
          </Text>
        </View>

        <View style={styles.quickActionsRow}>
          <TouchableOpacity
            style={styles.quickActionBoostWrap}
            activeOpacity={0.85}
            onPress={() => router.push(('/boost?targetType=post&targetId=' + encodeURIComponent(post.id)) as never)}
          >
            <LinearGradient colors={[PURPLE, BLUE]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.quickActionGradient}>
              <Feather name="zap" size={18} color={FG} />
              <Text style={styles.quickActionText}>Boost Post</Text>
            </LinearGradient>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickActionShare} activeOpacity={0.85} onPress={() => router.back()}>
            <Feather name="arrow-left" size={18} color={FG} />
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
          <Feather name="arrow-left" size={20} color={FG} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Post Analytics</Text>
        <TouchableOpacity style={styles.rangePill} onPress={cycleRange}>
          <Text style={styles.rangePillText}>{activeRange}</Text>
          <Feather name="chevron-down" size={12} color={MUTED} style={{ marginLeft: 2 }} />
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
                    post.status === 'published' ? GREEN :
                    post.status === 'draft' ? ORANGE : BLUE,
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
            iconColor={GREEN}
            label="Views"
            value={formatNumber(analytics.views)}
          />
          <HeroCard
            icon="heart"
            iconColor={PURPLE}
            label="Likes"
            value={formatNumber(analytics.likes)}
          />
          <HeroCard
            icon="bookmark"
            iconColor={BLUE}
            label="Saves"
            value={formatNumber(analytics.saves)}
          />
          <HeroCard
            icon="share-2"
            iconColor={ORANGE}
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
            <Text style={[styles.revenueLabel, { color: GREEN }]}>Revenue</Text>
            <Text style={styles.revenueValue}>{formatRevenue(analytics.revenue)}</Text>
          </View>
          <View style={[styles.revenueCard, { flex: 1 }]}>
            <Text style={[styles.revenueLabel, { color: MUTED }]}>Purchases</Text>
            <Text style={styles.revenueValue}>{analytics.purchases}</Text>
          </View>
          <View style={[styles.revenueCard, { flex: 1 }]}>
            <Text style={[styles.revenueLabel, { color: MUTED }]}>Conversion</Text>
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
            <Feather name="clock" size={20} color={GREEN} />
            <Text style={styles.peakHourTime}>{formatPeakHour(analytics.peakHour)}</Text>
          </View>
          <Text style={styles.peakHourSub}>Most viewers are active at this hour</Text>
        </View>

        {/* 8. Quick Actions * /}
        <View style={styles.quickActionsRow}>
          <TouchableOpacity style={styles.quickActionBoostWrap} activeOpacity={0.85}>
            <LinearGradient
              colors={[PURPLE, BLUE]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.quickActionGradient}
            >
              <Feather name="zap" size={18} color={FG} />
              <Text style={styles.quickActionText}>Boost Post</Text>
            </LinearGradient>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickActionShare} activeOpacity={0.85}>
            <Feather name="share-2" size={18} color={FG} />
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
  return (
    <View style={styles.heroCard}>
      <Feather name={icon} size={16} color={iconColor} />
      <Text style={styles.heroValue}>{value}</Text>
      <Text style={styles.heroLabel}>{label}</Text>
    </View>
  );
}

// ─── Retention Chart ───────────────────────────────────────────────────────────

interface RetentionChartProps {
  data: { second: number; viewerPct: number }[];
}

function RetentionChart({ data }: RetentionChartProps) {
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
              backgroundColor: retentionBarColor(point.viewerPct),
              marginRight: gap,
            },
          ]}
        />
      ))}
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BG,
  },

  // ── Not Found ──
  notFound: {
    flex: 1,
    backgroundColor: BG,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    gap: 12,
  },
  notFoundText: {
    color: FG,
    fontSize: 16,
    textAlign: 'center',
  },

  // ── Header ──
  header: {
    backgroundColor: CARD,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
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
    color: FG,
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  rangePill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  rangePillText: {
    color: MUTED,
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
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
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
    color: FG,
    fontSize: 14,
    lineHeight: 19,
  },
  previewBadgeRow: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
  },
  typeBadge: {
    backgroundColor: BORDER,
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  typeBadgeText: {
    color: MUTED,
    fontSize: 11,
    textTransform: 'capitalize',
  },
  statusBadge: {
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  statusBadgeText: {
    color: BG,
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  openBtn: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  openBtnText: {
    color: FG,
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
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 14,
    padding: 14,
    gap: 4,
  },
  heroValue: {
    color: FG,
    fontSize: 22,
    fontWeight: '700',
    marginTop: 6,
  },
  heroLabel: {
    color: MUTED,
    fontSize: 12,
  },
  heroChange: {
    color: GREEN,
    fontSize: 11,
    marginTop: 2,
  },

  // ── Section Title ──
  sectionTitle: {
    color: FG,
    fontSize: 16,
    fontWeight: '600',
    marginTop: 24,
    marginBottom: 12,
  },

  // ── Card ──
  card: {
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 14,
    padding: 14,
    gap: 12,
  },
  unavailableTitle: {
    color: FG,
    fontSize: 15,
    fontWeight: '700',
  },
  unavailableText: {
    color: MUTED,
    fontSize: 13,
    lineHeight: 19,
  },

  // ── Engagement Bars ──
  engRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  engLabel: {
    color: MUTED,
    fontSize: 13,
    width: 110,
  },
  engBarBg: {
    flex: 1,
    height: 6,
    backgroundColor: BG,
    borderRadius: 3,
    overflow: 'hidden',
  },
  engBarFill: {
    height: 6,
    borderRadius: 3,
  },
  engValue: {
    color: FG,
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
    color: MUTED,
    fontSize: 10,
  },
  retentionStats: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 4,
  },
  retentionStat: {
    color: MUTED,
    fontSize: 12,
  },

  // ── Revenue ──
  revenueRow: {
    flexDirection: 'row',
    gap: 10,
  },
  revenueCard: {
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
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
    color: FG,
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
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countryInitialsText: {
    color: MUTED,
    fontSize: 10,
    fontWeight: '700',
  },
  countryName: {
    color: FG,
    fontSize: 13,
    width: 110,
  },
  countryPct: {
    color: FG,
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
    color: GREEN,
    fontSize: 28,
    fontWeight: '700',
  },
  peakHourSub: {
    color: MUTED,
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
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 14,
    padding: 14,
    gap: 8,
  },
  quickActionText: {
    color: FG,
    fontSize: 15,
    fontWeight: '600',
  },
});
