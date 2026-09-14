import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Animated, Dimensions, Image, ScrollView,
  StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { VideoView, useVideoPlayer } from 'expo-video';
import * as Haptics from 'expo-haptics';
import { useApi } from '@/lib/api';
import { useColors } from '@/hooks/useColors';
import { useAppTheme } from '@/contexts/AppThemeContext';
import {
  BG, CARD, BORDER, FG, MUTED, SUBTLE, ON_DARK, ON_DARK_MUTED,
  SUCCESS, FONT, FS, SP, RADIUS,
} from '@/lib/theme';
import {
  ClaimedRemainingLabel,
  TimeRemainingLabel,
  URGENCY_UNITS_THRESHOLD,
} from '@/components/CommerceSignal';

const { width: W } = Dimensions.get('window');
const HERO_H = Math.max(470, Math.min(590, W * 1.38));

interface CountdownParts {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  isLive: boolean;
}

interface DropProduct {
  id: string;
  name: string;
  description?: string;
  category?: string;
  images?: string[];
  isPreOrder?: boolean;
}

interface DropDetail {
  id: string;
  name: string;
  type: 'pre-order' | 'pre-made';
  status: string;
  releaseAt?: string | null;
  endsAt?: string | null;
  estimatedShipDate?: string | null;
  orderCount?: number;
  claimedUnits?: number;
  remainingUnits?: number;
  createdAt: string;
  seller?: { displayName?: string; brandName?: string; verified?: boolean } | null;
  products?: DropProduct[];
}

function useCountdown(releaseAt?: string | null): CountdownParts {
  const compute = (): CountdownParts => {
    const difference = releaseAt ? new Date(releaseAt).getTime() - Date.now() : 0;
    if (difference <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0, isLive: true };
    const totalSeconds = Math.floor(difference / 1000);
    return {
      days: Math.floor(totalSeconds / 86400),
      hours: Math.floor((totalSeconds % 86400) / 3600),
      minutes: Math.floor((totalSeconds % 3600) / 60),
      seconds: totalSeconds % 60,
      isLive: false,
    };
  };
  const [parts, setParts] = useState<CountdownParts>(compute);

  useEffect(() => {
    setParts(compute());
    const interval = setInterval(() => setParts(compute()), 1000);
    return () => clearInterval(interval);
  }, [releaseAt]);

  return parts;
}

function HeroVideo({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, instance => {
    instance.loop = true;
    instance.muted = true;
    instance.play();
  });
  return <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />;
}

function Countdown({ releaseAt }: { releaseAt?: string | null }) {
  const { theme } = useAppTheme();
  const { days, hours, minutes, seconds, isLive } = useCountdown(releaseAt);
  const units = [
    { label: 'DAYS', value: days },
    { label: 'HOURS', value: hours },
    { label: 'MIN', value: minutes },
    { label: 'SEC', value: seconds },
  ];

  if (isLive) {
    return (
      <View style={styles.livePanel}>
        <View style={styles.livePulse} />
        <View style={{ flex: 1 }}>
          <Text style={styles.liveTitle}>LIVE NOW</Text>
          <Text style={styles.liveSub}>Limited release · while stock lasts</Text>
        </View>
        <Feather name="zap" size={22} color={ON_DARK} />
      </View>
    );
  }

  return (
    <View>
      <Text style={styles.eyebrow}>THE DROP OPENS IN</Text>
      <View style={styles.timerRow}>
        {units.map(unit => (
          <View key={unit.label} style={styles.timerUnit}>
            <Text style={styles.timerNumber}>{String(unit.value).padStart(2, '0')}</Text>
            <Text style={styles.timerLabel}>{unit.label}</Text>
          </View>
        ))}
      </View>
      <View style={[styles.timerRule, { backgroundColor: theme.accent }]} />
    </View>
  );
}

function ProductTile({ product, onPress }: { product: DropProduct; onPress: () => void }) {
  const imageUri = product.images?.find(Boolean);
  return (
    <TouchableOpacity style={styles.productTile} onPress={onPress} activeOpacity={0.86}>
      <View style={styles.productMedia}>
        {imageUri ? (
          <Image source={{ uri: imageUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : (
          <View style={styles.productFallback}><Feather name="image" size={28} color={SUBTLE} /></View>
        )}
        <LinearGradient colors={['transparent', 'rgba(0,0,0,0.72)']} style={StyleSheet.absoluteFill} />
        <View style={styles.productCaption}>
          <Text style={styles.productName} numberOfLines={2}>{product.name}</Text>
          <Text style={styles.productCategory}>{product.category ?? (product.isPreOrder ? 'PRE-ORDER' : 'LIMITED')}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

export default function BuyerDropDetail() {
  const colors = useColors();
  const { theme } = useAppTheme();
  const { dropId, dropName } = useLocalSearchParams<{ dropId: string; dropName?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const api = useApi();
  const scrollRef = useRef<ScrollView>(null);
  const entrance = useRef(new Animated.Value(0)).current;

  const [drop, setDrop] = useState<DropDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [notifyLoading, setNotifyLoading] = useState(false);

  useEffect(() => {
    if (!dropId) {
      setError('No drop ID provided.');
      setLoading(false);
      return;
    }
    Promise.all([
      api.publicDrops.get(dropId),
      api.publicDrops.notificationStatus(dropId).catch(() => ({ subscribed: false })),
    ]).then(([data, notification]) => {
      setDrop(data as DropDetail);
      setSubscribed(notification.subscribed);
      Animated.timing(entrance, { toValue: 1, duration: 650, useNativeDriver: true }).start();
    }).catch(() => setError('Could not load this drop. It may no longer be active.'))
      .finally(() => setLoading(false));
  }, [dropId]);

  const countdown = useCountdown(drop?.releaseAt);
  const products = drop?.products ?? [];
  const sellerName = drop?.seller?.brandName ?? drop?.seller?.displayName ?? 'Independent brand';
  const heroUri = products.flatMap(product => product.images ?? []).find(Boolean);
  const heroIsVideo = !!heroUri && /\.(mp4|mov|m4v|webm)(\?|$)/i.test(heroUri);

  async function toggleNotification() {
    if (!dropId || notifyLoading) return;
    setNotifyLoading(true);
    try {
      const result = subscribed
        ? await api.publicDrops.unsubscribe(dropId)
        : await api.publicDrops.subscribe(dropId);
      setSubscribed(result.subscribed);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      Alert.alert('Sign in to get drop alerts', 'Create or sign in to your buyer account, then tap Notify me again.');
    } finally {
      setNotifyLoading(false);
    }
  }

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color={colors.primary} size="large" /></View>;
  }
  if (error || !drop) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <Feather name="alert-circle" size={34} color={MUTED} />
        <Text style={styles.errorText}>{error ?? 'Drop unavailable.'}</Text>
        <TouchableOpacity style={styles.errorBack} onPress={() => router.back()}>
          <Text style={styles.errorBackText}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScrollView ref={scrollRef} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 48 }}>
        <View style={styles.hero}>
          {heroUri ? (
            heroIsVideo ? <HeroVideo uri={heroUri} /> : <Image source={{ uri: heroUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          ) : (
            <LinearGradient colors={['#23202A', '#050506']} style={StyleSheet.absoluteFill} />
          )}
          <LinearGradient colors={['rgba(0,0,0,0.18)', 'rgba(0,0,0,0.20)', 'rgba(0,0,0,0.96)']} locations={[0, 0.42, 1]} style={StyleSheet.absoluteFill} />

          <View style={[styles.heroHeader, { paddingTop: insets.top + SP.sm }]}>
            <TouchableOpacity style={styles.roundButton} onPress={() => router.back()} accessibilityLabel="Go back">
              <Feather name="arrow-left" size={21} color={ON_DARK} />
            </TouchableOpacity>
            <View style={styles.heroBadge}>
              <Text style={styles.heroBadgeText}>{countdown.isLive ? 'LIVE DROP' : 'UPCOMING'}</Text>
            </View>
            <TouchableOpacity style={styles.roundButton} onPress={toggleNotification} accessibilityLabel="Toggle drop alert">
              <Feather name={subscribed ? 'bell-off' : 'bell'} size={19} color={ON_DARK} />
            </TouchableOpacity>
          </View>

          <Animated.View
            style={[
              styles.heroCopy,
              { opacity: entrance, transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }] },
            ]}
          >
            <View style={styles.brandRow}>
              <View style={[styles.brandMark, { borderColor: `${theme.accent}AA` }]}>
                <Text style={styles.brandInitials}>{sellerName.slice(0, 2).toUpperCase()}</Text>
              </View>
              <View>
                <View style={styles.brandNameRow}>
                  <Text style={styles.brandName}>{sellerName}</Text>
                  {drop.seller?.verified && <Feather name="check-circle" size={14} color={theme.secondary} />}
                </View>
                <Text style={styles.dropType}>{drop.type === 'pre-order' ? 'PRE-ORDER EDITION' : 'READY TO SHIP'}</Text>
              </View>
            </View>

            <Text style={styles.dropName}>{drop.name ?? dropName}</Text>
            <Countdown releaseAt={drop.releaseAt} />

            {/* Demand signals — only shown when server supplies non-zero values */}
            {((drop.claimedUnits ?? 0) > 0 || (drop.remainingUnits ?? 0) > 0 || !!drop.endsAt) && (
              <View style={{ marginTop: SP.sm, gap: 5 }}>
                <ClaimedRemainingLabel
                  claimedUnits={drop.claimedUnits ?? 0}
                  remainingUnits={drop.remainingUnits ?? 0}
                  urgent={(drop.remainingUnits ?? 0) > 0 && (drop.remainingUnits ?? 0) <= URGENCY_UNITS_THRESHOLD}
                  accent={theme.accent}
                />
                {!!drop.endsAt && (
                  <TimeRemainingLabel endsAt={drop.endsAt} accent={theme.accent} />
                )}
              </View>
            )}

            <View style={styles.actionRow}>
              {!countdown.isLive ? (
                <TouchableOpacity
                  style={[styles.primaryButton, { backgroundColor: subscribed ? CARD : theme.accent }]}
                  onPress={toggleNotification}
                  disabled={notifyLoading}
                  testID="drop-notify-button"
                >
                  {notifyLoading ? <ActivityIndicator color={ON_DARK} /> : (
                    <>
                      <Feather name={subscribed ? 'check' : 'bell'} size={18} color={ON_DARK} />
                      <Text style={styles.primaryButtonText}>{subscribed ? 'You’ll be notified' : 'Notify me'}</Text>
                    </>
                  )}
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[styles.primaryButton, { backgroundColor: theme.accent }]}
                  onPress={() => scrollRef.current?.scrollTo({ y: HERO_H - 24, animated: true })}
                  testID="shop-live-drop-button"
                >
                  <Feather name="shopping-bag" size={18} color={ON_DARK} />
                  <Text style={styles.primaryButtonText}>Shop the drop</Text>
                </TouchableOpacity>
              )}
            </View>
          </Animated.View>
        </View>

        <View style={styles.content}>
          <View style={styles.releaseMeta}>
            <View>
              <Text style={styles.metaLabel}>RELEASE</Text>
              <Text style={styles.metaValue}>
                {drop.releaseAt ? new Date(drop.releaseAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Available now'}
              </Text>
            </View>
            <View style={styles.metaDivider} />
            <View>
              <Text style={styles.metaLabel}>EST. SHIP</Text>
              <Text style={styles.metaValue}>
                {drop.estimatedShipDate ? new Date(drop.estimatedShipDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'Shown at checkout'}
              </Text>
            </View>
            {!!drop.orderCount && (
              <>
                <View style={styles.metaDivider} />
                <View>
                  <Text style={styles.metaLabel}>ORDERS</Text>
                  <Text style={styles.metaValue}>{drop.orderCount}</Text>
                </View>
              </>
            )}
          </View>

          <View style={styles.collectionHeader}>
            <View>
              <Text style={styles.collectionEyebrow}>{countdown.isLive ? 'AVAILABLE NOW' : 'PREVIEW THE COLLECTION'}</Text>
              <Text style={styles.collectionTitle}>{products.length} {products.length === 1 ? 'piece' : 'pieces'}</Text>
            </View>
            {countdown.isLive && (
              <View style={[styles.stockPill, { backgroundColor: `${theme.accent}20`, borderColor: `${theme.accent}44` }]}>
                <View style={[styles.stockDot, { backgroundColor: theme.accent }]} />
                <Text style={[styles.stockText, { color: theme.accent }]}>LIMITED</Text>
              </View>
            )}
          </View>

          {products.length ? (
            <View style={styles.grid}>
              {products.map(product => (
                <ProductTile
                  key={product.id}
                  product={product}
                  onPress={() => router.push((`/buyer-product-detail?productId=${product.id}&productName=${encodeURIComponent(product.name)}`) as never)}
                />
              ))}
            </View>
          ) : (
            <View style={styles.emptyProducts}>
              <Feather name="package" size={32} color={MUTED} />
              <Text style={styles.emptyTitle}>The reveal is coming</Text>
              <Text style={styles.emptyText}>Products will appear here as the brand unveils this drop.</Text>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  center: { flex: 1, backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center', paddingHorizontal: SP.xl, gap: SP.md },
  errorText: { color: MUTED, fontFamily: FONT.regular, fontSize: FS.sm, textAlign: 'center' },
  errorBack: { borderWidth: 1, borderColor: BORDER, borderRadius: RADIUS.pill, paddingHorizontal: SP.lg, paddingVertical: SP.sm },
  errorBackText: { color: FG, fontFamily: FONT.semibold, fontSize: FS.sm },
  hero: { height: HERO_H, backgroundColor: CARD, position: 'relative', justifyContent: 'flex-end' },
  heroHeader: { position: 'absolute', top: 0, left: SP.md, right: SP.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', zIndex: 2 },
  roundButton: { width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(0,0,0,0.48)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  heroBadge: { backgroundColor: 'rgba(0,0,0,0.58)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)', borderRadius: RADIUS.pill, paddingHorizontal: 13, paddingVertical: 7 },
  heroBadgeText: { color: ON_DARK, fontFamily: FONT.bold, fontSize: 10, letterSpacing: 1.5 },
  heroCopy: { padding: 20, paddingBottom: 28 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: SP.md },
  brandMark: { width: 38, height: 38, borderRadius: 19, borderWidth: 1.5, backgroundColor: 'rgba(0,0,0,0.62)', alignItems: 'center', justifyContent: 'center' },
  brandInitials: { color: ON_DARK, fontFamily: FONT.bold, fontSize: 11 },
  brandNameRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  brandName: { color: ON_DARK, fontFamily: FONT.semibold, fontSize: FS.sm },
  dropType: { color: ON_DARK_MUTED, fontFamily: FONT.medium, fontSize: 9, letterSpacing: 1.2, marginTop: 2 },
  dropName: { color: ON_DARK, fontFamily: FONT.extrabold, fontSize: 39, lineHeight: 41, letterSpacing: -1.5, marginBottom: SP.lg, maxWidth: W - 40 },
  eyebrow: { color: ON_DARK_MUTED, fontFamily: FONT.semibold, fontSize: 10, letterSpacing: 1.7, marginBottom: 9 },
  timerRow: { flexDirection: 'row', justifyContent: 'space-between' },
  timerUnit: { minWidth: 58 },
  timerNumber: { color: ON_DARK, fontFamily: FONT.light, fontSize: 42, lineHeight: 48, letterSpacing: -1.8, fontVariant: ['tabular-nums'] },
  timerLabel: { color: ON_DARK_MUTED, fontFamily: FONT.semibold, fontSize: 8, letterSpacing: 1.25 },
  timerRule: { height: 2, marginTop: 13, width: 58 },
  livePanel: { backgroundColor: 'rgba(255,59,48,0.12)', borderWidth: 1, borderColor: 'rgba(255,59,48,0.4)', borderRadius: RADIUS.md, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 13 },
  livePulse: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#FF3B30' },
  liveTitle: { color: ON_DARK, fontFamily: FONT.extrabold, fontSize: FS.md, letterSpacing: 1.3 },
  liveSub: { color: ON_DARK_MUTED, fontFamily: FONT.regular, fontSize: FS.xs, marginTop: 2 },
  actionRow: { flexDirection: 'row', marginTop: SP.lg },
  primaryButton: { flex: 1, minHeight: 52, borderRadius: RADIUS.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  primaryButtonText: { color: ON_DARK, fontFamily: FONT.bold, fontSize: FS.base },
  content: { paddingTop: SP.lg },
  releaseMeta: { marginHorizontal: SP.md, paddingBottom: SP.lg, flexDirection: 'row', alignItems: 'center', gap: SP.md, borderBottomWidth: 1, borderBottomColor: BORDER },
  metaLabel: { color: SUBTLE, fontFamily: FONT.semibold, fontSize: 9, letterSpacing: 1.2, marginBottom: 4 },
  metaValue: { color: FG, fontFamily: FONT.semibold, fontSize: FS.sm },
  metaDivider: { width: 1, height: 30, backgroundColor: BORDER },
  collectionHeader: { paddingHorizontal: SP.md, paddingTop: SP.xl, paddingBottom: SP.md, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  collectionEyebrow: { color: SUBTLE, fontFamily: FONT.semibold, fontSize: 9, letterSpacing: 1.4 },
  collectionTitle: { color: FG, fontFamily: FONT.bold, fontSize: FS.xxl, marginTop: 4, letterSpacing: -0.5 },
  stockPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 9, paddingVertical: 6, borderRadius: RADIUS.pill, borderWidth: 1 },
  stockDot: { width: 6, height: 6, borderRadius: 3 },
  stockText: { fontFamily: FONT.bold, fontSize: 9, letterSpacing: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: SP.md },
  productTile: { width: (W - SP.md * 2 - 10) / 2, borderRadius: RADIUS.sm, overflow: 'hidden', backgroundColor: CARD },
  productMedia: { height: (W - SP.md * 2 - 10) * 0.68, justifyContent: 'flex-end' },
  productFallback: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', backgroundColor: CARD },
  productCaption: { padding: 11 },
  productName: { color: ON_DARK, fontFamily: FONT.bold, fontSize: FS.sm, lineHeight: 17 },
  productCategory: { color: ON_DARK_MUTED, fontFamily: FONT.semibold, fontSize: 8, letterSpacing: 1.1, marginTop: 5 },
  emptyProducts: { margin: SP.md, padding: SP.xl, borderRadius: RADIUS.lg, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, alignItems: 'center', gap: SP.sm },
  emptyTitle: { color: FG, fontFamily: FONT.bold, fontSize: FS.md },
  emptyText: { color: MUTED, fontFamily: FONT.regular, fontSize: FS.sm, textAlign: 'center', lineHeight: 20 },
});