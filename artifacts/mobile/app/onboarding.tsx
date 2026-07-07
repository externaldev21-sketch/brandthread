import React, { useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Animated, Dimensions, useColorScheme, ScrollView,
  ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ONBOARDING_KEY } from './_layout';

const { width: SCREEN_W } = Dimensions.get('window');

// ─── Data ─────────────────────────────────────────────────────────────────────

const STYLES_BUYER = [
  { value: 'streetwear',  label: 'Streetwear',  emoji: '🔥' },
  { value: 'luxury',      label: 'Luxury',       emoji: '✨' },
  { value: 'casual',      label: 'Casual',       emoji: '☁️' },
  { value: 'athletic',    label: 'Athletic',     emoji: '⚡' },
  { value: 'workwear',    label: 'Workwear',     emoji: '🏗️' },
  { value: 'accessories', label: 'Accessories',  emoji: '💍' },
  { value: 'vintage',     label: 'Vintage',      emoji: '🎞️' },
  { value: 'techwear',    label: 'Techwear',     emoji: '🤖' },
];

const BUDGETS = [
  { value: 'under50',   label: 'Under $50',     sub: 'Great finds, everyday wear' },
  { value: '50to150',   label: '$50 – $150',    sub: 'Quality pieces, indie brands' },
  { value: '150to500',  label: '$150 – $500',   sub: 'Premium drops & limited runs' },
  { value: '500plus',   label: '$500+',          sub: 'Luxury & collector-grade' },
];

const SELLER_CATEGORIES = [
  { value: 'streetwear',  label: 'Streetwear',  emoji: '🔥' },
  { value: 'luxury',      label: 'Luxury',       emoji: '✨' },
  { value: 'casual',      label: 'Casual',       emoji: '☁️' },
  { value: 'athletic',    label: 'Athletic',     emoji: '⚡' },
  { value: 'workwear',    label: 'Workwear',     emoji: '🏗️' },
  { value: 'accessories', label: 'Accessories',  emoji: '💍' },
];

const STAGES = [
  { value: 'starting',    label: 'Just starting out',  sub: 'Planning my first drop',        emoji: '🌱' },
  { value: 'traction',    label: 'Getting traction',   sub: 'Some sales, building momentum', emoji: '🔥' },
  { value: 'established', label: 'Established brand',  sub: 'Consistent sales, now scaling', emoji: '👑' },
];

const MODELS = [
  { value: 'pre-order',    label: 'Pre-Order Drops',    sub: 'Hold orders, ship when made',          emoji: '📦' },
  { value: 'pre-made',     label: 'Pre-Made Stock',     sub: 'Sell from inventory you already have', emoji: '🏪' },
  { value: 'both',         label: 'Both',               sub: 'Mix of pre-order and in-stock',        emoji: '⚖️' },
  { value: 'figuring-out', label: 'Still figuring out', sub: 'Show me everything',                  emoji: '🤔' },
];

type Role = 'buyer' | 'seller' | 'both' | null;

// ─── Role selection page ───────────────────────────────────────────────────────

function RolePage({
  isDark, onSelect,
}: {
  isDark: boolean;
  onSelect: (role: Role) => void;
}) {
  const insets = useSafeAreaInsets();
  const cards = [
    {
      role: 'buyer' as Role,
      emoji: '🛍️',
      title: 'I\'m a Buyer',
      sub: 'I want to discover and shop drops from clothing brands',
      colors: ['#1E1035', '#2D1F5E'] as [string, string],
      accent: '#9F7AEA',
      border: '#3D2F7E',
    },
    {
      role: 'seller' as Role,
      emoji: '🏷️',
      title: 'I\'m a Seller',
      sub: 'I run a clothing brand and want to manage drops & sales',
      colors: ['#0F1E35', '#1A2F52'] as [string, string],
      accent: '#60A5FA',
      border: '#1E3D6E',
    },
    {
      role: 'both' as Role,
      emoji: '⚡',
      title: 'I\'m Both',
      sub: 'I buy from brands and also sell my own clothing line',
      colors: ['#1A0F35', '#2E1A52'] as [string, string],
      accent: '#C026D3',
      border: '#4A1F7A',
    },
  ];

  return (
    <View style={{ flex: 1 }}>
      {/* Hero header */}
      <LinearGradient
        colors={isDark ? ['#0D0A1A', '#12082A'] : ['#2D1B69', '#1A0A3D']}
        style={[roleStyles.hero, { paddingTop: insets.top + 24 }]}
      >
        <Text style={roleStyles.heroLogo}>Brandthread</Text>
        <Text style={roleStyles.heroHeadline}>
          What brings{'\n'}you here?
        </Text>
        <Text style={roleStyles.heroSub}>
          We'll personalise everything for you.
        </Text>
      </LinearGradient>

      {/* Cards */}
      <ScrollView
        contentContainerStyle={[roleStyles.cardsScroll, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {cards.map((c) => (
          <TouchableOpacity
            key={c.role}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onSelect(c.role); }}
            activeOpacity={0.85}
            style={roleStyles.cardWrap}
          >
            <LinearGradient
              colors={c.colors}
              style={[roleStyles.card, { borderColor: c.border }]}
            >
              <View style={[roleStyles.cardIconWrap, { backgroundColor: c.accent + '22' }]}>
                <Text style={roleStyles.cardEmoji}>{c.emoji}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[roleStyles.cardTitle, { color: '#FFFFFF' }]}>{c.title}</Text>
                <Text style={[roleStyles.cardSub, { color: '#FFFFFF99' }]}>{c.sub}</Text>
              </View>
              <Feather name="arrow-right" size={20} color={c.accent} />
            </LinearGradient>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const roleStyles = StyleSheet.create({
  hero: {
    paddingHorizontal: 28,
    paddingBottom: 36,
  },
  heroLogo: {
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
    color: '#9F7AEA',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 28,
  },
  heroHeadline: {
    fontSize: 40,
    fontFamily: 'Inter_700Bold',
    color: '#FFFFFF',
    letterSpacing: -1,
    lineHeight: 48,
    marginBottom: 10,
  },
  heroSub: {
    fontSize: 16,
    fontFamily: 'Inter_400Regular',
    color: '#FFFFFF80',
    lineHeight: 24,
  },
  cardsScroll: {
    padding: 20,
    gap: 14,
  },
  cardWrap: { borderRadius: 20 },
  card: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  cardIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardEmoji:  { fontSize: 26 },
  cardTitle:  { fontSize: 18, fontFamily: 'Inter_700Bold', marginBottom: 4 },
  cardSub:    { fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 18 },
});

// ─── Buyer setup ──────────────────────────────────────────────────────────────

function BuyerSetup({
  isDark, onFinish,
}: {
  isDark: boolean;
  onFinish: () => void;
}) {
  const insets  = useSafeAreaInsets();
  const STEPS   = 2;
  const [step, setStep]       = useState(0);
  const [styles2, setStyles2] = useState<string[]>([]);
  const [budget, setBudget]   = useState('');
  const slideAnim             = useRef(new Animated.Value(0)).current;

  const bg      = isDark ? '#08080F' : '#F8F7FF';
  const card    = isDark ? '#111118' : '#FFFFFF';
  const border  = isDark ? '#252535' : '#DDD6FE';
  const fg      = isDark ? '#F0EEFF' : '#1A1035';
  const muted   = isDark ? '#6B6B8A' : '#6D6892';
  const primary = isDark ? '#9F7AEA' : '#7C3AED';
  const cardSel = isDark ? '#2D1F5E' : '#EDE9FE';

  function animateTo(next: number, dir: number) {
    Animated.timing(slideAnim, { toValue: dir * -SCREEN_W, duration: 240, useNativeDriver: true }).start(() => {
      setStep(next);
      slideAnim.setValue(dir * SCREEN_W);
      Animated.timing(slideAnim, { toValue: 0, duration: 240, useNativeDriver: true }).start();
    });
  }

  function canAdvance() {
    if (step === 0) return styles2.length > 0;
    if (step === 1) return !!budget;
    return false;
  }

  function handleNext() {
    if (!canAdvance()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (step < STEPS - 1) animateTo(step + 1, 1);
    else onFinish();
  }

  function handleBack() {
    if (step === 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    animateTo(step - 1, -1);
  }

  function toggleStyle(val: string) {
    Haptics.selectionAsync();
    setStyles2(prev => prev.includes(val) ? prev.filter(s => s !== val) : [...prev, val]);
  }

  function renderStep() {
    if (step === 0) return (
      <ScrollView contentContainerStyle={setupStyles.stepContent} showsVerticalScrollIndicator={false}>
        <Text style={setupStyles.emoji}>👕</Text>
        <Text style={[setupStyles.q, { color: fg }]}>What's your{'\n'}style?</Text>
        <Text style={[setupStyles.qSub, { color: muted }]}>Pick everything that fits — we'll find brands you'll love.</Text>
        <View style={setupStyles.gridWrap}>
          {STYLES_BUYER.map(s => {
            const sel = styles2.includes(s.value);
            return (
              <TouchableOpacity
                key={s.value}
                style={[setupStyles.gridCard, { backgroundColor: sel ? cardSel : card, borderColor: sel ? primary : border }]}
                onPress={() => toggleStyle(s.value)}
                activeOpacity={0.8}
              >
                <Text style={setupStyles.gridEmoji}>{s.emoji}</Text>
                <Text style={[setupStyles.gridLabel, { color: sel ? primary : fg }]}>{s.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
    );

    if (step === 1) return (
      <ScrollView contentContainerStyle={setupStyles.stepContent} showsVerticalScrollIndicator={false}>
        <Text style={setupStyles.emoji}>💰</Text>
        <Text style={[setupStyles.q, { color: fg }]}>What's your{'\n'}usual spend?</Text>
        <Text style={[setupStyles.qSub, { color: muted }]}>We'll surface drops in your range first.</Text>
        {BUDGETS.map(b => {
          const sel = budget === b.value;
          return (
            <TouchableOpacity
              key={b.value}
              style={[setupStyles.listCard, { backgroundColor: sel ? cardSel : card, borderColor: sel ? primary : border }]}
              onPress={() => { setBudget(b.value); Haptics.selectionAsync(); }}
              activeOpacity={0.8}
            >
              <View style={{ flex: 1 }}>
                <Text style={[setupStyles.listLabel, { color: sel ? primary : fg }]}>{b.label}</Text>
                <Text style={[setupStyles.listSub, { color: muted }]}>{b.sub}</Text>
              </View>
              <View style={[setupStyles.radio, { borderColor: sel ? primary : border, backgroundColor: sel ? primary : 'transparent' }]}>
                {sel && <View style={setupStyles.radioDot} />}
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    );

    return null;
  }

  return (
    <View style={[{ flex: 1 }, { backgroundColor: bg }]}>
      <View style={[setupStyles.header, { paddingTop: insets.top + 12 }]}>
        <View style={setupStyles.dots}>
          {Array.from({ length: STEPS }).map((_, i) => (
            <View key={i} style={[setupStyles.dot, { backgroundColor: i <= step ? primary : border }, i === step && setupStyles.dotActive]} />
          ))}
        </View>
        <Text style={[setupStyles.stepLabel, { color: muted }]}>Step {step + 1} of {STEPS}</Text>
      </View>
      <Animated.View style={[{ flex: 1 }, { transform: [{ translateX: slideAnim }] }]}>
        {renderStep()}
      </Animated.View>
      <View style={[setupStyles.footer, { paddingBottom: insets.bottom + 12, borderTopColor: border }]}>
        {step > 0 ? (
          <TouchableOpacity style={[setupStyles.backBtn, { borderColor: border }]} onPress={handleBack} activeOpacity={0.7}>
            <Text style={[setupStyles.backText, { color: muted }]}>← Back</Text>
          </TouchableOpacity>
        ) : <View style={setupStyles.backBtn} />}
        <TouchableOpacity
          style={[setupStyles.nextBtn, { backgroundColor: canAdvance() ? primary : border }]}
          onPress={handleNext}
          activeOpacity={0.85}
        >
          <Text style={setupStyles.nextText}>{step === STEPS - 1 ? '🛍️  Start shopping' : 'Continue →'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Seller setup ─────────────────────────────────────────────────────────────

function SellerSetup({
  isDark, onFinish, isBoth,
}: {
  isDark: boolean;
  onFinish: () => void;
  isBoth: boolean;
}) {
  const insets  = useSafeAreaInsets();
  const STEPS   = 4;
  const [step, setStep]           = useState(0);
  const [brandName, setBrandName] = useState('');
  const [brandType, setBrandType] = useState('');
  const [brandStage, setBrandStage] = useState('');
  const [sellModel, setSellModel] = useState('');
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState('');
  const slideAnim                 = useRef(new Animated.Value(0)).current;

  const bg      = isDark ? '#08080F' : '#F8F7FF';
  const card    = isDark ? '#111118' : '#FFFFFF';
  const border  = isDark ? '#252535' : '#DDD6FE';
  const fg      = isDark ? '#F0EEFF' : '#1A1035';
  const muted   = isDark ? '#6B6B8A' : '#6D6892';
  const primary = isDark ? '#9F7AEA' : '#7C3AED';
  const cardSel = isDark ? '#2D1F5E' : '#EDE9FE';

  function animateTo(next: number, dir: number) {
    Animated.timing(slideAnim, { toValue: dir * -SCREEN_W, duration: 240, useNativeDriver: true }).start(() => {
      setStep(next);
      slideAnim.setValue(dir * SCREEN_W);
      Animated.timing(slideAnim, { toValue: 0, duration: 240, useNativeDriver: true }).start();
    });
  }

  function canAdvance() {
    if (step === 0) return brandName.trim().length > 1;
    if (step === 1) return !!brandType;
    if (step === 2) return !!brandStage;
    if (step === 3) return !!sellModel;
    return false;
  }

  function handleNext() {
    if (!canAdvance()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (step < STEPS - 1) animateTo(step + 1, 1);
    else handleFinish();
  }

  function handleBack() {
    if (step === 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    animateTo(step - 1, -1);
  }

  async function handleFinish() {
    setSaving(true);
    setError('');
    try {
      onFinish();
    } catch (err: any) {
      setSaving(false);
      setError(err?.message ?? 'Something went wrong. Please try again.');
    }
  }

  function renderStep() {
    if (step === 0) return (
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={setupStyles.stepContent}>
          <Text style={setupStyles.emoji}>✂️</Text>
          <Text style={[setupStyles.q, { color: fg }]}>What's your{'\n'}brand called?</Text>
          <Text style={[setupStyles.qSub, { color: muted }]}>You can change this anytime in settings.</Text>
          <TextInput
            style={[setupStyles.bigInput, { backgroundColor: isDark ? '#1C1C2E' : '#F0EEFF', borderColor: border, color: fg }]}
            placeholder="e.g. Noir Collective"
            placeholderTextColor={muted}
            value={brandName}
            onChangeText={setBrandName}
            autoFocus
            autoCapitalize="words"
            returnKeyType="next"
            onSubmitEditing={handleNext}
          />
        </View>
      </KeyboardAvoidingView>
    );

    if (step === 1) return (
      <ScrollView contentContainerStyle={setupStyles.stepContent} showsVerticalScrollIndicator={false}>
        <Text style={setupStyles.emoji}>👕</Text>
        <Text style={[setupStyles.q, { color: fg }]}>What do{'\n'}you create?</Text>
        <Text style={[setupStyles.qSub, { color: muted }]}>Pick the one that fits best.</Text>
        <View style={setupStyles.gridWrap}>
          {SELLER_CATEGORIES.map(cat => {
            const sel = brandType === cat.value;
            return (
              <TouchableOpacity
                key={cat.value}
                style={[setupStyles.gridCard, { backgroundColor: sel ? cardSel : card, borderColor: sel ? primary : border }]}
                onPress={() => { setBrandType(cat.value); Haptics.selectionAsync(); }}
                activeOpacity={0.8}
              >
                <Text style={setupStyles.gridEmoji}>{cat.emoji}</Text>
                <Text style={[setupStyles.gridLabel, { color: sel ? primary : fg }]}>{cat.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
    );

    if (step === 2) return (
      <ScrollView contentContainerStyle={setupStyles.stepContent} showsVerticalScrollIndicator={false}>
        <Text style={setupStyles.emoji}>📍</Text>
        <Text style={[setupStyles.q, { color: fg }]}>Where are you{'\n'}right now?</Text>
        <Text style={[setupStyles.qSub, { color: muted }]}>We'll tailor Brandthread to your stage.</Text>
        {STAGES.map(s => {
          const sel = brandStage === s.value;
          return (
            <TouchableOpacity
              key={s.value}
              style={[setupStyles.listCard, { backgroundColor: sel ? cardSel : card, borderColor: sel ? primary : border }]}
              onPress={() => { setBrandStage(s.value); Haptics.selectionAsync(); }}
              activeOpacity={0.8}
            >
              <Text style={setupStyles.listEmoji}>{s.emoji}</Text>
              <View style={{ flex: 1 }}>
                <Text style={[setupStyles.listLabel, { color: sel ? primary : fg }]}>{s.label}</Text>
                <Text style={[setupStyles.listSub, { color: muted }]}>{s.sub}</Text>
              </View>
              <View style={[setupStyles.radio, { borderColor: sel ? primary : border, backgroundColor: sel ? primary : 'transparent' }]}>
                {sel && <View style={setupStyles.radioDot} />}
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    );

    if (step === 3) return (
      <ScrollView contentContainerStyle={setupStyles.stepContent} showsVerticalScrollIndicator={false}>
        <Text style={setupStyles.emoji}>🚀</Text>
        <Text style={[setupStyles.q, { color: fg }]}>How do you{'\n'}drop?</Text>
        <Text style={[setupStyles.qSub, { color: muted }]}>This helps us set up your payout flow.</Text>
        {MODELS.map(m => {
          const sel = sellModel === m.value;
          return (
            <TouchableOpacity
              key={m.value}
              style={[setupStyles.listCard, { backgroundColor: sel ? cardSel : card, borderColor: sel ? primary : border }]}
              onPress={() => { setSellModel(m.value); Haptics.selectionAsync(); }}
              activeOpacity={0.8}
            >
              <Text style={setupStyles.listEmoji}>{m.emoji}</Text>
              <View style={{ flex: 1 }}>
                <Text style={[setupStyles.listLabel, { color: sel ? primary : fg }]}>{m.label}</Text>
                <Text style={[setupStyles.listSub, { color: muted }]}>{m.sub}</Text>
              </View>
              <View style={[setupStyles.radio, { borderColor: sel ? primary : border, backgroundColor: sel ? primary : 'transparent' }]}>
                {sel && <View style={setupStyles.radioDot} />}
              </View>
            </TouchableOpacity>
          );
        })}
        {error ? <Text style={setupStyles.error}>{error}</Text> : null}
      </ScrollView>
    );

    return null;
  }

  const finishLabel = isBoth ? '🚀  Launch my brand' : '🚀  Launch brand';

  return (
    <View style={[{ flex: 1 }, { backgroundColor: bg }]}>
      <View style={[setupStyles.header, { paddingTop: insets.top + 12 }]}>
        <View style={setupStyles.dots}>
          {Array.from({ length: STEPS }).map((_, i) => (
            <View key={i} style={[setupStyles.dot, { backgroundColor: i <= step ? primary : border }, i === step && setupStyles.dotActive]} />
          ))}
        </View>
        <Text style={[setupStyles.stepLabel, { color: muted }]}>Step {step + 1} of {STEPS}</Text>
      </View>
      <Animated.View style={[{ flex: 1 }, { transform: [{ translateX: slideAnim }] }]}>
        {renderStep()}
      </Animated.View>
      <View style={[setupStyles.footer, { paddingBottom: insets.bottom + 12, borderTopColor: border }]}>
        {step > 0 ? (
          <TouchableOpacity style={[setupStyles.backBtn, { borderColor: border }]} onPress={handleBack} activeOpacity={0.7}>
            <Text style={[setupStyles.backText, { color: muted }]}>← Back</Text>
          </TouchableOpacity>
        ) : <View style={setupStyles.backBtn} />}
        <TouchableOpacity
          style={[setupStyles.nextBtn, { backgroundColor: canAdvance() ? primary : border }, saving && { opacity: 0.7 }]}
          onPress={handleNext}
          disabled={!canAdvance() || saving}
          activeOpacity={0.85}
        >
          {saving
            ? <ActivityIndicator color="#FFF" />
            : <Text style={setupStyles.nextText}>{step === STEPS - 1 ? finishLabel : 'Continue →'}</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

// shared setup styles
const setupStyles = StyleSheet.create({
  header:      { paddingHorizontal: 24, paddingBottom: 8 },
  dots:        { flexDirection: 'row', gap: 8, marginBottom: 10 },
  dot:         { height: 6, width: 24, borderRadius: 3 },
  dotActive:   { width: 36 },
  stepLabel:   { fontSize: 13, fontFamily: 'Inter_500Medium' },
  stepContent: { padding: 24, paddingTop: 12, flexGrow: 1 },
  emoji:       { fontSize: 44, marginBottom: 16 },
  q:           { fontSize: 32, fontFamily: 'Inter_700Bold', lineHeight: 40, letterSpacing: -0.8, marginBottom: 8 },
  qSub:        { fontSize: 15, fontFamily: 'Inter_400Regular', lineHeight: 22, marginBottom: 28 },
  bigInput:    { borderRadius: 16, borderWidth: 1.5, paddingHorizontal: 18, paddingVertical: 16, fontSize: 22, fontFamily: 'Inter_600SemiBold', letterSpacing: -0.3 },
  gridWrap:    { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  gridCard:    { width: (SCREEN_W - 48 - 12) / 2, borderRadius: 16, borderWidth: 1.5, padding: 16, alignItems: 'center', gap: 8 },
  gridEmoji:   { fontSize: 28 },
  gridLabel:   { fontSize: 14, fontFamily: 'Inter_600SemiBold', textAlign: 'center' },
  listCard:    { borderRadius: 16, borderWidth: 1.5, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  listEmoji:   { fontSize: 24, width: 32 },
  listLabel:   { fontSize: 15, fontFamily: 'Inter_700Bold', marginBottom: 2 },
  listSub:     { fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 18 },
  radio:       { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioDot:    { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FFF' },
  footer:      { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 24, paddingTop: 16, borderTopWidth: StyleSheet.hairlineWidth },
  backBtn:     { flex: 1, paddingVertical: 14, borderRadius: 14, borderWidth: 1.5, alignItems: 'center' },
  backText:    { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  nextBtn:     { flex: 2, paddingVertical: 14, borderRadius: 14, alignItems: 'center' },
  nextText:    { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#FFF' },
  error:       { color: '#EF4444', fontSize: 13, fontFamily: 'Inter_400Regular', marginTop: 12 },
});

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function OnboardingScreen() {
  const router   = useRouter();
  const scheme   = useColorScheme();
  const isDark   = scheme !== 'light';

  const [role, setRole] = useState<Role>(null);

  // Page-level slide animation (role → setup)
  const pageAnim = useRef(new Animated.Value(0)).current;

  function handleRoleSelect(r: Role) {
    setRole(r);
    pageAnim.setValue(SCREEN_W);
    Animated.spring(pageAnim, {
      toValue: 0,
      damping: 22,
      stiffness: 180,
      useNativeDriver: true,
    }).start();
  }

  async function handleFinish() {
    await AsyncStorage.setItem(ONBOARDING_KEY, 'true');
    if (role) await AsyncStorage.setItem('user_role', role);
    router.replace('/');
  }

  const bg = isDark ? '#08080F' : '#F8F7FF';

  return (
    <View style={{ flex: 1, backgroundColor: bg }}>
      {/* Role selection — always rendered underneath */}
      {role === null && (
        <View style={StyleSheet.absoluteFill}>
          <RolePage isDark={isDark} onSelect={handleRoleSelect} />
        </View>
      )}

      {/* Setup page — slides in once role is chosen */}
      {role !== null && (
        <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateX: pageAnim }] }]}>
          {(role === 'buyer') && (
            <BuyerSetup isDark={isDark} onFinish={handleFinish} />
          )}
          {(role === 'seller') && (
            <SellerSetup isDark={isDark} onFinish={handleFinish} isBoth={false} />
          )}
          {(role === 'both') && (
            <SellerSetup isDark={isDark} onFinish={handleFinish} isBoth={true} />
          )}
        </Animated.View>
      )}
    </View>
  );
}
