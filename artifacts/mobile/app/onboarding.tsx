import React, { useEffect, useRef, useState } from 'react';
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

type AccountType = 'buyer' | 'seller' | 'both';

// ─── Buyer data ───────────────────────────────────────────────────────────────

const STYLE_INTERESTS = [
  'Streetwear', 'Luxury', 'Minimal', 'Vintage', 'Activewear',
  'Y2K', 'Technical', 'Casual', 'Avant-garde', 'Sustainable',
  'Handmade', 'Accessories', 'Footwear', 'Other',
];

const PRODUCT_INTERESTS = [
  'T-shirts', 'Hoodies', 'Pants', 'Denim', 'Jackets',
  'Knitwear', 'Activewear', 'Dresses', 'Footwear',
  'Bags', 'Hats', 'Jewelry', 'Accessories',
];

const DISCOVERY_PREFS = [
  'Emerging brands', 'Established brands', 'Local brands',
  'Independent designers', 'Limited drops', 'Affordable fashion',
  'Luxury fashion', 'Sustainable brands', 'Custom clothing',
];

// ─── Seller data ──────────────────────────────────────────────────────────────

const EXPERIENCE_LEVELS = [
  { value: 'starting', label: 'I am just starting' },
  { value: 'selling',  label: 'I am already selling online or in person' },
];

const SELLER_CATEGORIES = [
  { value: 'streetwear',  label: 'Streetwear' },
  { value: 'luxury',      label: 'Luxury' },
  { value: 'casual',      label: 'Casual' },
  { value: 'athletic',    label: 'Athletic' },
  { value: 'workwear',    label: 'Workwear' },
  { value: 'accessories', label: 'Accessories' },
];

const MODELS = [
  { value: 'pre-order',    label: 'Pre-Order Drops',    sub: 'Hold orders, ship when made' },
  { value: 'pre-made',     label: 'Pre-Made Stock',     sub: 'Sell from inventory you already have' },
  { value: 'both',         label: 'Both',               sub: 'Mix of pre-order and in-stock' },
  { value: 'figuring-out', label: 'Still figuring out', sub: 'Show me everything' },
];

// ─── Shared components ────────────────────────────────────────────────────────

function ProgressDots({
  total, current, primary, border,
}: {
  total: number; current: number; primary: string; border: string;
}) {
  return (
    <View style={s.dots}>
      {Array.from({ length: total }).map((_, i) => (
        <View
          key={i}
          style={[s.dot, { backgroundColor: i <= current ? primary : border }]}
        />
      ))}
    </View>
  );
}

function ChipGrid({
  items, selected, onToggle, max, accent, card, fg, border,
}: {
  items: string[];
  selected: string[];
  onToggle: (v: string) => void;
  max?: number;
  accent: string;
  card: string;
  fg: string;
  border: string;
}) {
  return (
    <View style={s.chipGrid}>
      {items.map((item) => {
        const isOn = selected.includes(item);
        const disabled = !isOn && max !== undefined && selected.length >= max;
        return (
          <TouchableOpacity
            key={item}
            style={[
              s.chip,
              { backgroundColor: isOn ? accent + '22' : card, borderColor: isOn ? accent : border },
              isOn && { borderWidth: 1.5 },
            ]}
            onPress={() => {
              if (disabled) return;
              Haptics.selectionAsync();
              onToggle(item);
            }}
            activeOpacity={0.75}
          >
            <Text style={[s.chipText, { color: isOn ? accent : fg }]}>{item}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ─── Buyer onboarding (4 screens) ─────────────────────────────────────────────

function BuyerOnboarding({
  isDark, onFinish, showProfile = true,
}: {
  isDark: boolean;
  onFinish: (data: Record<string, any>) => void;
  showProfile?: boolean;
}) {
  const insets  = useSafeAreaInsets();
  const STEPS   = showProfile ? 4 : 3;
  const [step, setStep]         = useState(0);
  const [styles_,  setStyles]   = useState<string[]>([]);
  const [products, setProducts] = useState<string[]>([]);
  const [discovery, setDiscovery] = useState<string[]>([]);
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [location, setLocation] = useState('');
  const slideAnim = useRef(new Animated.Value(0)).current;

  const bg      = isDark ? '#0E0E0E' : '#F5F5F5';
  const card    = isDark ? '#1A1A1A' : '#FFFFFF';
  const border  = isDark ? '#2A2A2A' : '#E0E0E0';
  const fg      = isDark ? '#FFFFFF' : '#0A0A0A';
  const muted   = isDark ? '#888' : '#666';
  const primary = '#00C853';
  const inputBg = isDark ? '#252525' : '#F0F0F0';

  function animateTo(next: number, dir: number) {
    Animated.timing(slideAnim, { toValue: dir * -SCREEN_W, duration: 220, useNativeDriver: true }).start(() => {
      setStep(next);
      slideAnim.setValue(dir * SCREEN_W);
      Animated.timing(slideAnim, { toValue: 0, duration: 220, useNativeDriver: true }).start();
    });
  }

  function toggle(list: string[], set: (v: string[]) => void, value: string, max?: number) {
    if (list.includes(value)) {
      set(list.filter(v => v !== value));
    } else {
      if (max && list.length >= max) return;
      set([...list, value]);
    }
  }

  function canAdvance() {
    if (step === 0) return styles_.length > 0;
    if (step === 1) return products.length > 0;
    if (step === 2) return discovery.length > 0;
    if (step === 3) return displayName.trim().length > 0;
    return false;
  }

  function handleNext() {
    if (!canAdvance()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (step < STEPS - 1) animateTo(step + 1, 1);
    else onFinish({ styles: styles_, products, discovery, displayName, username, location });
  }

  function handleBack() {
    if (step === 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    animateTo(step - 1, -1);
  }

  const inputStyle = [s.bigInput, { backgroundColor: inputBg, borderColor: border, color: fg }];

  function renderStep() {
    if (step === 0) return (
      <ScrollView contentContainerStyle={s.stepContent} showsVerticalScrollIndicator={false}>
        <Text style={[s.title, { color: fg }]}>What styles are you into?</Text>
        <Text style={[s.qSub, { color: muted }]}>Pick up to 5. We'll personalize your feed.</Text>
        <ChipGrid
          items={STYLE_INTERESTS} selected={styles_}
          onToggle={(v) => toggle(styles_, setStyles, v, 5)}
          max={5} accent={primary} card={card} fg={fg} border={border}
        />
      </ScrollView>
    );

    if (step === 1) return (
      <ScrollView contentContainerStyle={s.stepContent} showsVerticalScrollIndicator={false}>
        <Text style={[s.title, { color: fg }]}>What do you usually shop for?</Text>
        <Text style={[s.qSub, { color: muted }]}>Select everything that applies.</Text>
        <ChipGrid
          items={PRODUCT_INTERESTS} selected={products}
          onToggle={(v) => toggle(products, setProducts, v)}
          accent={primary} card={card} fg={fg} border={border}
        />
      </ScrollView>
    );

    if (step === 2) return (
      <ScrollView contentContainerStyle={s.stepContent} showsVerticalScrollIndicator={false}>
        <Text style={[s.title, { color: fg }]}>What would you like to discover?</Text>
        <Text style={[s.qSub, { color: muted }]}>Choose all that interest you.</Text>
        <ChipGrid
          items={DISCOVERY_PREFS} selected={discovery}
          onToggle={(v) => toggle(discovery, setDiscovery, v)}
          accent={primary} card={card} fg={fg} border={border}
        />
      </ScrollView>
    );

    if (step === 3) return (
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={s.stepContent} keyboardShouldPersistTaps="handled">
          <Text style={[s.title, { color: fg }]}>Set up your profile</Text>
          <Text style={[s.qSub, { color: muted }]}>This is how other people will see you.</Text>

          <View style={{ gap: 14 }}>
            <View>
              <Text style={[s.inputLabel, { color: muted }]}>Display name *</Text>
              <TextInput
                style={inputStyle}
                placeholder="Alex Thomas"
                placeholderTextColor={muted}
                value={displayName}
                onChangeText={setDisplayName}
                autoCapitalize="words"
                autoFocus
              />
            </View>
            <View>
              <Text style={[s.inputLabel, { color: muted }]}>Username</Text>
              <TextInput
                style={inputStyle}
                placeholder="@yourhandle"
                placeholderTextColor={muted}
                value={username}
                onChangeText={setUsername}
                autoCapitalize="none"
              />
            </View>
            <View>
              <Text style={[s.inputLabel, { color: muted }]}>Location (optional)</Text>
              <TextInput
                style={inputStyle}
                placeholder="New York, NY"
                placeholderTextColor={muted}
                value={location}
                onChangeText={setLocation}
              />
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );

    return null;
  }

  return (
    <View style={[{ flex: 1 }, { backgroundColor: bg }]}>
      <View style={[s.header, { paddingTop: insets.top + 12 }]}>
        {step > 0
          ? <TouchableOpacity onPress={handleBack} style={s.backChevron}>
              <Feather name="chevron-left" size={22} color={muted} />
            </TouchableOpacity>
          : <View style={s.backChevron} />}
        <ProgressDots total={STEPS} current={step} primary={primary} border={border} />
      </View>

      <Animated.View style={[{ flex: 1 }, { transform: [{ translateX: slideAnim }] }]}>
        {renderStep()}
      </Animated.View>

      <View style={[s.footer, { paddingBottom: insets.bottom + 12 }]}>
        <TouchableOpacity
          style={[s.continueBtn, { backgroundColor: canAdvance() ? primary : border }]}
          onPress={handleNext}
          disabled={!canAdvance()}
          activeOpacity={0.85}
        >
          <Text style={[s.continueText, { color: canAdvance() ? '#021208' : muted }]}>
            {step === STEPS - 1 ? 'Finish' : 'Continue'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Seller setup (4 steps) ───────────────────────────────────────────────────

function SellerSetup({
  isDark, onFinish, isBoth,
}: {
  isDark: boolean;
  onFinish: (data: Record<string, any>) => void;
  isBoth: boolean;
}) {
  const insets  = useSafeAreaInsets();
  const STEPS   = 4;
  const [step, setStep]               = useState(0);
  const [experienceLevel, setLevel]   = useState('');
  const [brandName, setBrandName]     = useState('');
  const [brandType, setBrandType]     = useState('');
  const [sellModel, setSellModel]     = useState('');
  const slideAnim                     = useRef(new Animated.Value(0)).current;

  const bg      = isDark ? '#0E0E0E' : '#F5F5F5';
  const card    = isDark ? '#1A1A1A' : '#FFFFFF';
  const border  = isDark ? '#2A2A2A' : '#E0E0E0';
  const fg      = isDark ? '#FFFFFF' : '#0A0A0A';
  const muted   = isDark ? '#888' : '#666';
  const primary = isBoth ? '#9B59B6' : '#4A90E2';
  const inputBg = isDark ? '#252525' : '#F0F0F0';

  function animateTo(next: number, dir: number) {
    Animated.timing(slideAnim, { toValue: dir * -SCREEN_W, duration: 220, useNativeDriver: true }).start(() => {
      setStep(next);
      slideAnim.setValue(dir * SCREEN_W);
      Animated.timing(slideAnim, { toValue: 0, duration: 220, useNativeDriver: true }).start();
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
    else onFinish({ experienceLevel, brandName, brandType, sellModel });
  }

  function handleBack() {
    if (step === 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    animateTo(step - 1, -1);
  }

  function renderStep() {
    if (step === 0) return (
      <ScrollView contentContainerStyle={s.stepContent} showsVerticalScrollIndicator={false}>
        <Text style={[s.title, { color: fg }]}>You're in!</Text>
        <Text style={[s.qSub, { color: muted }]}>
          {isBoth
            ? "Let's start with your brand. You can also shop from other brands when you're done."
            : 'Now let us help you get started with a few questions.'}
        </Text>
        <Text style={[s.qLabel, { color: fg }]}>What best describes you?</Text>
        <View style={s.listWrap}>
          {EXPERIENCE_LEVELS.map((e) => {
            const sel = experienceLevel === e.value;
            return (
              <TouchableOpacity
                key={e.value}
                style={[s.plainRow, { backgroundColor: card, borderColor: sel ? primary : border, borderWidth: sel ? 1.5 : 1 }]}
                onPress={() => { setLevel(e.value); Haptics.selectionAsync(); }}
                activeOpacity={0.8}
              >
                <Text style={[s.plainRowLabel, { color: fg }]}>{e.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
    );

    if (step === 1) return (
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={s.stepContent}>
          <Text style={[s.title, { color: fg }]}>What's your brand called?</Text>
          <Text style={[s.qSub, { color: muted }]}>You can change this anytime in settings.</Text>
          <TextInput
            style={[s.bigInput, { backgroundColor: inputBg, borderColor: border, color: fg }]}
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
      <ScrollView contentContainerStyle={s.stepContent} showsVerticalScrollIndicator={false}>
        <Text style={[s.title, { color: fg }]}>What do you create?</Text>
        <Text style={[s.qSub, { color: muted }]}>Pick the one that fits best.</Text>
        <View style={s.listWrap}>
          {SELLER_CATEGORIES.map((cat) => {
            const sel = brandType === cat.value;
            return (
              <TouchableOpacity
                key={cat.value}
                style={[s.plainRow, { backgroundColor: card, borderColor: sel ? primary : border, borderWidth: sel ? 1.5 : 1 }]}
                onPress={() => { setBrandType(cat.value); Haptics.selectionAsync(); }}
                activeOpacity={0.8}
              >
                <Text style={[s.plainRowLabel, { color: fg }]}>{cat.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
    );

    if (step === 3) return (
      <ScrollView contentContainerStyle={s.stepContent} showsVerticalScrollIndicator={false}>
        <Text style={[s.title, { color: fg }]}>How do you drop?</Text>
        <Text style={[s.qSub, { color: muted }]}>This helps us set up your payout flow.</Text>
        <View style={s.listWrap}>
          {MODELS.map((m) => {
            const sel = sellModel === m.value;
            return (
              <TouchableOpacity
                key={m.value}
                style={[s.plainRow, { backgroundColor: card, borderColor: sel ? primary : border, borderWidth: sel ? 1.5 : 1 }]}
                onPress={() => { setSellModel(m.value); Haptics.selectionAsync(); }}
                activeOpacity={0.8}
              >
                <Text style={[s.plainRowLabel, { color: fg }]}>{m.label}</Text>
                <Text style={[s.plainRowSub, { color: muted }]}>{m.sub}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
    );

    return null;
  }

  return (
    <View style={[{ flex: 1 }, { backgroundColor: bg }]}>
      <View style={[s.header, { paddingTop: insets.top + 12 }]}>
        {step > 0
          ? <TouchableOpacity onPress={handleBack} style={s.backChevron}>
              <Feather name="chevron-left" size={22} color={muted} />
            </TouchableOpacity>
          : <View style={s.backChevron} />}
        <ProgressDots total={STEPS} current={step} primary={primary} border={border} />
      </View>

      <Animated.View style={[{ flex: 1 }, { transform: [{ translateX: slideAnim }] }]}>
        {renderStep()}
      </Animated.View>

      <View style={[s.footer, { paddingBottom: insets.bottom + 12 }]}>
        <TouchableOpacity
          style={[s.continueBtn, { backgroundColor: canAdvance() ? primary : border }]}
          onPress={handleNext}
          disabled={!canAdvance()}
          activeOpacity={0.85}
        >
          <Text style={[s.continueText, { color: canAdvance() ? '#FFFFFF' : muted }]}>
            {step === STEPS - 1 ? (isBoth ? 'Continue to preferences' : 'Launch brand') : 'Continue'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function OnboardingScreen() {
  const router  = useRouter();
  const scheme  = useColorScheme();
  const isDark  = scheme !== 'light';

  const [accountType, setAccountType] = useState<AccountType | null>(null);
  const [loading, setLoading]         = useState(true);
  const [bothPhase, setBothPhase]     = useState<'seller' | 'buyer'>('seller');
  const [sellerData, setSellerData]   = useState<Record<string, any>>({});

  useEffect(() => {
    AsyncStorage.getItem('user_role').then((r) => {
      setAccountType(r as AccountType ?? null);
      setLoading(false);
    });
  }, []);

  const bg = isDark ? '#0E0E0E' : '#F5F5F5';

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color="#00C853" />
      </View>
    );
  }

  // ─── Finish handlers ─────────────────────────────────────────────────────

  const handleBuyerFinish = async (data: Record<string, any>) => {
    await AsyncStorage.multiSet([
      [ONBOARDING_KEY, 'true'],
      ['user_role', 'buyer'],
      ['buyer_styles', JSON.stringify(data.styles ?? [])],
      ['buyer_products', JSON.stringify(data.products ?? [])],
      ['buyer_discovery', JSON.stringify(data.discovery ?? [])],
      ['display_name', data.displayName ?? ''],
      ['username', data.username ?? ''],
      ['buyer_location', data.location ?? ''],
    ]);
    router.replace('/(buyer)/' as never);
  };

  const handleSellerFinish = async (data: Record<string, any>) => {
    await AsyncStorage.multiSet([
      [ONBOARDING_KEY, 'true'],
      ['user_role', 'seller'],
      ['brand_name', data.brandName ?? ''],
      ['brand_type', data.brandType ?? ''],
      ['sell_model', data.sellModel ?? ''],
      ['experience_level', data.experienceLevel ?? ''],
    ]);
    router.push('/plans?fromOnboarding=true' as never);
  };

  const handleBothSellerPhase = (data: Record<string, any>) => {
    setSellerData(data);
    setBothPhase('buyer');
  };

  const handleBothFinish = async (buyerData: Record<string, any>) => {
    await AsyncStorage.multiSet([
      [ONBOARDING_KEY, 'true'],
      ['user_role', 'both'],
      ['active_mode', 'seller'],
      ['brand_name', sellerData.brandName ?? ''],
      ['brand_type', sellerData.brandType ?? ''],
      ['sell_model', sellerData.sellModel ?? ''],
      ['experience_level', sellerData.experienceLevel ?? ''],
      ['buyer_styles', JSON.stringify(buyerData.styles ?? [])],
      ['buyer_products', JSON.stringify(buyerData.products ?? [])],
      ['buyer_discovery', JSON.stringify(buyerData.discovery ?? [])],
    ]);
    router.push('/plans?fromOnboarding=true' as never);
  };

  // ─── Route based on account type ─────────────────────────────────────────

  if (accountType === 'buyer') {
    return <BuyerOnboarding isDark={isDark} onFinish={handleBuyerFinish} showProfile />;
  }

  if (accountType === 'seller') {
    return <SellerSetup isDark={isDark} onFinish={handleSellerFinish} isBoth={false} />;
  }

  if (accountType === 'both') {
    if (bothPhase === 'seller') {
      return <SellerSetup isDark={isDark} onFinish={handleBothSellerPhase} isBoth />;
    }
    return <BuyerOnboarding isDark={isDark} onFinish={handleBothFinish} showProfile={false} />;
  }

  // Fallback: no account type, send back to account-type selection
  router.replace('/account-type' as never);
  return null;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  header:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, paddingBottom: 20, gap: 4 },
  backChevron:  { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', marginRight: 2 },
  dots:         { flexDirection: 'row', gap: 6, flex: 1 },
  dot:          { height: 4, flex: 1, borderRadius: 2 },
  stepContent:  { paddingHorizontal: 24, paddingTop: 4, paddingBottom: 24, flexGrow: 1 },
  title:        { fontSize: 28, fontFamily: 'Inter_700Bold', letterSpacing: -0.6, marginBottom: 12 },
  qSub:         { fontSize: 14, fontFamily: 'Inter_400Regular', lineHeight: 21, marginBottom: 24 },
  qLabel:       { fontSize: 16, fontFamily: 'Inter_700Bold', marginBottom: 14 },
  bigInput:     { borderRadius: 16, borderWidth: 1.5, paddingHorizontal: 18, paddingVertical: 16, fontSize: 22, fontFamily: 'Inter_600SemiBold', letterSpacing: -0.3 },
  inputLabel:   { fontSize: 12, fontFamily: 'Inter_600SemiBold', marginBottom: 6 },
  listWrap:     { gap: 12 },
  plainRow:     { borderRadius: 12, padding: 16 },
  plainRowLabel:{ fontSize: 15, fontFamily: 'Inter_500Medium' },
  plainRowSub:  { fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 18, marginTop: 3 },
  footer:       { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 24, paddingTop: 16 },
  continueBtn:  { minWidth: 160, paddingVertical: 14, paddingHorizontal: 24, borderRadius: 14, alignItems: 'center' },
  continueText: { fontSize: 15, fontFamily: 'Inter_700Bold' },

  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  chip: {
    borderRadius: 100, paddingHorizontal: 16, paddingVertical: 10,
    borderWidth: 1,
  },
  chipText: { fontSize: 14, fontFamily: 'Inter_500Medium' },
});
