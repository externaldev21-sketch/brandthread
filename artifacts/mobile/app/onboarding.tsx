/**
 * Brandthread Onboarding — complete buyer + seller flows
 *
 * BUYER  steps: 0=Name 1=Style 2=Auth 3=Loading 4=ThreadPreview 5=Notifications 6=Success
 * SELLER steps: 0=Name 1=BrandName 2=Stage 3=Model 4=Goals 5=Auth 6=Loading 7=DashPreview 8=Notifications 9=Success
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth, useOAuth, useSignIn, useSignUp, useUser } from '@clerk/expo';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import { ONBOARDING_KEY } from './_layout';

// ─── Palette ────────────────────────────────────────────────────────────────
const BG      = '#07070F';
const CARD    = 'rgba(255,255,255,0.045)';
const BORDER  = 'rgba(255,255,255,0.09)';
const PURPLE  = '#8B5CF6';
const CYAN    = '#22D3EE';
const GREEN   = '#34D399';
const FG      = '#FFFFFF';
const MUTED   = 'rgba(255,255,255,0.45)';
const MUTED2  = 'rgba(255,255,255,0.25)';
const INPUT_BG = 'rgba(255,255,255,0.07)';
const INPUT_BD = 'rgba(255,255,255,0.12)';
const ERR     = '#F87171';

const { width: SW } = Dimensions.get('window');

// ─── Data ───────────────────────────────────────────────────────────────────
const STYLE_INTERESTS = [
  'Streetwear', 'Luxury', 'Vintage', 'Athleisure', 'Basics',
  'Accessories', 'Sneakers', 'Denim', 'Graphic tees', 'Minimal',
  'Avant-garde', 'Sustainable fashion',
];

const BRAND_STAGES = [
  { value: 'idea',    label: 'Just an idea',    sub: "I'm starting from zero." },
  { value: 'build',   label: 'Building now',     sub: "I'm designing or sourcing products." },
  { value: 'selling', label: 'Already selling',  sub: 'I have customers and active orders.' },
  { value: 'scale',   label: 'Ready to scale',   sub: 'I need stronger systems and growth.' },
];

const PRODUCT_MODELS = [
  { value: 'preorder',   label: 'Pre-order',           sub: 'Collect orders first, then fund production.' },
  { value: 'premade',    label: 'Pre-made inventory',  sub: 'Stock products before customers purchase.' },
  { value: 'both',       label: 'Both',                sub: 'Use pre-orders and stocked drops together.' },
];

const SELLER_GOALS = [
  'Create designs', 'Find manufacturers', 'Launch my store', 'Manage production',
  'Grow sales', 'Build content', 'Manage inventory', 'Ship orders',
  'Understand analytics', 'Manage customers',
];

const BUYER_LOADING_STEPS  = ['Learning your style', 'Curating your Thread', 'Finding brands you\'ll love', 'Finishing your profile'];
const SELLER_LOADING_STEPS = ['Mapping your brand workspace', 'Preparing your product pipeline', 'Connecting your growth tools', 'Finishing your dashboard'];

const DRAFT_KEY = 'onboarding_draft';

type Flow = 'buyer' | 'seller';

// ─── Clerk error mapper ──────────────────────────────────────────────────────
// Maps Clerk error objects to user-facing strings.
// Uses .code first (most reliable), then conservative message matching.
function mapClerkError(err: any): string {
  if (!err) return 'Something went wrong. Please try again.';

  // Clerk may wrap errors: err.errors[0] or err directly
  const inner = err?.errors?.[0] ?? err;
  const code  = (inner?.code ?? '').toLowerCase();
  const msg   = (inner?.message ?? inner?.longMessage ?? err?.message ?? '').toLowerCase();

  // ── Code-based mapping ───────────────────────────────────────────────────
  if (code === 'form_identifier_exists')
    return 'An account already exists with this email. Sign in instead.';
  if (code === 'session_exists' || code === 'identifier_already_signed_in')
    return 'You are already signed in. Sign out to create another account.';
  if (code === 'form_password_pwned' || code === 'form_password_strength_insufficient')
    return 'This password is too common or weak. Choose a stronger one.';
  if (code === 'form_password_length_too_short')
    return 'Use at least 8 characters.';
  if (code === 'form_param_format_invalid' || code === 'form_param_nil')
    return msg.includes('email') ? 'Enter a valid email address.' : 'One of your entries is not in the right format.';
  if (code === 'form_code_incorrect')
    return 'Invalid code. Please check and try again.';
  if (code === 'verification_expired')
    return 'Code expired. Request a new one.';
  if (code === 'request_rate_limited')
    return 'Too many attempts. Please wait a moment and try again.';
  if (code === 'network_failure' || code === 'request_timeout')
    return "Couldn't connect. Check your internet and try again.";
  if (code === 'missing_publishable_key' || code === 'publishable_key_invalid')
    return 'Authentication configuration error. Please contact support.';
  if (code === 'form_identifier_not_found' || code === 'form_password_incorrect')
    return 'Incorrect email or password.';

  // ── Conservative message-string fallback ─────────────────────────────────
  // Only match unambiguous phrases — avoids false-positives from the word
  // "identifier" appearing in session-related errors.
  if (msg.includes('that email address is taken') || (msg.includes('email') && msg.includes('already exists') && !msg.includes('session')))
    return 'An account already exists with this email. Sign in instead.';
  if (msg.includes('already signed in') || (msg.includes('session') && msg.includes('exists')))
    return 'You are already signed in. Sign out to create another account.';
  if (msg.includes('password') && (msg.includes('weak') || msg.includes('pwned')))
    return 'Use a stronger password (8+ characters).';
  if ((msg.includes('invalid') || msg.includes('format')) && msg.includes('email'))
    return 'Enter a valid email address.';
  if (msg.includes('network') || msg.includes('fetch') || msg.includes('timeout'))
    return "Couldn't connect. Check your internet and try again.";
  if (msg.includes('incorrect') || msg.includes('wrong password') || msg.includes('invalid password'))
    return 'Incorrect email or password.';
  if (msg.includes('rate limit') || msg.includes('too many'))
    return 'Too many attempts. Please wait and try again.';

  // Return raw message as last resort — always better than hiding the error
  return inner?.message || err?.message || 'Something went wrong. Please try again.';
}

// ─── Shared UI ───────────────────────────────────────────────────────────────

function GradientBar({ fraction }: { fraction: number }) {
  const clamped = Math.min(1, Math.max(0, fraction));
  return (
    <View style={sbar.track}>
      <LinearGradient
        colors={[PURPLE, CYAN]}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
        style={[sbar.fill, { width: `${Math.round(clamped * 100)}%` }]}
      />
    </View>
  );
}
const sbar = StyleSheet.create({
  track: { height: 3, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' },
  fill:  { height: 3, borderRadius: 2 },
});

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[sc.chip, selected && sc.chipOn]}
      onPress={() => { Haptics.selectionAsync(); onPress(); }}
      activeOpacity={0.75}
    >
      <Text style={[sc.chipText, selected && sc.chipTextOn]}>{label}</Text>
    </TouchableOpacity>
  );
}
const sc = StyleSheet.create({
  chip:       { backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: 100, paddingHorizontal: 14, paddingVertical: 9 },
  chipOn:     { backgroundColor: PURPLE + '22', borderColor: PURPLE, borderWidth: 1.5 },
  chipText:   { fontSize: 14, fontFamily: 'Inter_500Medium', color: MUTED },
  chipTextOn: { color: PURPLE },
});

function RadioRow({ label, sub, selected, onPress }: { label: string; sub: string; selected: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[sr.row, selected && sr.rowOn]}
      onPress={() => { Haptics.selectionAsync(); onPress(); }}
      activeOpacity={0.8}
    >
      <View style={{ flex: 1 }}>
        <Text style={[sr.label, selected && sr.labelOn]}>{label}</Text>
        <Text style={sr.sub}>{sub}</Text>
      </View>
      <View style={[sr.circle, selected && sr.circleOn]}>
        {selected && <View style={sr.dot} />}
      </View>
    </TouchableOpacity>
  );
}
const sr = StyleSheet.create({
  row:     { backgroundColor: CARD, borderRadius: 16, borderWidth: 1, borderColor: BORDER, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowOn:   { borderColor: PURPLE, borderWidth: 1.5, backgroundColor: PURPLE + '0C' },
  label:   { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: FG, marginBottom: 2 },
  labelOn: { color: FG },
  sub:     { fontSize: 13, fontFamily: 'Inter_400Regular', color: MUTED, lineHeight: 18 },
  circle:  { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: BORDER, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  circleOn:{ borderColor: PURPLE },
  dot:     { width: 10, height: 10, borderRadius: 5, backgroundColor: PURPLE },
});

function PrimaryButton({ label, onPress, disabled, loading }: { label: string; onPress: () => void; disabled?: boolean; loading?: boolean }) {
  return (
    <TouchableOpacity activeOpacity={0.88} onPress={onPress} disabled={disabled || loading}>
      {disabled || loading ? (
        <View style={[spb.btn, spb.btnDisabled]}>
          {loading ? <ActivityIndicator color={MUTED} size="small" /> : <Text style={[spb.text, spb.textDisabled]}>{label}</Text>}
        </View>
      ) : (
        <LinearGradient colors={[PURPLE, CYAN]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={spb.btn}>
          <Text style={spb.text}>{label}</Text>
        </LinearGradient>
      )}
    </TouchableOpacity>
  );
}
const spb = StyleSheet.create({
  btn:         { borderRadius: 16, paddingVertical: 17, alignItems: 'center' },
  btnDisabled: { backgroundColor: 'rgba(255,255,255,0.06)' },
  text:        { fontSize: 16, fontFamily: 'Inter_700Bold', color: FG },
  textDisabled:{ color: MUTED2 },
});

// ─── Loading animation ────────────────────────────────────────────────────────
function LoadingAnimation({ steps, onDone }: { steps: string[]; onDone: () => void }) {
  const insets  = useSafeAreaInsets();
  const [done, setDone]   = useState<boolean[]>(steps.map(() => false));
  const [active, setActive] = useState(0);
  const progress = useRef(new Animated.Value(0)).current;
  const logoScale = useRef(new Animated.Value(0.7)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const total = steps.length * 700 + 400;

    Animated.parallel([
      Animated.spring(logoScale, { toValue: 1, damping: 14, stiffness: 100, useNativeDriver: true }),
      Animated.timing(logoOpacity, { toValue: 1, duration: 400, useNativeDriver: true }),
    ]).start();

    Animated.timing(progress, { toValue: 1, duration: total - 200, useNativeDriver: false }).start();

    const timers: ReturnType<typeof setTimeout>[] = [];
    steps.forEach((_, i) => {
      timers.push(
        setTimeout(() => {
          setActive(i);
          setTimeout(() => {
            setDone((prev) => { const n = [...prev]; n[i] = true; return n; });
          }, 500);
        }, i * 700),
      );
    });

    const endTimer = setTimeout(onDone, total);
    timers.push(endTimer);
    return () => timers.forEach(clearTimeout);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={[sl.root, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 40 }]}>
      <LinearGradient colors={[BG, '#0D0820', BG]} style={StyleSheet.absoluteFill} />

      {/* Glow */}
      <View style={sl.glow} />

      {/* Logo */}
      <Animated.View style={{ opacity: logoOpacity, transform: [{ scale: logoScale }], marginBottom: 52 }}>
        <LinearGradient colors={[PURPLE, CYAN]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={sl.logoBox}>
          <Text style={sl.logoLetter}>B</Text>
        </LinearGradient>
      </Animated.View>

      {/* Steps */}
      <View style={sl.stepsList}>
        {steps.map((label, i) => {
          const isDone = done[i];
          const isActive = active === i && !isDone;
          return (
            <View key={label} style={sl.stepRow}>
              <View style={[sl.stepIcon, isDone && sl.stepIconDone, isActive && sl.stepIconActive]}>
                {isDone ? (
                  <Feather name="check" size={14} color={FG} />
                ) : isActive ? (
                  <ActivityIndicator size="small" color={PURPLE} />
                ) : (
                  <View style={sl.stepDot} />
                )}
              </View>
              <Text style={[sl.stepLabel, (isDone || isActive) && sl.stepLabelActive]}>
                {label}
              </Text>
            </View>
          );
        })}
      </View>

      {/* Progress bar */}
      <View style={sl.barTrack}>
        <Animated.View
          style={[sl.barFill, {
            width: progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
          }]}
        >
          <LinearGradient colors={[PURPLE, CYAN]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
        </Animated.View>
      </View>
    </View>
  );
}
const sl = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 },
  glow: {
    position: 'absolute', width: 300, height: 300, borderRadius: 150,
    backgroundColor: '#8B5CF610',
  },
  logoBox: {
    width: 80, height: 80, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: PURPLE, shadowOpacity: 0.6, shadowRadius: 24, shadowOffset: { width: 0, height: 0 }, elevation: 16,
  },
  logoLetter: { fontSize: 46, fontFamily: 'Inter_700Bold', color: FG },
  stepsList: { width: '100%', gap: 18, marginBottom: 48 },
  stepRow:   { flexDirection: 'row', alignItems: 'center', gap: 14 },
  stepIcon:  {
    width: 30, height: 30, borderRadius: 15,
    borderWidth: 1, borderColor: BORDER,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  stepIconDone:   { backgroundColor: GREEN, borderColor: GREEN },
  stepIconActive: { borderColor: PURPLE },
  stepDot:        { width: 8, height: 8, borderRadius: 4, backgroundColor: MUTED2 },
  stepLabel:      { fontSize: 15, fontFamily: 'Inter_400Regular', color: MUTED },
  stepLabelActive:{ color: FG, fontFamily: 'Inter_500Medium' },
  barTrack: { width: '100%', height: 3, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' },
  barFill:  { height: 3, borderRadius: 2, overflow: 'hidden' },
});

// ─── Thread preview ───────────────────────────────────────────────────────────
function ThreadPreview({ firstName, onEnter }: { firstName: string; onEnter: () => void }) {
  const insets  = useSafeAreaInsets();
  const opacity = useRef(new Animated.Value(0)).current;
  const slideY  = useRef(new Animated.Value(30)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity,  { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.spring(slideY,   { toValue: 0, damping: 18, stiffness: 110, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <View style={[stp.root, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 24 }]}>
      <LinearGradient colors={[BG, '#0D0820', BG]} style={StyleSheet.absoluteFill} />
      <View style={stp.glow} />

      <Animated.View style={{ opacity, transform: [{ translateY: slideY }], flex: 1 }}>
        <Text style={stp.headline}>Your Thread is ready.</Text>
        {firstName ? <Text style={stp.sub}>Welcome, {firstName}.</Text> : null}

        {/* Mock Thread card */}
        <View style={stp.card}>
          {/* Image placeholder */}
          <LinearGradient
            colors={['#1a0a2e', '#0a1628', '#0a2818']}
            style={stp.imageArea}
          >
            <Text style={stp.imagePlaceholder}>NOIR COLLECTIVE</Text>
            <View style={stp.dropBadge}><Text style={stp.dropBadgeText}>NEW DROP</Text></View>
          </LinearGradient>

          {/* Card content */}
          <View style={stp.cardBody}>
            <View style={stp.brandRow}>
              <View style={stp.avatar}><Text style={stp.avatarLetter}>N</Text></View>
              <View>
                <Text style={stp.brandName}>Noir Collective</Text>
                <Text style={stp.timestamp}>Just dropped</Text>
              </View>
            </View>
            <Text style={stp.caption}>New season. Limited run. Copped or not?</Text>

            {/* Tagged product */}
            <View style={stp.taggedProduct}>
              <View style={stp.taggedThumb} />
              <View>
                <Text style={stp.taggedName}>Shadow Hoodie</Text>
                <Text style={stp.taggedPrice}>$128</Text>
              </View>
              <TouchableOpacity style={stp.shopBtn}>
                <Feather name="shopping-bag" size={14} color={FG} />
              </TouchableOpacity>
            </View>

            {/* Action icons */}
            <View style={stp.actions}>
              {(['heart', 'message-circle', 'repeat', 'bookmark', 'shopping-bag'] as const).map((icon) => (
                <TouchableOpacity key={icon} style={stp.actionBtn}>
                  <Feather name={icon} size={20} color={MUTED} />
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      </Animated.View>

      <Animated.View style={{ opacity }}>
        <PrimaryButton label="Enter my Thread" onPress={onEnter} />
      </Animated.View>
    </View>
  );
}
const stp = StyleSheet.create({
  root:      { flex: 1, backgroundColor: BG, paddingHorizontal: 20 },
  glow:      { position: 'absolute', top: -40, width: '80%', height: 200, borderRadius: 120, backgroundColor: '#8B5CF610', alignSelf: 'center' },
  headline:  { fontSize: 30, fontFamily: 'Inter_700Bold', color: FG, letterSpacing: -0.6, marginBottom: 6 },
  sub:       { fontSize: 15, fontFamily: 'Inter_400Regular', color: MUTED, marginBottom: 24 },
  card:      { backgroundColor: CARD, borderRadius: 20, borderWidth: 1, borderColor: BORDER, overflow: 'hidden', marginBottom: 24, flex: 1 },
  imageArea: { height: 180, alignItems: 'center', justifyContent: 'center' },
  imagePlaceholder: { fontSize: 13, fontFamily: 'Inter_700Bold', color: 'rgba(255,255,255,0.2)', letterSpacing: 4 },
  dropBadge: { position: 'absolute', top: 12, right: 12, backgroundColor: PURPLE, borderRadius: 100, paddingHorizontal: 10, paddingVertical: 4 },
  dropBadgeText: { fontSize: 10, fontFamily: 'Inter_700Bold', color: FG, letterSpacing: 1 },
  cardBody:  { padding: 16, gap: 12 },
  brandRow:  { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar:    { width: 32, height: 32, borderRadius: 16, backgroundColor: PURPLE + '44', alignItems: 'center', justifyContent: 'center' },
  avatarLetter: { fontSize: 14, fontFamily: 'Inter_700Bold', color: FG },
  brandName: { fontSize: 14, fontFamily: 'Inter_700Bold', color: FG },
  timestamp: { fontSize: 11, fontFamily: 'Inter_400Regular', color: MUTED },
  caption:   { fontSize: 14, fontFamily: 'Inter_400Regular', color: FG, lineHeight: 20 },
  taggedProduct: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 12, padding: 10 },
  taggedThumb: { width: 36, height: 36, borderRadius: 8, backgroundColor: MUTED2 },
  taggedName:  { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: FG },
  taggedPrice: { fontSize: 12, fontFamily: 'Inter_400Regular', color: MUTED },
  shopBtn:     { marginLeft: 'auto', width: 32, height: 32, borderRadius: 16, backgroundColor: PURPLE + '33', alignItems: 'center', justifyContent: 'center' },
  actions:   { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 4 },
  actionBtn: { padding: 4 },
});

// ─── Dashboard preview ────────────────────────────────────────────────────────
function DashboardPreview({ firstName, brandName, onOpen }: { firstName: string; brandName: string; onOpen: () => void }) {
  const insets  = useSafeAreaInsets();
  const opacity = useRef(new Animated.Value(0)).current;
  const slideY  = useRef(new Animated.Value(30)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity,  { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.spring(slideY,   { toValue: 0, damping: 18, stiffness: 110, useNativeDriver: true }),
    ]).start();
  }, []);

  const STATS = [
    { label: 'Revenue',    value: '$0',  icon: '💰' },
    { label: 'Orders',     value: '0',   icon: '📦' },
    { label: 'Visitors',   value: '0',   icon: '👥' },
    { label: 'Conversion', value: '0%',  icon: '📈' },
  ];

  const MODULES = [
    { icon: '🎨', label: 'Design Studio' },
    { icon: '📦', label: 'Products' },
    { icon: '🏭', label: 'Manufacturer Hub' },
    { icon: '🛍', label: 'Store Builder' },
    { icon: '📋', label: 'Orders' },
    { icon: '📊', label: 'Analytics' },
  ];

  return (
    <View style={[sdp.root, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 }]}>
      <LinearGradient colors={[BG, '#0D0820', BG]} style={StyleSheet.absoluteFill} />
      <View style={sdp.glow} />

      <Animated.ScrollView
        style={{ opacity }}
        contentContainerStyle={{ paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={{ transform: [{ translateY: slideY }] }}>
          <Text style={sdp.headline}>Your brand is ready.</Text>
          {brandName ? <Text style={sdp.brandName}>{brandName}</Text> : null}
          <Text style={sdp.greeting}>Good to have you, {firstName || 'Founder'}. 👋</Text>

          {/* Stats grid */}
          <View style={sdp.statsGrid}>
            {STATS.map((s) => (
              <View key={s.label} style={sdp.statCard}>
                <Text style={sdp.statIcon}>{s.icon}</Text>
                <Text style={sdp.statValue}>{s.value}</Text>
                <Text style={sdp.statLabel}>{s.label}</Text>
              </View>
            ))}
          </View>

          {/* Setup progress */}
          <View style={sdp.progressCard}>
            <Text style={sdp.progressTitle}>Setup progress</Text>
            <View style={sdp.progressTrack}>
              <LinearGradient
                colors={[PURPLE, CYAN]}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                style={[sdp.progressFill, { width: '12%' }]}
              />
            </View>
            <Text style={sdp.progressNote}>Complete setup to unlock all features</Text>
          </View>

          {/* Modules grid */}
          <Text style={sdp.sectionLabel}>Your workspace</Text>
          <View style={sdp.modulesGrid}>
            {MODULES.map((m) => (
              <View key={m.label} style={sdp.moduleCard}>
                <Text style={sdp.moduleIcon}>{m.icon}</Text>
                <Text style={sdp.moduleLabel}>{m.label}</Text>
              </View>
            ))}
          </View>
        </Animated.View>
      </Animated.ScrollView>

      <Animated.View style={{ opacity, paddingHorizontal: 0 }}>
        <PrimaryButton label="Open my dashboard" onPress={onOpen} />
      </Animated.View>
    </View>
  );
}
const sdp = StyleSheet.create({
  root:       { flex: 1, backgroundColor: BG, paddingHorizontal: 20 },
  glow:       { position: 'absolute', top: -40, width: '80%', height: 200, borderRadius: 120, backgroundColor: '#22D3EE08', alignSelf: 'center' },
  headline:   { fontSize: 28, fontFamily: 'Inter_700Bold', color: FG, letterSpacing: -0.5, marginBottom: 4 },
  brandName:  { fontSize: 18, fontFamily: 'Inter_700Bold', color: CYAN, marginBottom: 4 },
  greeting:   { fontSize: 14, fontFamily: 'Inter_400Regular', color: MUTED, marginBottom: 20 },
  statsGrid:  { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  statCard:   { width: (SW - 40 - 10) / 2, backgroundColor: CARD, borderRadius: 16, borderWidth: 1, borderColor: BORDER, padding: 14, gap: 4 },
  statIcon:   { fontSize: 18, marginBottom: 4 },
  statValue:  { fontSize: 22, fontFamily: 'Inter_700Bold', color: FG },
  statLabel:  { fontSize: 12, fontFamily: 'Inter_400Regular', color: MUTED },
  progressCard: { backgroundColor: CARD, borderRadius: 16, borderWidth: 1, borderColor: BORDER, padding: 14, marginBottom: 20, gap: 8 },
  progressTitle:{ fontSize: 13, fontFamily: 'Inter_600SemiBold', color: FG },
  progressTrack:{ height: 4, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: 4, borderRadius: 2 },
  progressNote: { fontSize: 12, fontFamily: 'Inter_400Regular', color: MUTED },
  sectionLabel: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: MUTED, marginBottom: 10, letterSpacing: 0.5 },
  modulesGrid:  { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  moduleCard:   { width: (SW - 40 - 20) / 3, backgroundColor: CARD, borderRadius: 14, borderWidth: 1, borderColor: BORDER, padding: 12, alignItems: 'center', gap: 6 },
  moduleIcon:   { fontSize: 22 },
  moduleLabel:  { fontSize: 11, fontFamily: 'Inter_500Medium', color: MUTED, textAlign: 'center' },
});

// ─── Notifications step ────────────────────────────────────────────────────────
function NotificationsStep({ flow, onEnable, onSkip }: { flow: Flow; onEnable: () => void; onSkip: () => void }) {
  const insets  = useSafeAreaInsets();
  const opacity = useRef(new Animated.Value(0)).current;
  const slideY  = useRef(new Animated.Value(30)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 450, useNativeDriver: true }),
      Animated.spring(slideY,  { toValue: 0, damping: 18, stiffness: 110, useNativeDriver: true }),
    ]).start();
  }, []);

  const desc = flow === 'buyer'
    ? 'Get drop alerts, friend requests, messages and order updates.'
    : 'Get order, production, payout and customer alerts instantly.';

  const items = flow === 'buyer'
    ? ['New brand drops', 'Messages from brands', 'Order updates', 'Friend requests']
    : ['New orders', 'Production milestones', 'Payout confirmations', 'Customer messages'];

  return (
    <View style={[sn.root, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 32 }]}>
      <LinearGradient colors={[BG, '#0D0820', BG]} style={StyleSheet.absoluteFill} />
      <View style={sn.glow} />

      <Animated.View style={[sn.body, { opacity, transform: [{ translateY: slideY }] }]}>
        {/* Bell icon */}
        <View style={sn.bellWrap}>
          <LinearGradient colors={[PURPLE, CYAN]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={sn.bellBg}>
            <Feather name="bell" size={32} color={FG} />
          </LinearGradient>
        </View>

        <Text style={sn.headline}>Never miss what matters.</Text>
        <Text style={sn.sub}>{desc}</Text>

        {/* Notification examples */}
        <View style={sn.examples}>
          {items.map((item) => (
            <View key={item} style={sn.exampleRow}>
              <View style={sn.exampleDot} />
              <Text style={sn.exampleText}>{item}</Text>
            </View>
          ))}
        </View>
      </Animated.View>

      <Animated.View style={[sn.btns, { opacity }]}>
        <TouchableOpacity
          activeOpacity={0.88}
          onPress={async () => {
            try { await Notifications.requestPermissionsAsync(); } catch { /* not supported in web */ }
            onEnable();
          }}
        >
          <LinearGradient colors={[PURPLE, CYAN]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={sn.enableBtn}>
            <Text style={sn.enableBtnText}>Enable notifications</Text>
          </LinearGradient>
        </TouchableOpacity>

        <TouchableOpacity style={sn.skipBtn} onPress={onSkip} activeOpacity={0.7}>
          <Text style={sn.skipText}>Not now</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}
const sn = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG, paddingHorizontal: 24 },
  glow: { position: 'absolute', top: 0, width: '80%', height: 250, borderRadius: 150, backgroundColor: '#8B5CF612', alignSelf: 'center' },
  body: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingBottom: 40 },
  bellWrap: { marginBottom: 32 },
  bellBg:   { width: 80, height: 80, borderRadius: 24, alignItems: 'center', justifyContent: 'center', shadowColor: PURPLE, shadowOpacity: 0.5, shadowRadius: 20, shadowOffset: { width: 0, height: 0 }, elevation: 12 },
  headline: { fontSize: 28, fontFamily: 'Inter_700Bold', color: FG, textAlign: 'center', letterSpacing: -0.5, marginBottom: 12 },
  sub:      { fontSize: 15, fontFamily: 'Inter_400Regular', color: MUTED, textAlign: 'center', lineHeight: 22, marginBottom: 32 },
  examples: { gap: 12, width: '100%' },
  exampleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  exampleDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: PURPLE },
  exampleText:{ fontSize: 14, fontFamily: 'Inter_400Regular', color: FG },
  btns: { gap: 12 },
  enableBtn: { borderRadius: 16, paddingVertical: 17, alignItems: 'center' },
  enableBtnText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: FG },
  skipBtn: { paddingVertical: 14, alignItems: 'center' },
  skipText: { fontSize: 15, fontFamily: 'Inter_500Medium', color: MUTED },
});

// ─── Success screen ────────────────────────────────────────────────────────────
function SuccessScreen({ flow, firstName, brandName, onFinish, onDevReset }: { flow: Flow; firstName: string; brandName: string; onFinish: () => void; onDevReset: () => void }) {
  const insets  = useSafeAreaInsets();
  const opacity = useRef(new Animated.Value(0)).current;
  const scale   = useRef(new Animated.Value(0.85)).current;
  const slideY  = useRef(new Animated.Value(40)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 550, useNativeDriver: true }),
      Animated.spring(scale,   { toValue: 1, damping: 16, stiffness: 110, useNativeDriver: true }),
      Animated.spring(slideY,  { toValue: 0, damping: 18, stiffness: 110, useNativeDriver: true }),
    ]).start();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, []);

  const ctaLabel = flow === 'buyer' ? 'Start exploring' : 'Go to Dashboard';
  const desc = flow === 'buyer'
    ? 'Your next favorite brand is one swipe away.'
    : 'Your brand now has one home for design, production, selling and growth.';

  return (
    <View style={[ss.root, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 32 }]}>
      <LinearGradient colors={[BG, '#0D0820', BG]} style={StyleSheet.absoluteFill} />
      <View style={ss.glowTop} />
      <View style={ss.glowBottom} />

      <Animated.View style={[ss.body, { opacity, transform: [{ scale }, { translateY: slideY }] }]}>
        {/* Checkmark circle */}
        <TouchableOpacity
          onLongPress={() => {
            Alert.alert(
              '🛠 Developer Reset',
              'Reset onboarding so you can run through the flow again?',
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Reset', style: 'destructive', onPress: onDevReset },
              ],
            );
          }}
          delayLongPress={1500}
          activeOpacity={1}
        >
          <LinearGradient colors={[PURPLE, CYAN]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={ss.checkCircle}>
            <Feather name="check" size={36} color={FG} />
          </LinearGradient>
        </TouchableOpacity>

        <Text style={ss.headline}>Welcome to{'\n'}Brandthread.</Text>

        {flow === 'seller' && brandName ? (
          <View style={ss.brandBadge}>
            <Text style={ss.brandBadgeText}>{brandName}</Text>
          </View>
        ) : null}

        <Text style={ss.desc}>{desc}</Text>

        {/* Feature rows */}
        <View style={ss.features}>
          {(flow === 'buyer'
            ? ['Thread — your personal brand feed', 'Discover drops before they sell out', 'Chat directly with brands', 'Track every order in one place']
            : ['Design Studio & AI tools ready', 'Manufacturer network unlocked', 'Your store is ready to launch', 'Analytics dashboard activated']
          ).map((f) => (
            <View key={f} style={ss.featureRow}>
              <Feather name="check-circle" size={16} color={GREEN} />
              <Text style={ss.featureText}>{f}</Text>
            </View>
          ))}
        </View>
      </Animated.View>

      <Animated.View style={{ opacity }}>
        <PrimaryButton label={ctaLabel} onPress={onFinish} />
      </Animated.View>
    </View>
  );
}
const ss = StyleSheet.create({
  root:       { flex: 1, backgroundColor: BG, paddingHorizontal: 24 },
  glowTop:    { position: 'absolute', top: -60, width: '80%', height: 250, borderRadius: 150, backgroundColor: '#8B5CF614', alignSelf: 'center' },
  glowBottom: { position: 'absolute', bottom: -60, width: '80%', height: 200, borderRadius: 120, backgroundColor: '#22D3EE08', alignSelf: 'center' },
  body:       { flex: 1, justifyContent: 'center' },
  checkCircle:{ width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', marginBottom: 28, shadowColor: PURPLE, shadowOpacity: 0.5, shadowRadius: 24, shadowOffset: { width: 0, height: 0 }, elevation: 12 },
  headline:   { fontSize: 36, fontFamily: 'Inter_700Bold', color: FG, letterSpacing: -1, lineHeight: 42, marginBottom: 12 },
  brandBadge: { alignSelf: 'flex-start', backgroundColor: CYAN + '18', borderRadius: 100, paddingHorizontal: 14, paddingVertical: 5, marginBottom: 12, borderWidth: 1, borderColor: CYAN + '40' },
  brandBadgeText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: CYAN },
  desc:       { fontSize: 15, fontFamily: 'Inter_400Regular', color: MUTED, lineHeight: 22, marginBottom: 28 },
  features:   { gap: 12 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  featureText:{ fontSize: 14, fontFamily: 'Inter_400Regular', color: FG },
});

// ─── Auth step ────────────────────────────────────────────────────────────────
type AuthPhase = 'form' | 'verify';

interface AuthStepProps {
  flow: Flow;
  firstName: string;
  brandName: string;
  signUp: ReturnType<typeof useSignUp>['signUp'];
  signIn: ReturnType<typeof useSignIn>['signIn'];
  startGoogleOAuth: () => Promise<any>;
  startAppleOAuth: () => Promise<any>;
  onAuthComplete: () => void;
  onDevClear: () => Promise<void>;
}

function AuthStep({ flow, firstName, brandName, signUp, signIn: _signIn, startGoogleOAuth, startAppleOAuth, onAuthComplete, onDevClear }: AuthStepProps) {
  const router = useRouter();
  const { isSignedIn, signOut } = useAuth();
  const { user } = useUser();

  const [phase, setPhase]               = useState<AuthPhase>('form');
  const [email, setEmail]               = useState('');
  const [password, setPassword]         = useState('');
  const [code, setCode]                 = useState('');
  const [showPw, setShowPw]             = useState(false);
  const [loading, setLoading]           = useState(false);
  const [oauthLoading, setOAuth]        = useState('');
  const [error, setError]               = useState('');
  const [clearingSession, setClearSession] = useState(false);

  const canSubmit = email.includes('@') && password.length >= 8;
  const canVerify = code.length === 6;
  const currentEmail = user?.primaryEmailAddress?.emailAddress ?? '';

  // ── Clear local test session ─────────────────────────────────────────────────
  async function handleClearSession() {
    setClearSession(true);
    setError('');
    try {
      if (isSignedIn) await signOut();
      await onDevClear();
    } catch (e) {
      console.warn('[Auth] Clear session error:', e);
    } finally {
      setClearSession(false);
    }
  }

  // ── Sign-up ──────────────────────────────────────────────────────────────────
  async function handleSignUp() {
    if (!canSubmit || loading) return;

    // DEV LOGGING ─────────────────────────────────────────────────────────────
    console.log('[Auth] ── handleSignUp ──────────────────────────────────────');
    console.log('[Auth] Email submitted  :', email.trim().toLowerCase());
    console.log('[Auth] Session exists   :', isSignedIn);
    console.log('[Auth] Provider         : Clerk email/password');
    // ─────────────────────────────────────────────────────────────────────────

    // CRITICAL: if a session already exists Clerk returns session_exists, which
    // the old code misclassified as "email already taken". Block this early.
    if (isSignedIn) {
      const who = currentEmail ? `as ${currentEmail}` : 'with another account';
      setError(`You are currently signed in ${who}. Tap "Sign out and create another account" below.`);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const nameParts = (firstName || brandName || '').trim().split(/\s+/);
      const { error: err } = await signUp.password({
        emailAddress: email.trim().toLowerCase(),
        password,
        firstName: nameParts[0] || undefined,
        lastName:  nameParts.slice(1).join(' ') || undefined,
      });

      // DEV LOGGING ───────────────────────────────────────────────────────────
      if (err) {
        console.log('[Auth] Sign-up error code       :', (err as any).code);
        console.log('[Auth] Sign-up error message    :', (err as any).message);
        console.log('[Auth] Sign-up error longMessage:', (err as any).longMessage);
      } else {
        console.log('[Auth] Sign-up password step succeeded — sending verification code');
      }
      // ───────────────────────────────────────────────────────────────────────

      if (err) { setError(mapClerkError(err)); return; }

      await signUp.verifications.sendEmailCode();
      setPhase('verify');
    } catch (e: any) {
      console.log('[Auth] Sign-up exception code   :', e?.code);
      console.log('[Auth] Sign-up exception message:', e?.message);
      setError(mapClerkError(e));
    } finally {
      setLoading(false);
    }
  }

  // ── Verify email code ────────────────────────────────────────────────────────
  async function handleVerify() {
    if (!canVerify || loading) return;
    setLoading(true);
    setError('');
    try {
      await signUp.verifications.verifyEmailCode({ code });

      console.log('[Auth] Verification status:', signUp.status);
      console.log('[Auth] Profile creation ran: true');

      if (signUp.status === 'complete') {
        console.log('[Auth] Finalizing session…');
        await signUp.finalize({
          navigate: ({ decorateUrl }: { decorateUrl: (url: string) => string }) => {
            const url = decorateUrl('/onboarding');
            if (url.startsWith('http') && typeof window !== 'undefined') {
              window.location.href = url;
            } else {
              router.replace('/onboarding' as never);
            }
          },
        });
        onAuthComplete();
      }
    } catch (e: any) {
      console.log('[Auth] Verify exception:', e?.code, e?.message);
      setError(mapClerkError(e));
    } finally {
      setLoading(false);
    }
  }

  // ── OAuth ────────────────────────────────────────────────────────────────────
  async function handleOAuth(startFlow: () => Promise<any>, provider: string) {
    setOAuth(provider);
    setError('');
    try {
      const result = await startFlow();
      if (result?.createdSessionId && result?.setActive) {
        await result.setActive({ session: result.createdSessionId });
      }
      onAuthComplete();
    } catch (e: any) {
      if (e?.message?.includes('cancel') || e?.message?.includes('dismiss')) { setOAuth(''); return; }
      setError(`${provider} sign-in failed. Please try again.`);
    } finally {
      setOAuth('');
    }
  }

  // ── Active session warning ───────────────────────────────────────────────────
  if (isSignedIn && phase === 'form') {
    return (
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={sa.scroll} keyboardShouldPersistTaps="handled">
          <Text style={sa.headline}>Already signed in</Text>
          <Text style={sa.sub}>
            {currentEmail
              ? `You are currently signed in as ${currentEmail}.`
              : 'You are currently signed in.'}
            {'\n\n'}Sign out first to create a new account, or continue with your current account.
          </Text>

          <TouchableOpacity
            style={sa.sessionBtn}
            onPress={handleClearSession}
            disabled={clearingSession}
            activeOpacity={0.85}
          >
            <LinearGradient colors={[PURPLE, CYAN]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={sa.sessionBtnGrad}>
              {clearingSession
                ? <ActivityIndicator color={FG} size="small" />
                : <Text style={sa.sessionBtnText}>Sign out and create another account</Text>}
            </LinearGradient>
          </TouchableOpacity>

          <TouchableOpacity style={sa.continueBtn} onPress={onAuthComplete} activeOpacity={0.8}>
            <Text style={sa.continueBtnText}>Continue with current account →</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ── Email verification ───────────────────────────────────────────────────────
  if (phase === 'verify') {
    return (
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={sa.scroll} keyboardShouldPersistTaps="handled">
          <Text style={sa.headline}>Check your email</Text>
          <Text style={sa.sub}>We sent a 6-digit code to {email}</Text>

          <View style={sa.inputWrap}>
            <Text style={sa.label}>Verification code</Text>
            <TextInput
              style={[sa.input, sa.codeInput]}
              placeholder="000000"
              placeholderTextColor={MUTED2}
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              maxLength={6}
              autoFocus
            />
          </View>

          {error ? <Text style={sa.error}>{error}</Text> : null}

          <PrimaryButton
            label={loading ? 'Verifying…' : 'Verify email'}
            onPress={handleVerify}
            disabled={!canVerify}
            loading={loading}
          />

          <TouchableOpacity style={sa.resendBtn} onPress={() => signUp.verifications.sendEmailCode()}>
            <Text style={sa.resendText}>{"Didn't get it? "}<Text style={{ color: PURPLE }}>Resend</Text></Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ── Sign-up form ─────────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={sa.scroll} keyboardShouldPersistTaps="handled">
        <Text style={sa.headline}>Create your account</Text>
        <Text style={sa.sub}>One account for everything you build.</Text>

        {/* OAuth */}
        <TouchableOpacity
          style={sa.oauthBtn}
          onPress={() => handleOAuth(startGoogleOAuth, 'Google')}
          activeOpacity={0.85}
          disabled={!!oauthLoading || loading}
        >
          {oauthLoading === 'Google' ? <ActivityIndicator color={FG} size="small" /> : <>
            <Text style={sa.oauthIcon}>G</Text>
            <Text style={sa.oauthText}>Continue with Google</Text>
          </>}
        </TouchableOpacity>

        {Platform.OS === 'ios' && (
          <TouchableOpacity
            style={[sa.oauthBtn, sa.appleBtn]}
            onPress={() => handleOAuth(startAppleOAuth, 'Apple')}
            activeOpacity={0.85}
            disabled={!!oauthLoading || loading}
          >
            {oauthLoading === 'Apple' ? <ActivityIndicator color={BG} size="small" /> : <>
              <Text style={[sa.oauthIcon, { color: BG }]}>🍎</Text>
              <Text style={[sa.oauthText, { color: BG }]}>Continue with Apple</Text>
            </>}
          </TouchableOpacity>
        )}

        {/* Divider */}
        <View style={sa.divider}>
          <View style={sa.divLine} />
          <Text style={sa.divText}>or</Text>
          <View style={sa.divLine} />
        </View>

        {/* Email */}
        <View style={sa.inputWrap}>
          <Text style={sa.label}>Email address</Text>
          <TextInput
            style={sa.input}
            placeholder="you@yourbrand.com"
            placeholderTextColor={MUTED2}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
          />
        </View>

        {/* Password */}
        <View style={sa.inputWrap}>
          <Text style={sa.label}>Password</Text>
          <View style={sa.pwRow}>
            <TextInput
              style={[sa.input, sa.pwInput]}
              placeholder="Minimum 8 characters"
              placeholderTextColor={MUTED2}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPw}
              autoComplete="new-password"
            />
            <TouchableOpacity style={sa.eyeBtn} onPress={() => setShowPw(v => !v)}>
              <Feather name={showPw ? 'eye-off' : 'eye'} size={18} color={MUTED} />
            </TouchableOpacity>
          </View>
          {password.length > 0 && password.length < 8 && (
            <Text style={sa.hint}>Use at least 8 characters</Text>
          )}
        </View>

        {error ? <Text style={sa.error}>{error}</Text> : null}

        <PrimaryButton
          label={loading ? 'Creating account…' : 'Create account'}
          onPress={handleSignUp}
          disabled={!canSubmit}
          loading={loading}
        />

        <Text style={sa.legal}>
          By continuing you agree to our{' '}
          <Text style={{ color: MUTED }}>Terms</Text>
          {' and '}
          <Text style={{ color: MUTED }}>Privacy Policy</Text>.
        </Text>

        {/* Developer: clear local test session */}
        <TouchableOpacity
          style={sa.devClearBtn}
          onPress={handleClearSession}
          disabled={clearingSession}
          activeOpacity={0.7}
        >
          {clearingSession
            ? <ActivityIndicator color={MUTED2} size="small" />
            : <Text style={sa.devClearText}>Clear local test session</Text>}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
const sa = StyleSheet.create({
  scroll:    { flexGrow: 1, paddingVertical: 8, gap: 0 },
  headline:  { fontSize: 28, fontFamily: 'Inter_700Bold', color: FG, letterSpacing: -0.5, marginBottom: 6 },
  sub:       { fontSize: 14, fontFamily: 'Inter_400Regular', color: MUTED, marginBottom: 24 },
  oauthBtn:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, borderRadius: 14, borderWidth: 1, borderColor: BORDER, paddingVertical: 14, backgroundColor: CARD, marginBottom: 10 },
  appleBtn:  { backgroundColor: FG },
  oauthIcon: { fontSize: 16, fontFamily: 'Inter_700Bold', color: FG },
  oauthText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: FG },
  divider:   { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 18 },
  divLine:   { flex: 1, height: 1, backgroundColor: BORDER },
  divText:   { fontSize: 13, fontFamily: 'Inter_400Regular', color: MUTED },
  inputWrap: { marginBottom: 14 },
  label:     { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: MUTED, marginBottom: 6 },
  input:     { backgroundColor: INPUT_BG, borderWidth: 1, borderColor: INPUT_BD, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15, fontFamily: 'Inter_400Regular', color: FG },
  codeInput: { letterSpacing: 8, fontSize: 22, textAlign: 'center', fontFamily: 'Inter_700Bold' },
  pwRow:     { flexDirection: 'row', alignItems: 'center', backgroundColor: INPUT_BG, borderWidth: 1, borderColor: INPUT_BD, borderRadius: 12 },
  pwInput:   { flex: 1, borderWidth: 0, backgroundColor: 'transparent' },
  eyeBtn:    { paddingHorizontal: 14 },
  hint:      { fontSize: 12, fontFamily: 'Inter_400Regular', color: MUTED, marginTop: 4 },
  error:     { color: ERR, fontSize: 13, fontFamily: 'Inter_400Regular', marginBottom: 12 },
  resendBtn: { paddingVertical: 12, alignItems: 'center', marginTop: 8 },
  resendText:{ fontSize: 14, fontFamily: 'Inter_400Regular', color: MUTED },
  legal:     { fontSize: 12, fontFamily: 'Inter_400Regular', color: MUTED2, textAlign: 'center', lineHeight: 18, marginTop: 14 },
  // Active-session warning
  sessionBtn:     { marginTop: 8, marginBottom: 12, borderRadius: 16, overflow: 'hidden' },
  sessionBtnGrad: { paddingVertical: 17, alignItems: 'center', paddingHorizontal: 20 },
  sessionBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: FG },
  continueBtn:    { paddingVertical: 14, alignItems: 'center' },
  continueBtnText:{ fontSize: 14, fontFamily: 'Inter_500Medium', color: MUTED },
  // Developer reset
  devClearBtn:    { paddingVertical: 12, alignItems: 'center', marginTop: 10 },
  devClearText:   { fontSize: 11, fontFamily: 'Inter_400Regular', color: MUTED2, textDecorationLine: 'underline' },
});

// ─── Main onboarding component ────────────────────────────────────────────────
export default function OnboardingScreen() {
  const { isSignedIn, signOut } = useAuth();
  const { signUp }              = useSignUp();
  const { signIn }              = useSignIn();
  const { startOAuthFlow: startGoogleOAuth } = useOAuth({ strategy: 'oauth_google' });
  const { startOAuthFlow: startAppleOAuth }  = useOAuth({ strategy: 'oauth_apple' });

  const router  = useRouter();
  const insets  = useSafeAreaInsets();

  const [flow, setFlow]           = useState<Flow | null>(null);
  const [step, setStep]           = useState(0);
  const [ready, setReady]         = useState(false);

  // Buyer data
  const [firstName, setFirstName]         = useState('');
  const [styleInterests, setStyleArr]     = useState<string[]>([]);

  // Seller data
  const [brandName, setBrandName]         = useState('');
  const [brandStage, setBrandStage]       = useState('');
  const [productModel, setProductModel]   = useState('');
  const [goals, setGoals]                 = useState<string[]>([]);

  const slideAnim = useRef(new Animated.Value(0)).current;

  // ── Restore draft on mount ──────────────────────────────────────────────────
  useEffect(() => {
    async function init() {
      const [[, roleVal], [, draftVal]] = await AsyncStorage.multiGet(['user_role', DRAFT_KEY]);
      const role = roleVal as Flow | null;
      let restored = false;

      if (draftVal) {
        try {
          const draft = JSON.parse(draftVal);
          if (draft.flow) {
            setFlow(draft.flow);
            setStep(draft.step ?? 0);
            setFirstName(draft.firstName ?? '');
            setStyleArr(draft.styleInterests ?? []);
            setBrandName(draft.brandName ?? '');
            setBrandStage(draft.brandStage ?? '');
            setProductModel(draft.productModel ?? '');
            setGoals(draft.goals ?? []);
            restored = true;
          }
        } catch { /* bad json, ignore */ }
      }

      if (!restored && role) {
        setFlow(role);
        setStep(0);
      }
      setReady(true);
    }
    init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Persist draft ───────────────────────────────────────────────────────────
  const saveDraft = useCallback(async (overrides?: Record<string, unknown>) => {
    const data = {
      flow, step, firstName, styleInterests, brandName, brandStage, productModel, goals,
      ...overrides,
    };
    await AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(data));
  }, [flow, step, firstName, styleInterests, brandName, brandStage, productModel, goals]);

  // ── Auth completion handler (OAuth without remount) ─────────────────────────
  const handleAuthComplete = useCallback(() => {
    if (!flow) return;
    const loadingStep = flow === 'buyer' ? 3 : 6;
    setStep(loadingStep);
  }, [flow]);

  // ── Watch for OAuth isSignedIn change ────────────────────────────────────────
  const prevSignedIn = useRef<boolean | null>(null);
  useEffect(() => {
    if (!ready || !flow) return;
    if (prevSignedIn.current === null) { prevSignedIn.current = isSignedIn ?? false; return; }
    if (!prevSignedIn.current && isSignedIn) {
      const loadingStep = flow === 'buyer' ? 3 : 6;
      setStep(loadingStep);
    }
    prevSignedIn.current = isSignedIn ?? false;
  }, [isSignedIn, ready, flow]);

  // ── Navigation helpers ──────────────────────────────────────────────────────
  function animateTo(next: number, dir: 1 | -1) {
    Animated.timing(slideAnim, { toValue: dir * -SW, duration: 220, useNativeDriver: true }).start(() => {
      setStep(next);
      slideAnim.setValue(dir * SW);
      Animated.timing(slideAnim, { toValue: 0, duration: 220, useNativeDriver: true }).start();
    });
  }

  function goNext(overrideStep?: number) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const next = overrideStep ?? step + 1;
    saveDraft({ step: next });
    animateTo(next, 1);
  }

  function goBack() {
    if (step === 0) { router.back(); return; }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    animateTo(step - 1, -1);
  }

  // ── Finish handlers ─────────────────────────────────────────────────────────
  async function finishBuyer() {
    await AsyncStorage.multiSet([
      [ONBOARDING_KEY, 'true'],
      ['user_role', 'buyer'],
      ['onboarding_first_name', firstName],
      ['onboarding_style_interests', JSON.stringify(styleInterests)],
    ]);
    await AsyncStorage.removeItem(DRAFT_KEY);
    router.replace('/(buyer)/' as never);
  }

  async function finishSeller() {
    await AsyncStorage.multiSet([
      [ONBOARDING_KEY, 'true'],
      ['user_role', 'seller'],
      ['onboarding_first_name', firstName],
      ['onboarding_brand_name', brandName],
    ]);
    await AsyncStorage.removeItem(DRAFT_KEY);
    router.replace('/(tabs)/' as never);
  }

  // ── Developer reset ─────────────────────────────────────────────────────────
  // Signs out of Clerk, wipes all local test state. Does NOT delete backend accounts.
  async function devReset() {
    try { if (isSignedIn) await signOut(); } catch {}
    await AsyncStorage.multiRemove([
      ONBOARDING_KEY, 'user_role', DRAFT_KEY,
      'onboarding_first_name', 'onboarding_brand_name',
      'onboarding_style_interests', 'splash_seen',
    ]);
    router.replace('/splash' as never);
  }

  // ── Validation ──────────────────────────────────────────────────────────────
  function canContinue(): boolean {
    if (!flow) return false;
    if (flow === 'buyer') {
      if (step === 0) return firstName.trim().length >= 2;
      if (step === 1) return styleInterests.length >= 3;
    }
    if (flow === 'seller') {
      if (step === 0) return firstName.trim().length >= 2;
      if (step === 1) return brandName.trim().length >= 1;
      if (step === 2) return !!brandStage;
      if (step === 3) return !!productModel;
      if (step === 4) return goals.length >= 1;
    }
    return true;
  }

  // ── Progress bar ────────────────────────────────────────────────────────────
  function showsProgressBar(): boolean {
    if (!flow) return false;
    if (flow === 'buyer')  return step <= 2;
    if (flow === 'seller') return step <= 5;
    return false;
  }

  function progressFraction(): number {
    if (!flow) return 0;
    if (flow === 'buyer')  return (step + 1) / 3;
    if (flow === 'seller') return (step + 1) / 6;
    return 0;
  }

  // ── Step rendering ──────────────────────────────────────────────────────────
  function renderStep() {
    if (!flow) return null;

    /* ─── BUYER STEPS ─── */
    if (flow === 'buyer') {
      // Step 0: Name
      if (step === 0) return (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={sm.scroll} keyboardShouldPersistTaps="handled">
            <Text style={sm.stepHeadline}>What should{'\n'}we call you?</Text>
            <Text style={sm.stepSub}>This is how your profile will appear.</Text>
            <View style={sm.inputWrap}>
              <Text style={sm.label}>First name</Text>
              <TextInput
                style={sm.input}
                placeholder="Alex"
                placeholderTextColor={MUTED2}
                value={firstName}
                onChangeText={setFirstName}
                autoCapitalize="words"
                autoFocus
                maxLength={40}
              />
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      );

      // Step 1: Style interests
      if (step === 1) return (
        <ScrollView contentContainerStyle={sm.scroll} showsVerticalScrollIndicator={false}>
          <Text style={sm.stepHeadline}>What do you{'\n'}want to see?</Text>
          <Text style={sm.stepSub}>Choose at least three. Your Thread will keep learning.</Text>
          <View style={sm.chipGrid}>
            {STYLE_INTERESTS.map((item) => (
              <Chip
                key={item}
                label={item}
                selected={styleInterests.includes(item)}
                onPress={() => setStyleArr((prev) => prev.includes(item) ? prev.filter((v) => v !== item) : [...prev, item])}
              />
            ))}
          </View>
          {styleInterests.length > 0 && styleInterests.length < 3 && (
            <Text style={sm.selectionHint}>Select {3 - styleInterests.length} more</Text>
          )}
        </ScrollView>
      );

      // Step 2: Auth
      if (step === 2) return (
        <AuthStep
          flow={flow}
          firstName={firstName}
          brandName=""
          signUp={signUp}
          signIn={signIn}
          startGoogleOAuth={startGoogleOAuth}
          startAppleOAuth={startAppleOAuth}
          onAuthComplete={handleAuthComplete}
          onDevClear={devReset}
        />
      );

      // Step 3: Loading
      if (step === 3) return (
        <LoadingAnimation steps={BUYER_LOADING_STEPS} onDone={() => { setStep(4); }} />
      );

      // Step 4: Thread preview
      if (step === 4) return (
        <ThreadPreview firstName={firstName} onEnter={() => setStep(5)} />
      );

      // Step 5: Notifications
      if (step === 5) return (
        <NotificationsStep
          flow="buyer"
          onEnable={() => setStep(6)}
          onSkip={() => setStep(6)}
        />
      );

      // Step 6: Success
      if (step === 6) return (
        <SuccessScreen flow="buyer" firstName={firstName} brandName="" onFinish={finishBuyer} onDevReset={devReset} />
      );
    }

    /* ─── SELLER STEPS ─── */
    if (flow === 'seller') {
      // Step 0: Name
      if (step === 0) return (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={sm.scroll} keyboardShouldPersistTaps="handled">
            <Text style={sm.stepHeadline}>What should{'\n'}we call you?</Text>
            <Text style={sm.stepSub}>This is how your workspace will greet you.</Text>
            <View style={sm.inputWrap}>
              <Text style={sm.label}>First name</Text>
              <TextInput
                style={sm.input}
                placeholder="Alex"
                placeholderTextColor={MUTED2}
                value={firstName}
                onChangeText={setFirstName}
                autoCapitalize="words"
                autoFocus
                maxLength={40}
              />
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      );

      // Step 1: Brand name
      if (step === 1) return (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={sm.scroll} keyboardShouldPersistTaps="handled">
            <Text style={sm.stepHeadline}>What are you{'\n'}building?</Text>
            <Text style={sm.stepSub}>Use your current name, a working name, or change it later.</Text>
            <View style={sm.inputWrap}>
              <Text style={sm.label}>Brand name</Text>
              <TextInput
                style={sm.input}
                placeholder="e.g. Noir Collective"
                placeholderTextColor={MUTED2}
                value={brandName}
                onChangeText={setBrandName}
                autoCapitalize="words"
                autoFocus
                maxLength={60}
              />
              <Text style={sm.inputHint}>Brandthread AI will use this to shape your workspace.</Text>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      );

      // Step 2: Brand stage
      if (step === 2) return (
        <ScrollView contentContainerStyle={sm.scroll} showsVerticalScrollIndicator={false}>
          <Text style={sm.stepHeadline}>Where is your{'\n'}brand today?</Text>
          <Text style={sm.stepSub}>We'll tailor your workspace to your stage.</Text>
          <View style={sm.radioList}>
            {BRAND_STAGES.map((s) => (
              <RadioRow
                key={s.value}
                label={s.label}
                sub={s.sub}
                selected={brandStage === s.value}
                onPress={() => setBrandStage(s.value)}
              />
            ))}
          </View>
        </ScrollView>
      );

      // Step 3: Product model
      if (step === 3) return (
        <ScrollView contentContainerStyle={sm.scroll} showsVerticalScrollIndicator={false}>
          <Text style={sm.stepHeadline}>How will you{'\n'}sell products?</Text>
          <Text style={sm.stepSub}>You can use multiple models as you grow.</Text>
          <View style={sm.radioList}>
            {PRODUCT_MODELS.map((m) => (
              <RadioRow
                key={m.value}
                label={m.label}
                sub={m.sub}
                selected={productModel === m.value}
                onPress={() => setProductModel(m.value)}
              />
            ))}
          </View>
        </ScrollView>
      );

      // Step 4: Goals
      if (step === 4) return (
        <ScrollView contentContainerStyle={sm.scroll} showsVerticalScrollIndicator={false}>
          <Text style={sm.stepHeadline}>What do you{'\n'}need help with?</Text>
          <Text style={sm.stepSub}>Choose everything that matters right now.</Text>
          <View style={sm.chipGrid}>
            {SELLER_GOALS.map((g) => (
              <Chip
                key={g}
                label={g}
                selected={goals.includes(g)}
                onPress={() => setGoals((prev) => prev.includes(g) ? prev.filter((v) => v !== g) : [...prev, g])}
              />
            ))}
          </View>
          {goals.length === 0 && <Text style={sm.selectionHint}>Select at least one</Text>}
          <TouchableOpacity
            style={[sm.buildBtn, goals.length === 0 && sm.buildBtnDisabled]}
            disabled={goals.length === 0}
            onPress={() => { if (goals.length > 0) goNext(); }}
          >
            <LinearGradient
              colors={goals.length > 0 ? [PURPLE, CYAN] : ['rgba(255,255,255,0.06)', 'rgba(255,255,255,0.06)']}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
              style={sm.buildBtnInner}
            >
              <Text style={[sm.buildBtnText, goals.length === 0 && sm.buildBtnTextDisabled]}>
                Build my workspace
              </Text>
            </LinearGradient>
          </TouchableOpacity>
        </ScrollView>
      );

      // Step 5: Auth
      if (step === 5) return (
        <AuthStep
          flow={flow}
          firstName={firstName}
          brandName={brandName}
          signUp={signUp}
          signIn={signIn}
          startGoogleOAuth={startGoogleOAuth}
          startAppleOAuth={startAppleOAuth}
          onAuthComplete={handleAuthComplete}
          onDevClear={devReset}
        />
      );

      // Step 6: Loading
      if (step === 6) return (
        <LoadingAnimation steps={SELLER_LOADING_STEPS} onDone={() => setStep(7)} />
      );

      // Step 7: Dashboard preview
      if (step === 7) return (
        <DashboardPreview firstName={firstName} brandName={brandName} onOpen={() => setStep(8)} />
      );

      // Step 8: Notifications
      if (step === 8) return (
        <NotificationsStep
          flow="seller"
          onEnable={() => setStep(9)}
          onSkip={() => setStep(9)}
        />
      );

      // Step 9: Success
      if (step === 9) return (
        <SuccessScreen flow="seller" firstName={firstName} brandName={brandName} onFinish={finishSeller} onDevReset={devReset} />
      );
    }

    return null;
  }

  // ── Which steps get the standard header wrapper ─────────────────────────────
  const isFullScreen = (flow === 'buyer'  && step >= 3)
                    || (flow === 'seller' && step >= 6);

  const isAuthStep = (flow === 'buyer' && step === 2) || (flow === 'seller' && step === 5);

  // ── Show Continue button in footer (not auth, not goals, not full-screen) ───
  const showFooter = !isFullScreen && !isAuthStep && !(flow === 'seller' && step === 4);

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: BG, alignItems: 'center', justifyContent: 'center' }}>
        <StatusBar barStyle="light-content" />
        <ActivityIndicator color={PURPLE} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <StatusBar barStyle="light-content" />

      {/* Header (only for non-full-screen steps) */}
      {!isFullScreen && (
        <View style={[sm.header, { paddingTop: insets.top + 8 }]}>
          <TouchableOpacity
            style={sm.backBtn}
            onPress={goBack}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Feather name="chevron-left" size={22} color={MUTED} />
          </TouchableOpacity>

          {showsProgressBar() && (
            <View style={{ flex: 1, marginRight: 8 }}>
              <GradientBar fraction={progressFraction()} />
            </View>
          )}
        </View>
      )}

      {/* Step content */}
      <Animated.View style={[sm.stepWrap, { transform: [{ translateX: slideAnim }] }]}>
        {renderStep()}
      </Animated.View>

      {/* Footer Continue button */}
      {showFooter && (
        <View style={[sm.footer, { paddingBottom: insets.bottom + 16 }]}>
          <PrimaryButton
            label={
              flow === 'buyer' && step === 1 ? 'Continue' :
              flow === 'seller' && step === 4 ? 'Build my workspace' :
              step === (flow === 'buyer' ? 2 : 5) ? 'Create account' :
              'Continue'
            }
            onPress={() => goNext()}
            disabled={!canContinue()}
          />
        </View>
      )}

      {/* Dev reset (5-tap on header logo area) */}
    </View>
  );
}

const sm = StyleSheet.create({
  header:    { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 12, gap: 8 },
  backBtn:   { width: 36, height: 36, justifyContent: 'center' },
  stepWrap:  { flex: 1, paddingHorizontal: 24 },
  footer:    { paddingHorizontal: 24, paddingTop: 12 },

  scroll:    { flexGrow: 1, paddingTop: 12, paddingBottom: 40 },
  stepHeadline: { fontSize: 32, fontFamily: 'Inter_700Bold', color: FG, letterSpacing: -0.8, lineHeight: 38, marginBottom: 8 },
  stepSub:   { fontSize: 14, fontFamily: 'Inter_400Regular', color: MUTED, lineHeight: 21, marginBottom: 28 },
  inputWrap: { gap: 4 },
  label:     { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: MUTED, marginBottom: 6 },
  input:     { backgroundColor: INPUT_BG, borderWidth: 1, borderColor: INPUT_BD, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, fontFamily: 'Inter_400Regular', color: FG },
  inputHint: { fontSize: 12, fontFamily: 'Inter_400Regular', color: MUTED2, marginTop: 6 },
  chipGrid:  { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  radioList: { gap: 10 },
  selectionHint: { fontSize: 13, fontFamily: 'Inter_400Regular', color: MUTED, textAlign: 'center', marginTop: 8 },
  buildBtn:  { marginTop: 8 },
  buildBtnDisabled: { opacity: 0.5 },
  buildBtnInner: { borderRadius: 16, paddingVertical: 17, alignItems: 'center' },
  buildBtnText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: FG },
  buildBtnTextDisabled: { color: MUTED2 },
});
