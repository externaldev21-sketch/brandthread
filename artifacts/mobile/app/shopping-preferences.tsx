/**
 * Shopping Preferences — full buyer preferences screen
 * Sizes, fit, categories, price range, colors, recommendations
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Switch, TextInput,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { BG, CARD, BORDER, FG, MUTED, SUBTLE, PURPLE, FONT, FS, SP, RADIUS } from '@/lib/theme';
import { loadBuyerSettings, patchBuyerSettings } from '@/lib/buyerSettings';
import type { BuyerSettingsState } from '@/lib/buyerSettings';

const TOPS = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL+'];
const BOTTOMS = ['28', '29', '30', '31', '32', '33', '34', '36', '38', '40+'];
const SHOES_M = ['7', '7.5', '8', '8.5', '9', '9.5', '10', '10.5', '11', '11.5', '12', '13', '14'];
const FIT_OPTIONS: { value: BuyerSettingsState['preferredFit']; label: string; desc: string }[] = [
  { value: 'slim', label: 'Slim', desc: 'Close to the body' },
  { value: 'regular', label: 'Regular', desc: 'Classic fit' },
  { value: 'oversized', label: 'Oversized', desc: 'Relaxed and roomy' },
];
const CATEGORIES = [
  'Tees', 'Hoodies', 'Sweats', 'Denim', 'Jackets', 'Outerwear',
  'Shoes', 'Accessories', 'Hats', 'Bags', 'Jewelry', 'Shorts', 'Pants', 'Other',
];
const COLORS = [
  { label: 'Black', hex: '#000000' }, { label: 'White', hex: '#FFFFFF' },
  { label: 'Grey', hex: '#6B7280' }, { label: 'Navy', hex: '#1E3A5F' },
  { label: 'Brown', hex: '#92400E' }, { label: 'Beige', hex: '#D4B896' },
  { label: 'Red', hex: '#DC2626' }, { label: 'Blue', hex: '#2563EB' },
  { label: 'Green', hex: '#16A34A' }, { label: 'Purple', hex: '#8B5CF6' },
  { label: 'Pink', hex: '#EC4899' }, { label: 'Orange', hex: '#EA580C' },
  { label: 'Yellow', hex: '#CA8A04' }, { label: 'Multi', hex: '#E5E7EB' },
];

export default function ShoppingPreferencesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [settings, setSettings] = useState<BuyerSettingsState | null>(null);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedColors, setSelectedColors] = useState<string[]>([]);
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');

  useEffect(() => {
    loadBuyerSettings().then(s => {
      setSettings(s);
    });
  }, []);

  const patch = useCallback(async (update: Partial<BuyerSettingsState>) => {
    Haptics.selectionAsync();
    const next = await patchBuyerSettings(update);
    setSettings(next);
  }, []);

  const toggleCategory = (cat: string) => {
    Haptics.selectionAsync();
    setSelectedCategories(prev =>
      prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
    );
  };

  const toggleColor = (color: string) => {
    Haptics.selectionAsync();
    setSelectedColors(prev =>
      prev.includes(color) ? prev.filter(c => c !== color) : [...prev, color]
    );
  };

  if (!settings) return <View style={{ flex: 1, backgroundColor: BG }} />;

  return (
    <View style={[styles.page, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={21} color={FG} />
        </TouchableOpacity>
        <Text style={styles.title}>Shopping preferences</Text>
        <View style={styles.iconBtn} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: SP.md, paddingBottom: insets.bottom + 48 }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Tops Size ── */}
        <SectionLabel title="Top size" />
        <View style={styles.chipRow}>
          {TOPS.map(s => (
            <ChipBtn
              key={s}
              label={s}
              active={settings.sizeTops === s}
              onPress={() => patch({ sizeTops: s })}
            />
          ))}
        </View>

        {/* ── Bottoms Size ── */}
        <SectionLabel title="Bottom size (waist)" />
        <View style={styles.chipRow}>
          {BOTTOMS.map(s => (
            <ChipBtn
              key={s}
              label={s}
              active={settings.sizeBottoms === s}
              onPress={() => patch({ sizeBottoms: s })}
            />
          ))}
        </View>

        {/* ── Shoe Size ── */}
        <SectionLabel title="Shoe size (US)" />
        <View style={styles.chipRow}>
          {SHOES_M.map(s => (
            <ChipBtn
              key={s}
              label={s}
              active={settings.sizeShoes === s}
              onPress={() => patch({ sizeShoes: s })}
            />
          ))}
        </View>

        {/* ── Preferred Fit ── */}
        <SectionLabel title="Preferred fit" />
        <View style={styles.card}>
          {FIT_OPTIONS.map((opt, i) => (
            <React.Fragment key={opt.value}>
              <TouchableOpacity
                style={styles.fitRow}
                onPress={() => patch({ preferredFit: opt.value })}
                activeOpacity={0.7}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.fitLabel}>{opt.label}</Text>
                  <Text style={styles.fitDesc}>{opt.desc}</Text>
                </View>
                <View style={[styles.radio, settings.preferredFit === opt.value && styles.radioActive]}>
                  {settings.preferredFit === opt.value && <View style={styles.radioDot} />}
                </View>
              </TouchableOpacity>
              {i < FIT_OPTIONS.length - 1 && <View style={styles.divider} />}
            </React.Fragment>
          ))}
        </View>

        {/* ── Favorite Categories ── */}
        <SectionLabel title="Favorite categories" subtitle="We'll prioritize these in your Discover feed" />
        <View style={styles.chipRow}>
          {CATEGORIES.map(cat => (
            <ChipBtn
              key={cat}
              label={cat}
              active={selectedCategories.includes(cat)}
              onPress={() => toggleCategory(cat)}
            />
          ))}
        </View>

        {/* ── Preferred Colors ── */}
        <SectionLabel title="Preferred colors" />
        <View style={styles.colorRow}>
          {COLORS.map(c => (
            <TouchableOpacity
              key={c.label}
              style={[
                styles.colorSwatch,
                { backgroundColor: c.hex, borderColor: selectedColors.includes(c.label) ? PURPLE : 'transparent' },
              ]}
              onPress={() => toggleColor(c.label)}
              activeOpacity={0.8}
            >
              {selectedColors.includes(c.label) && (
                <Feather name="check" size={14} color={c.hex === '#FFFFFF' || c.hex === '#E5E7EB' ? '#000' : '#fff'} />
              )}
            </TouchableOpacity>
          ))}
        </View>

        {/* ── Price Range ── */}
        <SectionLabel title="Price range" subtitle="Filter products to your budget" />
        <View style={styles.priceRow}>
          <View style={styles.priceInput}>
            <Text style={styles.priceCurrency}>$</Text>
            <TextInput
              style={styles.priceField}
              value={minPrice}
              onChangeText={setMinPrice}
              placeholder="Min"
              placeholderTextColor={SUBTLE}
              keyboardType="numeric"
            />
          </View>
          <Text style={styles.priceDash}>—</Text>
          <View style={styles.priceInput}>
            <Text style={styles.priceCurrency}>$</Text>
            <TextInput
              style={styles.priceField}
              value={maxPrice}
              onChangeText={setMaxPrice}
              placeholder="Max"
              placeholderTextColor={SUBTLE}
              keyboardType="numeric"
            />
          </View>
        </View>

        {/* ── Recommendations ── */}
        <SectionLabel title="Recommendations" />
        <View style={styles.card}>
          <ToggleRow
            label="Personalized recommendations"
            sub="Tailored to your style and activity"
            value={settings.personalizedRecommendations}
            onToggle={v => patch({ personalizedRecommendations: v })}
          />
          <View style={styles.divider} />
          <ToggleRow
            label="Use shopping activity"
            sub="Improve recommendations based on what you view and buy"
            value={settings.showShoppingActivity}
            onToggle={v => patch({ showShoppingActivity: v })}
          />
        </View>

        {/* ── Alerts ── */}
        <SectionLabel title="Shopping alerts" />
        <View style={styles.card}>
          <ToggleRow
            label="Drop alerts"
            sub="Notify me when favorite brands drop new items"
            value={settings.dropAlerts}
            onToggle={v => patch({ dropAlerts: v })}
          />
          <View style={styles.divider} />
          <ToggleRow
            label="Restock alerts"
            sub="Notify me when sold-out items come back"
            value={settings.restockAlerts}
            onToggle={v => patch({ restockAlerts: v })}
          />
          <View style={styles.divider} />
          <ToggleRow
            label="Price drop alerts"
            sub="Notify me when saved items go on sale"
            value={settings.priceDropAlerts}
            onToggle={v => patch({ priceDropAlerts: v })}
          />
        </View>
      </ScrollView>
    </View>
  );
}

function SectionLabel({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={{ marginBottom: 10, marginTop: 20 }}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {subtitle ? <Text style={styles.sectionSub}>{subtitle}</Text> : null}
    </View>
  );
}

function ChipBtn({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[styles.chip, active && styles.chipActive]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function ToggleRow({ label, sub, value, onToggle }: { label: string; sub?: string; value: boolean; onToggle: (v: boolean) => void }) {
  return (
    <View style={styles.toggleRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.toggleLabel}>{label}</Text>
        {sub ? <Text style={styles.toggleSub}>{sub}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onToggle}
        trackColor={{ false: '#333344', true: PURPLE }}
        thumbColor="#fff"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: BG },
  header: {
    height: 58, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingHorizontal: SP.md,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { color: FG, fontFamily: FONT.bold, fontSize: FS.md },
  sectionTitle: { color: FG, fontFamily: FONT.semibold, fontSize: FS.sm },
  sectionSub: { color: MUTED, fontFamily: FONT.regular, fontSize: 11.5, marginTop: 2 },
  card: {
    backgroundColor: CARD, borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: BORDER, overflow: 'hidden',
  },
  divider: { height: 1, backgroundColor: BORDER },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: RADIUS.pill, borderWidth: 1, borderColor: BORDER,
    backgroundColor: CARD,
  },
  chipActive: { backgroundColor: `${PURPLE}20`, borderColor: PURPLE },
  chipText: { fontFamily: FONT.medium, fontSize: 13, color: MUTED },
  chipTextActive: { color: PURPLE },
  fitRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 14, gap: 12,
  },
  fitLabel: { color: FG, fontFamily: FONT.medium, fontSize: 14 },
  fitDesc: { color: MUTED, fontFamily: FONT.regular, fontSize: 12, marginTop: 2 },
  radio: {
    width: 20, height: 20, borderRadius: 10, borderWidth: 2,
    borderColor: BORDER, alignItems: 'center', justifyContent: 'center',
  },
  radioActive: { borderColor: PURPLE },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: PURPLE },
  colorRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  colorSwatch: {
    width: 36, height: 36, borderRadius: 18,
    borderWidth: 2, alignItems: 'center', justifyContent: 'center',
  },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  priceInput: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: CARD, borderWidth: 1, borderColor: BORDER,
    borderRadius: RADIUS.md, paddingHorizontal: 12, paddingVertical: 12,
  },
  priceCurrency: { color: MUTED, fontFamily: FONT.medium, fontSize: 14 },
  priceField: { flex: 1, color: FG, fontFamily: FONT.regular, fontSize: 14 },
  priceDash: { color: MUTED, fontFamily: FONT.medium },
  toggleRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 14, gap: 12,
  },
  toggleLabel: { color: FG, fontFamily: FONT.medium, fontSize: 14 },
  toggleSub: { color: MUTED, fontFamily: FONT.regular, fontSize: 11.5, marginTop: 2 },
});
