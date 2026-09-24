import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo, ActivityIndicator, Alert, Animated, Dimensions, Image, LayoutAnimation,
  Platform, ScrollView, Share, StyleSheet, Text, TouchableOpacity, UIManager, View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { VideoView, useVideoPlayer } from 'expo-video';
import * as Haptics from 'expo-haptics';
import { useApi } from '@/lib/api';
import { useColors } from '@/hooks/useColors';
import { useAppTheme, getOnAccentTextStyle } from '@/contexts/AppThemeContext';
import {
  BG, CARD, BORDER, FG, MUTED, SUBTLE, ON_DARK, ON_DARK_MUTED,
  SUCCESS, FONT, FS, SP, RADIUS,
} from '@/lib/theme';
import {
  ClaimedRemainingLabel,
  TimeRemainingLabel,
  URGENCY_UNITS_THRESHOLD,
} from '@/components/CommerceSignal';
import { ShopProductSheet } from '@/components/ShopProductSheet';
import type { ShopSheetSelection } from '@/components/ShopProductSheet';
import { buildCanonicalDropUrl } from '@/lib/shareDrop';
import { computeCountdownParts, type CountdownParts } from '@/lib/dropCountdown';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const { width: W } = Dimensions.get('window');
const HERO_H = Math.max(470, Math.min(590, W * 1.38));

// Reuse the app's single low-stock threshold convention (CommerceSignal.tsx).
const LOW_STOCK_THRESHOLD = URGENCY_UNITS_THRESHOLD;

interface DropProduct {
  id: string;
  name: string;
  description?: string;
  category?: string;
  images?: string[];
  isPreOrder?: boolean;
  status?: string;
  stockRemaining?: number;
  soldOut?: boolean;
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
  ownerId?: string;
  heroImageUrl?: string | null;
  heroVideoUrl?: string | null;
  launchTimezone?: string | null;
  earlyAccessMinutes?: number;
  viewerHasEarlyAccess?: boolean;
  effectiveReleaseAt?: string | null;
  seller?: { displayName?: string; brandName?: string; verified?: boolean } | null;
  products?: DropProduct[];
}

const computeParts = computeCountdownParts;

/**
 * Countdown ticking hook. Targets `effectiveReleaseAt` (falls back to
 * `releaseAt`) so early-access followers see their own earlier unlock time.
 * Fires a light haptic tick once per second in the last 10s before launch,
 * and invokes `onBecomeLive` exactly once when the countdown crosses from
 * not-live to live while mounted (used for the reveal animation).
 */
function useCountdown(target?: string | null, onBecomeLive?: () => void): CountdownParts {
  const [parts, setParts] = useState<CountdownParts>(() => computeParts(target));
  const lastHapticSecondRef = useRef<number | null>(null);
  const wasLiveRef = useRef<boolean>(computeParts(target).isLive);

  useEffect(() => {
    const tick = () => {
      const next = computeParts(target);
      setParts(next);

      if (!next.isLive && next.totalSeconds > 0 && next.totalSeconds <= 10) {
        if (lastHapticSecondRef.current !== next.totalSeconds) {
          lastHapticSecondRef.current = next.totalSeconds;
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        }
      }

      if (next.isLive && !wasLiveRef.current) {
        wasLiveRef.current = true;
        onBecomeLive?.();
      } else if (!next.isLive) {
        wasLiveRef.current = false;
      }
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

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

// ─── Flip-digit countdown ───────────────────────────────────────────────────

function FlipDigit({ digit }: { digit: string }) {
  const prevDigitRef = useRef(digit);
  const [displayDigit, setDisplayDigit] = useState(digit);
  const anim = useRef(new Animated.Value(1)).current; // 1 = settled

  useEffect(() => {
    if (prevDigitRef.current === digit) return;
    prevDigitRef.current = digit;
    anim.setValue(0);
    setDisplayDigit(digit);
    Animated.timing(anim, {
      toValue: 1,
      duration: 260,
      useNativeDriver: true,
    }).start();
  }, [digit, anim]);

  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [-10, 0] });
  const opacity = anim.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 0.4, 1] });

  return (
    <View style={styles.flipDigitClip}>
      <Animated.Text style={[styles.timerNumber, { opacity, transform: [{ translateY }] }]}>
        {displayDigit}
      </Animated.Text>
    </View>
  );
}

function FlipNumber({ value }: { value: number }) {
  const str = String(value).padStart(2, '0');
  return (
    <View style={{ flexDirection: 'row' }}>
      {str.split('').map((d, i) => <FlipDigit key={i} digit={d} />)}
    </View>
  );
}

function Countdown({
  parts, earlyAccessMinutes, viewerHasEarlyAccess,
}: {
  parts: CountdownParts;
  earlyAccessMinutes?: number;
  viewerHasEarlyAccess?: boolean;
}) {
  const { theme } = useAppTheme();
  const { days, hours, minutes, seconds, isLive } = parts;
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
            <FlipNumber value={unit.value} />
            <Text style={styles.timerLabel}>{unit.label}</Text>
          </View>
        ))}
      </View>
      <View style={[styles.timerRule, { backgroundColor: theme.accent }]} />
      {viewerHasEarlyAccess && !!earlyAccessMinutes && (
        <View style={styles.earlyAccessRow}>
          <Feather name="star" size={12} color={theme.accent} />
          <Text style={[styles.earlyAccessText, { color: theme.accent }]}>
            Early access — you get in {earlyAccessMinutes} min before everyone else
          </Text>
        </View>
      )}
    </View>
  );
}

function ProductTile({
  product, locked, isLive, onPress,
}: {
  product: DropProduct;
  locked: boolean;
  isLive: boolean;
  onPress: () => void;
}) {
  const { theme } = useAppTheme();
  const imageUri = product.images?.find(Boolean);
  const soldOut = isLive && !!product.soldOut;
  const lowStock = isLive && !soldOut && typeof product.stockRemaining === 'number' && product.stockRemaining <= LOW_STOCK_THRESHOLD;
  const revealAnim = useRef(new Animated.Value(locked ? 1 : 0)).current;

  useEffect(() => {
    if (!locked) {
      Animated.spring(revealAnim, { toValue: 1, friction: 7, tension: 60, useNativeDriver: true }).start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked]);

  return (
    <Animated.View
      style={{
        width: (W - SP.md * 2 - 10) / 2,
        opacity: locked ? 1 : revealAnim,
        transform: [{ scale: locked ? 1 : revealAnim.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }],
      }}
    >
      <TouchableOpacity
        style={[styles.productTile, soldOut && { opacity: 0.55 }]}
        onPress={onPress}
        activeOpacity={0.86}
        disabled={soldOut}
        accessibilityRole="button"
        accessibilityLabel={locked ? 'Locked — unlocks at launch' : `${product.name}${soldOut ? ', sold out' : ''}`}
      >
        <View style={styles.productMedia}>
          {imageUri ? (
            <Image source={{ uri: imageUri }} style={StyleSheet.absoluteFill} resizeMode="cover" blurRadius={locked ? 22 : 0} />
          ) : (
            <View style={styles.productFallback}><Feather name="image" size={28} color={SUBTLE} /></View>
          )}
          {soldOut && (
            <View style={StyleSheet.absoluteFill}>
              <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.45)' }]} />
            </View>
          )}
          <LinearGradient colors={['transparent', 'rgba(0,0,0,0.72)']} style={StyleSheet.absoluteFill} />

          {locked && (
            <View style={styles.lockOverlay}>
              <View style={styles.lockBadge}>
                <Feather name="lock" size={18} color={ON_DARK} />
              </View>
            </View>
          )}

          {!locked && lowStock && (
            <View style={[styles.stockBadge, { backgroundColor: `${theme.accent}E6` }]}>
              <Text style={[styles.stockBadgeText, { color: theme.onAccent }]}>{product.stockRemaining} left</Text>
            </View>
          )}
          {!locked && soldOut && (
            <View style={[styles.stockBadge, styles.soldOutBadge]}>
              <Text style={styles.soldOutBadgeText}>SOLD OUT</Text>
            </View>
          )}

          <View style={styles.productCaption}>
            <Text style={styles.productName} numberOfLines={2}>
              {locked ? '???' : product.name}
            </Text>
            <Text style={styles.productCategory}>
              {locked
                ? (product.category ?? 'COMING SOON')
                : (product.category ?? (product.isPreOrder ? 'PRE-ORDER' : 'LIMITED'))}
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    </Animated.View>
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
  const launchFlash = useRef(new Animated.Value(0)).current;

  const [drop, setDrop] = useState<DropDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [notifyLoading, setNotifyLoading] = useState(false);
  const [reloadGeneration, setReloadGeneration] = useState(0);
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);
  const [shopSelection, setShopSelection] = useState<ShopSheetSelection | null>(null);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled?.().then(setReduceMotion).catch(() => setReduceMotion(false));
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', setReduceMotion);
    return () => sub?.remove?.();
  }, []);

  useEffect(() => {
    let active = true;
    if (!dropId) {
      setLoading(false);
      setLoadError(true);
      return () => { active = false; };
    }
    setLoading(true);
    setLoadError(false);
    Promise.all([
      api.publicDrops.get(dropId),
      api.publicDrops.notificationStatus(dropId).catch(() => ({ subscribed: false })),
    ]).then(([data, notification]) => {
      if (!active) return;
      if (!data) {
        setDrop(null);
        setLoadError(true);
        return;
      }
      setDrop(data as DropDetail);
      setSubscribed(notification.subscribed);
      Animated.timing(entrance, { toValue: 1, duration: 650, useNativeDriver: true }).start();
    }).catch(() => { if (active) { setDrop(null); setLoadError(true); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [dropId, reloadGeneration]);

  const products = drop?.products ?? [];
  const sellerName = drop?.seller?.brandName ?? drop?.seller?.displayName ?? 'Independent brand';

  const isEnded = drop?.status === 'closed' || drop?.status === 'fulfilled' ||
    (!!drop?.endsAt && new Date(drop.endsAt).getTime() <= Date.now());

  function handleBecomeLive() {
    if (isEnded) return;
    if (!reduceMotion) {
      LayoutAnimation.configureNext({
        duration: 480,
        update: { type: LayoutAnimation.Types.spring, springDamping: 0.7 },
      });
      Animated.sequence([
        Animated.timing(launchFlash, { toValue: 1, duration: 140, useNativeDriver: true }),
        Animated.timing(launchFlash, { toValue: 0, duration: 460, useNativeDriver: true }),
      ]).start();
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }

  const targetReleaseAt = drop?.effectiveReleaseAt ?? drop?.releaseAt;
  const countdown = useCountdown(isEnded ? null : targetReleaseAt, handleBecomeLive);
  const isLive = isEnded ? true : countdown.isLive;
  const showRecap = isEnded;

  const heroUri = drop?.heroVideoUrl || drop?.heroImageUrl || products.flatMap(product => product.images ?? []).find(Boolean);
  const heroIsVideo = !!drop?.heroVideoUrl && heroUri === drop.heroVideoUrl;

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

  function handleShare() {
    if (!drop) return;
    const url = buildCanonicalDropUrl(drop.id);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (url) {
      Share.share({ message: `Check out ${drop.name} on Brandthread: ${url}`, url });
    } else {
      Share.share({ message: `Check out ${drop.name} on Brandthread` });
    }
  }

  function handleProductPress(product: DropProduct) {
    if (showRecap) {
      router.push((`/buyer-product-detail?productId=${product.id}&productName=${encodeURIComponent(product.name)}`) as never);
      return;
    }
    if (!isLive) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      return;
    }
    if (product.soldOut) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    // postId is only used by ShopProductSheet/cartFlight for attribution and
    // flight-animation bookkeeping, never as a server-side post lookup — a
    // stable synthetic id is safe here.
    setShopSelection({
      postId: `drop-${drop!.id}`,
      postSellerId: drop!.ownerId,
      tags: [{ productId: product.id, productName: product.name, priceCents: 0 }],
      activeTagIndex: 0,
    });
  }

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color={colors.primary} size="large" /></View>;
  }
  if (!drop) {
    return (
      <View style={[styles.center, { paddingHorizontal: 32, gap: 16 }]}>
        <Feather name="alert-triangle" size={32} color={theme.muted} />
        <Text style={{ color: theme.text, fontSize: 17, fontWeight: '600', textAlign: 'center' }}>
          {loadError ? "Couldn't load this drop." : "This drop isn't available."}
        </Text>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          {loadError && (
            <TouchableOpacity
              onPress={() => setReloadGeneration(g => g + 1)}
              accessibilityRole="button"
              accessibilityLabel="Try again"
              style={{ paddingHorizontal: 20, paddingVertical: 12, borderRadius: 14, backgroundColor: theme.accent }}
            >
              <Text style={[{ fontWeight: '600' }, { color: theme.onAccent }, getOnAccentTextStyle(theme)]}>Try again</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Back"
            style={{ paddingHorizontal: 20, paddingVertical: 12, borderRadius: 14, borderWidth: 1, borderColor: theme.border }}
          >
            <Text style={{ color: theme.text, fontWeight: '600' }}>Back</Text>
          </TouchableOpacity>
        </View>
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

          {!reduceMotion && (
            <Animated.View
              pointerEvents="none"
              style={[StyleSheet.absoluteFill, { backgroundColor: theme.accent, opacity: launchFlash }]}
            />
          )}

          <View style={[styles.heroHeader, { paddingTop: insets.top + SP.sm }]}>
            <TouchableOpacity style={styles.roundButton} onPress={() => router.back()} accessibilityLabel="Go back">
              <Feather name="arrow-left" size={21} color={ON_DARK} />
            </TouchableOpacity>
            <View style={styles.heroBadge}>
              <Text style={styles.heroBadgeText}>{showRecap ? 'DROP ENDED' : (isLive ? 'LIVE DROP' : 'UPCOMING')}</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity style={styles.roundButton} onPress={handleShare} accessibilityLabel="Share this drop">
                <Feather name="share" size={18} color={ON_DARK} />
              </TouchableOpacity>
              {!showRecap && (
                <TouchableOpacity style={styles.roundButton} onPress={toggleNotification} accessibilityLabel="Toggle drop alert">
                  <Feather name={subscribed ? 'bell-off' : 'bell'} size={19} color={ON_DARK} />
                </TouchableOpacity>
              )}
            </View>
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

            {showRecap ? (
              <View style={styles.livePanel}>
                <Feather name="check-circle" size={20} color={SUCCESS} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.liveTitle}>{drop.orderCount ?? 0} pieces claimed</Text>
                  <Text style={styles.liveSub}>This drop has ended</Text>
                </View>
              </View>
            ) : (
              <Countdown
                parts={countdown}
                earlyAccessMinutes={drop.earlyAccessMinutes}
                viewerHasEarlyAccess={drop.viewerHasEarlyAccess}
              />
            )}

            {/* Demand signals — only shown when server supplies non-zero values */}
            {!showRecap && ((drop.claimedUnits ?? 0) > 0 || (drop.remainingUnits ?? 0) > 0 || !!drop.endsAt) && (
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

            {!showRecap && (
              <View style={styles.actionRow}>
                {!isLive ? (
                  <TouchableOpacity
                    style={[styles.primaryButton, { backgroundColor: subscribed ? CARD : theme.accent }]}
                    onPress={toggleNotification}
                    disabled={notifyLoading}
                    testID="drop-notify-button"
                  >
                    {notifyLoading ? <ActivityIndicator color={subscribed ? ON_DARK : theme.onAccent} /> : (
                      <>
                        <Feather name={subscribed ? 'check' : 'bell'} size={18} color={subscribed ? ON_DARK : theme.onAccent} />
                        <Text style={[styles.primaryButtonText, !subscribed && { color: theme.onAccent }]}>
                          {subscribed ? 'You’ll be notified' : 'Notify me'}
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={[styles.primaryButton, { backgroundColor: theme.accent }]}
                    onPress={() => scrollRef.current?.scrollTo({ y: HERO_H - 24, animated: true })}
                    testID="shop-live-drop-button"
                  >
                    <Feather name="shopping-bag" size={18} color={theme.onAccent} />
                    <Text style={[styles.primaryButtonText, { color: theme.onAccent }]}>Shop the drop</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
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
              <Text style={styles.collectionEyebrow}>
                {showRecap ? 'THE COLLECTION' : (isLive ? 'AVAILABLE NOW' : 'PREVIEW THE COLLECTION')}
              </Text>
              <Text style={styles.collectionTitle}>{products.length} {products.length === 1 ? 'piece' : 'pieces'}</Text>
            </View>
            {isLive && !showRecap && (
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
                  locked={!showRecap && !isLive}
                  isLive={isLive && !showRecap}
                  onPress={() => handleProductPress(product)}
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

      {shopSelection && (
        <ShopProductSheet
          selection={shopSelection}
          onClose={() => setShopSelection(null)}
          reduceMotion={reduceMotion}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  center: { flex: 1, backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center', paddingHorizontal: SP.xl, gap: SP.md },
  hero: { height: HERO_H, backgroundColor: CARD, position: 'relative', justifyContent: 'flex-end' },
  heroHeader: { position: 'absolute', top: 0, left: SP.md, right: SP.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', zIndex: 2 },
  roundButton: { width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(0,0,0,0.48)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  heroBadge: { backgroundColor: 'rgba(0,0,0,0.58)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)', borderRadius: RADIUS.pill, paddingHorizontal: 13, paddingVertical: 7 },
  heroBadgeText: { color: ON_DARK, fontFamily: FONT.bold, fontSize: FS.xs, letterSpacing: 1.5 },
  heroCopy: { padding: 20, paddingBottom: 28 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: SP.md },
  brandMark: { width: 38, height: 38, borderRadius: 19, borderWidth: 1.5, backgroundColor: 'rgba(0,0,0,0.62)', alignItems: 'center', justifyContent: 'center' },
  brandInitials: { color: ON_DARK, fontFamily: FONT.bold, fontSize: 11 },
  brandNameRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  brandName: { color: ON_DARK, fontFamily: FONT.semibold, fontSize: FS.sm },
  dropType: { color: ON_DARK_MUTED, fontFamily: FONT.medium, fontSize: FS.xs, letterSpacing: 1.2, marginTop: 2 },
  dropName: { color: ON_DARK, fontFamily: FONT.extrabold, fontSize: 39, lineHeight: 41, letterSpacing: -1.5, marginBottom: SP.lg, maxWidth: W - 40 },
  eyebrow: { color: ON_DARK_MUTED, fontFamily: FONT.semibold, fontSize: FS.xs, letterSpacing: 1.7, marginBottom: 9 },
  timerRow: { flexDirection: 'row', justifyContent: 'space-between' },
  timerUnit: { minWidth: 58 },
  flipDigitClip: { overflow: 'hidden', height: 48 },
  timerNumber: { color: ON_DARK, fontFamily: FONT.light, fontSize: 42, lineHeight: 48, letterSpacing: -1.8, fontVariant: ['tabular-nums'] },
  timerLabel: { color: ON_DARK_MUTED, fontFamily: FONT.semibold, fontSize: FS.xs, letterSpacing: 1.25 },
  timerRule: { height: 2, marginTop: 13, width: 58 },
  earlyAccessRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 },
  earlyAccessText: { fontFamily: FONT.semibold, fontSize: FS.xs, flexShrink: 1 },
  livePanel: { backgroundColor: 'rgba(255,59,48,0.12)', borderWidth: 1, borderColor: 'rgba(255,59,48,0.4)', borderRadius: RADIUS.md, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 13 },
  livePulse: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#FF3B30' },
  liveTitle: { color: ON_DARK, fontFamily: FONT.extrabold, fontSize: FS.md, letterSpacing: 1.3 },
  liveSub: { color: ON_DARK_MUTED, fontFamily: FONT.regular, fontSize: FS.xs, marginTop: 2 },
  actionRow: { flexDirection: 'row', marginTop: SP.lg },
  primaryButton: { flex: 1, minHeight: 52, borderRadius: RADIUS.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  primaryButtonText: { color: ON_DARK, fontFamily: FONT.bold, fontSize: FS.base },
  content: { paddingTop: SP.lg },
  releaseMeta: { marginHorizontal: SP.md, paddingBottom: SP.lg, flexDirection: 'row', alignItems: 'center', gap: SP.md, borderBottomWidth: 1, borderBottomColor: BORDER },
  metaLabel: { color: SUBTLE, fontFamily: FONT.semibold, fontSize: FS.xs, letterSpacing: 1.2, marginBottom: 4 },
  metaValue: { color: FG, fontFamily: FONT.semibold, fontSize: FS.sm },
  metaDivider: { width: 1, height: 30, backgroundColor: BORDER },
  collectionHeader: { paddingHorizontal: SP.md, paddingTop: SP.xl, paddingBottom: SP.md, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  collectionEyebrow: { color: SUBTLE, fontFamily: FONT.semibold, fontSize: FS.xs, letterSpacing: 1.4 },
  collectionTitle: { color: FG, fontFamily: FONT.bold, fontSize: FS.xxl, marginTop: 4, letterSpacing: -0.5 },
  stockPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 9, paddingVertical: 6, borderRadius: RADIUS.pill, borderWidth: 1 },
  stockDot: { width: 6, height: 6, borderRadius: 3 },
  stockText: { fontFamily: FONT.bold, fontSize: FS.xs, letterSpacing: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: SP.md },
  productTile: { borderRadius: RADIUS.sm, overflow: 'hidden', backgroundColor: CARD },
  productMedia: { height: (W - SP.md * 2 - 10) * 0.68, justifyContent: 'flex-end' },
  productFallback: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', backgroundColor: CARD },
  productCaption: { padding: 11 },
  productName: { color: ON_DARK, fontFamily: FONT.bold, fontSize: FS.sm, lineHeight: 17 },
  productCategory: { color: ON_DARK_MUTED, fontFamily: FONT.semibold, fontSize: FS.xs, letterSpacing: 1.1, marginTop: 5 },
  lockOverlay: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  lockBadge: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.55)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', alignItems: 'center', justifyContent: 'center' },
  stockBadge: { position: 'absolute', top: 8, right: 8, paddingHorizontal: 8, paddingVertical: 4, borderRadius: RADIUS.pill },
  stockBadgeText: { fontFamily: FONT.bold, fontSize: 10, letterSpacing: 0.4 },
  soldOutBadge: { backgroundColor: 'rgba(0,0,0,0.72)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)' },
  soldOutBadgeText: { color: ON_DARK, fontFamily: FONT.bold, fontSize: 10, letterSpacing: 0.6 },
  emptyProducts: { margin: SP.md, padding: SP.xl, borderRadius: RADIUS.lg, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, alignItems: 'center', gap: SP.sm },
  emptyTitle: { color: FG, fontFamily: FONT.bold, fontSize: FS.md },
  emptyText: { color: MUTED, fontFamily: FONT.regular, fontSize: FS.sm, textAlign: 'center', lineHeight: 20 },
});
