/**
 * Brandthread Design Studio — Template Library
 * Route: /design-templates
 */
import React, { useState, useMemo } from 'react';
import { useAppTheme } from '@/contexts/AppThemeContext';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, FlatList,
  Alert, ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  BG, SURFACE, CARD, CARD_ELEVATED,
  BORDER, BORDER_ACTIVE,
  FG, MUTED, SUBTLE,
  FONT, FS, SP, RADIUS, ICON,
} from '@/lib/theme';
import { SearchBar, EmptyState } from '@/components/BrandthreadUI';
import { createProject } from '@/services/designService';

// ─── Template data ─────────────────────────────────────────────────────────────
type TemplateCategory = 'Garments' | 'Social' | 'Product' | 'Packaging';

interface DesignTemplate {
  id: string;
  name: string;
  category: TemplateCategory;
  subcategory: string;
  dimensions: string;
  views?: number;
  garmentType?: string;
  presetId?: string;
  gradColors: readonly [string, string, ...string[]];
}

const TEMPLATES: DesignTemplate[] = [
  // Garments
  { id: 'gt1', name: 'Classic T-Shirt', category: 'Garments', subcategory: 'tshirt', dimensions: 'Front + Back', views: 4, garmentType: 'tshirt', gradColors: ['#1E3A5F', '#3B82F6'] },
  { id: 'gt2', name: 'Pullover Hoodie', category: 'Garments', subcategory: 'hoodie', dimensions: 'Front + Back', views: 3, garmentType: 'hoodie', gradColors: ['#0C4A6E', '#0EA5E9'] },
  { id: 'gt3', name: 'Crewneck Sweatshirt', category: 'Garments', subcategory: 'sweatshirt', dimensions: 'Front + Back', views: 3, garmentType: 'sweatshirt', gradColors: ['#134E4A', '#10B981'] },
  { id: 'gt4', name: 'Bomber Jacket', category: 'Garments', subcategory: 'jacket', dimensions: 'Front + Back + Side', views: 4, garmentType: 'jacket', gradColors: ['#451A03', '#F97316'] },
  { id: 'gt5', name: 'Snapback Cap', category: 'Garments', subcategory: 'hat', dimensions: 'Front + Back + Side', views: 4, garmentType: 'hat', gradColors: ['#1C1917', '#78716C'] },
  { id: 'gt6', name: 'Tote Bag', category: 'Garments', subcategory: 'bag', dimensions: 'Front + Back', views: 3, garmentType: 'bag', gradColors: ['#0F172A', '#475569'] },
  { id: 'gt7', name: 'Polo Shirt', category: 'Garments', subcategory: 'polo', dimensions: 'Front + Back', views: 3, garmentType: 'polo', gradColors: ['#0C4A6E', '#22D3EE'] },
  { id: 'gt8', name: 'Athletic Tank', category: 'Garments', subcategory: 'tank', dimensions: 'Front + Back', views: 2, garmentType: 'tank', gradColors: ['#164E63', '#67E8F9'] },

  // Social
  { id: 'st1', name: 'Instagram Story', category: 'Social', subcategory: 'story', dimensions: '1080 × 1920', presetId: 'ig_story', gradColors: ['#0EA5E9', '#EC4899'] },
  { id: 'st2', name: 'Instagram Post', category: 'Social', subcategory: 'post', dimensions: '1080 × 1080', presetId: 'ig_post', gradColors: ['#0EA5E9', '#0F766E'] },
  { id: 'st3', name: 'IG Landscape', category: 'Social', subcategory: 'landscape', dimensions: '1080 × 566', presetId: 'ig_land', gradColors: ['#059669', '#22D3EE'] },
  { id: 'st4', name: 'Facebook Post', category: 'Social', subcategory: 'facebook', dimensions: '1200 × 630', presetId: 'fb_post', gradColors: ['#1D4ED8', '#60A5FA'] },
  { id: 'st5', name: 'Twitter / X Post', category: 'Social', subcategory: 'twitter', dimensions: '1600 × 900', presetId: 'twitter_post', gradColors: ['#0F172A', '#3B82F6'] },

  // Product
  { id: 'pt1', name: 'Product Card', category: 'Product', subcategory: 'product_card', dimensions: '800 × 1000', presetId: 'product_card', gradColors: ['#0F172A', '#0EA5E9'] },
  { id: 'pt2', name: 'Campaign Banner', category: 'Product', subcategory: 'banner', dimensions: '1200 × 400', presetId: 'banner', gradColors: ['#7C2D12', '#EA580C'] },
  { id: 'pt3', name: 'Email Banner', category: 'Product', subcategory: 'email', dimensions: '600 × 200', presetId: 'email_banner', gradColors: ['#134E4A', '#34D399'] },

  // Packaging
  { id: 'pk1', name: 'Product Box', category: 'Packaging', subcategory: 'box', dimensions: 'Custom', presetId: 'custom', gradColors: ['#312E81', '#6366F1'] },
  { id: 'pk2', name: 'Hang Tag', category: 'Packaging', subcategory: 'tag', dimensions: 'Custom', presetId: 'custom', gradColors: ['#1F2937', '#9CA3AF'] },
  { id: 'pk3', name: 'Mailer Bag', category: 'Packaging', subcategory: 'mailer', dimensions: 'Custom', presetId: 'custom', gradColors: ['#7C2D12', '#F97316'] },
];

const CATEGORIES: TemplateCategory[] = ['Garments', 'Social', 'Product', 'Packaging'];

export default function DesignTemplatesScreen() {
  const { theme } = useAppTheme();
  const { accent: PURPLE, accentDim: PURPLE_DIM, accentLight: PURPLE_LIGHT, secondary: CYAN } = theme;
  const ts = createStyles(theme);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<TemplateCategory>('Garments');
  const [creatingId, setCreatingId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return TEMPLATES.filter(t => {
      const matchCat = t.category === activeCategory;
      const matchSearch = !search.trim() || t.name.toLowerCase().includes(search.toLowerCase()) || t.subcategory.toLowerCase().includes(search.toLowerCase());
      return matchCat && matchSearch;
    });
  }, [activeCategory, search]);

  function parseDimensions(dims: string): { width: number; height: number } | null {
    const match = dims.match(/(\d+)\s*[×x]\s*(\d+)/);
    if (!match) return null;
    return { width: Number(match[1]), height: Number(match[2]) };
  }

  async function handleUseTemplate(template: DesignTemplate) {
    if (creatingId) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setCreatingId(template.id);
    try {
      if (template.garmentType) {
        // Create the project first so "Save Placement" and "Open Editor" in
        // design-garment have a real projectId, instead of dead-ending.
        const project = await createProject('garment', template.name, {}, template.garmentType as any);
        router.push(`/design-garment?projectId=${project.id}&garmentType=${template.garmentType}` as any);
      } else if (template.presetId) {
        const size = parseDimensions(template.dimensions);
        const project = await createProject('canvas', template.name, size ?? {});
        router.push(`/design-canvas?id=${project.id}` as any);
      }
    } catch {
      Alert.alert('Couldn’t create project', 'Try again.');
    } finally {
      setCreatingId(null);
    }
  }

  return (
    <View style={ts.root}>
      {/* ── TOP BAR ── */}
      <View style={[ts.topBar, { paddingTop: insets.top + 4 }]}>
        <TouchableOpacity style={ts.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={ICON.md} color={FG} />
        </TouchableOpacity>
        <Text style={ts.topTitle}>Templates</Text>
      </View>

      {/* ── SEARCH ── */}
      <View style={ts.searchWrap}>
        <SearchBar value={search} onChange={setSearch} placeholder="Search templates…" />
      </View>

      {/* ── CATEGORY TABS ── */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={ts.tabsScroll} contentContainerStyle={ts.tabsContent}>
        {CATEGORIES.map(cat => (
          <TouchableOpacity
            key={cat}
            style={[ts.tab, activeCategory === cat && ts.tabActive]}
            onPress={() => { Haptics.selectionAsync(); setActiveCategory(cat); }}
          >
            <Text style={[ts.tabText, activeCategory === cat && { color: PURPLE_LIGHT }]}>{cat}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* ── TEMPLATE GRID ── */}
      {filtered.length === 0 ? (
        <View style={{ flex: 1 }}>
          <EmptyState
            icon="layout"
            title="No templates found"
            description="Choose a starting point for your next design."
            action={{ label: 'Clear Search', onPress: () => setSearch('') }}
          />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={item => item.id}
          numColumns={2}
          contentContainerStyle={[ts.gridContent, { paddingBottom: insets.bottom + SP.xl }]}
          columnWrapperStyle={ts.columnWrapper}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <View style={ts.templateCard}>
              {/* Thumbnail */}
              <LinearGradient
                colors={item.gradColors}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={ts.thumbnail}
              >
                <View style={ts.thumbnailContent}>
                  <Feather
                    name={
                      item.category === 'Garments' ? 'layers' :
                      item.category === 'Social' ? 'smartphone' :
                      item.category === 'Packaging' ? 'box' : 'monitor'
                    }
                    size={ICON.xl}
                    color="rgba(255,255,255,0.6)"
                  />
                </View>
              </LinearGradient>

              {/* Info */}
              <View style={ts.cardInfo}>
                <Text style={ts.cardName} numberOfLines={1}>{item.name}</Text>
                <Text style={ts.cardDims} numberOfLines={1}>
                  {item.dimensions}{item.views ? ` · ${item.views} views` : ''}
                </Text>
              </View>

              {/* Use button */}
              <TouchableOpacity
                style={ts.useBtn}
                onPress={() => handleUseTemplate(item)}
                activeOpacity={0.8}
                disabled={creatingId === item.id}
              >
                {creatingId === item.id ? (
                  <ActivityIndicator size="small" color={PURPLE_LIGHT} />
                ) : (
                  <Text style={ts.useBtnText}>Use Template</Text>
                )}
              </TouchableOpacity>
            </View>
          )}
        />
      )}
    </View>
  );
}

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => {
  const { accentDim: PURPLE_DIM, accentLight: PURPLE_LIGHT } = theme;
  return StyleSheet.create({
  root:          { flex: 1, backgroundColor: 'transparent' },
  topBar:        { flexDirection: 'row', alignItems: 'center', backgroundColor: SURFACE, borderBottomWidth: 1, borderBottomColor: BORDER, paddingHorizontal: SP.md, paddingBottom: SP.sm, gap: SP.sm },
  backBtn:       { width: 36, height: 36, borderRadius: RADIUS.sm, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  topTitle:      { fontSize: FS.xl, fontFamily: FONT.bold, color: FG, letterSpacing: -0.3 },

  searchWrap:    { paddingHorizontal: SP.md, paddingVertical: SP.sm },

  tabsScroll:    { flexGrow: 0 },
  tabsContent:   { paddingHorizontal: SP.md, gap: SP.xs, paddingBottom: SP.sm },
  tab:           { paddingHorizontal: SP.md, paddingVertical: 8, borderRadius: RADIUS.pill, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER },
  tabActive:     { backgroundColor: PURPLE_DIM, borderColor: BORDER_ACTIVE },
  tabText:       { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED },

  gridContent:   { paddingHorizontal: SP.md, paddingTop: SP.sm },
  columnWrapper: { gap: SP.sm, marginBottom: SP.sm },

  templateCard:  { flex: 1, backgroundColor: CARD, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: BORDER, overflow: 'hidden' },
  thumbnail:     { width: '100%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  thumbnailContent: { alignItems: 'center', gap: SP.xs },
  thumbnailLabel:{ fontSize: FS.xs, fontFamily: FONT.bold, color: 'rgba(255,255,255,0.5)', letterSpacing: 1 },
  cardInfo:      { padding: SP.sm, gap: 2 },
  cardName:      { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  cardDims:      { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
  useBtn:        { margin: SP.sm, marginTop: 0, backgroundColor: PURPLE_DIM, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: BORDER_ACTIVE, paddingVertical: 8, alignItems: 'center' },
  useBtnText:    { fontSize: FS.xs, fontFamily: FONT.semibold, color: PURPLE_LIGHT },
  });
};
