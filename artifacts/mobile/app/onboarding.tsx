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

const BUYER_STYLES = [
  { value: 'streetwear',      label: 'Streetwear',      emoji: '🔥' },
  { value: 'archive-fashion', label: 'Archive Fashion',  emoji: '🎞️' },
  { value: 'luxury',          label: 'Luxury',           emoji: '✨' },
  { value: 'athletic-wear',   label: 'Athletic Wear',    emoji: '⚡' },
  { value: 'accessories',     label: 'Accessories',      emoji: '💍' },
];

const SELLER_CATEGORIES = [
  { value: 'streetwear',  label: 'Streetwear' },
  { value: 'luxury',      label: 'Luxury' },
  { value: 'casual',      label: 'Casual' },
  { value: 'athletic',    label: 'Athletic' },
  { value: 'workwear',    label: 'Workwear' },
  { value: 'accessories', label: 'Accessories' },
];

// "What best describes you?" — asked first for sellers & both
const EXPERIENCE_LEVELS = [
  { value: 'starting', label: 'I am just starting' },
  { value: 'selling',  label: 'I am already selling online or in person' },
];

const MODELS = [
  { value: 'pre-order',    label: 'Pre-Order Drops',    sub: 'Hold orders, ship when made' },
  { value: 'pre-made',     label: 'Pre-Made Stock',     sub: 'Sell from inventory you already have' },
  { value: 'both',         label: 'Both',               sub: 'Mix of pre-order and in-stock' },
  { value: 'figuring-out', label: 'Still figuring out', sub: 'Show me everything' },
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
      colors: ['#1D140D', '#2A1B12'] as [string, string],
      accent: '#C94D1F',
      border: '#4A3423',
    },
    {
      role: 'seller' as Role,
      emoji: '🏷️',
      title: 'I\'m a Seller',
      sub: 'I run a clothing brand and want to manage drops & sales',
      colors: ['#161512', '#20211E'] as [string, string],
      accent: '#4A6FA5',
      border: '#33342F',
    },
    {
      role: 'both' as Role,
      emoji: '⚡',
      title: 'I\'m Both',
      sub: 'I buy from brands and also sell my own clothing line',
      colors: ['#1D140D', '#2A1B12'] as [string, string],
      accent: '#C1440E',
      border: '#4A3423',
    },
  ];

  return (
    <View style={{ flex: 1 }}>
      {/* Hero header */}
      <LinearGradient
        colors={isDark ? ['#0F0D0A', '#181410'] : ['#241708', '#14110D']}
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
    color: '#C94D1F',
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


// ─── Buyer style picker ───────────────────────────────────────────────────────

function BuyerStylePicker({
  isDark, onFinish,
}: {
  isDark: boolean;
  onFinish: () => void;
}) {
  const insets  = useSafeAreaInsets();
  const [picked, setPicked] = useState('');

  const bg      = isDark ? '#121110' : '#F2EEE3';
  const card    = isDark ? '#1B1917' : '#FFFFFF';
  const border  = isDark ? '#33302A' : '#DBD3C0';
  const fg      = isDark ? '#EDE7D9' : '#17140F';
  const muted   = isDark ? '#8C8577' : '#6E6759';
  const primary = isDark ? '#C94D1F' : '#B33F1E';

  return (
    <View style={[{ flex: 1 }, { backgroundColor: bg }]}>
      <View style={[setupStyles.header, { paddingTop: insets.top + 12 }]}>
        <View style={setupStyles.dots}>
          <View style={[setupStyles.dot, setupStyles.dotActive, { backgroundColor: primary }]} />
        </View>
      </View>

      <ScrollView contentContainerStyle={setupStyles.stepContent} showsVerticalScrollIndicator={false}>
        <Text style={[setupStyles.title, { color: fg }]}>What's your style?</Text>
        <Text style={[setupStyles.qSub, { color: muted }]}>We'll show you drops that match your taste.</Text>
        <Text style={[setupStyles.qLabel, { color: fg }]}>Pick the one that fits best</Text>
        <View style={setupStyles.listWrap}>
          {BUYER_STYLES.map(s => {
            const sel = picked === s.value;
            return (
              <TouchableOpacity
                key={s.value}
                style={[setupStyles.plainRow, { backgroundColor: card, borderColor: sel ? primary : border, borderWidth: sel ? 1.5 : 1 }]}
                onPress={() => { setPicked(s.value); Haptics.selectionAsync(); }}
                activeOpacity={0.8}
              >
                <Text style={[setupStyles.plainRowLabel, { color: fg }]}>{s.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      <View style={[setupStyles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <TouchableOpacity
          style={[setupStyles.continueBtn, { backgroundColor: picked ? primary : border }]}
          onPress={() => { if (picked) { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onFinish(); } }}
          activeOpacity={0.85}
          disabled={!picked}
        >
          <Text style={[setupStyles.continueText, { color: picked ? '#FFFFFF' : muted }]}>Continue</Text>
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
  const [experienceLevel, setExperienceLevel] = useState('');
  const [brandName, setBrandName] = useState('');
  const [brandType, setBrandType] = useState('');
  const [sellModel, setSellModel] = useState('');
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState('');
  const slideAnim                 = useRef(new Animated.Value(0)).current;

  const bg      = isDark ? '#121110' : '#F2EEE3';
  const card    = isDark ? '#1B1917' : '#FFFFFF';
  const border  = isDark ? '#33302A' : '#DBD3C0';
  const fg      = isDark ? '#EDE7D9' : '#17140F';
  const muted   = isDark ? '#8C8577' : '#6E6759';
  const primary = isDark ? '#C94D1F' : '#B33F1E';

  function animateTo(next: number, dir: number) {
    Animated.timing(slideAnim, { toValue: dir * -SCREEN_W, duration: 240, useNativeDriver: true }).start(() => {
      setStep(next);
      slideAnim.setValue(dir * SCREEN_W);
      Animated.timing(slideAnim, { toValue: 0, duration: 240, useNativeDriver: true }).start();
    });
  }

  function canAdvance() {
    if (step === 0) return !!experienceLevel;
    if (step === 1) return brandName.trim().length > 1;
    if (step === 2) return !!brandType;
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
      <ScrollView contentContainerStyle={setupStyles.stepContent} showsVerticalScrollIndicator={false}>
        <Text style={[setupStyles.title, { color: fg }]}>You're in!</Text>
        <Text style={[setupStyles.qSub, { color: muted }]}>
          Now that you've created your account, let us help you get started by answering a few questions.
        </Text>
        <Text style={[setupStyles.qLabel, { color: fg }]}>What best describes you?</Text>
        <View style={setupStyles.listWrap}>
          {EXPERIENCE_LEVELS.map(e => {
            const sel = experienceLevel === e.value;
            return (
              <TouchableOpacity
                key={e.value}
                style={[setupStyles.plainRow, { backgroundColor: card, borderColor: sel ? primary : border, borderWidth: sel ? 1.5 : 1 }]}
                onPress={() => { setExperienceLevel(e.value); Haptics.selectionAsync(); }}
                activeOpacity={0.8}
              >
                <Text style={[setupStyles.plainRowLabel, { color: fg }]}>{e.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
    );

    if (step === 1) return (
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={setupStyles.stepContent}>
          <Text style={[setupStyles.title, { color: fg }]}>What's your brand called?</Text>
          <Text style={[setupStyles.qSub, { color: muted }]}>You can change this anytime in settings.</Text>
          <TextInput
            style={[setupStyles.bigInput, { backgroundColor: isDark ? '#201D18' : '#EDE7D9', borderColor: border, color: fg }]}
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

    if (step === 2) return (
      <ScrollView contentContainerStyle={setupStyles.stepContent} showsVerticalScrollIndicator={false}>
        <Text style={[setupStyles.title, { color: fg }]}>What do you create?</Text>
        <Text style={[setupStyles.qSub, { color: muted }]}>Pick the one that fits best.</Text>
        <View style={setupStyles.listWrap}>
          {SELLER_CATEGORIES.map(cat => {
            const sel = brandType === cat.value;
            return (
              <TouchableOpacity
                key={cat.value}
                style={[setupStyles.plainRow, { backgroundColor: card, borderColor: sel ? primary : border, borderWidth: sel ? 1.5 : 1 }]}
                onPress={() => { setBrandType(cat.value); Haptics.selectionAsync(); }}
                activeOpacity={0.8}
              >
                <Text style={[setupStyles.plainRowLabel, { color: fg }]}>{cat.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
    );

    if (step === 3) return (
      <ScrollView contentContainerStyle={setupStyles.stepContent} showsVerticalScrollIndicator={false}>
        <Text style={[setupStyles.title, { color: fg }]}>How do you drop?</Text>
        <Text style={[setupStyles.qSub, { color: muted }]}>This helps us set up your payout flow.</Text>
        <View style={setupStyles.listWrap}>
          {MODELS.map(m => {
            const sel = sellModel === m.value;
            return (
              <TouchableOpacity
                key={m.value}
                style={[setupStyles.plainRow, { backgroundColor: card, borderColor: sel ? primary : border, borderWidth: sel ? 1.5 : 1 }]}
                onPress={() => { setSellModel(m.value); Haptics.selectionAsync(); }}
                activeOpacity={0.8}
              >
                <Text style={[setupStyles.plainRowLabel, { color: fg }]}>{m.label}</Text>
                <Text style={[setupStyles.plainRowSub, { color: muted }]}>{m.sub}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {error ? <Text style={setupStyles.error}>{error}</Text> : null}
      </ScrollView>
    );

    return null;
  }

  const finishLabel = isBoth ? 'Launch my brand' : 'Launch brand';

  return (
    <View style={[{ flex: 1 }, { backgroundColor: bg }]}>
      <View style={[setupStyles.header, { paddingTop: insets.top + 12 }]}>
        {step > 0 ? (
          <TouchableOpacity onPress={handleBack} activeOpacity={0.7} style={setupStyles.backChevron}>
            <Feather name="chevron-left" size={22} color={muted} />
          </TouchableOpacity>
        ) : <View style={setupStyles.backChevron} />}
        <View style={setupStyles.dots}>
          {Array.from({ length: STEPS }).map((_, i) => (
            <View key={i} style={[setupStyles.dot, { backgroundColor: i <= step ? primary : border }, i === step && setupStyles.dotActive]} />
          ))}
        </View>
      </View>
      <Animated.View style={[{ flex: 1 }, { transform: [{ translateX: slideAnim }] }]}>
        {renderStep()}
      </Animated.View>
      <View style={[setupStyles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <TouchableOpacity
          style={[setupStyles.continueBtn, { backgroundColor: canAdvance() ? primary : border }, saving && { opacity: 0.7 }]}
          onPress={handleNext}
          disabled={!canAdvance() || saving}
          activeOpacity={0.85}
        >
          {saving
            ? <ActivityIndicator color="#FFF" />
            : <Text style={[setupStyles.continueText, { color: canAdvance() ? '#FFFFFF' : muted }]}>{step === STEPS - 1 ? finishLabel : 'Continue'}</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

// shared setup styles — mirrors the "You're in!" question-screen structure:
// thin progress dots up top, bold headline + subtext, plain bordered option rows,
// and a compact Continue button pinned bottom-right that greys out until answered.
const setupStyles = StyleSheet.create({
  header:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, paddingBottom: 20, gap: 4 },
  backChevron:  { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', marginRight: 2 },
  dots:         { flexDirection: 'row', gap: 6, flex: 1 },
  dot:          { height: 4, flex: 1, borderRadius: 2 },
  dotActive:    {},
  stepContent:  { paddingHorizontal: 24, paddingTop: 4, flexGrow: 1 },
  title:        { fontSize: 28, fontFamily: 'Inter_700Bold', letterSpacing: -0.6, marginBottom: 12 },
  qSub:         { fontSize: 14, fontFamily: 'Inter_400Regular', lineHeight: 21, marginBottom: 28 },
  qLabel:       { fontSize: 16, fontFamily: 'Inter_700Bold', marginBottom: 14 },
  bigInput:     { borderRadius: 16, borderWidth: 1.5, paddingHorizontal: 18, paddingVertical: 16, fontSize: 22, fontFamily: 'Inter_600SemiBold', letterSpacing: -0.3 },
  listWrap:     { gap: 12 },
  plainRow:     { borderRadius: 12, padding: 16 },
  plainRowLabel:{ fontSize: 15, fontFamily: 'Inter_500Medium' },
  plainRowSub:  { fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 18, marginTop: 3 },
  footer:       { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 24, paddingTop: 16 },
  continueBtn:  { minWidth: 140, paddingVertical: 14, paddingHorizontal: 24, borderRadius: 14, alignItems: 'center' },
  continueText: { fontSize: 15, fontFamily: 'Inter_700Bold' },
  error:        { color: '#EF4444', fontSize: 13, fontFamily: 'Inter_400Regular', marginTop: 12 },
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

  async function handleFinish(overrideRole?: Role) {
    const finalRole = overrideRole ?? role;
    await AsyncStorage.setItem(ONBOARDING_KEY, 'true');
    if (finalRole) await AsyncStorage.setItem('user_role', finalRole);
    // Route buyers to their dedicated group; sellers/both go to the dashboard
    const dest = finalRole === 'buyer' ? '/(buyer)/' : '/(tabs)/';
    router.replace(dest as never);
  }

  const bg = isDark ? '#121110' : '#F2EEE3';

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
          {role === 'buyer'
            ? <BuyerStylePicker isDark={isDark} onFinish={handleFinish} />
            : <SellerSetup isDark={isDark} onFinish={handleFinish} isBoth={role === 'both'} />
          }
        </Animated.View>
      )}
    </View>
  );
}
