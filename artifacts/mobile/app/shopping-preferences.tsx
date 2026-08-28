/**
 * Shopping Preferences — full buyer preferences screen
 * Sizes, fit, categories, alerts, and activity toggles
 */
import React, { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Switch,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import {
  BG, CARD, BORDER, FG, MUTED,
  FONT, FS, SP, RADIUS, GRAD_PRIMARY,
} from '@/lib/theme';
import { useColors } from '@/hooks/useColors';
import { getOnAccentTextStyle, useAppTheme } from '@/contexts/AppThemeContext';
import { loadBuyerSettings, patchBuyerSettings, type BuyerSettingsState } from '@/lib/buyerSettings';

const TOPS = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL+'];
const BOTTOMS = ['28', '29', '30', '31', '32', '33', '34', '36', '38', '40+'];
const SHOES = ['6', '7', '8', '9', '10', '11', '12', '13', '14'];

const FIT_OPTIONS: { key: BuyerSettingsState['preferredFit']; label: string; desc: string }[] = [
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

function SizeSelector({
  label, options, selected, onSelect,
}: {
  label: string;
  options: string[];
  selected: string;
  onSelect: (v: string) => void;
}) {
  const colors = useColors();
  const { theme } = useAppTheme();
  const s = createStyles(colors);
  return (
    <View style={s.sizeBlock}>
      <Text style={s.sizeLabel}>{label}</Text>
      <View style={s.sizeRow}>
        {options.map(opt => (
          <TouchableOpacity
            key={opt}
            style={[s.sizeBubble, selected === opt && s.sizeBubbleActive]}
            onPress={() => { Haptics.selectionAsync(); onSelect(opt); }}
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
  const [settings, setSettings] = useState<BuyerSettingsState | null>(null);
  const [selectedCats, setSelectedCats] = useState<Set<string>>(new Set());
  const [hasChanges, setHasChanges] = useState(false);

  useFocusEffect(useCallback(() => {
    loadBuyerSettings().then(s => {
      setSettings(s);
      setSelectedCats(new Set(s.styleCategories ?? ['streetwear', 'vintage']));
    });
  }, []));

  async function patch(updates: Partial<BuyerSettingsState>) {
    const next = await patchBuyerSettings(updates);
    setSettings(next);
    setHasChanges(true);
  }

  async function save() {
    // Persist selected style categories alongside other preferences
    await patchBuyerSettings({ styleCategories: Array.from(selectedCats) });
    setHasChanges(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.back();
  }

  function toggleCat(key: string) {
    Haptics.selectionAsync();
    setSelectedCats(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
    setHasChanges(true);
  }

  if (!settings) return <View style={{ flex: 1, backgroundColor: BG }} />;

  return (
    <View style={[s.page, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity style={s.iconBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={21} color={FG} />
        </TouchableOpacity>
        <Text style={s.title}>Shopping Preferences</Text>
        <View style={s.iconBtn} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: SP.md, paddingBottom: insets.bottom + 100 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Sizes */}
        <Text style={s.sectionTitle}>Your Sizes</Text>
        <Text style={s.sectionDesc}>Used for size recommendations and filtering.</Text>
        <View style={s.card}>
          <SizeSelector label="Tops" options={TOPS} selected={settings.sizeTops} onSelect={v => patch({ sizeTops: v })} />
          <View style={s.divider} />
          <SizeSelector label="Bottoms" options={BOTTOMS} selected={settings.sizeBottoms} onSelect={v => patch({ sizeBottoms: v })} />
          <View style={s.divider} />
          <SizeSelector label="Shoes (US)" options={SHOES} selected={settings.sizeShoes} onSelect={v => patch({ sizeShoes: v })} />
        </View>

        {/* Fit */}
        <Text style={s.sectionTitle}>Preferred Fit</Text>
        <Text style={s.sectionDesc}>We'll show you cuts that match your style.</Text>
        <View style={s.card}>
          {FIT_OPTIONS.map((opt, i) => (
            <React.Fragment key={opt.key}>
              <TouchableOpacity
                style={s.fitRow}
                onPress={() => patch({ preferredFit: opt.key })}
                activeOpacity={0.7}
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
        <Text style={s.sectionTitle}>Style Categories</Text>
        <Text style={s.sectionDesc}>Select all that apply — we'll personalize your Discover feed.</Text>
        <View style={s.catGrid}>
          {CATEGORIES.map(cat => (
            <TouchableOpacity
              key={cat.key}
              style={[s.catChip, selectedCats.has(cat.key) && s.catChipActive]}
              onPress={() => toggleCat(cat.key)}
              activeOpacity={0.7}
            >
              <Text style={s.catEmoji}>{cat.emoji}</Text>
              <Text style={[s.catLabel, selectedCats.has(cat.key) && s.catLabelActive]}>
                {cat.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Alerts */}
        <Text style={s.sectionTitle}>Alerts &amp; Notifications</Text>
        <Text style={s.sectionDesc}>Stay in the loop on products you care about.</Text>
        <View style={s.card}>
          {([
            { key: 'dropAlerts' as const, label: 'Drop alerts', sub: 'Notify me when brands drop new collections', icon: 'zap' },
            { key: 'restockAlerts' as const, label: 'Restock alerts', sub: 'Get notified when sold-out items come back', icon: 'refresh-cw' },
            { key: 'priceDropAlerts' as const, label: 'Price drop alerts', sub: 'Alert me when saved items go on sale', icon: 'tag' },
          ]).map((item, i, arr) => (
            <React.Fragment key={item.key}>
              <View style={s.alertRow}>
                <Feather name={item.icon as any} size={19} color={colors.primary} style={{ width: 28 }} />
                <View style={{ flex: 1 }}>
                  <Text style={s.alertLabel}>{item.label}</Text>
                  <Text style={s.alertSub}>{item.sub}</Text>
                </View>
                <Switch
                  value={Boolean(settings[item.key])}
                  onValueChange={v => { Haptics.selectionAsync(); patch({ [item.key]: v }); }}
                  trackColor={{ false: '#333344', true: colors.primary }}
                  thumbColor="#fff"
                />
              </View>
              {i < arr.length - 1 && <View style={s.divider} />}
            </React.Fragment>
          ))}
        </View>

        {/* Shopping activity */}
        <View style={[s.card, { marginTop: SP.sm }]}>
          <View style={s.alertRow}>
            <Feather name="eye" size={19} color={colors.primary} style={{ width: 28 }} />
            <View style={{ flex: 1 }}>
              <Text style={s.alertLabel}>Shopping activity</Text>
              <Text style={s.alertSub}>Let brands see what you've viewed and saved</Text>
            </View>
            <Switch
              value={Boolean(settings.showShoppingActivity)}
              onValueChange={v => { Haptics.selectionAsync(); patch({ showShoppingActivity: v }); }}
              trackColor={{ false: '#333344', true: colors.primary }}
              thumbColor="#fff"
            />
          </View>
          <View style={s.divider} />
          <View style={s.alertRow}>
            <Feather name="sliders" size={19} color={colors.primary} style={{ width: 28 }} />
            <View style={{ flex: 1 }}>
              <Text style={s.alertLabel}>Personalized recommendations</Text>
              <Text style={s.alertSub}>Use your activity to surface relevant products</Text>
            </View>
            <Switch
              value={Boolean(settings.personalizedRecommendations)}
              onValueChange={v => { Haptics.selectionAsync(); patch({ personalizedRecommendations: v }); }}
              trackColor={{ false: '#333344', true: colors.primary }}
              thumbColor="#fff"
            />
          </View>
        </View>
      </ScrollView>

      {/* Save button */}
      <View style={[s.saveBar, { paddingBottom: insets.bottom + SP.md }]}>
        <TouchableOpacity onPress={save} activeOpacity={0.85} style={{ flex: 1 }}>
          <LinearGradient colors={theme.primaryGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.saveBtn}>
            <Text style={[s.saveBtnText, { color: theme.onAccent }, getOnAccentTextStyle(theme)]}>Save Preferences</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  page: { flex: 1, backgroundColor: BG },
  header: { height: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SP.md, borderBottomWidth: 1, borderBottomColor: BORDER },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { color: FG, fontFamily: FONT.bold, fontSize: FS.md },

  sectionTitle: { color: FG, fontFamily: FONT.semibold, fontSize: FS.sm, marginTop: SP.lg, marginBottom: 4 },
  sectionDesc: { color: MUTED, fontFamily: FONT.regular, fontSize: FS.xs, marginBottom: SP.sm, lineHeight: 18 },

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
  catChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 9, borderRadius: RADIUS.pill, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER },
  catChipActive: { backgroundColor: colors.accent, borderColor: colors.primary },
  catEmoji: { fontSize: 14 },
  catLabel: { fontFamily: FONT.medium, fontSize: FS.sm, color: MUTED },
  catLabelActive: { color: colors.primary },

  // Alerts
  alertRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP.md, paddingVertical: 14, gap: 12 },
  alertLabel: { fontFamily: FONT.medium, fontSize: FS.base, color: FG },
  alertSub: { fontFamily: FONT.regular, fontSize: FS.xs, color: MUTED, marginTop: 2 },

  // Save
  saveBar: { paddingHorizontal: SP.md, paddingTop: SP.sm, backgroundColor: BG, borderTopWidth: 1, borderTopColor: BORDER },
  saveBtn: { height: 50, borderRadius: RADIUS.pill, alignItems: 'center', justifyContent: 'center' },
  saveBtnText: { color: '#FFF', fontFamily: FONT.bold, fontSize: FS.base },
});
