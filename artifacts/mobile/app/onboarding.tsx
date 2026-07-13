import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Animated, Dimensions, useColorScheme, ScrollView,
  ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ONBOARDING_KEY } from './_layout';

const { width: SCREEN_W } = Dimensions.get('window');
type AccountType = 'buyer' | 'seller';

// ─── Data ─────────────────────────────────────────────────────────────────────

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

const EXPERIENCE_LEVELS = [
  { value: 'starting', label: 'I am just starting' },
  { value: 'selling',  label: 'I am already selling online or in person' },
];
const BRAND_STAGES = [
  { value: 'idea',      label: 'Just an idea', sub: "I haven't started yet" },
  { value: 'dev',       label: 'In development', sub: 'I am working on it' },
  { value: 'launched',  label: 'Just launched', sub: 'Up and running recently' },
  { value: 'scaling',   label: 'Already selling', sub: 'Looking to grow and scale' },
];
const PRIMARY_GOALS = [
  'Find manufacturers', 'Build a website', 'Design products',
  'Manage drops', 'Grow my audience', 'Handle payments',
  'Track inventory', 'Connect with buyers',
];
const BRAND_AESTHETICS = [
  'Minimalist', 'Bold & graphic', 'Streetwear', 'Luxury',
  'Vintage', 'Techwear', 'Workwear', 'Sustainable',
  'Y2K', 'Handmade', 'Premium basics', 'Avant-garde',
];
const PRODUCT_CATS = [
  'T-shirts', 'Hoodies', 'Pants & denim', 'Outerwear',
  'Activewear', 'Knitwear', 'Footwear', 'Accessories',
  'Bags', 'Hats', 'Jewelry',
];
const CURRENT_TOOLS = [
  'Shopify', 'Instagram', 'TikTok', 'Etsy',
  'WooCommerce', 'Spreadsheets', 'Squarespace', 'Nothing yet',
];
const TEAM_SIZES = [
  { value: 'solo',   label: 'Just me' },
  { value: 'small',  label: '2–5 people' },
  { value: 'mid',    label: '6–20 people' },
  { value: 'large',  label: '20+ people' },
];
const MONTHLY_ORDERS = [
  { value: 'pre',    label: '0 (pre-launch)' },
  { value: 'low',    label: '1–50 orders/month' },
  { value: 'mid',    label: '50–200 orders/month' },
  { value: 'high',   label: '200+ orders/month' },
];
const WORKSPACE_MODULES = [
  { value: 'design',     label: 'Design studio',        icon: '🎨' },
  { value: 'mfg',        label: 'Manufacturer search',  icon: '🏭' },
  { value: 'storefront', label: 'My storefront',        icon: '🛍️' },
  { value: 'orders',     label: 'Order management',     icon: '📦' },
  { value: 'analytics',  label: 'Analytics',            icon: '📊' },
];

const BUILD_STEPS = [
  'Setting up your workspace',
  'Configuring your brand profile',
  'Connecting your tools',
  'Personalising your dashboard',
  'Almost ready…',
];

// ─── Shared components ────────────────────────────────────────────────────────

function ProgressDots({ total, current, primary, border }: { total: number; current: number; primary: string; border: string }) {
  return (
    <View style={s.dots}>
      {Array.from({ length: total }).map((_, i) => (
        <View key={i} style={[s.dot, { backgroundColor: i <= current ? primary : border }]} />
      ))}
    </View>
  );
}

function ChipGrid({ items, selected, onToggle, max, accent, card, fg, border }: {
  items: string[]; selected: string[]; onToggle: (v: string) => void;
  max?: number; accent: string; card: string; fg: string; border: string;
}) {
  return (
    <View style={s.chipGrid}>
      {items.map((item) => {
        const isOn = selected.includes(item);
        const disabled = !isOn && max !== undefined && selected.length >= max;
        return (
          <TouchableOpacity
            key={item}
            style={[s.chip, { backgroundColor: isOn ? accent + '22' : card, borderColor: isOn ? accent : border }, isOn && { borderWidth: 1.5 }]}
            onPress={() => { if (disabled) return; Haptics.selectionAsync(); onToggle(item); }}
            activeOpacity={0.75}
          >
            <Text style={[s.chipText, { color: isOn ? accent : fg }]}>{item}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function PlainRadio({ items, selected, onSelect, primary, card, border, fg, muted }: {
  items: { value: string; label: string; sub?: string }[];
  selected: string; onSelect: (v: string) => void;
  primary: string; card: string; border: string; fg: string; muted: string;
}) {
  return (
    <View style={s.listWrap}>
      {items.map((item) => {
        const sel = selected === item.value;
        return (
          <TouchableOpacity
            key={item.value}
            style={[s.plainRow, { backgroundColor: card, borderColor: sel ? primary : border, borderWidth: sel ? 1.5 : 1 }]}
            onPress={() => { onSelect(item.value); Haptics.selectionAsync(); }}
            activeOpacity={0.8}
          >
            <Text style={[s.plainRowLabel, { color: fg }]}>{item.label}</Text>
            {item.sub && <Text style={[s.plainRowSub, { color: muted }]}>{item.sub}</Text>}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ─── Build animation screen ───────────────────────────────────────────────────

function BuildAnimation({ isDark, onDone }: { isDark: boolean; onDone: () => void }) {
  const insets  = useSafeAreaInsets();
  const progress = useRef(new Animated.Value(0)).current;
  const [step, setStep]   = useState(0);
  const bg      = isDark ? '#0E0E0E' : '#F5F5F5';
  const fg      = isDark ? '#FFFFFF' : '#0A0A0A';
  const muted   = isDark ? '#888' : '#666';
  const primary = '#00C853';

  useEffect(() => {
    // Cycle through build steps
    let currentStep = 0;
    const interval = setInterval(() => {
      currentStep += 1;
      if (currentStep < BUILD_STEPS.length) setStep(currentStep);
      else clearInterval(interval);
    }, 380);

    // Fill progress bar over 2.2s
    Animated.timing(progress, { toValue: 1, duration: 2200, useNativeDriver: false }).start();

    const timer = setTimeout(onDone, 2400);
    return () => { clearTimeout(timer); clearInterval(interval); };
  }, []);

  return (
    <View style={[{ flex: 1, backgroundColor: bg, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 }]}>
      <View style={[s.logoSquareSm, { backgroundColor: primary, marginBottom: 40 }]}>
        <Text style={s.logoLetterSm}>B</Text>
      </View>
      <Text style={[s.buildTitle, { color: fg }]}>Building your workspace</Text>
      <Text style={[s.buildStep, { color: muted }]}>{BUILD_STEPS[step]}</Text>

      {/* Progress bar */}
      <View style={[s.barTrack, { backgroundColor: isDark ? '#1A1A1A' : '#E0E0E0' }]}>
        <Animated.View
          style={[s.barFill, {
            backgroundColor: primary,
            width: progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
          }]}
        />
      </View>
    </View>
  );
}

// ─── Completion screens ───────────────────────────────────────────────────────

function BuyerCompletion({ isDark, onFinish }: { isDark: boolean; onFinish: () => void }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const slideUp = useRef(new Animated.Value(30)).current;
  const insets  = useSafeAreaInsets();
  const bg = isDark ? '#0E0E0E' : '#F5F5F5';
  const fg = isDark ? '#FFFFFF' : '#0A0A0A';
  const muted = isDark ? '#888' : '#666';

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.spring(slideUp, { toValue: 0, damping: 18, stiffness: 120, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <View style={[{ flex: 1, backgroundColor: bg }]}>
      <Animated.View style={[s.completionWrap, { opacity, transform: [{ translateY: slideUp }] }]}>
        <Text style={s.completionEmoji}>🎉</Text>
        <Text style={[s.completionTitle, { color: fg }]}>Your Brandthread is ready.</Text>
        <Text style={[s.completionSub, { color: muted }]}>
          Discover brands, track your orders, and follow the drops that match your taste — all in one place.
        </Text>

        <View style={s.featureList}>
          {['Personalised brand feed', 'Order tracking', 'Wishlist & collections', 'Chat with brands'].map((f) => (
            <View key={f} style={s.featureRow}>
              <Text style={[s.featureDot, { color: '#00C853' }]}>✓</Text>
              <Text style={[s.featureText, { color: fg }]}>{f}</Text>
            </View>
          ))}
        </View>
      </Animated.View>

      <View style={[s.completionFooter, { paddingBottom: insets.bottom + 24 }]}>
        <TouchableOpacity
          style={[s.completionBtn, { backgroundColor: '#00C853' }]}
          onPress={onFinish}
          activeOpacity={0.85}
        >
          <Text style={[s.completionBtnText, { color: '#021208' }]}>Start exploring</Text>
          <Feather name="arrow-right" size={18} color="#021208" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

function SellerCompletion({ isDark, brandName, onFinish }: { isDark: boolean; brandName: string; onFinish: () => void }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const slideUp = useRef(new Animated.Value(30)).current;
  const insets  = useSafeAreaInsets();
  const bg = isDark ? '#0E0E0E' : '#F5F5F5';
  const fg = isDark ? '#FFFFFF' : '#0A0A0A';
  const muted = isDark ? '#888' : '#666';
  const primary = '#4A90E2';

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.spring(slideUp, { toValue: 0, damping: 18, stiffness: 120, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <View style={[{ flex: 1, backgroundColor: bg }]}>
      <Animated.View style={[s.completionWrap, { opacity, transform: [{ translateY: slideUp }] }]}>
        <Text style={s.completionEmoji}>🚀</Text>
        <Text style={[s.completionTitle, { color: fg }]}>Your brand workspace is ready.</Text>
        {brandName ? (
          <Text style={[s.brandNameLabel, { color: primary }]}>{brandName}</Text>
        ) : null}
        <Text style={[s.completionSub, { color: muted }]}>
          You're all set up. Choose your plan to unlock manufacturing, payments, and storefronts.
        </Text>

        <View style={s.featureList}>
          {['Manufacturer network', 'Drop management', 'Custom storefront', 'Payout dashboard'].map((f) => (
            <View key={f} style={s.featureRow}>
              <Text style={[s.featureDot, { color: primary }]}>✓</Text>
              <Text style={[s.featureText, { color: fg }]}>{f}</Text>
            </View>
          ))}
        </View>
      </Animated.View>

      <View style={[s.completionFooter, { paddingBottom: insets.bottom + 24 }]}>
        <TouchableOpacity
          style={[s.completionBtn, { backgroundColor: primary }]}
          onPress={onFinish}
          activeOpacity={0.85}
        >
          <Text style={[s.completionBtnText, { color: '#FFF' }]}>Enter Brandthread</Text>
          <Feather name="arrow-right" size={18} color="#FFF" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

function BothCompletion({ isDark, brandName, onFinish }: { isDark: boolean; brandName: string; onFinish: () => void }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const slideUp = useRef(new Animated.Value(30)).current;
  const insets  = useSafeAreaInsets();
  const bg = isDark ? '#0E0E0E' : '#F5F5F5';
  const fg = isDark ? '#FFFFFF' : '#0A0A0A';
  const muted = isDark ? '#888' : '#666';
  const primary = '#9B59B6';

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.spring(slideUp, { toValue: 0, damping: 18, stiffness: 120, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <View style={[{ flex: 1, backgroundColor: bg }]}>
      <Animated.View style={[s.completionWrap, { opacity, transform: [{ translateY: slideUp }] }]}>
        <Text style={s.completionEmoji}>✨</Text>
        <Text style={[s.completionTitle, { color: fg }]}>Both sides of your Brandthread are ready.</Text>
        {brandName ? <Text style={[s.brandNameLabel, { color: primary }]}>{brandName}</Text> : null}
        <Text style={[s.completionSub, { color: muted }]}>
          {`Run ${brandName || 'your brand'}, discover other brands, and switch between your business and shopping experiences from one account.`}
        </Text>

        <View style={s.featureList}>
          {['One account, two experiences', 'Switch modes instantly', 'Separate order histories', 'Full brand workspace'].map((f) => (
            <View key={f} style={s.featureRow}>
              <Text style={[s.featureDot, { color: primary }]}>✓</Text>
              <Text style={[s.featureText, { color: fg }]}>{f}</Text>
            </View>
          ))}
        </View>
      </Animated.View>

      <View style={[s.completionFooter, { paddingBottom: insets.bottom + 24 }]}>
        <TouchableOpacity
          style={[s.completionBtn, { backgroundColor: primary }]}
          onPress={onFinish}
          activeOpacity={0.85}
        >
          <Text style={[s.completionBtnText, { color: '#FFF' }]}>Enter Brandthread</Text>
          <Feather name="arrow-right" size={18} color="#FFF" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Buyer onboarding (4 screens + completion) ────────────────────────────────

function BuyerOnboarding({ isDark, onFinish, showProfile = true }: { isDark: boolean; onFinish: (data: Record<string, any>) => void; showProfile?: boolean }) {
  const insets  = useSafeAreaInsets();
  const QUESTION_STEPS = showProfile ? 4 : 3;
  const [step, setStep]         = useState(0);
  const [showCompletion, setShowCompletion] = useState(false);
  const [styles_,  setStylesArr]   = useState<string[]>([]);
  const [products, setProducts]    = useState<string[]>([]);
  const [discovery, setDiscovery]  = useState<string[]>([]);
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername]    = useState('');
  const [location, setLocation]    = useState('');
  const slideAnim = useRef(new Animated.Value(0)).current;

  const bg = isDark ? '#0E0E0E' : '#F5F5F5'; const card = isDark ? '#1A1A1A' : '#FFFFFF';
  const border = isDark ? '#2A2A2A' : '#E0E0E0'; const fg = isDark ? '#FFFFFF' : '#0A0A0A';
  const muted = isDark ? '#888' : '#666'; const primary = '#00C853';
  const inputBg = isDark ? '#252525' : '#F0F0F0';

  function animateTo(next: number, dir: number) {
    Animated.timing(slideAnim, { toValue: dir * -SCREEN_W, duration: 220, useNativeDriver: true }).start(() => {
      setStep(next); slideAnim.setValue(dir * SCREEN_W);
      Animated.timing(slideAnim, { toValue: 0, duration: 220, useNativeDriver: true }).start();
    });
  }
  function toggle(list: string[], set: (v: string[]) => void, value: string, max?: number) {
    if (list.includes(value)) set(list.filter(v => v !== value));
    else if (!max || list.length < max) set([...list, value]);
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
    if (step < QUESTION_STEPS - 1) animateTo(step + 1, 1);
    else setShowCompletion(true);
  }
  function handleBack() {
    if (step === 0) return;
    animateTo(step - 1, -1);
  }

  if (showCompletion) {
    return <BuyerCompletion isDark={isDark} onFinish={() => onFinish({ styles: styles_, products, discovery, displayName, username, location })} />;
  }

  const inputStyle = [s.bigInput, { backgroundColor: inputBg, borderColor: border, color: fg }];

  function renderStep() {
    if (step === 0) return (
      <ScrollView contentContainerStyle={s.stepContent} showsVerticalScrollIndicator={false}>
        <Text style={[s.title, { color: fg }]}>What styles are you into?</Text>
        <Text style={[s.qSub, { color: muted }]}>Pick up to 5. We'll personalise your feed.</Text>
        <ChipGrid items={STYLE_INTERESTS} selected={styles_} onToggle={v => toggle(styles_, setStylesArr, v, 5)} max={5} accent={primary} card={card} fg={fg} border={border} />
      </ScrollView>
    );
    if (step === 1) return (
      <ScrollView contentContainerStyle={s.stepContent} showsVerticalScrollIndicator={false}>
        <Text style={[s.title, { color: fg }]}>What do you usually shop for?</Text>
        <Text style={[s.qSub, { color: muted }]}>Select everything that applies.</Text>
        <ChipGrid items={PRODUCT_INTERESTS} selected={products} onToggle={v => toggle(products, setProducts, v)} accent={primary} card={card} fg={fg} border={border} />
      </ScrollView>
    );
    if (step === 2) return (
      <ScrollView contentContainerStyle={s.stepContent} showsVerticalScrollIndicator={false}>
        <Text style={[s.title, { color: fg }]}>What would you like to discover?</Text>
        <Text style={[s.qSub, { color: muted }]}>Choose all that interest you.</Text>
        <ChipGrid items={DISCOVERY_PREFS} selected={discovery} onToggle={v => toggle(discovery, setDiscovery, v)} accent={primary} card={card} fg={fg} border={border} />
      </ScrollView>
    );
    if (step === 3) return (
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={s.stepContent} keyboardShouldPersistTaps="handled">
          <Text style={[s.title, { color: fg }]}>Set up your profile</Text>
          <Text style={[s.qSub, { color: muted }]}>This is how other people will see you.</Text>
          <View style={{ gap: 14 }}>
            <View><Text style={[s.inputLabel, { color: muted }]}>Display name *</Text><TextInput style={inputStyle} placeholder="Alex Thomas" placeholderTextColor={muted} value={displayName} onChangeText={setDisplayName} autoCapitalize="words" autoFocus /></View>
            <View><Text style={[s.inputLabel, { color: muted }]}>Username</Text><TextInput style={inputStyle} placeholder="@yourhandle" placeholderTextColor={muted} value={username} onChangeText={setUsername} autoCapitalize="none" /></View>
            <View><Text style={[s.inputLabel, { color: muted }]}>Location (optional)</Text><TextInput style={inputStyle} placeholder="New York, NY" placeholderTextColor={muted} value={location} onChangeText={setLocation} /></View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
    return null;
  }

  return (
    <View style={[{ flex: 1 }, { backgroundColor: bg }]}>
      <View style={[s.header, { paddingTop: insets.top + 12 }]}>
        {step > 0 ? <TouchableOpacity onPress={handleBack} style={s.backChevron}><Feather name="chevron-left" size={22} color={muted} /></TouchableOpacity> : <View style={s.backChevron} />}
        <ProgressDots total={QUESTION_STEPS} current={step} primary={primary} border={border} />
      </View>
      <Animated.View style={[{ flex: 1 }, { transform: [{ translateX: slideAnim }] }]}>{renderStep()}</Animated.View>
      <View style={[s.footer, { paddingBottom: insets.bottom + 12 }]}>
        <TouchableOpacity style={[s.continueBtn, { backgroundColor: canAdvance() ? primary : border }]} onPress={handleNext} disabled={!canAdvance()} activeOpacity={0.85}>
          <Text style={[s.continueText, { color: canAdvance() ? '#021208' : muted }]}>{step === QUESTION_STEPS - 1 ? 'Finish' : 'Continue'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Seller setup (11 steps: 9 questions + build animation + completion) ───────

function SellerSetup({ isDark, onFinish, isBoth }: { isDark: boolean; onFinish: (data: Record<string, any>) => void; isBoth: boolean }) {
  const insets = useSafeAreaInsets();
  const QUESTION_STEPS = 9; // steps 0-8 are questions
  const [step, setStep]           = useState(0);
  const [phase, setPhase]         = useState<'questions' | 'build' | 'completion'>('questions');

  // Question answers
  const [experienceLevel, setLevel]   = useState('');
  const [brandStage, setBrandStage]   = useState('');
  const [goals, setGoals]             = useState<string[]>([]);
  const [brandName, setBrandName]     = useState('');
  const [founderName, setFounderName] = useState('');
  const [website, setWebsite]         = useState('');
  const [brandLocation, setBrandLocation] = useState('');
  const [aesthetics, setAesthetics]   = useState<string[]>([]);
  const [categories, setCategories]   = useState<string[]>([]);
  const [tools, setTools]             = useState<string[]>([]);
  const [teamSize, setTeamSize]       = useState('');
  const [monthlyOrders, setOrders]    = useState('');
  const [prefModule, setPrefModule]   = useState('');

  const slideAnim = useRef(new Animated.Value(0)).current;

  const bg = isDark ? '#0E0E0E' : '#F5F5F5'; const card = isDark ? '#1A1A1A' : '#FFFFFF';
  const border = isDark ? '#2A2A2A' : '#E0E0E0'; const fg = isDark ? '#FFFFFF' : '#0A0A0A';
  const muted = isDark ? '#888' : '#666'; const inputBg = isDark ? '#252525' : '#F0F0F0';
  const primary = isBoth ? '#9B59B6' : '#4A90E2';

  function animateTo(next: number, dir: number) {
    Animated.timing(slideAnim, { toValue: dir * -SCREEN_W, duration: 220, useNativeDriver: true }).start(() => {
      setStep(next); slideAnim.setValue(dir * SCREEN_W);
      Animated.timing(slideAnim, { toValue: 0, duration: 220, useNativeDriver: true }).start();
    });
  }
  function toggle(list: string[], set: (v: string[]) => void, value: string) {
    if (list.includes(value)) set(list.filter(v => v !== value)); else set([...list, value]);
  }
  function canAdvance() {
    switch (step) {
      case 0: return !!experienceLevel;
      case 1: return !!brandStage;
      case 2: return goals.length > 0;
      case 3: return brandName.trim().length > 1;
      case 4: return aesthetics.length > 0;
      case 5: return categories.length > 0;
      case 6: return tools.length > 0;
      case 7: return !!teamSize && !!monthlyOrders;
      case 8: return !!prefModule;
      default: return false;
    }
  }
  function handleNext() {
    if (!canAdvance()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (step < QUESTION_STEPS - 1) animateTo(step + 1, 1);
    else setPhase('build');
  }
  function handleBack() {
    if (step === 0) return;
    animateTo(step - 1, -1);
  }

  const data = { experienceLevel, brandStage, goals, brandName, founderName, website, brandLocation, aesthetics, categories, tools, teamSize, monthlyOrders, prefModule };

  if (phase === 'build') return <BuildAnimation isDark={isDark} onDone={() => setPhase('completion')} />;
  if (phase === 'completion') {
    if (isBoth) return null; // parent handles completion for "both"
    return <SellerCompletion isDark={isDark} brandName={brandName} onFinish={() => onFinish(data)} />;
  }

  const inputStyle = [s.bigInput, { backgroundColor: inputBg, borderColor: border, color: fg }];
  const smInput    = [s.smInput,  { backgroundColor: inputBg, borderColor: border, color: fg }];

  function renderStep() {
    // Step 0: Experience level
    if (step === 0) return (
      <ScrollView contentContainerStyle={s.stepContent} showsVerticalScrollIndicator={false}>
        <Text style={[s.title, { color: fg }]}>You're in!</Text>
        <Text style={[s.qSub, { color: muted }]}>
          {isBoth
            ? "Let's start with your brand. You'll be able to switch to shopping mode at any time."
            : 'Let us help you get started with a few questions.'}
        </Text>
        <Text style={[s.qLabel, { color: fg }]}>What best describes you?</Text>
        <PlainRadio items={EXPERIENCE_LEVELS} selected={experienceLevel} onSelect={setLevel} primary={primary} card={card} border={border} fg={fg} muted={muted} />
      </ScrollView>
    );

    // Step 1: Brand stage
    if (step === 1) return (
      <ScrollView contentContainerStyle={s.stepContent} showsVerticalScrollIndicator={false}>
        <Text style={[s.title, { color: fg }]}>Where is your brand right now?</Text>
        <Text style={[s.qSub, { color: muted }]}>We'll tailor your workspace to your stage.</Text>
        <PlainRadio items={BRAND_STAGES} selected={brandStage} onSelect={setBrandStage} primary={primary} card={card} border={border} fg={fg} muted={muted} />
      </ScrollView>
    );

    // Step 2: Primary goals
    if (step === 2) return (
      <ScrollView contentContainerStyle={s.stepContent} showsVerticalScrollIndicator={false}>
        <Text style={[s.title, { color: fg }]}>What do you want to accomplish?</Text>
        <Text style={[s.qSub, { color: muted }]}>Pick everything you're focused on.</Text>
        <ChipGrid items={PRIMARY_GOALS} selected={goals} onToggle={v => toggle(goals, setGoals, v)} accent={primary} card={card} fg={fg} border={border} />
      </ScrollView>
    );

    // Step 3: Brand information
    if (step === 3) return (
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={s.stepContent} keyboardShouldPersistTaps="handled">
          <Text style={[s.title, { color: fg }]}>Tell us about your brand</Text>
          <Text style={[s.qSub, { color: muted }]}>You can update these any time.</Text>
          <View style={{ gap: 14 }}>
            <View><Text style={[s.inputLabel, { color: muted }]}>Brand name *</Text><TextInput style={inputStyle} placeholder="e.g. Noir Collective" placeholderTextColor={muted} value={brandName} onChangeText={setBrandName} autoCapitalize="words" autoFocus /></View>
            <View><Text style={[s.inputLabel, { color: muted }]}>Your name (founder)</Text><TextInput style={inputStyle} placeholder="Alex Thomas" placeholderTextColor={muted} value={founderName} onChangeText={setFounderName} autoCapitalize="words" /></View>
            <View><Text style={[s.inputLabel, { color: muted }]}>Website (optional)</Text><TextInput style={inputStyle} placeholder="https://yourbrand.com" placeholderTextColor={muted} value={website} onChangeText={setWebsite} autoCapitalize="none" keyboardType="url" /></View>
            <View><Text style={[s.inputLabel, { color: muted }]}>Location (optional)</Text><TextInput style={inputStyle} placeholder="New York, NY" placeholderTextColor={muted} value={brandLocation} onChangeText={setBrandLocation} /></View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );

    // Step 4: Brand aesthetic
    if (step === 4) return (
      <ScrollView contentContainerStyle={s.stepContent} showsVerticalScrollIndicator={false}>
        <Text style={[s.title, { color: fg }]}>How would you describe your aesthetic?</Text>
        <Text style={[s.qSub, { color: muted }]}>Pick all that apply to your brand.</Text>
        <ChipGrid items={BRAND_AESTHETICS} selected={aesthetics} onToggle={v => toggle(aesthetics, setAesthetics, v)} accent={primary} card={card} fg={fg} border={border} />
      </ScrollView>
    );

    // Step 5: Product categories
    if (step === 5) return (
      <ScrollView contentContainerStyle={s.stepContent} showsVerticalScrollIndicator={false}>
        <Text style={[s.title, { color: fg }]}>What do you create?</Text>
        <Text style={[s.qSub, { color: muted }]}>Select all product types you make or plan to make.</Text>
        <ChipGrid items={PRODUCT_CATS} selected={categories} onToggle={v => toggle(categories, setCategories, v)} accent={primary} card={card} fg={fg} border={border} />
      </ScrollView>
    );

    // Step 6: Current tools
    if (step === 6) return (
      <ScrollView contentContainerStyle={s.stepContent} showsVerticalScrollIndicator={false}>
        <Text style={[s.title, { color: fg }]}>What tools do you currently use?</Text>
        <Text style={[s.qSub, { color: muted }]}>We'll help you migrate or connect them.</Text>
        <ChipGrid items={CURRENT_TOOLS} selected={tools} onToggle={v => toggle(tools, setTools, v)} accent={primary} card={card} fg={fg} border={border} />
      </ScrollView>
    );

    // Step 7: Team & business size
    if (step === 7) return (
      <ScrollView contentContainerStyle={s.stepContent} showsVerticalScrollIndicator={false}>
        <Text style={[s.title, { color: fg }]}>Your team & business size</Text>
        <Text style={[s.qSub, { color: muted }]}>Helps us set the right defaults for your workspace.</Text>
        <Text style={[s.qLabel, { color: fg }]}>Team size</Text>
        <PlainRadio items={TEAM_SIZES} selected={teamSize} onSelect={setTeamSize} primary={primary} card={card} border={border} fg={fg} muted={muted} />
        <Text style={[s.qLabel, { color: fg, marginTop: 24 }]}>Monthly orders</Text>
        <PlainRadio items={MONTHLY_ORDERS} selected={monthlyOrders} onSelect={setOrders} primary={primary} card={card} border={border} fg={fg} muted={muted} />
      </ScrollView>
    );

    // Step 8: Workspace personalization
    if (step === 8) return (
      <ScrollView contentContainerStyle={s.stepContent} showsVerticalScrollIndicator={false}>
        <Text style={[s.title, { color: fg }]}>What do you want to see first?</Text>
        <Text style={[s.qSub, { color: muted }]}>Your workspace will open here by default.</Text>
        <View style={s.listWrap}>
          {WORKSPACE_MODULES.map((m) => {
            const sel = prefModule === m.value;
            return (
              <TouchableOpacity
                key={m.value}
                style={[s.moduleRow, { backgroundColor: card, borderColor: sel ? primary : border, borderWidth: sel ? 1.5 : 1 }]}
                onPress={() => { setPrefModule(m.value); Haptics.selectionAsync(); }}
                activeOpacity={0.8}
              >
                <Text style={s.moduleEmoji}>{m.icon}</Text>
                <Text style={[s.plainRowLabel, { color: fg }]}>{m.label}</Text>
                {sel && <Feather name="check" size={16} color={primary} style={{ marginLeft: 'auto' }} />}
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
        {step > 0 ? <TouchableOpacity onPress={handleBack} style={s.backChevron}><Feather name="chevron-left" size={22} color={muted} /></TouchableOpacity> : <View style={s.backChevron} />}
        <ProgressDots total={QUESTION_STEPS} current={step} primary={primary} border={border} />
      </View>
      <Animated.View style={[{ flex: 1 }, { transform: [{ translateX: slideAnim }] }]}>{renderStep()}</Animated.View>
      <View style={[s.footer, { paddingBottom: insets.bottom + 12 }]}>
        <TouchableOpacity style={[s.continueBtn, { backgroundColor: canAdvance() ? primary : border }]} onPress={handleNext} disabled={!canAdvance()} activeOpacity={0.85}>
          <Text style={[s.continueText, { color: canAdvance() ? '#FFFFFF' : muted }]}>
            {step === QUESTION_STEPS - 1 ? 'Build my workspace' : 'Continue'}
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

  const handleBuyerFinish = async (data: Record<string, any>) => {
    await AsyncStorage.multiSet([
      [ONBOARDING_KEY, 'true'], ['user_role', 'buyer'],
      ['buyer_styles', JSON.stringify(data.styles ?? [])],
      ['buyer_products', JSON.stringify(data.products ?? [])],
      ['buyer_discovery', JSON.stringify(data.discovery ?? [])],
      ['display_name', data.displayName ?? ''], ['username', data.username ?? ''],
      ['buyer_location', data.location ?? ''],
    ]);
    router.replace('/(buyer)/' as never);
  };

  const handleSellerFinish = async (data: Record<string, any>) => {
    await AsyncStorage.multiSet([
      ['user_role', 'seller'],
      ['brand_name', data.brandName ?? ''], ['founder_name', data.founderName ?? ''],
      ['brand_website', data.website ?? ''], ['brand_location', data.brandLocation ?? ''],
      ['brand_stage', data.brandStage ?? ''], ['experience_level', data.experienceLevel ?? ''],
      ['brand_aesthetics', JSON.stringify(data.aesthetics ?? [])],
      ['product_categories', JSON.stringify(data.categories ?? [])],
      ['current_tools', JSON.stringify(data.tools ?? [])],
      ['team_size', data.teamSize ?? ''], ['monthly_orders', data.monthlyOrders ?? ''],
      ['pref_module', data.prefModule ?? ''],
    ]);
    router.push('/plans?fromOnboarding=true' as never);
  };

  if (accountType === 'buyer') return <BuyerOnboarding isDark={isDark} onFinish={handleBuyerFinish} showProfile />;
  if (accountType === 'seller') return <SellerSetup isDark={isDark} onFinish={handleSellerFinish} isBoth={false} />;

  router.replace('/account-type' as never);
  return null;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  header:        { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, paddingBottom: 20, gap: 4 },
  backChevron:   { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', marginRight: 2 },
  dots:          { flexDirection: 'row', gap: 6, flex: 1 },
  dot:           { height: 4, flex: 1, borderRadius: 2 },
  stepContent:   { paddingHorizontal: 24, paddingTop: 4, paddingBottom: 24, flexGrow: 1 },
  title:         { fontSize: 28, fontFamily: 'Inter_700Bold', letterSpacing: -0.6, marginBottom: 12 },
  qSub:          { fontSize: 14, fontFamily: 'Inter_400Regular', lineHeight: 21, marginBottom: 24 },
  qLabel:        { fontSize: 16, fontFamily: 'Inter_700Bold', marginBottom: 14 },
  bigInput:      { borderRadius: 16, borderWidth: 1.5, paddingHorizontal: 18, paddingVertical: 16, fontSize: 22, fontFamily: 'Inter_600SemiBold', letterSpacing: -0.3 },
  smInput:       { borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, fontFamily: 'Inter_400Regular' },
  inputLabel:    { fontSize: 12, fontFamily: 'Inter_600SemiBold', marginBottom: 6 },
  listWrap:      { gap: 12 },
  plainRow:      { borderRadius: 12, padding: 16 },
  plainRowLabel: { fontSize: 15, fontFamily: 'Inter_500Medium' },
  plainRowSub:   { fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 18, marginTop: 3 },
  moduleRow:     { borderRadius: 12, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  moduleEmoji:   { fontSize: 20 },
  footer:        { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 24, paddingTop: 16 },
  continueBtn:   { minWidth: 180, paddingVertical: 14, paddingHorizontal: 24, borderRadius: 14, alignItems: 'center' },
  continueText:  { fontSize: 15, fontFamily: 'Inter_700Bold' },
  chipGrid:      { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  chip:          { borderRadius: 100, paddingHorizontal: 16, paddingVertical: 10, borderWidth: 1 },
  chipText:      { fontSize: 14, fontFamily: 'Inter_500Medium' },
  // Build animation
  logoSquareSm:  { width: 64, height: 64, borderRadius: 18, alignItems: 'center', justifyContent: 'center', shadowColor: '#00C853', shadowOpacity: 0.5, shadowRadius: 20, shadowOffset: { width: 0, height: 0 }, elevation: 12 },
  logoLetterSm:  { fontSize: 38, fontFamily: 'Inter_700Bold', color: '#FFF' },
  buildTitle:    { fontSize: 22, fontFamily: 'Inter_700Bold', marginBottom: 12, textAlign: 'center' },
  buildStep:     { fontSize: 14, fontFamily: 'Inter_400Regular', marginBottom: 36, textAlign: 'center' },
  barTrack:      { width: '100%', height: 4, borderRadius: 2, overflow: 'hidden' },
  barFill:       { height: 4, borderRadius: 2 },
  // Completion
  completionWrap:   { flex: 1, paddingHorizontal: 32, paddingTop: 64, alignItems: 'center' },
  completionEmoji:  { fontSize: 56, marginBottom: 24 },
  completionTitle:  { fontSize: 26, fontFamily: 'Inter_700Bold', letterSpacing: -0.5, textAlign: 'center', marginBottom: 12 },
  brandNameLabel:   { fontSize: 18, fontFamily: 'Inter_700Bold', marginBottom: 12 },
  completionSub:    { fontSize: 15, fontFamily: 'Inter_400Regular', lineHeight: 23, textAlign: 'center', marginBottom: 32 },
  featureList:      { width: '100%', gap: 12 },
  featureRow:       { flexDirection: 'row', alignItems: 'center', gap: 12 },
  featureDot:       { fontSize: 16, fontFamily: 'Inter_700Bold' },
  featureText:      { fontSize: 15, fontFamily: 'Inter_500Medium' },
  completionFooter: { paddingHorizontal: 24 },
  completionBtn:    { borderRadius: 16, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  completionBtnText:{ fontSize: 16, fontFamily: 'Inter_700Bold' },
});
