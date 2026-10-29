import * as Haptics from 'expo-haptics';
/**
 * Shopping preferences — sizes, fit, categories, alerts, and activity toggles.
 * Every control saves as soon as it changes. Signed in, sizes and style
 * categories read/write the account's buyer_preferences (the same source and
 * option set as My sizes — BUYER_SIZE_OPTIONS); signed out / dev preview they
 * fall back to local settings.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { goBackOr } from '@/lib/navigation/goBackOr';

import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';

import { Icon } from '@/components/ui/Icon';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useRouter, useFocusEffect } from 'expo-router';


import { LinearGradient } from 'expo-linear-gradient';

import { haptics, haptic } from '@/lib/haptics';


import { BG, CARD, BORDER, FG, MUTED, FONT, FS, SP, RADIUS, GRAD_PRIMARY } from '@/lib/theme';

import { useColors } from '@/hooks/useColors';

import { getOnAccentTextStyle, useAppTheme } from '@/contexts/AppThemeContext';

import { HapticSwitch } from '@/components/BrandthreadUI';

import { ScreenHeader } from '@/components/ScreenHeader';

import { useSellerTabBarInset } from '@/hooks/useSellerTabBarInset';

import { minHitSlop } from '@/lib/hitSlop';

import { BUYER_SIZE_OPTIONS, loadBuyerSettings, patchBuyerSettings, type BuyerSettingsState } from '@/lib/buyerSettings';

import { useBuyerPreferences } from '@/hooks/useBuyerPreferences';

import { mergeStyleInterests, selectedCategoriesFromInterests, type ShoppingSizeField } from '@/lib/shoppingPreferences';

import { updateBuyerSettings } from '@/lib/buyerSettingsSync';
import { showAlert } from '@/lib/actionSheet';
import { friendlyError } from '@/lib/friendlyError';
import { useApi } from '@/lib/api';
import { radius } from '@/constants/radii';

const FIT_OPTIONS: { key: Exclude<BuyerSettingsState['preferredFit'], ''>; label: string; desc: string }[] = [
  { key: 'slim', label: 'Slim', desc: 'Close to the body' },
  { key: 'regular', label: 'Regular', desc: 'Classic fit' },
  { key: 'oversized', label: 'Oversized', desc: 'Relaxed & roomy' },
];

const CATEGORIES = [
  { key: 'streetwear', label: 'Streetwear', emoji: '🧢' },
  { key: 'luxury', label: 'Luxury', emoji: '💎' },
  { key: 'vintage', label: 'Vintage', emoji: '🕰️' },
  { key: 'athleisure', label: 'Athleisure', emoji: '🏃' },
  { key: 'minimalist', label: 'Minimalist', emoji: '⚪' },
  { key: 'y2k', label: 'Y2K', emoji: '✨' },
  { key: 'techwear', label: 'Techwear', emoji: '🤖' },
  { key: 'cottagecore', label: 'Cottagecore', emoji: '🌿' },
  { key: 'darkwear', label: 'Dark Fashion', emoji: '🖤' },
  { key: 'business', label: 'Business Casual', emoji: '👔' },
];

// Invisible a11y touch padding to 44pt height: 36pt size bubbles (slop stays
// inside the card's padding, so its overflow: 'hidden' doesn't clip it) and
// ~37pt category chips. Vertical only — both wrap in rows 8pt apart.
// Heights minus the 1pt top+bottom border (web slop sits inside the border box).
const SIZE_BUBBLE_HIT_SLOP = minHitSlop({ height: 36 - 2 });
const CAT_CHIP_HIT_SLOP = minHitSlop({ height: 37 - 2 });

function SizeSelector({
  label, options, selected, onSelect,
}: {
  label: string;
  options: readonly string[];
  selected: string;
  onSelect: (v: string) => void;
}) {
  const colors = useColors();
  const { theme } = useAppTheme();
  const s = createStyles(colors);
  return (
    <View style={s.sizeBlock}>
      <Text style={s.sizeLabel}>{label}</Text>
      <View style={s.sizeRow} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {options.map(opt => (
          <TouchableOpacity
            key={opt}
            style={[s.sizeBubble, selected === opt && s.sizeBubbleActive]}
            onPress={() => { haptic('select'); onSelect(opt); }}
            hitSlop={SIZE_BUBBLE_HIT_SLOP}
            accessibilityRole="radio"
            accessibilityLabel={`${label}, ${opt}`}
            accessibilityState={{ selected: selected === opt, checked: selected === opt }}
          >
            <Text style={[s.sizeBubbleText, selected === opt && s.sizeBubbleTextActive]}>{opt}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

export default function ShoppingPreferences() {
  const colors = useColors();
  const { theme } = useAppTheme();
  const s = createStyles(colors);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tabBarInset = useSellerTabBarInset();
  const api = useApi();
  const [settings, setSettings] = useState<BuyerSettingsState | null>(null);
  const [selectedCats, setSelectedCats] = useState<Set<string>>(new Set());
  // Sizes and style categories live on the account (buyer_preferences, the
  // same source as My sizes). Signed out / dev preview: local settings only.
  const { preferences, status: prefsStatus, update: updatePreferences } = useBuyerPreferences();
  const signedIn = prefsStatus !== 'signed-out';
  const prefsLoaded = prefsStatus === 'loaded';
  const catsTouched = useRef(false);
  // The tapped size shows immediately while the account save is in flight.
  const [sizeOverride, setSizeOverride] = useState<Partial<Record<ShoppingSizeField, string>>>({});

  const serverCatsRef = useRef<string[]>([]);
  serverCatsRef.current = prefsLoaded ? selectedCategoriesFromInterests(preferences.styleInterests, CATEGORIES) : [];
  const signedInRef = useRef(signedIn);
  signedInRef.current = signedIn;

  useFocusEffect(useCallback(() => {
    catsTouched.current = false;
    loadBuyerSettings().then(s => {
      setSettings(s);
      // Signed in, only the account copy counts; local is the signed-out fallback.
      setSelectedCats(new Set(signedInRef.current ? serverCatsRef.current : (s.styleCategories ?? [])));
    });
  }, []));

  // Once the account's saved interests arrive, show them (unless already edited here).
  useEffect(() => {
    if (!prefsLoaded || catsTouched.current) return;
    const fromServer = selectedCategoriesFromInterests(preferences.styleInterests, CATEGORIES);
    setSelectedCats(new Set(fromServer));
  }, [prefsLoaded, preferences.styleInterests]);

  // Signed in, the account copy is the only source (no stale device value).
  const localSize = (field: ShoppingSizeField) =>
    settings?.[field === 'tops' ? 'sizeTops' : field === 'bottoms' ? 'sizeBottoms' : 'sizeShoes'] || '';
  const sizeFor = (field: ShoppingSizeField) =>
    sizeOverride[field] ?? (signedIn ? (prefsLoaded ? preferences.sizes[field] ?? '' : '') : localSize(field));
  const sizeTops = sizeFor('tops');
  const sizeBottoms = sizeFor('bottoms');
  const sizeShoes = sizeFor('shoes');

  async function patch(updates: Partial<BuyerSettingsState>) {
    const next = await patchBuyerSettings(updates);
    setSettings(next);
  }

  async function selectSize(field: ShoppingSizeField, value: string) {
    if (!signedIn) {
      const localKey = field === 'tops' ? 'sizeTops' : field === 'bottoms' ? 'sizeBottoms' : 'sizeShoes';
      await patch({ [localKey]: value } as Partial<BuyerSettingsState>);
      return;
    }
    setSizeOverride(prev => ({ ...prev, [field]: value }));
    try {
      await updatePreferences({ sizes: { [field]: value } });
    } catch (error) {
      showAlert('Couldn’t update size', friendlyError(error, 'Try again.'));
    } finally {
      setSizeOverride(prev => {
        if (prev[field] !== value) return prev;
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  }
  // Personalized recommendations is an account setting the For You ranking
  // reads on the server — saved immediately, rolled back with the real error.
  async function setPersonalized(v: boolean) {
    setSettings(prev => prev ? { ...prev, personalizedRecommendations: v } : prev);
    try {
      setSettings(await updateBuyerSettings(api, { personalizedRecommendations: v }));
    } catch (error) {
      setSettings(prev => prev ? { ...prev, personalizedRecommendations: !v } : prev);
      showAlert('Couldn’t update recommendations', friendlyError(error, 'Check your connection and try again.'));
    }
  }

  // Category toggles save immediately, like every other control here. Saves
  // run one at a time so a quick double toggle can't land out of order.
  const selectedCatsRef = useRef(selectedCats);
  selectedCatsRef.current = selectedCats;
  const catSaveChain = useRef<Promise<void>>(Promise.resolve());
  const preferencesRef = useRef(preferences);
  preferencesRef.current = preferences;

  function saveCategories(next: Set<string>, prev: Set<string>) {
    const cats = Array.from(next);
    catSaveChain.current = catSaveChain.current.then(async () => {
      // A rejection here would leave the chain rejected and skip every later save.
      try {
        if (!signedIn) {
          await patchBuyerSettings({ styleCategories: cats });
          return;
        }
        await updatePreferences({ styleInterests: mergeStyleInterests(preferencesRef.current.styleInterests, cats, CATEGORIES) });
      } catch (error) {
        // Roll back only if nothing newer was picked meanwhile.
        if (selectedCatsRef.current === next) setSelectedCats(prev);
        showAlert('Couldn’t update categories', friendlyError(error, 'Try again.'));
      }
    });
  }

  function toggleCat(key: string) {
    // Saving before the account copy loads would overwrite interests set elsewhere.
    if (signedIn && !prefsLoaded) {
      showAlert('Still loading your preferences', 'Try again in a moment.');
      return;
    }
    catsTouched.current = true;
    haptic('select');
    const prev = selectedCatsRef.current;
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    selectedCatsRef.current = next;
    setSelectedCats(next);
    saveCategories(next, prev);
  }

  if (!settings) return <View style={{ flex: 1, backgroundColor: 'transparent' }} />;

  return (
    <View style={s.page}>
      <ScreenHeader title="Shopping preferences" />

      <ScrollView
        contentContainerStyle={{ padding: SP.md, paddingBottom: insets.bottom + 100 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Sizes */}
        <Text style={s.sectionTitle}>Your sizes</Text>
        <Text style={s.sectionDesc}>Used for size recommendations and filtering.</Text>
        <View style={s.card}>
          <SizeSelector label="Tops" options={BUYER_SIZE_OPTIONS.tops} selected={sizeTops} onSelect={v => selectSize('tops', v)} />
          <View style={s.divider} />
          <SizeSelector label="Bottoms" options={BUYER_SIZE_OPTIONS.bottoms} selected={sizeBottoms} onSelect={v => selectSize('bottoms', v)} />
          <View style={s.divider} />
          <SizeSelector label="Shoes (US)" options={BUYER_SIZE_OPTIONS.shoes} selected={sizeShoes} onSelect={v => selectSize('shoes', v)} />
        </View>

        {/* Fit */}
        <Text style={s.sectionTitle}>Preferred fit</Text>
        <Text style={s.sectionDesc}>Size suggestions use this when you're between two sizes.</Text>
        <View style={s.card} accessibilityRole="radiogroup" accessibilityLabel="Preferred fit">
          {FIT_OPTIONS.map((opt, i) => (
            <React.Fragment key={opt.key}>
              <TouchableOpacity
                style={s.fitRow}
                onPress={() => patch({ preferredFit: opt.key })}
                activeOpacity={0.7}
                accessibilityRole="radio"
                accessibilityLabel={`${opt.label}, ${opt.desc}`}
                accessibilityState={{ selected: settings.preferredFit === opt.key, checked: settings.preferredFit === opt.key }}
              >
                <View style={s.fitRadio}>
                  {settings.preferredFit === opt.key && <View style={s.fitRadioFill} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.fitLabel}>{opt.label}</Text>
                  <Text style={s.fitDesc}>{opt.desc}</Text>
                </View>
              </TouchableOpacity>
              {i < FIT_OPTIONS.length - 1 && <View style={s.divider} />}
            </React.Fragment>
          ))}
        </View>

        {/* Categories */}
        <Text style={s.sectionTitle}>Style categories</Text>
        <Text style={s.sectionDesc}>Select all that apply — we'll personalize your Discover feed.</Text>
        <View style={s.catGrid}>
          {CATEGORIES.map(cat => (
            <TouchableOpacity
              key={cat.key}
              style={[s.catChip, selectedCats.has(cat.key) && s.catChipActive]}
              onPress={() => toggleCat(cat.key)}
              activeOpacity={0.7}
              hitSlop={CAT_CHIP_HIT_SLOP}
              accessibilityRole="checkbox"
              accessibilityLabel={cat.label}
              accessibilityState={{ checked: selectedCats.has(cat.key) }}
            >
              <Text style={s.catEmoji}>{cat.emoji}</Text>
              <Text style={[s.catLabel, selectedCats.has(cat.key) && s.catLabelActive]}>
                {cat.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Alerts */}
        <Text style={s.sectionTitle}>Alerts and notifications</Text>
        <Text style={s.sectionDesc}>Choose which product updates you receive.</Text>
        <View style={s.card}>
          {([
            { key: 'dropAlerts' as const, label: 'Drop alerts', sub: 'Notify me when brands drop new collections', icon: 'zap' },
            { key: 'restockAlerts' as const, label: 'Restock alerts', sub: 'Notify me when sold-out items return', icon: 'refresh-cw' },
            { key: 'priceDropAlerts' as const, label: 'Price drop alerts', sub: 'Alert me when saved items go on sale', icon: 'tag' },
          ]).map((item, i, arr) => (
            <React.Fragment key={item.key}>
              <View style={s.alertRow}>
                <Icon name={item.icon as any} size={19} color={colors.primary} style={{ width: 28 }} />
                <View style={{ flex: 1 }}>
                  <Text style={s.alertLabel}>{item.label}</Text>
                  <Text style={s.alertSub}>{item.sub}</Text>
                </View>
                <HapticSwitch
                  value={Boolean(settings[item.key])}
                  onValueChange={v => patch({ [item.key]: v })}
                  accessibilityLabel={item.label}
                  accessibilityHint={item.sub}
                />
              </View>
              {i < arr.length - 1 && <View style={s.divider} />}
            </React.Fragment>
          ))}
        </View>

        {/* Shopping activity */}
        <View style={[s.card, { marginTop: SP.sm }]}>
          <View style={s.alertRow}>
            <Icon name="eye" size={19} color={colors.primary} style={{ width: 28 }} />
            <View style={{ flex: 1 }}>
              <Text style={s.alertLabel}>Shopping activity</Text>
              <Text style={s.alertSub}>Let brands see what you've viewed and saved</Text>
            </View>
            <HapticSwitch
              value={Boolean(settings.showShoppingActivity)}
              onValueChange={v => patch({ showShoppingActivity: v })}
              accessibilityLabel="Shopping activity"
              accessibilityHint="Let brands see what you've viewed and saved"
            />
          </View>
          <View style={s.divider} />
          <View style={s.alertRow}>
            <Icon name="sliders" size={19} color={colors.primary} style={{ width: 28 }} />
            <View style={{ flex: 1 }}>
              <Text style={s.alertLabel}>Personalized recommendations</Text>
              <Text style={s.alertSub}>Use your activity to surface relevant products</Text>
            </View>
            <HapticSwitch
              value={Boolean(settings.personalizedRecommendations)}
              onValueChange={v => { void setPersonalized(v); }}
              accessibilityLabel="Personalized recommendations"
              accessibilityHint="Use your activity to surface relevant products"
            />
          </View>
        </View>
      </ScrollView>

      {/* Everything saves as it changes; this just closes the screen. */}
      <View style={[s.saveBar, { paddingBottom: insets.bottom + SP.md + tabBarInset }]}>
        <TouchableOpacity onPress={() => goBackOr(router)} activeOpacity={0.85} style={{ flex: 1 }} accessibilityRole="button" accessibilityLabel="Done">
          <LinearGradient colors={theme.primaryGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.saveBtn}>
            <Text style={[s.saveBtnText, { color: theme.onAccent }, getOnAccentTextStyle(theme)]}>Done</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  page: { flex: 1, backgroundColor: 'transparent' },

  sectionTitle: { color: FG, fontFamily: FONT.semibold, fontSize: FS.sm, marginTop: SP.lg, marginBottom: 4 },
  sectionDesc: { color: MUTED, fontFamily: FONT.regular, fontSize: FS.xs, marginBottom: SP.sm, lineHeight: 14 },

  card: { backgroundColor: CARD, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: BORDER, overflow: 'hidden' },
  divider: { height: 1, backgroundColor: BORDER, marginLeft: 16 },

  // Sizes
  sizeBlock: { paddingHorizontal: SP.md, paddingVertical: 14 },
  sizeLabel: { fontFamily: FONT.medium, fontSize: FS.sm, color: MUTED, marginBottom: 10 },
  sizeRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  sizeBubble: { minWidth: 44, height: 36, borderRadius: RADIUS.md, backgroundColor: BG, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  sizeBubbleActive: { backgroundColor: colors.accent, borderColor: colors.primary },
  sizeBubbleText: { fontFamily: FONT.medium, fontSize: FS.sm, color: MUTED },
  sizeBubbleTextActive: { color: colors.primary },

  // Fit
  fitRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP.md, paddingVertical: 14, gap: 12 },
  fitRadio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  fitRadioFill: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
  fitLabel: { fontFamily: FONT.medium, fontSize: FS.base, color: FG },
  fitDesc: { fontFamily: FONT.regular, fontSize: FS.xs, color: MUTED, marginTop: 2 },

  // Categories
  catGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm },
  catChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.md, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER },
  catChipActive: { backgroundColor: colors.accent, borderColor: colors.primary },
  catEmoji: { fontSize: 15 },
  catLabel: { fontFamily: FONT.medium, fontSize: FS.sm, color: MUTED },
  catLabelActive: { color: colors.primary },

  // Alerts
  alertRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP.md, paddingVertical: 14, gap: 12 },
  alertLabel: { fontFamily: FONT.medium, fontSize: FS.base, color: FG },
  alertSub: { fontFamily: FONT.regular, fontSize: FS.xs, color: MUTED, marginTop: 2 },

  // Save
  saveBar: { paddingHorizontal: SP.md, paddingTop: SP.sm, backgroundColor: BG, borderTopWidth: 1, borderTopColor: BORDER },
  saveBtn: { height: 50, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  saveBtnText: { color: '#FFF', fontFamily: FONT.bold, fontSize: FS.base },
});
