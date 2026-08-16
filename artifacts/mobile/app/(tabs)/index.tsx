import React, { useState, useEffect, useRef, useCallback } from 'react';
import AIBrainFAB from '@/components/AIBrainFAB';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Animated, Modal, TextInput, FlatList, Alert, Pressable,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getSetupState, markSetupStarted, dismissWelcome,
  completionPercent, nextTask, nextBestAction, dismissTip,
  markFeatureOpened, type SetupState,
} from '@/lib/setupStore';
import { DEMO_ORDERS, DEMO_PRODUCTS } from '@/services/data';
import { getHubStats } from '@/services/manufacturerService';
import { getOrderStats } from '@/services/orderService';
import { getInventoryStats } from '@/services/inventoryService';
import {
  BrandthreadScreen, BrandthreadCard, GradientCard,
  PrimaryButton, SecondaryButton, IconButton, SearchBar,
  StatCard, QuickActionCard, SectionHeader, ProgressCard,
  NavigationCard, GuidedTip, NewFeatureBadge, LoadingSkeleton,
  EmptyState, StatusBadge,
} from '@/components/BrandthreadUI';
import {
  BG, SURFACE, CARD, CARD_ELEVATED, BORDER, BORDER_ACTIVE,
  FG, MUTED, SUBTLE, PURPLE, PURPLE_LIGHT, PURPLE_DIM,
  CYAN, CYAN_DIM, SUCCESS, GREEN_BRIGHT, BLUE, ORANGE, RED, GOLD,
  GRAD_PRIMARY, GRAD_CARD_GLOW, GRAD_DARK_FADE,
  FONT, FS, SP, RADIUS, COMP, ICON, ANIM, SHADOW_PURPLE,
} from '@/lib/theme';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function orderStatusVariant(status: string): 'success' | 'info' | 'warning' | 'error' | 'neutral' | 'purple' {
  switch (status) {
    case 'shipped':
    case 'delivered': return 'success';
    case 'new': return 'info';
    case 'processing': return 'purple';
    case 'ready_to_ship': return 'warning';
    case 'refunded': return 'error';
    default: return 'neutral';
  }
}

function orderStatusLabel(status: string): string {
  switch (status) {
    case 'ready_to_ship': return 'Ready';
    case 'processing': return 'Processing';
    case 'new': return 'New';
    case 'shipped': return 'Shipped';
    case 'delivered': return 'Delivered';
    case 'refunded': return 'Refunded';
    default: return status;
  }
}

function timeAgo(dateStr: string): string {
  const parts = dateStr.split(' ');
  if (parts.length >= 2) {
    const month = parts[0];
    const day = parseInt(parts[1].replace(',', ''));
    const now = new Date();
    const orderDate = new Date(`${month} ${day}, ${now.getFullYear()}`);
    const diffMs = now.getTime() - orderDate.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return '1d ago';
    return `${diffDays}d ago`;
  }
  return dateStr;
}

// ─── Command Menu items ────────────────────────────────────────────────────────

const COMMAND_ITEMS = [
  { label: 'Create product',    icon: 'package'      as const, route: '/(tabs)/products' },
  { label: 'Create design',     icon: 'pen-tool'     as const, route: '/(tabs)/studio'   },
  { label: 'Create post',       icon: 'video'        as const, route: '/create-post'     },
  { label: 'View orders',       icon: 'shopping-bag' as const, route: '/(tabs)/orders'   },
  { label: 'Manufacturer Hub',  icon: 'package'      as const, route: '/manufacturer-hub' },
  { label: 'Inventory',         icon: 'layers'       as const, route: '/(tabs)/more'     },
  { label: 'Store Builder',     icon: 'layout'       as const, route: '/(tabs)/more'     },
  { label: 'Analytics',         icon: 'bar-chart-2'  as const, route: '/(tabs)/analytics'},
  { label: 'Settings',          icon: 'settings'     as const, route: '/(tabs)/more'     },
];

// ─── Default setup state ──────────────────────────────────────────────────────

const DEFAULT_SETUP: SetupState = {
  started: false,
  dismissed: false,
  currentStep: null,
  tasks: [],
  dismissedTips: [],
  openedFeatures: [],
  lastUpdated: Date.now(),
};

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function SellerHomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [statsError, setStatsError] = useState(false);
  const [setupState, setSetupState] = useState<SetupState>(DEFAULT_SETUP);
  const [searchModal, setSearchModal] = useState(false);
  const [commandModal, setCommandModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [hubStats, setHubStats] = useState<{
    activeQuotes: number;
    samplesNeedingReview: number;
    activeProduction: number;
    unreadMessages: number;
  } | null>(null);
  const [orderStats, setOrderStats] = useState<{
    newOrders: number;
    toProcess: number;
    readyToShip: number;
    returnRequests: number;
    disputes: number;
  } | null>(null);
  const [invStats, setInvStats] = useState<{
    lowStockCount: number;
    outOfStockCount: number;
    incomingCount: number;
    delayedCount: number;
  } | null>(null);

  const progressAnim = useRef(new Animated.Value(0)).current;

  // ── Load setup state ──────────────────────────────────────────────────────
  const loadSetup = useCallback(async () => {
    const state = await getSetupState();
    setSetupState(state);
    setLoading(false);
    const pct = completionPercent(state);
    Animated.timing(progressAnim, {
      toValue: pct / 100,
      duration: ANIM.slow,
      useNativeDriver: false,
    }).start();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadSetup();
    }, 0);
    // Show skeleton for at least 500ms
    const minLoad = setTimeout(() => {}, 500);
    setStatsError(false);
    // Load hub stats
    getHubStats().then(stats => setHubStats({
      activeQuotes: stats.activeQuotes,
      samplesNeedingReview: stats.samplesNeedingReview,
      activeProduction: stats.activeProduction,
      unreadMessages: stats.unreadMessages,
    })).catch(() => { setStatsError(true); });
    // Load order stats
    getOrderStats().then(s => setOrderStats({
      newOrders: s.newOrders,
      toProcess: s.toProcess,
      readyToShip: s.readyToShip,
      returnRequests: s.returnRequests,
      disputes: s.disputes,
    })).catch(() => { setStatsError(true); });
    // Load inventory stats
    getInventoryStats().then(s => setInvStats({
      lowStockCount: s.lowStockCount,
      outOfStockCount: s.outOfStockCount,
      incomingCount: s.incomingCount,
      delayedCount: s.delayedCount,
    })).catch(() => { setStatsError(true); });
    return () => { clearTimeout(timer); clearTimeout(minLoad); };
  }, []);

  // ── Derived values ────────────────────────────────────────────────────────
  const pct = completionPercent(setupState);
  const nextT = nextTask(setupState);
  const nba = nextBestAction(setupState);
  const showWelcome = !setupState.started && !setupState.dismissed;
  const showProgress = setupState.started && pct < 100;

  // ── Search results ────────────────────────────────────────────────────────
  const q = searchQuery.toLowerCase().trim();
  const productResults = q
    ? DEMO_PRODUCTS.filter(p => p.name.toLowerCase().includes(q))
    : [];
  const orderResults = q
    ? DEMO_ORDERS.filter(o =>
        o.orderNumber.toLowerCase().includes(q) ||
        o.customer.name.toLowerCase().includes(q)
      )
    : [];

  // ── Handlers ──────────────────────────────────────────────────────────────
  function nav(route: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(route as never);
  }

  async function handleStartSetup() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const next = await markSetupStarted();
    setSetupState(next);
    Animated.timing(progressAnim, {
      toValue: completionPercent(next) / 100,
      duration: ANIM.slow,
      useNativeDriver: false,
    }).start();
  }

  async function handleDismissWelcome() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const next = await dismissWelcome();
    setSetupState(next);
  }

  function closeCommand() {
    setCommandModal(false);
  }

  // ── Loading skeleton ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: BG }}>
        <View style={[s.header, { paddingTop: insets.top + 8 }]}>
          <View style={{ gap: 4 }}>
            <LoadingSkeleton height={12} style={{ width: 100 }} />
            <LoadingSkeleton height={24} style={{ width: 160, marginTop: 4 }} />
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <LoadingSkeleton height={40} style={{ width: 40, borderRadius: RADIUS.sm }} />
            <LoadingSkeleton height={40} style={{ width: 40, borderRadius: RADIUS.sm }} />
          </View>
        </View>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: SP.md, gap: 12, paddingBottom: 160 }}
          showsVerticalScrollIndicator={false}
        >
          <LoadingSkeleton height={120} />
          <LoadingSkeleton height={80} />
          <LoadingSkeleton height={100} />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <LoadingSkeleton height={90} style={{ flex: 1 }} />
            <LoadingSkeleton height={90} style={{ flex: 1 }} />
            <LoadingSkeleton height={90} style={{ flex: 1 }} />
            <LoadingSkeleton height={90} style={{ flex: 1 }} />
          </View>
        </ScrollView>
      </View>
    );
  }

  // ── Main render ───────────────────────────────────────────────────────────
  return (
    <View style={{ flex: 1, backgroundColor: BG }}>

      {/* ── Fixed Header ─────────────────────────────────────────────────── */}
      <View style={[s.header, { paddingTop: insets.top + 8 }]}>
        <View>
          <Text style={s.greetSmall}>{greeting()}</Text>
          <Text style={s.brandName}>Brandthread</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <IconButton
            name="search"
            onPress={() => { setSearchQuery(''); setSearchModal(true); }}
          />
          <IconButton
            name="bell"
            badge
            onPress={() => Alert.alert('Notifications', 'No new notifications.')}
          />
        </View>
      </View>

      {/* ── Scrollable Content ───────────────────────────────────────────── */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 160 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >

        {/* ── Stats Error Banner ────────────────────────────────────────── */}
        {statsError && (
          <TouchableOpacity
            style={{ marginHorizontal: SP.md, marginBottom: SP.sm, flexDirection: 'row', alignItems: 'center', gap: SP.sm, backgroundColor: 'rgba(249,115,22,0.1)', borderRadius: RADIUS.md, padding: SP.sm, borderWidth: 1, borderColor: 'rgba(249,115,22,0.25)' }}
            onPress={() => { setStatsError(false); }}
            activeOpacity={0.8}
          >
            <Feather name="alert-triangle" size={14} color={ORANGE} />
            <Text style={{ flex: 1, fontSize: FS.xs, fontFamily: FONT.regular, color: ORANGE }}>Couldn't load live stats — tap to dismiss</Text>
          </TouchableOpacity>
        )}

        {/* ── Welcome Card ──────────────────────────────────────────────── */}
        {showWelcome && (
          <View style={{ paddingHorizontal: SP.md, paddingTop: SP.md, marginBottom: SP.md }}>
            <GradientCard
              colors={['rgba(139,92,246,0.25)', 'rgba(34,211,238,0.08)']}
              glow
            >
              <Text style={s.welcomeTitle}>Your brand workspace is ready.</Text>
              <Text style={[s.welcomeSub, { marginTop: 6, marginBottom: SP.md }]}>
                Let's build your first product and prepare your store.
              </Text>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <PrimaryButton
                  label="Start setup"
                  onPress={handleStartSetup}
                  small
                  style={{ flex: 1 }}
                />
                <SecondaryButton
                  label="Explore on my own"
                  onPress={handleDismissWelcome}
                  small
                  style={{ flex: 1 }}
                />
              </View>
            </GradientCard>
          </View>
        )}

        {/* ── Next Best Action ──────────────────────────────────────────── */}
        <View style={{ paddingHorizontal: SP.md, marginBottom: SP.md }}>
          <GradientCard
            colors={['rgba(139,92,246,0.15)', 'rgba(34,211,238,0.06)']}
            glow
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <Feather name="zap" size={12} color={CYAN} />
              <Text style={s.recommendedLabel}>RECOMMENDED</Text>
            </View>
            <Text style={s.nbaLabel} numberOfLines={2}>{nba.label}</Text>
            <View style={{ marginTop: 12, alignSelf: 'flex-start' }}>
              <SecondaryButton
                label="Go →"
                onPress={() => nav(nba.route)}
                small
                accent={CYAN}
              />
            </View>
          </GradientCard>
        </View>

        {/* ── Setup Progress Card ───────────────────────────────────────── */}
        {showProgress && (
          <View style={{ paddingHorizontal: SP.md, marginBottom: SP.md }}>
            <BrandthreadCard>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <Text style={s.progressTitle}>Setup progress</Text>
                <Text style={{ fontSize: FS.sm, fontFamily: FONT.semibold, color: PURPLE_LIGHT }}>{pct}%</Text>
              </View>
              <View style={s.progressTrack}>
                <Animated.View
                  style={[
                    s.progressFill,
                    {
                      width: progressAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: ['0%', '100%'],
                      }),
                    },
                  ]}
                />
              </View>
              {nextT && (
                <Text style={[s.progressNext, { marginTop: 8 }]}>
                  <Text style={{ color: MUTED }}>Next: </Text>
                  <Text style={{ color: SUBTLE }}>{nextT.label}</Text>
                </Text>
              )}
              <View style={{ marginTop: 12, alignSelf: 'flex-start' }}>
                <SecondaryButton
                  label="Continue setup"
                  onPress={() => Alert.alert('Setup', 'Guided setup coming soon.')}
                  small
                />
              </View>
            </BrandthreadCard>
          </View>
        )}

        {/* ── Stats Row ─────────────────────────────────────────────────── */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: SP.md, gap: 8, paddingBottom: 4 }}
          style={{ marginBottom: SP.md }}
        >
          <StatCard
            label="Revenue"
            value="$0"
            icon="dollar-sign"
            accent={GREEN_BRIGHT}
            change="+0% this week"
            positive
            style={{ minWidth: 110 }}
          />
          <StatCard
            label="Orders"
            value="0"
            icon="shopping-bag"
            accent={PURPLE}
            change="0 new today"
            style={{ minWidth: 110 }}
          />
          <StatCard
            label="Visitors"
            value="0"
            icon="users"
            accent={CYAN}
            style={{ minWidth: 110 }}
          />
          <StatCard
            label="Conversion"
            value="0%"
            icon="trending-up"
            accent={BLUE}
            style={{ minWidth: 110 }}
          />
        </ScrollView>

        {/* ── Quick Actions ─────────────────────────────────────────────── */}
        <View style={{ paddingHorizontal: SP.md, marginBottom: SP.md }}>
          <SectionHeader title="Quick actions" style={{ paddingHorizontal: 0, marginBottom: SP.sm }} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            <QuickActionCard
              label="Create Post"
              icon="video"
              accent={PURPLE}
              badge={!setupState.openedFeatures.includes('create-post')}
              onPress={() => {
                markFeatureOpened('create-post');
                nav('/create-post');
              }}
              style={{ width: '48.5%' }}
            />
            <QuickActionCard
              label="Add Product"
              icon="plus-circle"
              accent={CYAN}
              onPress={() => nav('/(tabs)/products')}
              style={{ width: '48.5%' }}
            />
            <QuickActionCard
              label="View Orders"
              icon="shopping-bag"
              accent={BLUE}
              onPress={() => nav('/(tabs)/orders')}
              style={{ width: '48.5%' }}
            />
            <QuickActionCard
              label="Studio"
              icon="zap"
              accent={ORANGE}
              onPress={() => nav('/(tabs)/studio')}
              style={{ width: '48.5%' }}
            />
          </View>
        </View>

        {/* ── Today Priorities ──────────────────────────────────────────── */}
        <View style={{ paddingHorizontal: SP.md, marginBottom: SP.md }}>
          <SectionHeader title="Today" style={{ paddingHorizontal: 0, marginBottom: SP.sm }} />
          <View style={{ gap: 8 }}>
            <NavigationCard
              label="3 orders ready to ship"
              icon="truck"
              accent={SUCCESS}
              description="Tap to view"
              onPress={() => nav('/(tabs)/orders')}
            />
            <NavigationCard
              label="Review manufacturer quote"
              icon="tool"
              accent={ORANGE}
              description="New message"
              badge
              onPress={() => nav('/manufacturer-hub')}
            />
            <NavigationCard
              label="Upload product images"
              icon="image"
              accent={PURPLE}
              description="Complete your product"
              onPress={() => nav('/(tabs)/products')}
            />
          </View>
        </View>

        {/* ── Order Stats ───────────────────────────────────────────────── */}
        {orderStats && (orderStats.newOrders > 0 || orderStats.readyToShip > 0 || orderStats.returnRequests > 0 || orderStats.disputes > 0) && (
          <View style={{ paddingHorizontal: SP.md, marginBottom: SP.md }}>
            <SectionHeader title="Orders" style={{ paddingHorizontal: 0, marginBottom: SP.sm }} action={{ label: 'View all', onPress: () => nav('/(tabs)/orders') }} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {(orderStats.newOrders > 0) && (
                <QuickActionCard
                  label={`${orderStats.newOrders} New order${orderStats.newOrders > 1 ? 's' : ''}`}
                  icon="shopping-bag"
                  accent={BLUE}
                  badge
                  onPress={() => nav('/(tabs)/orders')}
                  style={{ width: '48.5%' }}
                />
              )}
              {(orderStats.readyToShip > 0) && (
                <QuickActionCard
                  label={`${orderStats.readyToShip} Ready to ship`}
                  icon="truck"
                  accent={SUCCESS}
                  badge
                  onPress={() => nav('/(tabs)/orders')}
                  style={{ width: '48.5%' }}
                />
              )}
              {(orderStats.returnRequests > 0) && (
                <QuickActionCard
                  label={`${orderStats.returnRequests} Return${orderStats.returnRequests > 1 ? 's' : ''}`}
                  icon="refresh-ccw"
                  accent={ORANGE}
                  badge
                  onPress={() => nav('/(tabs)/orders')}
                  style={{ width: '48.5%' }}
                />
              )}
              {(orderStats.disputes > 0) && (
                <QuickActionCard
                  label={`${orderStats.disputes} Dispute${orderStats.disputes > 1 ? 's' : ''}`}
                  icon="alert-circle"
                  accent={RED}
                  badge
                  onPress={() => nav('/(tabs)/orders')}
                  style={{ width: '48.5%' }}
                />
              )}
            </View>
          </View>
        )}

        {/* ── Inventory Alerts ─────────────────────────────────────────── */}
        {invStats && (invStats.outOfStockCount > 0 || invStats.lowStockCount > 0 || invStats.incomingCount > 0) && (
          <View style={{ paddingHorizontal: SP.md, marginBottom: SP.md }}>
            <SectionHeader title="Inventory" style={{ paddingHorizontal: 0, marginBottom: SP.sm }} action={{ label: 'View all', onPress: () => nav('/inventory') }} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {(invStats.outOfStockCount > 0) && (
                <QuickActionCard
                  label={`${invStats.outOfStockCount} out of stock`}
                  icon="alert-circle"
                  accent={RED}
                  badge
                  onPress={() => nav('/inventory')}
                  style={{ width: '48.5%' }}
                />
              )}
              {(invStats.lowStockCount > 0) && (
                <QuickActionCard
                  label={`${invStats.lowStockCount} low stock`}
                  icon="trending-down"
                  accent={ORANGE}
                  badge
                  onPress={() => nav('/inventory')}
                  style={{ width: '48.5%' }}
                />
              )}
              {(invStats.incomingCount > 0) && (
                <QuickActionCard
                  label={`${invStats.incomingCount} incoming`}
                  icon="truck"
                  accent={CYAN}
                  onPress={() => nav('/inventory')}
                  style={{ width: '48.5%' }}
                />
              )}
            </View>
          </View>
        )}

        {/* ── Manufacturer Hub Stats ────────────────────────────────────── */}
        {hubStats && (hubStats.samplesNeedingReview > 0 || hubStats.activeProduction > 0 || hubStats.unreadMessages > 0) && (
          <View style={{ paddingHorizontal: SP.md, marginBottom: SP.md }}>
            <SectionHeader title="Manufacturer Hub" style={{ paddingHorizontal: 0, marginBottom: SP.sm }} action={{ label: 'Open hub', onPress: () => nav('/manufacturer-hub') }} />
            <View style={{ gap: 8 }}>
              {hubStats.samplesNeedingReview > 0 && (
                <NavigationCard
                  label={`${hubStats.samplesNeedingReview} sample${hubStats.samplesNeedingReview > 1 ? 's' : ''} need review`}
                  icon="package"
                  accent={ORANGE}
                  description="Tap to review"
                  badge
                  onPress={() => nav('/manufacturer-hub')}
                />
              )}
              {hubStats.activeProduction > 0 && (
                <NavigationCard
                  label={`${hubStats.activeProduction} active production order${hubStats.activeProduction > 1 ? 's' : ''}`}
                  icon="layers"
                  accent={PURPLE}
                  description="Track progress"
                  onPress={() => nav('/manufacturer-hub')}
                />
              )}
              {hubStats.unreadMessages > 0 && (
                <NavigationCard
                  label={`${hubStats.unreadMessages} new manufacturer message${hubStats.unreadMessages > 1 ? 's' : ''}`}
                  icon="message-circle"
                  accent={CYAN}
                  description="Tap to reply"
                  badge
                  onPress={() => nav('/manufacturer-hub')}
                />
              )}
            </View>
          </View>
        )}

        {/* ── Recent Activity ───────────────────────────────────────────── */}
        <View style={{ paddingHorizontal: SP.md, marginBottom: SP.md }}>
          <SectionHeader
            title="Recent activity"
            action={{ label: 'View all', onPress: () => nav('/(tabs)/orders') }}
            style={{ paddingHorizontal: 0 }}
          />
          <View style={{ gap: 8 }}>
            {DEMO_ORDERS.slice(0, 3).map((order) => (
              <BrandthreadCard
                key={order.id}
                style={{ marginBottom: 0 }}
                onPress={() => Alert.alert('Order', `Order ${order.orderNumber}`)}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP.sm }}>
                  <View style={s.orderIconCircle}>
                    <Feather name="shopping-bag" size={ICON.sm} color={PURPLE_LIGHT} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={s.orderNumber}>{order.orderNumber}</Text>
                      <StatusBadge
                        label={orderStatusLabel(order.status)}
                        variant={orderStatusVariant(order.status)}
                        small
                      />
                      <Text style={[s.orderTime, { marginLeft: 'auto' }]}>{timeAgo(order.date)}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
                      <Text style={s.orderCustomer}>{order.customer.name}</Text>
                      <Text style={s.orderTotal}>${order.total.toFixed(2)}</Text>
                    </View>
                  </View>
                </View>
              </BrandthreadCard>
            ))}
          </View>
        </View>

        {/* ── Go to Command Menu trigger ────────────────────────────────── */}
        <PrimaryButton
          label="Go to →"
          icon="command"
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            setCommandModal(true);
          }}
          style={{ marginHorizontal: SP.md, marginBottom: SP.lg }}
        />

      </ScrollView>

      {/* ── Command Menu Modal ────────────────────────────────────────────── */}
      <Modal
        visible={commandModal}
        animationType="slide"
        transparent
        onRequestClose={closeCommand}
      >
        <Pressable style={s.modalOverlay} onPress={closeCommand} />
        <View style={[s.bottomSheet, { paddingBottom: Math.max(insets.bottom, SP.lg) }]}>
          <View style={s.sheetHandle} />
          <Text style={s.commandTitle}>Go to</Text>
          <View style={s.commandGrid}>
            {COMMAND_ITEMS.map((item) => (
              <TouchableOpacity
                key={item.label}
                style={s.commandItem}
                activeOpacity={0.8}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  closeCommand();
                  setTimeout(() => nav(item.route), 100);
                }}
              >
                <View style={s.commandIconWrap}>
                  <Feather name={item.icon} size={ICON.md} color={PURPLE_LIGHT} />
                </View>
                <Text style={s.commandLabel} numberOfLines={2}>{item.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </Modal>

      {/* ── Global Search Modal ───────────────────────────────────────────── */}
      <Modal
        visible={searchModal}
        animationType="fade"
        transparent={false}
        onRequestClose={() => setSearchModal(false)}
      >
        <View style={[s.searchScreen, { backgroundColor: BG }]}>
          <View style={[s.searchHeader, { paddingTop: insets.top + 8 }]}>
            <View style={{ flex: 1 }}>
              <SearchBar
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="Search products, orders…"
              />
            </View>
            <TouchableOpacity
              onPress={() => setSearchModal(false)}
              style={s.searchClose}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={{ fontSize: FS.sm, fontFamily: FONT.medium, color: PURPLE_LIGHT }}>Cancel</Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            contentContainerStyle={{ paddingHorizontal: SP.md, paddingBottom: 40 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {!q ? (
              /* Empty state: show categories */
              <View style={{ gap: 8, marginTop: SP.md }}>
                <Text style={s.searchSectionTitle}>Browse</Text>
                <NavigationCard label="Products" icon="package" onPress={() => { setSearchModal(false); nav('/(tabs)/products'); }} accent={CYAN} />
                <NavigationCard label="Orders" icon="shopping-bag" onPress={() => { setSearchModal(false); nav('/(tabs)/orders'); }} accent={PURPLE} />
                <NavigationCard label="Studio" icon="zap" onPress={() => { setSearchModal(false); nav('/(tabs)/studio'); }} accent={ORANGE} />
                <NavigationCard label="Analytics" icon="bar-chart-2" onPress={() => { setSearchModal(false); nav('/(tabs)/analytics'); }} accent={BLUE} />
              </View>
            ) : (
              <View style={{ gap: SP.md, marginTop: SP.md }}>
                {productResults.length > 0 && (
                  <View style={{ gap: 8 }}>
                    <Text style={s.searchSectionTitle}>Products</Text>
                    {productResults.map((p) => (
                      <NavigationCard
                        key={p.id}
                        label={p.name}
                        icon="package"
                        description={`${p.status} · $${p.price}`}
                        accent={CYAN}
                        onPress={() => { setSearchModal(false); nav('/(tabs)/products'); }}
                      />
                    ))}
                  </View>
                )}
                {orderResults.length > 0 && (
                  <View style={{ gap: 8 }}>
                    <Text style={s.searchSectionTitle}>Orders</Text>
                    {orderResults.map((o) => (
                      <NavigationCard
                        key={o.id}
                        label={o.orderNumber}
                        icon="shopping-bag"
                        description={`${o.customer.name} · $${o.total.toFixed(2)}`}
                        accent={PURPLE}
                        onPress={() => { setSearchModal(false); nav('/(tabs)/orders'); }}
                      />
                    ))}
                  </View>
                )}
                {productResults.length === 0 && orderResults.length === 0 && (
                  <EmptyState
                    icon="search"
                    title="No results"
                    description={`Nothing matched "${searchQuery}". Try a different term.`}
                  />
                )}
              </View>
            )}
          </ScrollView>
        </View>
      </Modal>
      <AIBrainFAB context={{ screen: 'home' as const }} bottomOffset={72} />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SP.md,
    paddingBottom: SP.sm,
    backgroundColor: BG,
  },
  greetSmall: {
    fontSize: FS.xs,
    fontFamily: FONT.medium,
    color: MUTED,
    letterSpacing: 0.1,
  },
  brandName: {
    fontSize: FS.xl,
    fontFamily: FONT.bold,
    color: FG,
    letterSpacing: -0.4,
  },

  // Welcome card
  welcomeTitle: {
    fontSize: FS.xl,
    fontFamily: FONT.bold,
    color: FG,
    letterSpacing: -0.3,
  },
  welcomeSub: {
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    color: MUTED,
    lineHeight: 20,
  },

  // Next best action
  recommendedLabel: {
    fontSize: 10,
    fontFamily: FONT.bold,
    color: SUBTLE,
    letterSpacing: 0.8,
  },
  nbaLabel: {
    fontSize: FS.md,
    fontFamily: FONT.bold,
    color: FG,
    letterSpacing: -0.2,
  },

  // Progress
  progressTitle: {
    fontSize: FS.base,
    fontFamily: FONT.bold,
    color: FG,
  },
  progressTrack: {
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 99,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: PURPLE,
    borderRadius: 99,
  },
  progressNext: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: MUTED,
  },

  // Recent orders
  orderIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: PURPLE_DIM,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orderNumber: {
    fontSize: FS.sm,
    fontFamily: FONT.bold,
    color: PURPLE_LIGHT,
  },
  orderTime: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: SUBTLE,
  },
  orderCustomer: {
    fontSize: FS.sm,
    fontFamily: FONT.medium,
    color: FG,
  },
  orderTotal: {
    fontSize: FS.sm,
    fontFamily: FONT.semibold,
    color: FG,
  },

  // Command modal
  modalOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  bottomSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: CARD,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    paddingHorizontal: SP.lg,
    paddingTop: SP.sm,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: RADIUS.pill,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignSelf: 'center',
    marginBottom: SP.md,
  },
  commandTitle: {
    fontSize: FS.xl,
    fontFamily: FONT.bold,
    color: PURPLE_LIGHT,
    marginBottom: SP.md,
  },
  commandGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: SP.md,
  },
  commandItem: {
    width: '30%',
    alignItems: 'center',
    gap: SP.sm,
    backgroundColor: CARD_ELEVATED,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: BORDER,
    paddingVertical: SP.md,
    paddingHorizontal: SP.sm,
  },
  commandIconWrap: {
    width: 44,
    height: 44,
    borderRadius: RADIUS.sm,
    backgroundColor: PURPLE_DIM,
    alignItems: 'center',
    justifyContent: 'center',
  },
  commandLabel: {
    fontSize: FS.xs,
    fontFamily: FONT.medium,
    color: MUTED,
    textAlign: 'center',
  },

  // Search modal
  searchScreen: {
    flex: 1,
  },
  searchHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    paddingHorizontal: SP.md,
    paddingBottom: SP.sm,
  },
  searchClose: {
    paddingHorizontal: SP.sm,
    paddingVertical: SP.sm,
  },
  searchSectionTitle: {
    fontSize: FS.xs,
    fontFamily: FONT.semibold,
    color: SUBTLE,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
});
