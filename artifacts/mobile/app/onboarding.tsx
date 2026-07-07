import React, { useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Animated, Dimensions, useColorScheme, ScrollView,
  ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useApi } from '@/hooks/useApi';
import * as Haptics from 'expo-haptics';

const { width: SCREEN_W } = Dimensions.get('window');
const TOTAL_STEPS = 4;

// ─── Step data ────────────────────────────────────────────────────────────────

const CATEGORIES = [
  { value: 'streetwear',   label: 'Streetwear',   emoji: '🔥' },
  { value: 'luxury',       label: 'Luxury',        emoji: '✨' },
  { value: 'casual',       label: 'Casual',        emoji: '☁️' },
  { value: 'athletic',     label: 'Athletic',      emoji: '⚡' },
  { value: 'workwear',     label: 'Workwear',      emoji: '🏗️' },
  { value: 'accessories',  label: 'Accessories',   emoji: '💍' },
];

const STAGES = [
  { value: 'starting',     label: 'Just starting out',   sub: 'Planning my first drop',         emoji: '🌱' },
  { value: 'traction',     label: 'Getting traction',    sub: 'Some sales, building momentum',  emoji: '🔥' },
  { value: 'established',  label: 'Established brand',   sub: 'Consistent sales, now scaling',  emoji: '👑' },
];

const MODELS = [
  { value: 'pre-order',    label: 'Pre-Order Drops',     sub: 'Hold orders, ship when manufactured',   emoji: '📦' },
  { value: 'pre-made',     label: 'Pre-Made Stock',      sub: 'Sell from inventory you already have',  emoji: '🏪' },
  { value: 'both',         label: 'Both',                sub: 'Mix of pre-order and in-stock',         emoji: '⚖️' },
  { value: 'figuring-out', label: 'Still figuring out',  sub: 'Show me everything',                   emoji: '🤔' },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function OnboardingScreen() {
  const router   = useRouter();
  const api      = useApi();
  const insets   = useSafeAreaInsets();
  const scheme   = useColorScheme();
  const isDark   = scheme !== 'light';

  const [step, setStep]           = useState(0);
  const [brandName, setBrandName] = useState('');
  const [brandType, setBrandType] = useState('');
  const [brandStage, setBrandStage] = useState('');
  const [sellModel, setSellModel] = useState('');
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState('');

  // Sliding animation
  const slideAnim = useRef(new Animated.Value(0)).current;
  const direction = useRef(1); // 1 = forward, -1 = backward

  const bg       = isDark ? '#08080F' : '#F8F7FF';
  const card     = isDark ? '#111118' : '#FFFFFF';
  const border   = isDark ? '#252535' : '#DDD6FE';
  const fg       = isDark ? '#F0EEFF' : '#1A1035';
  const muted    = isDark ? '#6B6B8A' : '#6D6892';
  const primary  = isDark ? '#9F7AEA' : '#7C3AED';
  const inputBg  = isDark ? '#1C1C2E' : '#F0EEFF';
  const cardSel  = isDark ? '#2D1F5E' : '#EDE9FE';

  function animateTo(nextStep: number, dir: number) {
    direction.current = dir;
    // Slide out
    Animated.timing(slideAnim, {
      toValue: dir * -SCREEN_W,
      duration: 260,
      useNativeDriver: true,
    }).start(() => {
      setStep(nextStep);
      slideAnim.setValue(dir * SCREEN_W);
      // Slide in
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 260,
        useNativeDriver: true,
      }).start();
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
    if (step < TOTAL_STEPS - 1) {
      animateTo(step + 1, 1);
    } else {
      handleFinish();
    }
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
      await api.auth.sync();
      await api.auth.onboarding({ brandName: brandName.trim(), brandType, brandStage, sellModel });
      router.replace('/');
    } catch (err: any) {
      setSaving(false);
      setError(err?.message ?? 'Something went wrong. Please try again.');
    }
  }

  // ─── Step renderers ─────────────────────────────────────────────────────────

  function renderStep() {
    switch (step) {
      case 0: return (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <View style={styles.stepContent}>
            <Text style={[styles.emoji]}>✂️</Text>
            <Text style={[styles.q, { color: fg }]}>What's your{'\n'}brand called?</Text>
            <Text style={[styles.qSub, { color: muted }]}>You can change this anytime in settings.</Text>
            <TextInput
              style={[styles.bigInput, { backgroundColor: inputBg, borderColor: border, color: fg }]}
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

      case 1: return (
        <ScrollView contentContainerStyle={styles.stepContent} showsVerticalScrollIndicator={false}>
          <Text style={styles.emoji}>👕</Text>
          <Text style={[styles.q, { color: fg }]}>What do{'\n'}you create?</Text>
          <Text style={[styles.qSub, { color: muted }]}>Pick the one that fits best.</Text>
          <View style={styles.gridWrap}>
            {CATEGORIES.map(cat => {
              const sel = brandType === cat.value;
              return (
                <TouchableOpacity
                  key={cat.value}
                  style={[styles.gridCard, { backgroundColor: sel ? cardSel : card, borderColor: sel ? primary : border }]}
                  onPress={() => { setBrandType(cat.value); Haptics.selectionAsync(); }}
                  activeOpacity={0.8}
                >
                  <Text style={styles.gridEmoji}>{cat.emoji}</Text>
                  <Text style={[styles.gridLabel, { color: sel ? primary : fg }]}>{cat.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </ScrollView>
      );

      case 2: return (
        <ScrollView contentContainerStyle={styles.stepContent} showsVerticalScrollIndicator={false}>
          <Text style={styles.emoji}>📍</Text>
          <Text style={[styles.q, { color: fg }]}>Where are you{'\n'}right now?</Text>
          <Text style={[styles.qSub, { color: muted }]}>We'll tailor Brandthread to your stage.</Text>
          {STAGES.map(s => {
            const sel = brandStage === s.value;
            return (
              <TouchableOpacity
                key={s.value}
                style={[styles.listCard, { backgroundColor: sel ? cardSel : card, borderColor: sel ? primary : border }]}
                onPress={() => { setBrandStage(s.value); Haptics.selectionAsync(); }}
                activeOpacity={0.8}
              >
                <Text style={styles.listEmoji}>{s.emoji}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.listLabel, { color: sel ? primary : fg }]}>{s.label}</Text>
                  <Text style={[styles.listSub, { color: muted }]}>{s.sub}</Text>
                </View>
                <View style={[styles.radio, { borderColor: sel ? primary : border, backgroundColor: sel ? primary : 'transparent' }]}>
                  {sel && <View style={styles.radioDot} />}
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      );

      case 3: return (
        <ScrollView contentContainerStyle={styles.stepContent} showsVerticalScrollIndicator={false}>
          <Text style={styles.emoji}>🚀</Text>
          <Text style={[styles.q, { color: fg }]}>How do you{'\n'}drop?</Text>
          <Text style={[styles.qSub, { color: muted }]}>This helps us set up your payout flow.</Text>
          {MODELS.map(m => {
            const sel = sellModel === m.value;
            return (
              <TouchableOpacity
                key={m.value}
                style={[styles.listCard, { backgroundColor: sel ? cardSel : card, borderColor: sel ? primary : border }]}
                onPress={() => { setSellModel(m.value); Haptics.selectionAsync(); }}
                activeOpacity={0.8}
              >
                <Text style={styles.listEmoji}>{m.emoji}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.listLabel, { color: sel ? primary : fg }]}>{m.label}</Text>
                  <Text style={[styles.listSub, { color: muted }]}>{m.sub}</Text>
                </View>
                <View style={[styles.radio, { borderColor: sel ? primary : border, backgroundColor: sel ? primary : 'transparent' }]}>
                  {sel && <View style={styles.radioDot} />}
                </View>
              </TouchableOpacity>
            );
          })}
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>
      );

      default: return null;
    }
  }

  const isLast   = step === TOTAL_STEPS - 1;
  const ready    = canAdvance();

  return (
    <View style={[styles.container, { backgroundColor: bg }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        {/* Progress dots */}
        <View style={styles.dots}>
          {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                { backgroundColor: i <= step ? primary : border },
                i === step && styles.dotActive,
              ]}
            />
          ))}
        </View>
        {/* Step label */}
        <Text style={[styles.stepLabel, { color: muted }]}>
          Step {step + 1} of {TOTAL_STEPS}
        </Text>
      </View>

      {/* Animated content */}
      <Animated.View style={[styles.slideWrapper, { transform: [{ translateX: slideAnim }] }]}>
        {renderStep()}
      </Animated.View>

      {/* Footer */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 12, borderTopColor: border }]}>
        {step > 0 ? (
          <TouchableOpacity style={[styles.backBtn, { borderColor: border }]} onPress={handleBack} activeOpacity={0.7}>
            <Text style={[styles.backText, { color: muted }]}>← Back</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.backBtn} />
        )}

        <TouchableOpacity
          style={[styles.nextBtn, { backgroundColor: ready ? primary : border }, saving && { opacity: 0.7 }]}
          onPress={handleNext}
          disabled={!ready || saving}
          activeOpacity={0.85}
        >
          {saving
            ? <ActivityIndicator color="#FFF" />
            : <Text style={styles.nextText}>{isLast ? '🚀  Launch brand' : 'Continue →'}</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container:    { flex: 1 },
  header:       { paddingHorizontal: 24, paddingBottom: 8 },
  dots:         { flexDirection: 'row', gap: 8, marginBottom: 10 },
  dot:          { height: 6, width: 24, borderRadius: 3 },
  dotActive:    { width: 36 },
  stepLabel:    { fontSize: 13, fontFamily: 'Inter_500Medium' },

  slideWrapper: { flex: 1 },
  stepContent:  { padding: 24, paddingTop: 12, flexGrow: 1 },

  emoji:        { fontSize: 44, marginBottom: 16 },
  q:            { fontSize: 32, fontFamily: 'Inter_700Bold', lineHeight: 40, letterSpacing: -0.8, marginBottom: 8 },
  qSub:         { fontSize: 15, fontFamily: 'Inter_400Regular', lineHeight: 22, marginBottom: 28 },

  bigInput:     { borderRadius: 16, borderWidth: 1.5, paddingHorizontal: 18, paddingVertical: 16, fontSize: 22, fontFamily: 'Inter_600SemiBold', letterSpacing: -0.3 },

  // 2-column grid for category
  gridWrap:     { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  gridCard:     { width: (SCREEN_W - 48 - 12) / 2, borderRadius: 16, borderWidth: 1.5, padding: 16, alignItems: 'center', gap: 8 },
  gridEmoji:    { fontSize: 28 },
  gridLabel:    { fontSize: 14, fontFamily: 'Inter_600SemiBold', textAlign: 'center' },

  // List cards for stage/model
  listCard:     { borderRadius: 16, borderWidth: 1.5, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  listEmoji:    { fontSize: 24, width: 32 },
  listLabel:    { fontSize: 15, fontFamily: 'Inter_700Bold', marginBottom: 2 },
  listSub:      { fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 18 },
  radio:        { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioDot:     { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FFF' },

  // Footer
  footer:       { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 24, paddingTop: 16, borderTopWidth: StyleSheet.hairlineWidth },
  backBtn:      { flex: 1, paddingVertical: 14, borderRadius: 14, borderWidth: 1.5, alignItems: 'center' },
  backText:     { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  nextBtn:      { flex: 2, paddingVertical: 14, borderRadius: 14, alignItems: 'center' },
  nextText:     { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#FFF' },

  error:        { color: '#EF4444', fontSize: 13, fontFamily: 'Inter_400Regular', marginTop: 12 },
});
