import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useColors } from '@/hooks/useColors';
import { View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet,
  KeyboardAvoidingView, Platform, Alert, Switch } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import { BG, SURFACE, CARD, CARD_ELEVATED, BORDER, BORDER_ACTIVE,
  FG, MUTED, SUBTLE, PURPLE, PURPLE_LIGHT, PURPLE_DIM,
  CYAN, CYAN_DIM, SUCCESS, SUCCESS_DIM, BLUE, BLUE_DIM,
  ORANGE, ORANGE_DIM, RED, RED_DIM, GOLD,
  GRAD_PRIMARY, GRAD_CARD_GLOW, FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';
import { BrandthreadCard, GradientCard, PrimaryButton, SecondaryButton,
  IconButton, FilterChip, StatusBadge, SectionHeader,
  EmptyState, StatCard } from '@/components/BrandthreadUI';
import { saveDraftAnswers, loadDraftAnswers, clearDraftAnswers,
  generateStoreFromAnswers, applyGenerationResult } from '@/services/storeService';
import { StoreGenerationAnswers, StoreColorPalette,
  BRAND_STYLES, BRAND_MOODS, HOMEPAGE_PRIORITIES, TARGET_CUSTOMERS,
  STORE_FEATURES, STORE_CONTENT_OPTIONS, TYPOGRAPHY_STYLES,
  COLOR_PRESETS, TypographyStyle, BrandStyle, BrandMood,
  HomepagePriority, TargetCustomer, StoreFeature, StoreContent } from '@/services/storeTypes';

const TOTAL_STEPS = 10;

const DEFAULT_ANSWERS: Partial<StoreGenerationAnswers> = {
  primaryStyle: null,
  secondaryStyles: [],
  moods: [],
  colors: {
    primary: '#7c3aed',
    secondary: '#5b21b6',
    accent: '#a78bfa',
    background: '#0f0f1a',
    text: '#f4f4ff',
    buttonText: '#0f0f1a',
  },
  typography: 'modern',
  homepagePriority: null,
  additionalSections: [],
  brandStory: '',
  targetCustomers: [],
  ageRange: { min: 16, max: 45 },
  audienceDescription: '',
  existingContent: [],
  features: [],
  moodBoardUris: [],
};

const BUYER_EXPERIENCE_FEATURES: StoreFeature[] = [
  'product_reviews', 'size_guide', 'wishlist', 'quick_add',
  'sticky_add_to_cart', 'recently_viewed', 'pre_order_display', 'low_stock_notice',
];
const MARKETING_FEATURES: StoreFeature[] = [
  'announcement_bar', 'drop_countdown', 'email_signup', 'sms_signup',
  'social_feed', 'seller_posts', 'product_recommendations', 'faq', 'contact_form',
];

function isStepComplete(step: number, answers: Partial<StoreGenerationAnswers>): boolean {
  switch (step) {
    case 1: return !!answers.primaryStyle;
    case 2: return (answers.moods?.length ?? 0) > 0;
    case 3: return true;
    case 4: return !!answers.typography;
    case 5: return !!answers.homepagePriority;
    case 6: return true;
    case 7: return (answers.targetCustomers?.length ?? 0) > 0;
    case 8: return true;
    case 9: return true;
    case 10: return true;
    default: return false;
  }
}

function hexToRgb(hex: string) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const toLinear = (c: number) => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function contrastRatio(hex1: string, hex2: string): number {
  try {
    const l1 = hexToRgb(hex1);
    const l2 = hexToRgb(hex2);
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
  } catch { return 4.5; }
}

export default function StoreGenerateScreen() {
  const { primary: PURPLE, accent: PURPLE_DIM, accentForeground: PURPLE_LIGHT, info: CYAN } = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState(1);
  const [answers, setAnswers] = useState<Partial<StoreGenerationAnswers>>(DEFAULT_ANSWERS);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [showContinueDraft, setShowContinueDraft] = useState(false);
  const [draftData, setDraftData] = useState<Partial<StoreGenerationAnswers> | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [colorPresetIdx, setColorPresetIdx] = useState(0);

  useEffect(() => {
    (async () => {
      const draft = await loadDraftAnswers();
      if (draft && draft.primaryStyle) {
        setDraftData(draft);
        setShowContinueDraft(true);
      }
      setDraftLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (!draftLoaded) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaving(false);
    setSaveFailed(false);
    saveTimer.current = setTimeout(async () => {
      setSaving(true);
      try {
        await saveDraftAnswers(answers);
        setSaving(false);
      } catch {
        setSaving(false);
        setSaveFailed(true);
      }
    }, 800);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [answers, draftLoaded]);

  const updateAnswers = (patch: Partial<StoreGenerationAnswers>) => {
    setAnswers(prev => ({ ...prev, ...patch }));
  };

  const handleBack = async () => {
    if (step > 1) {
      setStep(s => s - 1);
    } else {
      await saveDraftAnswers(answers);
      router.back();
    }
  };

  const handleSaveAndExit = async () => {
    await saveDraftAnswers(answers);
    router.back();
  };

  const handleContinue = () => {
    if (step < TOTAL_STEPS) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setStep(s => s + 1);
    }
  };

  const handleGenerate = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await saveDraftAnswers(answers);
    router.push('/store-generating' as never);
  };

  const continueEnabled = isStepComplete(step, answers);

  // ── STEP RENDERERS ───────────────────────────────────────────────────────

  const renderStep1 = () => (
    <View style={st.stepContainer}>
      <Text style={st.stepHeading}>What kind of brand are you building?</Text>
      <Text style={st.stepSubheading}>Choose one primary style. You can also add up to 2 secondary influences.</Text>

      <Text style={st.sectionLabel}>Primary Style</Text>
      <View style={st.chipGrid}>
        {BRAND_STYLES.map(({ value, label }) => {
          const isPrimary = answers.primaryStyle === value;
          return (
            <TouchableOpacity
              key={value}
              onPress={() => {
                Haptics.selectionAsync();
                const newSecondary = (answers.secondaryStyles ?? []).filter(s => s !== value);
                updateAnswers({ primaryStyle: value, secondaryStyles: newSecondary });
              }}
              activeOpacity={0.8}
              style={st.chipWrapper}
            >
              {isPrimary ? (
                <LinearGradient colors={[...GRAD_PRIMARY]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={st.chipGrad}>
                  <Text style={st.chipTextActive}>{label}</Text>
                </LinearGradient>
              ) : (
                <View style={st.chip}>
                  <Text style={st.chipText}>{label}</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {answers.primaryStyle && (
        <>
          <Text style={[st.sectionLabel, { marginTop: SP.md }]}>Add secondary styles (optional):</Text>
          <View style={st.chipGrid}>
            {BRAND_STYLES.filter(b => b.value !== answers.primaryStyle).map(({ value, label }) => {
              const isSelected = (answers.secondaryStyles ?? []).includes(value);
              return (
                <TouchableOpacity
                  key={value}
                  onPress={() => {
                    Haptics.selectionAsync();
                    const current = answers.secondaryStyles ?? [];
                    if (isSelected) {
                      updateAnswers({ secondaryStyles: current.filter(s => s !== value) });
                    } else if (current.length < 2) {
                      updateAnswers({ secondaryStyles: [...current, value] });
                    }
                  }}
                  activeOpacity={0.8}
                  style={st.chipWrapper}
                >
                  <View style={[st.chip, isSelected && st.chipSecondarySelected]}>
                    <Text style={[st.chipText, isSelected && st.chipTextSecondary]}>{label}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </>
      )}
    </View>
  );

  const renderStep2 = () => (
    <View style={st.stepContainer}>
      <Text style={st.stepHeading}>What should customers feel?</Text>
      <Text style={st.stepSubheading}>Select all that apply.</Text>
      <View style={st.chipGrid}>
        {BRAND_MOODS.map(({ value, label }) => {
          const isSelected = (answers.moods ?? []).includes(value);
          return (
            <TouchableOpacity
              key={value}
              onPress={() => {
                Haptics.selectionAsync();
                const current = answers.moods ?? [];
                updateAnswers({
                  moods: isSelected ? current.filter(m => m !== value) : [...current, value],
                });
              }}
              activeOpacity={0.8}
              style={st.chipWrapper}
            >
              {isSelected ? (
                <LinearGradient colors={[...GRAD_PRIMARY]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={st.chipGrad}>
                  <Text style={st.chipTextActive}>{label}</Text>
                </LinearGradient>
              ) : (
                <View style={st.chip}>
                  <Text style={st.chipText}>{label}</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );

  const renderStep3 = () => {
    const colors = answers.colors ?? DEFAULT_ANSWERS.colors!;
    const ratio = contrastRatio(colors.text, colors.background);
    const goodContrast = ratio >= 4.5;
    const presets = COLOR_PRESETS;
    return (
      <View style={st.stepContainer}>
        <Text style={st.stepHeading}>Set your brand colors.</Text>

        <Text style={st.sectionLabel}>Start with a preset</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={st.presetsScroll}>
          {presets.map((preset, idx) => {
            const isSelected = JSON.stringify(answers.colors) === JSON.stringify(preset.colors);
            return (
              <TouchableOpacity
                key={preset.label}
                onPress={() => {
                  Haptics.selectionAsync();
                  setColorPresetIdx(idx);
                  updateAnswers({ colors: preset.colors });
                }}
                style={[st.presetChip, isSelected && st.presetChipSelected]}
                activeOpacity={0.8}
              >
                <View style={st.presetSwatches}>
                  {[preset.colors.primary, preset.colors.secondary, preset.colors.accent].map((c, i) => (
                    <View key={i} style={[st.presetSwatch, { backgroundColor: c }]} />
                  ))}
                </View>
                <Text style={[st.presetLabel, isSelected && st.presetLabelSelected]}>{preset.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <Text style={[st.sectionLabel, { marginTop: SP.md }]}>Current Colors</Text>
        <View style={st.colorTilesRow}>
          {(
            [
              { key: 'primary', label: 'Primary' },
              { key: 'secondary', label: 'Secondary' },
              { key: 'accent', label: 'Accent' },
            ] as { key: keyof StoreColorPalette; label: string }[]
          ).map(({ key, label }) => (
            <TouchableOpacity
              key={key}
              style={st.colorTile}
              onPress={() => {
                Alert.prompt(
                  `Set ${label} Color`,
                  'Enter hex value (e.g. #FF0000)',
                  (val) => {
                    if (val && /^#[0-9A-Fa-f]{6}$/.test(val)) {
                      updateAnswers({ colors: { ...colors, [key]: val } });
                    }
                  },
                  'plain-text',
                  colors[key],
                );
              }}
              activeOpacity={0.8}
            >
              <View style={[st.colorSwatch, { backgroundColor: colors[key] }]} />
              <Text style={st.colorTileLabel}>{label}</Text>
              <Text style={st.colorTileHex}>{colors[key]}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={[st.contrastRow, { backgroundColor: goodContrast ? SUCCESS_DIM : RED_DIM }]}>
          <Feather name={goodContrast ? 'check-circle' : 'alert-triangle'} size={ICON.sm} color={goodContrast ? SUCCESS : RED} />
          <Text style={[st.contrastText, { color: goodContrast ? SUCCESS : RED }]}>
            {goodContrast ? 'Good contrast ratio.' : 'Text may be hard to read on this background.'}
          </Text>
        </View>

        <View style={st.colorActionsRow}>
          <TouchableOpacity
            style={st.colorActionBtn}
            onPress={() => {
              const nextIdx = (colorPresetIdx + 1) % COLOR_PRESETS.length;
              setColorPresetIdx(nextIdx);
              updateAnswers({ colors: COLOR_PRESETS[nextIdx].colors });
            }}
            activeOpacity={0.8}
          >
            <Feather name="refresh-cw" size={ICON.sm} color={PURPLE_LIGHT} />
            <Text style={st.colorActionText}>Generate Palette</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={st.colorActionBtn}
            onPress={() => router.push('/store-from-logo' as never)}
            activeOpacity={0.8}
          >
            <Feather name="image" size={ICON.sm} color={CYAN} />
            <Text style={st.colorActionText}>From Logo</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderStep4 = () => (
    <View style={st.stepContainer}>
      <Text style={st.stepHeading}>What matches your brand?</Text>
      {TYPOGRAPHY_STYLES.map(({ value, label, heading, body, sample }) => {
        const isSelected = answers.typography === value;
        return (
          <BrandthreadCard
            key={value}
            style={[st.typoCard, isSelected && st.typoCardSelected]}
            onPress={() => {
              Haptics.selectionAsync();
              updateAnswers({ typography: value });
            }}
          >
            <View style={st.typoCardMain}>
              <View style={st.typoCardLeft}>
                <Text style={st.typoCardLabel}>{label}</Text>
                <Text style={st.typoCardFonts}>
                  Heading: {heading} / Body: {body}
                </Text>
              </View>
              {isSelected && <Feather name="check-circle" size={ICON.sm} color={PURPLE_LIGHT} />}
            </View>
            <Text style={[st.typoSample, {
              fontStyle: value === 'editorial' || value === 'luxury' ? 'italic' : 'normal',
              letterSpacing: value === 'technical' || value === 'minimal' ? 1.5 : 0,
              fontWeight: value === 'bold' ? '800' : '400',
              textTransform: value === 'bold' ? 'uppercase' : 'none',
            }]}>{sample}</Text>
          </BrandthreadCard>
        );
      })}
    </View>
  );

  const renderStep5 = () => (
    <View style={st.stepContainer}>
      <Text style={st.stepHeading}>What should customers see first?</Text>
      <Text style={st.stepSubheading}>Choose one main section for the top of your homepage.</Text>

      <View style={st.priorityGrid}>
        {HOMEPAGE_PRIORITIES.map(({ value, label, icon }) => {
          const isSelected = answers.homepagePriority === value;
          return (
            <TouchableOpacity
              key={value}
              onPress={() => {
                Haptics.selectionAsync();
                const addl = (answers.additionalSections ?? []).filter(s => s !== value);
                updateAnswers({ homepagePriority: value, additionalSections: addl });
              }}
              activeOpacity={0.8}
              style={st.priorityCardWrapper}
            >
              {isSelected ? (
                <LinearGradient colors={[...GRAD_PRIMARY]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={st.priorityCardGrad}>
                  <Feather name={icon as any} size={ICON.md} color="#FFFFFF" />
                  <Text style={st.priorityCardTextActive}>{label}</Text>
                </LinearGradient>
              ) : (
                <View style={st.priorityCard}>
                  <Feather name={icon as any} size={ICON.md} color={MUTED} />
                  <Text style={st.priorityCardText}>{label}</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {answers.homepagePriority && (
        <>
          <Text style={[st.sectionLabel, { marginTop: SP.md }]}>Additional sections (optional):</Text>
          <View style={st.chipGrid}>
            {HOMEPAGE_PRIORITIES.filter(p => p.value !== answers.homepagePriority).map(({ value, label }) => {
              const isSelected = (answers.additionalSections ?? []).includes(value);
              return (
                <TouchableOpacity
                  key={value}
                  onPress={() => {
                    Haptics.selectionAsync();
                    const current = answers.additionalSections ?? [];
                    updateAnswers({
                      additionalSections: isSelected
                        ? current.filter(s => s !== value)
                        : [...current, value],
                    });
                  }}
                  activeOpacity={0.8}
                  style={st.chipWrapper}
                >
                  <View style={[st.chip, isSelected && st.chipSecondarySelected]}>
                    <Text style={[st.chipText, isSelected && st.chipTextSecondary]}>{label}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </>
      )}
    </View>
  );

  const renderStep6 = () => (
    <View style={st.stepContainer}>
      <Text style={st.stepHeading}>What makes your brand different?</Text>

      <TextInput
        style={st.storyInput}
        value={answers.brandStory ?? ''}
        onChangeText={v => updateAnswers({ brandStory: v })}
        placeholder="Write your brand story here, or let AI draft one for you..."
        placeholderTextColor={SUBTLE}
        multiline
        numberOfLines={6}
        textAlignVertical="top"
      />

      <Text style={st.sectionLabel}>AI Tools</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={st.aiToolsScroll}>
        {['Write with AI', 'Improve Writing', 'Shorten', 'Make Bold', 'More Premium', 'More Emotional'].map(tool => (
          <TouchableOpacity
            key={tool}
            style={st.aiToolChip}
            onPress={async () => {
              if (!answers.brandStory?.trim()) { Alert.alert('Add your brand story first', 'Write some text below, then use AI to refine it.'); return; }
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              try {
                const res = await fetch('/api/ai/chat', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ messages: [
                    { role: 'system', content: 'You are a brand copywriter. Apply the requested transformation and return ONLY the rewritten brand story text.' },
                    { role: 'user', content: `${tool} this brand story:\n\n${answers.brandStory}` },
                  ] }),
                });
                const data = await res.json();
                const result = data?.message?.content ?? data?.content;
                if (result) setAnswers(prev => ({ ...prev, brandStory: result }));
              } catch { Alert.alert('Error', 'AI processing failed. Please try again.'); }
            }}
            activeOpacity={0.8}
          >
            <Text style={st.aiToolChipText}>{tool}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      <Text style={st.aiNote}>AI suggestions will be shown below your text for review before applying.</Text>
    </View>
  );

  const renderStep7 = () => (
    <View style={st.stepContainer}>
      <Text style={st.stepHeading}>Who are you designing for?</Text>

      <View style={st.chipGrid}>
        {TARGET_CUSTOMERS.map(({ value, label }) => {
          const isSelected = (answers.targetCustomers ?? []).includes(value);
          return (
            <TouchableOpacity
              key={value}
              onPress={() => {
                Haptics.selectionAsync();
                const current = answers.targetCustomers ?? [];
                updateAnswers({
                  targetCustomers: isSelected
                    ? current.filter(c => c !== value)
                    : [...current, value],
                });
              }}
              activeOpacity={0.8}
              style={st.chipWrapper}
            >
              {isSelected ? (
                <LinearGradient colors={[...GRAD_PRIMARY]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={st.chipGrad}>
                  <Text style={st.chipTextActive}>{label}</Text>
                </LinearGradient>
              ) : (
                <View style={st.chip}>
                  <Text style={st.chipText}>{label}</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={[st.sectionLabel, { marginTop: SP.md }]}>Age Range (optional)</Text>
      <View style={st.ageRow}>
        <View style={st.ageInputWrap}>
          <Text style={st.ageInputLabel}>Min age</Text>
          <TextInput
            style={st.ageInput}
            value={String(answers.ageRange?.min ?? 16)}
            onChangeText={v => updateAnswers({ ageRange: { min: parseInt(v) || 16, max: answers.ageRange?.max ?? 45 } })}
            keyboardType="numeric"
            placeholderTextColor={SUBTLE}
          />
        </View>
        <Text style={st.ageSep}>—</Text>
        <View style={st.ageInputWrap}>
          <Text style={st.ageInputLabel}>Max age</Text>
          <TextInput
            style={st.ageInput}
            value={String(answers.ageRange?.max ?? 45)}
            onChangeText={v => updateAnswers({ ageRange: { min: answers.ageRange?.min ?? 16, max: parseInt(v) || 45 } })}
            keyboardType="numeric"
            placeholderTextColor={SUBTLE}
          />
        </View>
      </View>

      <Text style={[st.sectionLabel, { marginTop: SP.md }]}>Describe your ideal customer (optional)</Text>
      <TextInput
        style={st.descInput}
        value={answers.audienceDescription ?? ''}
        onChangeText={v => updateAnswers({ audienceDescription: v })}
        placeholder="E.g. Young professionals who value quality over quantity..."
        placeholderTextColor={SUBTLE}
        multiline
        numberOfLines={3}
        textAlignVertical="top"
      />
    </View>
  );

  const renderStep8 = () => {
    const existingContent = answers.existingContent ?? [];
    return (
      <View style={st.stepContainer}>
        <Text style={st.stepHeading}>What content do you already have?</Text>
        <Text style={st.stepSubheading}>We'll feature what you have. You can always add more later.</Text>

        <View style={st.contentGrid}>
          {STORE_CONTENT_OPTIONS.map(({ value, label, icon }) => {
            const isSelected = existingContent.includes(value);
            return (
              <TouchableOpacity
                key={value}
                onPress={() => {
                  Haptics.selectionAsync();
                  if (value === 'none') {
                    updateAnswers({ existingContent: isSelected ? [] : ['none'] });
                  } else {
                    const filtered = existingContent.filter(c => c !== 'none');
                    updateAnswers({
                      existingContent: isSelected
                        ? filtered.filter(c => c !== value)
                        : [...filtered, value],
                    });
                  }
                }}
                activeOpacity={0.8}
                style={[st.contentCard, isSelected && st.contentCardSelected]}
              >
                <Feather name={icon as any} size={ICON.md} color={isSelected ? PURPLE_LIGHT : MUTED} />
                <Text style={[st.contentCardLabel, isSelected && st.contentCardLabelSelected]}>{label}</Text>
                {(value === 'logo' || value === 'product_photos' || value === 'campaign_images') && isSelected && (
                  <TouchableOpacity
                    style={st.uploadBtn}
                    onPress={async () => {
                      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
                      if (!perm.granted) { Alert.alert('Permission required', 'Allow access to your photo library.'); return; }
                      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
                      if (!result.canceled && result.assets[0]) {
                        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                      }
                    }}
                    activeOpacity={0.8}
                  >
                    <Text style={st.uploadBtnText}>Upload</Text>
                  </TouchableOpacity>
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={st.contentNote}>
          <Feather name="info" size={ICON.xs} color={CYAN} />
          <Text style={st.contentNoteText}>Your existing Seller posts will be connected automatically.</Text>
        </View>
      </View>
    );
  };

  const renderStep9 = () => {
    const features = answers.features ?? [];
    const renderFeatureGroup = (groupLabel: string, groupFeatures: StoreFeature[]) => (
      <View style={st.featureGroup}>
        <Text style={st.featureGroupLabel}>{groupLabel}</Text>
        {STORE_FEATURES.filter(f => groupFeatures.includes(f.value)).map(({ value, label, icon }) => {
          const isOn = features.includes(value);
          return (
            <View key={value} style={st.featureRow}>
              <View style={st.featureIconWrap}>
                <Feather name={icon as any} size={ICON.sm} color={isOn ? PURPLE_LIGHT : MUTED} />
              </View>
              <View style={st.featureTextWrap}>
                <Text style={[st.featureLabel, isOn && st.featureLabelOn]}>{label}</Text>
              </View>
              <Switch
                value={isOn}
                onValueChange={(val) => {
                  Haptics.selectionAsync();
                  updateAnswers({
                    features: val
                      ? [...features, value]
                      : features.filter(f => f !== value),
                  });
                }}
                trackColor={{ false: BORDER, true: PURPLE }}
                thumbColor={isOn ? PURPLE_LIGHT : MUTED}
              />
            </View>
          );
        })}
      </View>
    );

    return (
      <View style={st.stepContainer}>
        <Text style={st.stepHeading}>What features do you want?</Text>
        <Text style={st.stepSubheading}>Choose the tools you want active on your storefront.</Text>
        {renderFeatureGroup('Buyer Experience', BUYER_EXPERIENCE_FEATURES)}
        {renderFeatureGroup('Marketing & Growth', MARKETING_FEATURES)}
      </View>
    );
  };

  const renderStep10 = () => {
    const colors = answers.colors ?? DEFAULT_ANSWERS.colors!;
    const typoEntry = TYPOGRAPHY_STYLES.find(t => t.value === answers.typography);
    return (
      <View style={st.stepContainer}>
        <Text style={st.stepHeading}>Review your selections</Text>
        <Text style={st.stepSubheading}>Everything looks right? Generate your storefront.</Text>

        {[
          {
            label: 'Brand Style',
            content: [answers.primaryStyle, ...(answers.secondaryStyles ?? [])].filter(Boolean).join(', ') || 'Not set',
            step: 1,
          },
          {
            label: 'Mood',
            content: (answers.moods ?? []).join(', ') || 'Not set',
            step: 2,
          },
          {
            label: 'Typography',
            content: typoEntry ? `${typoEntry.label} — ${typoEntry.heading}` : 'Not set',
            step: 4,
          },
          {
            label: 'Homepage Priority',
            content: answers.homepagePriority
              ? HOMEPAGE_PRIORITIES.find(h => h.value === answers.homepagePriority)?.label ?? answers.homepagePriority
              : 'Not set',
            step: 5,
          },
          {
            label: 'Target Customers',
            content: (answers.targetCustomers ?? []).length > 0
              ? (answers.targetCustomers ?? []).join(', ')
              : 'Not set',
            step: 7,
          },
          {
            label: 'Features',
            content: `${(answers.features ?? []).length} feature(s) selected`,
            step: 9,
          },
        ].map(({ label, content, step: reviewStep }) => (
          <BrandthreadCard key={label} style={st.reviewCard}>
            <View style={st.reviewCardRow}>
              <View style={st.reviewCardText}>
                <Text style={st.reviewCardLabel}>{label}</Text>
                <Text style={st.reviewCardContent}>{content}</Text>
              </View>
              <TouchableOpacity
                onPress={() => setStep(reviewStep)}
                style={st.reviewEditBtn}
                activeOpacity={0.8}
              >
                <Text style={st.reviewEditText}>Edit</Text>
              </TouchableOpacity>
            </View>
          </BrandthreadCard>
        ))}

        {/* Colors review */}
        <BrandthreadCard style={st.reviewCard}>
          <View style={st.reviewCardRow}>
            <View style={st.reviewCardText}>
              <Text style={st.reviewCardLabel}>Colors</Text>
              <View style={st.reviewSwatches}>
                {[colors.primary, colors.secondary, colors.accent].map((c, i) => (
                  <View key={i} style={[st.reviewSwatch, { backgroundColor: c }]} />
                ))}
              </View>
            </View>
            <TouchableOpacity onPress={() => setStep(3)} style={st.reviewEditBtn} activeOpacity={0.8}>
              <Text style={st.reviewEditText}>Edit</Text>
            </TouchableOpacity>
          </View>
        </BrandthreadCard>

        <PrimaryButton
          label="Generate My Store →"
          onPress={handleGenerate}
          style={st.generateBtn}
        />
      </View>
    );
  };

  const renderCurrentStep = () => {
    switch (step) {
      case 1: return renderStep1();
      case 2: return renderStep2();
      case 3: return renderStep3();
      case 4: return renderStep4();
      case 5: return renderStep5();
      case 6: return renderStep6();
      case 7: return renderStep7();
      case 8: return renderStep8();
      case 9: return renderStep9();
      case 10: return renderStep10();
      default: return null;
    }
  };

  const progressWidth = `${(step / TOTAL_STEPS) * 100}%`;

  return (
    <View style={[st.root, { backgroundColor: BG }]}>
      {/* Header */}
      <View style={[st.header, { paddingTop: insets.top + SP.sm }]}>
        <View style={st.headerTop}>
          <TouchableOpacity onPress={handleBack} style={st.backBtn} activeOpacity={0.7}>
            <Feather name="arrow-left" size={ICON.md} color={FG} />
          </TouchableOpacity>
          <View style={st.headerCenter}>
            <Text style={st.stepIndicator}>Step {step} of {TOTAL_STEPS}</Text>
            <Text style={st.headerTitle}>Generate My Store</Text>
          </View>
          <TouchableOpacity onPress={handleSaveAndExit} style={st.saveExitBtn} activeOpacity={0.7}>
            <Text style={st.saveExitText}>
              {saving ? 'Saving…' : saveFailed ? 'Retry' : 'Save & Exit'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Progress bar */}
        <View style={st.progressTrack}>
          <LinearGradient
            colors={[...GRAD_PRIMARY]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[st.progressFill, { width: progressWidth as any }]}
          />
        </View>
      </View>

      {/* Draft prompt */}
      {showContinueDraft && (
        <View style={st.draftPrompt}>
          <Text style={st.draftPromptText}>Continue where you left off?</Text>
          <View style={st.draftPromptActions}>
            <TouchableOpacity
              onPress={() => {
                if (draftData) setAnswers(draftData);
                setShowContinueDraft(false);
              }}
              style={st.draftYesBtn}
              activeOpacity={0.8}
            >
              <Text style={st.draftYesText}>Yes, continue</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={async () => {
                await clearDraftAnswers();
                setAnswers(DEFAULT_ANSWERS);
                setShowContinueDraft(false);
              }}
              style={st.draftNoBtn}
              activeOpacity={0.8}
            >
              <Text style={st.draftNoText}>Start fresh</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Step content */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 120 }}
          keyboardShouldPersistTaps="handled"
        >
          {renderCurrentStep()}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Bottom nav */}
      <View style={[st.bottomNav, { paddingBottom: insets.bottom + SP.sm }]}>
        <TouchableOpacity
          onPress={handleBack}
          style={st.navBackBtn}
          activeOpacity={0.7}
        >
          <Feather name="arrow-left" size={ICON.sm} color={FG} />
          <Text style={st.navBackText}>Back</Text>
        </TouchableOpacity>

        <Text style={st.navStepText}>Step {step} of {TOTAL_STEPS}</Text>

        {step < TOTAL_STEPS ? (
          <TouchableOpacity
            onPress={continueEnabled ? handleContinue : undefined}
            style={[st.navContinueBtn, !continueEnabled && st.navContinueBtnDisabled]}
            activeOpacity={continueEnabled ? 0.8 : 1}
          >
            <LinearGradient
              colors={continueEnabled ? [...GRAD_PRIMARY] : ['#3A3A4E', '#3A3A4E']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={st.navContinueGrad}
            >
              <Text style={st.navContinueText}>Continue</Text>
              <Feather name="arrow-right" size={ICON.sm} color="#FFFFFF" />
            </LinearGradient>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            onPress={handleGenerate}
            style={st.navContinueBtn}
            activeOpacity={0.8}
          >
            <LinearGradient
              colors={[...GRAD_PRIMARY]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={st.navContinueGrad}
            >
              <Text style={st.navContinueText}>Generate →</Text>
            </LinearGradient>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1 },
  header: {
    paddingHorizontal: SP.md,
    paddingBottom: SP.sm,
    backgroundColor: SURFACE,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SP.sm,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: RADIUS.sm,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: { alignItems: 'center', flex: 1 },
  stepIndicator: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
  headerTitle: { fontSize: FS.base, fontFamily: FONT.bold, color: FG },
  saveExitBtn: { paddingHorizontal: SP.sm, paddingVertical: SP.xs },
  saveExitText: { fontSize: FS.sm, fontFamily: FONT.medium, color: PURPLE_LIGHT },
  progressTrack: {
    height: 3,
    backgroundColor: BORDER,
    borderRadius: RADIUS.pill,
    overflow: 'hidden',
  },
  progressFill: { height: 3, borderRadius: RADIUS.pill },
  // Draft prompt
  draftPrompt: {
    backgroundColor: PURPLE_DIM,
    borderBottomWidth: 1,
    borderBottomColor: BORDER_ACTIVE,
    padding: SP.md,
  },
  draftPromptText: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG, marginBottom: SP.sm },
  draftPromptActions: { flexDirection: 'row', gap: SP.sm },
  draftYesBtn: {
    backgroundColor: PURPLE,
    borderRadius: RADIUS.md,
    paddingHorizontal: SP.md,
    paddingVertical: SP.xs,
  },
  draftYesText: { fontSize: FS.sm, fontFamily: FONT.bold, color: '#FFFFFF' },
  draftNoBtn: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: RADIUS.md,
    paddingHorizontal: SP.md,
    paddingVertical: SP.xs,
  },
  draftNoText: { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED },
  // Step container
  stepContainer: { padding: SP.md, gap: SP.md },
  stepHeading: {
    fontSize: FS.xl,
    fontFamily: FONT.bold,
    color: FG,
    letterSpacing: -0.3,
  },
  stepSubheading: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, lineHeight: 20 },
  sectionLabel: { fontSize: FS.sm, fontFamily: FONT.semibold, color: MUTED, letterSpacing: 0.2 },
  // Chip grid
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm },
  chipWrapper: {},
  chip: {
    paddingHorizontal: SP.md,
    paddingVertical: SP.xs + 2,
    borderRadius: RADIUS.pill,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
  },
  chipGrad: {
    paddingHorizontal: SP.md,
    paddingVertical: SP.xs + 2,
    borderRadius: RADIUS.pill,
  },
  chipText: { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED },
  chipTextActive: { fontSize: FS.sm, fontFamily: FONT.bold, color: '#FFFFFF' },
  chipSecondarySelected: { borderColor: BORDER_ACTIVE, backgroundColor: PURPLE_DIM },
  chipTextSecondary: { color: PURPLE_LIGHT, fontFamily: FONT.semibold },
  // Color presets
  presetsScroll: { flexGrow: 0 },
  presetChip: {
    alignItems: 'center',
    gap: SP.xs,
    padding: SP.sm,
    borderRadius: RADIUS.md,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    marginRight: SP.sm,
    minWidth: 72,
  },
  presetChipSelected: { borderColor: PURPLE, backgroundColor: PURPLE_DIM },
  presetSwatches: { flexDirection: 'row', gap: 3 },
  presetSwatch: { width: 16, height: 16, borderRadius: 4 },
  presetLabel: { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED },
  presetLabelSelected: { color: PURPLE_LIGHT },
  // Color tiles
  colorTilesRow: { flexDirection: 'row', gap: SP.sm },
  colorTile: {
    flex: 1,
    backgroundColor: CARD,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: BORDER,
    padding: SP.sm,
    alignItems: 'center',
    gap: SP.xs,
  },
  colorSwatch: { width: 40, height: 40, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: BORDER },
  colorTileLabel: { fontSize: FS.xs, fontFamily: FONT.semibold, color: MUTED },
  colorTileHex: { fontSize: 9, fontFamily: FONT.regular, color: SUBTLE },
  // Contrast
  contrastRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    padding: SP.sm,
    borderRadius: RADIUS.sm,
  },
  contrastText: { fontSize: FS.sm, fontFamily: FONT.medium },
  // Color actions
  colorActionsRow: { flexDirection: 'row', gap: SP.sm },
  colorActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SP.xs,
    backgroundColor: CARD,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: BORDER,
    paddingVertical: SP.sm,
  },
  colorActionText: { fontSize: FS.sm, fontFamily: FONT.medium, color: FG },
  // Typography
  typoCard: { gap: SP.sm },
  typoCardSelected: { borderColor: BORDER_ACTIVE, backgroundColor: PURPLE_DIM },
  typoCardMain: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  typoCardLeft: { gap: 2 },
  typoCardLabel: { fontSize: FS.base, fontFamily: FONT.bold, color: FG },
  typoCardFonts: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
  typoSample: { fontSize: FS.sm, color: SUBTLE, lineHeight: 20 },
  // Homepage priority
  priorityGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm },
  priorityCardWrapper: { width: '48%' },
  priorityCard: {
    padding: SP.md,
    borderRadius: RADIUS.md,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    gap: SP.xs,
    alignItems: 'center',
  },
  priorityCardGrad: {
    padding: SP.md,
    borderRadius: RADIUS.md,
    gap: SP.xs,
    alignItems: 'center',
  },
  priorityCardText: { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED, textAlign: 'center' },
  priorityCardTextActive: { fontSize: FS.xs, fontFamily: FONT.bold, color: '#FFFFFF', textAlign: 'center' },
  // Brand story
  storyInput: {
    backgroundColor: CARD,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: BORDER,
    padding: SP.md,
    fontSize: FS.base,
    fontFamily: FONT.regular,
    color: FG,
    minHeight: 120,
    textAlignVertical: 'top',
  },
  aiToolsScroll: { flexGrow: 0 },
  aiToolChip: {
    paddingHorizontal: SP.md,
    paddingVertical: SP.xs,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: BORDER_ACTIVE,
    backgroundColor: PURPLE_DIM,
    marginRight: SP.sm,
  },
  aiToolChipText: { fontSize: FS.xs, fontFamily: FONT.semibold, color: PURPLE_LIGHT },
  aiNote: { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE, lineHeight: 16 },
  // Target customers age
  ageRow: { flexDirection: 'row', alignItems: 'center', gap: SP.md },
  ageInputWrap: { flex: 1, gap: SP.xs },
  ageInputLabel: { fontSize: FS.xs, fontFamily: FONT.semibold, color: MUTED },
  ageInput: {
    backgroundColor: CARD,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: BORDER,
    padding: SP.sm,
    fontSize: FS.base,
    fontFamily: FONT.regular,
    color: FG,
    textAlign: 'center',
  },
  ageSep: { fontSize: FS.lg, color: MUTED, fontFamily: FONT.regular, marginTop: SP.md },
  descInput: {
    backgroundColor: CARD,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: BORDER,
    padding: SP.md,
    fontSize: FS.base,
    fontFamily: FONT.regular,
    color: FG,
    minHeight: 72,
    textAlignVertical: 'top',
  },
  // Content grid
  contentGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm },
  contentCard: {
    width: '47%',
    backgroundColor: CARD,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: BORDER,
    padding: SP.md,
    gap: SP.xs,
    alignItems: 'center',
  },
  contentCardSelected: { borderColor: BORDER_ACTIVE, backgroundColor: PURPLE_DIM },
  contentCardLabel: { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED, textAlign: 'center' },
  contentCardLabelSelected: { color: PURPLE_LIGHT },
  uploadBtn: {
    marginTop: SP.xs,
    backgroundColor: PURPLE_DIM,
    borderRadius: RADIUS.pill,
    paddingHorizontal: SP.sm,
    paddingVertical: 2,
  },
  uploadBtnText: { fontSize: FS.xs, fontFamily: FONT.semibold, color: PURPLE_LIGHT },
  contentNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.xs,
    backgroundColor: CYAN_DIM,
    borderRadius: RADIUS.sm,
    padding: SP.sm,
  },
  contentNoteText: { fontSize: FS.xs, fontFamily: FONT.regular, color: FG, flex: 1 },
  // Features
  featureGroup: { gap: SP.sm },
  featureGroupLabel: { fontSize: FS.sm, fontFamily: FONT.bold, color: PURPLE_LIGHT, letterSpacing: 0.3 },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CARD,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: BORDER,
    padding: SP.sm,
    gap: SP.sm,
  },
  featureIconWrap: { width: 32, height: 32, borderRadius: RADIUS.sm, backgroundColor: PURPLE_DIM, alignItems: 'center', justifyContent: 'center' },
  featureTextWrap: { flex: 1 },
  featureLabel: { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED },
  featureLabelOn: { color: FG, fontFamily: FONT.semibold },
  // Review
  reviewCard: { gap: SP.xs },
  reviewCardRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  reviewCardText: { flex: 1, gap: 2 },
  reviewCardLabel: { fontSize: FS.xs, fontFamily: FONT.semibold, color: MUTED },
  reviewCardContent: { fontSize: FS.sm, fontFamily: FONT.medium, color: FG },
  reviewEditBtn: { paddingHorizontal: SP.sm, paddingVertical: SP.xs },
  reviewEditText: { fontSize: FS.sm, fontFamily: FONT.medium, color: PURPLE_LIGHT },
  reviewSwatches: { flexDirection: 'row', gap: SP.xs, marginTop: SP.xs },
  reviewSwatch: { width: 20, height: 20, borderRadius: 4 },
  generateBtn: { marginTop: SP.sm },
  // Bottom nav
  bottomNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SP.md,
    paddingTop: SP.md,
    backgroundColor: SURFACE,
    borderTopWidth: 1,
    borderTopColor: BORDER,
  },
  navBackBtn: { flexDirection: 'row', alignItems: 'center', gap: SP.xs, padding: SP.xs },
  navBackText: { fontSize: FS.sm, fontFamily: FONT.medium, color: FG },
  navStepText: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
  navContinueBtn: { borderRadius: RADIUS.md, overflow: 'hidden' },
  navContinueBtnDisabled: { opacity: 0.5 },
  navContinueGrad: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.xs,
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
  },
  navContinueText: { fontSize: FS.sm, fontFamily: FONT.bold, color: '#FFFFFF' },
});
