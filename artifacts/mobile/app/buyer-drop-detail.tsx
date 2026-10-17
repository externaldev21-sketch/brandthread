import React, { useEffect, useRef, useState } from 'react';
import { goBackOr } from '@/lib/navigation/goBackOr';

import { AccessibilityInfo, ActivityIndicator, Alert, Animated, LayoutAnimation, Platform, ScrollView, Share, StyleSheet, Text, TouchableOpacity, UIManager, View, useWindowDimensions } from 'react-native';

import { CachedImage } from '@/components/CachedImage';

import { useLocalSearchParams, useRouter } from 'expo-router';

import { pickRouteParam } from '@/lib/routeParamAliases';

import { Icon } from '@/components/ui/Icon';

import { LinearGradient } from 'expo-linear-gradient';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { VideoView, useVideoPlayer } from 'expo-video';

import { haptics, haptic } from '@/lib/haptics';


import { useApi } from '@/lib/api';

import { useColors } from '@/hooks/useColors';

import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';

import { useAppTheme } from '@/contexts/AppThemeContext';

import { BG, CARD, BORDER, FG, MUTED, SUBTLE, ON_DARK, ON_DARK_MUTED, SUCCESS, FONT, FS, SP, RADIUS } from '@/lib/theme';

import { ClaimedRemainingLabel, TimeRemainingLabel, URGENCY_UNITS_THRESHOLD } from '@/components/CommerceSignal';

import { ShopProductSheet } from '@/components/ShopProductSheet';

import { EmptyState } from '@/components/BrandthreadUI';

import { ScreenHeader } from '@/components/ScreenHeader';

import { ErrorState } from '@/components/ui/ErrorState';

import { UnavailableScreen, isMissingParam } from '@/components/ui/UnavailableScreen';

import { isWellFormedDropId } from '@/lib/dropId';

import type { ShopSheetSelection } from '@/components/ShopProductSheet';
import { buildCanonicalDropUrl } from '@/lib/shareDrop';
import { dropAlertErrorCopy } from '@/lib/dropAlertError';
import { buyerProductHref } from '@/lib/dropProductContext';
import { computeCountdownParts, type CountdownParts } from '@/lib/dropCountdown';
import { ProductPhotoPlaceholder } from '@/components/media/ProductPhoto';
import { productPhotoHeight } from '@/constants/media';

import { crispPx } from '@/lib/crispPixel';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}


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
  membersOnly?: boolean;
  /** False only when the drop is members-only and this viewer hasn't bought from the seller. */
  viewerIsMember?: boolean;
  seller?: { displayName?: string; brandName?: string; verified?: boolean } | null;
  products?: DropProduct[];
}

const computeParts = computeCountdownParts;

/**
 * Countdown ticking hook. Targets `effectiveReleaseAt` (falls back to
 * `releaseAt`) so early-access followers see their own earlier unlock time.
 * Invokes `onBecomeLive` exactly once when the countdown crosses from
 * not-live to live while mounted (used for the reveal animation).
 */
function useCountdown(target?: string | null, onBecomeLive?: () => void): CountdownParts {
  const [parts, setParts] = useState<CountdownParts>(() => computeParts(target));
  const wasLiveRef = useRef<boolean>(computeParts(target).isLive);

  useEffect(() => {
    const tick = () => {
      const next = computeParts(target);
      setParts(next);

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
          <Text style={styles.liveSub}>Limited drop · while stock lasts</Text>
        </View>
        <Icon name="zap" size={22} color={ON_DARK} />
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
          <Icon name="star" size={12} color={theme.accent} />
          <Text style={[styles.earlyAccessText, { color: theme.accent }]}>
            Early access — you get in {earlyAccessMinutes} min before everyone else
          </Text>
        </View>
      )}
    </View>
  );
}

function ProductTile({
  product, brand, locked, isLive, onPress,
}: {
  product: DropProduct;
  brand?: string;
  locked: boolean;
  isLive: boolean;
  onPress: () => void;
}) {
  const { theme } = useAppTheme();
  const { width: W } = useWindowDimensions();
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
        accessibilityLabel={locked ? 'Locked — unlocks at the drop' : `${product.name}${soldOut ? ', sold out' : ''}`}
      >
        <View style={[styles.productMedia, { height: (W - SP.md * 2 - 10) * 0.68 }]}>
          {/* Locked: the photo stays hidden until launch (a solid tile under
              the lock), never shown blurred. */}
          {imageUri && !locked ? (
            <CachedImage source={{ uri: imageUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
          ) : (
            <View style={styles.productFallback}>{locked ? null : <ProductPhotoPlaceholder brand={brand} name={product.name} style={StyleSheet.absoluteFill} />}</View>
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
                <Icon name="lock" size={18} color={ON_DARK} />
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
                ? (product.category ?? 'Upcoming')
                : (product.category ?? (product.isPreOrder ? 'PRE-ORDER' : 'LIMITED'))}
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

export default function BuyerDropDetail() {
  const { width: W } = useWindowDimensions();
  const HERO_H = Math.max(470, Math.min(590, W * 1.38));
  const colors = useColors();
  const { theme } = useAppTheme();
  const routeParams = useLocalSearchParams<{ dropId?: string; id?: string; dropName?: string }>();
  // Older drop notifications deep-link with `?id=`; every in-app entry uses `?dropId=`.
  const dropId = pickRouteParam(routeParams, 'dropId', 'id');
  const { dropName } = routeParams;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const headerTopInset = useHeaderTopInset();
  const api = useApi();
  const scrollRef = useRef<ScrollView>(null);
  const entrance = useRef(new Animated.Value(0)).current;
  const launchFlash = useRef(new Animated.Value(0)).current;

  const [drop, setDrop] = useState<DropDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [notFound, setNotFound] = useState(false);
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
    // Missing or malformed id (e.g. /drops/demo): it can never resolve, so
    // show "not found" without a request instead of a misleading load error.
    if (isMissingParam(dropId) || !isWellFormedDropId(dropId)) {
      setLoading(false);
      setNotFound(true);
      return () => { active = false; };
    }
    setLoading(true);
    setLoadError(false);
    setNotFound(false);
    Promise.all([
      api.publicDrops.get(dropId!),
      api.publicDrops.notificationStatus(dropId!).catch(() => ({ subscribed: false })),
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
    }).catch((err: unknown) => {
      if (!active) return;
      setDrop(null);
      if ((err as { status?: number } | null)?.status === 404) setNotFound(true);
      else setLoadError(true);
    })
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
    } catch (error) {
      const copy = dropAlertErrorCopy(error);
      Alert.alert(copy.title, copy.message);
    } finally {
      setNotifyLoading(false);
    }
  }

  function handleShare() {
    if (!drop) return;
    const url = buildCanonicalDropUrl(drop.id);
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
      // Upcoming drop: open the product page with "drops on <date>" context
      // (purchase buttons stay held there until launch).
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      router.push(buyerProductHref(product, { releaseAt: targetReleaseAt ?? null, name: drop?.name ?? null }) as never);
      return;
    }
    if (product.soldOut) return;
    if (drop?.membersOnly && drop.viewerIsMember === false) {
      haptics.warning();
      Alert.alert('Past buyers only', `This drop is only for people who've bought from ${sellerName}.`);
      return;
    }

    haptic('sheet');
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

  const fallbackTitle = typeof dropName === 'string' && dropName.trim() ? dropName : 'Drop';

  if (notFound) {
    return (
      <UnavailableScreen
        title={fallbackTitle}
        heading="Drop not found"
        message="This drop link is invalid or the drop was removed."
        icon="calendar"
        fallback="/buyer-drops"
      />
    );
  }
  if (loading) {
    return (
      <View style={styles.root}>
        <ScreenHeader title={fallbackTitle} onBack={() => goBackOr(router, '/buyer-drops')} />
        <View style={styles.center}><ActivityIndicator color={colors.primary} size="large" /></View>
      </View>
    );
  }
  if (!drop) {
    return (
      <View style={styles.root}>
        <ScreenHeader title={fallbackTitle} onBack={() => goBackOr(router, '/buyer-drops')} />
        <View style={styles.center}>
          <ErrorState
            message={loadError ? 'Couldn’t load this drop.' : 'This drop isn’t available.'}
            onRetry={loadError ? () => setReloadGeneration(g => g + 1) : undefined}
            retryLabel="Try again"
          />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScrollView ref={scrollRef} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 48 }}>
        <View style={[styles.hero, { height: HERO_H }]}>
          {heroUri ? (
            heroIsVideo ? <HeroVideo uri={heroUri} /> : <CachedImage source={{ uri: heroUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
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

          <View style={[styles.heroHeader, { paddingTop: headerTopInset + SP.sm }]}>
            <TouchableOpacity style={styles.roundButton} onPress={() => goBackOr(router)} hitSlop={4} accessibilityLabel="Go back">
              <Icon name="arrow-left" size={21} color={ON_DARK} />
            </TouchableOpacity>
            <View style={styles.heroBadge}>
              <Text style={styles.heroBadgeText}>{showRecap ? 'DROP ENDED' : (isLive ? 'LIVE DROP' : 'UPCOMING')}</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity style={styles.roundButton} onPress={handleShare} hitSlop={4} accessibilityLabel="Share this drop">
                <Icon name="share" size={18} color={ON_DARK} />
              </TouchableOpacity>
              {!showRecap && (
                <TouchableOpacity style={styles.roundButton} onPress={toggleNotification} hitSlop={4} accessibilityLabel="Toggle drop alert">
                  <Icon name={subscribed ? 'bell-off' : 'bell'} size={19} color={ON_DARK} />
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
                  {drop.seller?.verified && <Icon name="check-circle" size={14} color={theme.secondary} />}
                </View>
                <Text style={styles.dropType}>{drop.type === 'pre-order' ? 'PRE-ORDER EDITION' : 'READY TO SHIP'}</Text>
              </View>
            </View>

            <Text style={[styles.dropName, { maxWidth: W - 40 }]}>{drop.name ?? dropName}</Text>

            {showRecap ? (
              <View style={styles.livePanel}>
                <Icon name="check-circle" size={20} color={SUCCESS} />
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

            {!showRecap && !!drop.membersOnly && (
              <View style={styles.earlyAccessRow} testID="drop-members-only-row">
                <Icon name={drop.viewerIsMember === false ? 'lock' : 'check'} size={12} color={theme.accent} />
                <Text style={[styles.earlyAccessText, { color: theme.accent }]}>
                  {drop.viewerIsMember === false
                    ? `Only for past buyers of ${sellerName}`
                    : "Past buyers only. You're in"}
                </Text>
              </View>
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
                        <Icon name={subscribed ? 'check' : 'bell'} size={18} color={subscribed ? ON_DARK : theme.onAccent} />
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
                    <Icon name="shopping-bag" size={18} color={theme.onAccent} />
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
              <Text style={styles.metaLabel}>DROPS</Text>
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
                  brand={sellerName}
                  locked={!showRecap && !isLive}
                  isLive={isLive && !showRecap}
                  onPress={() => handleProductPress(product)}
                />
              ))}
            </View>
          ) : (
            <EmptyState
              icon="package"
              title="The reveal is coming"
              description="Products will appear here as the brand unveils this drop."
              compact
            />
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
  hero: { backgroundColor: CARD, position: 'relative', justifyContent: 'flex-end' },
  heroHeader: { position: 'absolute', top: 0, left: SP.md, right: SP.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', zIndex: 2 },
  roundButton: { width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(0,0,0,0.48)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  heroBadge: { backgroundColor: 'rgba(0,0,0,0.58)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)', borderRadius: RADIUS.pill, paddingHorizontal: 13, paddingVertical: 7 },
  heroBadgeText: { color: ON_DARK, fontFamily: FONT.bold, fontSize: FS.xs },
  heroCopy: { padding: 20, paddingBottom: 28 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: SP.md },
  brandMark: { width: 38, height: 38, borderRadius: 19, borderWidth: crispPx(1.5), backgroundColor: 'rgba(0,0,0,0.62)', alignItems: 'center', justifyContent: 'center' },
  brandInitials: { color: ON_DARK, fontFamily: FONT.bold, fontSize: 11 },
  brandNameRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  brandName: { color: ON_DARK, fontFamily: FONT.semibold, fontSize: FS.sm },
  dropType: { color: ON_DARK_MUTED, fontFamily: FONT.medium, fontSize: FS.xs, marginTop: 2 },
  dropName: { color: ON_DARK, fontFamily: FONT.extrabold, fontSize: FS.h1, lineHeight: 41, letterSpacing: -1.5, marginBottom: SP.lg },
  eyebrow: { color: ON_DARK_MUTED, fontFamily: FONT.semibold, fontSize: FS.xs, marginBottom: 9 },
  timerRow: { flexDirection: 'row', justifyContent: 'space-between' },
  timerUnit: { minWidth: 58 },
  flipDigitClip: { overflow: 'hidden', height: 48 },
  timerNumber: { color: ON_DARK, fontFamily: FONT.light, fontSize: 42, lineHeight: 48, letterSpacing: -1.8, fontVariant: ['tabular-nums'] },
  timerLabel: { color: ON_DARK_MUTED, fontFamily: FONT.semibold, fontSize: FS.xs },
  timerRule: { height: 2, marginTop: 13, width: 58 },
  earlyAccessRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 },
  earlyAccessText: { fontFamily: FONT.semibold, fontSize: FS.xs, flexShrink: 1 },
  livePanel: { backgroundColor: 'rgba(255,59,48,0.12)', borderWidth: 1, borderColor: 'rgba(255,59,48,0.4)', borderRadius: RADIUS.md, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 13 },
  livePulse: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#FF3B30' },
  liveTitle: { color: ON_DARK, fontFamily: FONT.extrabold, fontSize: FS.md },
  liveSub: { color: ON_DARK_MUTED, fontFamily: FONT.regular, fontSize: FS.xs, marginTop: 2 },
  actionRow: { flexDirection: 'row', marginTop: SP.lg },
  primaryButton: { flex: 1, minHeight: 52, borderRadius: RADIUS.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  primaryButtonText: { color: ON_DARK, fontFamily: FONT.bold, fontSize: FS.base },
  content: { paddingTop: SP.lg },
  releaseMeta: { marginHorizontal: SP.md, paddingBottom: SP.lg, flexDirection: 'row', alignItems: 'center', gap: SP.md, borderBottomWidth: 1, borderBottomColor: BORDER },
  metaLabel: { color: SUBTLE, fontFamily: FONT.semibold, fontSize: FS.xs, marginBottom: 4 },
  metaValue: { color: FG, fontFamily: FONT.semibold, fontSize: FS.sm },
  metaDivider: { width: 1, height: 30, backgroundColor: BORDER },
  collectionHeader: { paddingHorizontal: SP.md, paddingTop: SP.xl, paddingBottom: SP.md, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  collectionEyebrow: { color: SUBTLE, fontFamily: FONT.semibold, fontSize: FS.xs },
  collectionTitle: { color: FG, fontFamily: FONT.bold, fontSize: FS.xxl, marginTop: 4, letterSpacing: -0.5 },
  stockPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 9, paddingVertical: 6, borderRadius: RADIUS.pill, borderWidth: 1 },
  stockDot: { width: 6, height: 6, borderRadius: 3 },
  stockText: { fontFamily: FONT.bold, fontSize: FS.xs },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: SP.md },
  productTile: { borderRadius: RADIUS.sm, overflow: 'hidden', backgroundColor: CARD },
  productMedia: { justifyContent: 'flex-end' },
  productFallback: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', backgroundColor: CARD },
  productCaption: { padding: 11 },
  productName: { color: ON_DARK, fontFamily: FONT.bold, fontSize: FS.sm, lineHeight: 17 },
  productCategory: { color: ON_DARK_MUTED, fontFamily: FONT.semibold, fontSize: FS.xs, marginTop: 5 },
  lockOverlay: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  lockBadge: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.55)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', alignItems: 'center', justifyContent: 'center' },
  stockBadge: { position: 'absolute', top: 8, right: 8, paddingHorizontal: 8, paddingVertical: 4, borderRadius: RADIUS.pill },
  stockBadgeText: { fontFamily: FONT.bold, fontSize: 11 },
  soldOutBadge: { backgroundColor: 'rgba(0,0,0,0.72)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)' },
  soldOutBadgeText: { color: ON_DARK, fontFamily: FONT.bold, fontSize: 11 },
  emptyProducts: { margin: SP.md, padding: SP.xl, borderRadius: RADIUS.lg, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, alignItems: 'center', gap: SP.sm },
  emptyTitle: { color: FG, fontFamily: FONT.bold, fontSize: FS.md },
  emptyText: { color: MUTED, fontFamily: FONT.regular, fontSize: FS.sm, textAlign: 'center', lineHeight: 20 },
});
