import React, { useState } from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Feather } from '@expo/vector-icons';
import { Badge } from '@/components/Badge';
import { useRouter } from 'expo-router';

const PAGES = [
  { name: 'Home', status: 'Published', views: '8,240', icon: 'home' as const },
  { name: 'Shop', status: 'Published', views: '5,180', icon: 'shopping-bag' as const },
  { name: 'About Us', status: 'Published', views: '1,240', icon: 'info' as const },
  { name: 'Blog', status: 'Draft', views: '—', icon: 'edit' as const },
  { name: 'FAQ', status: 'Published', views: '920', icon: 'help-circle' as const },
  { name: 'Contact', status: 'Published', views: '640', icon: 'mail' as const },
];

interface StoreLayout {
  id: string;
  name: string;
  desc: string;
  heroBg: string;
  heroTextColor: string;
  layout: 'centered' | 'split' | 'banner';
  swatches: string[];
  gridCols: number;
}

const LAYOUTS: StoreLayout[] = [
  {
    id: 'minimal',
    name: 'Minimal',
    desc: 'Clean grid, lots of whitespace',
    heroBg: '#12121F',
    heroTextColor: '#0EA5E9',
    layout: 'centered',
    swatches: ['#0EA5E9', '#1A1A4A', '#22D3EE', '#4A2A2A'],
    gridCols: 4,
  },
  {
    id: 'bold',
    name: 'Bold',
    desc: 'Big type, high contrast blocks',
    heroBg: '#0F766E',
    heroTextColor: '#FFFFFF',
    layout: 'banner',
    swatches: ['#0E0E0E', '#F5EFE6', '#0E0E0E'],
    gridCols: 3,
  },
  {
    id: 'editorial',
    name: 'Editorial',
    desc: 'Magazine-style storytelling',
    heroBg: '#1E1B16',
    heroTextColor: '#F5EFE6',
    layout: 'split',
    swatches: ['#8A6D3B', '#3A3A3A', '#5C4A2E'],
    gridCols: 2,
  },
  {
    id: 'luxe',
    name: 'Luxe',
    desc: 'Dark, gallery-like showcase',
    heroBg: '#0B0B0B',
    heroTextColor: '#C9A96E',
    layout: 'centered',
    swatches: ['#C9A96E', '#1A1A1A', '#3A3A3A'],
    gridCols: 3,
  },
  {
    id: 'street',
    name: 'Street',
    desc: 'Punchy color, streetwear energy',
    heroBg: '#1A1A4A',
    heroTextColor: '#EF4444',
    layout: 'banner',
    swatches: ['#EF4444', '#1A1A4A', '#F5C518', '#111'],
    gridCols: 4,
  },
  {
    id: 'mono',
    name: 'Mono',
    desc: 'Monochrome, typography-first',
    heroBg: '#141414',
    heroTextColor: '#EDEDED',
    layout: 'split',
    swatches: ['#333', '#666', '#999'],
    gridCols: 3,
  },
];

function LayoutPreview({ layout, colors }: { layout: StoreLayout; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={styles.layoutPreviewOuter}>
      <View style={styles.previewBar}>
        {[...Array(3)].map((_, i) => (
          <View key={i} style={[styles.previewDot, { backgroundColor: i === 0 ? '#EF4444' : i === 1 ? '#B98A2E' : colors.primary }]} />
        ))}
      </View>
      <View style={styles.previewContent}>
        <View
          style={[
            styles.previewHero,
            { backgroundColor: layout.heroBg },
            layout.layout === 'split' && { alignItems: 'flex-start', paddingLeft: 12 },
          ]}
        >
          <Text style={[styles.previewHeroText, { color: layout.heroTextColor }]}>BRANDTHREAD</Text>
          <Text style={[styles.previewHeroSub, { color: layout.heroTextColor + 'AA' }]}>The New Collection</Text>
        </View>
        <View style={[styles.previewGrid, { flexWrap: 'wrap' }]}>
          {layout.swatches.slice(0, layout.gridCols).map((c, i) => (
            <View
              key={i}
              style={[
                styles.previewProduct,
                { backgroundColor: c + 'CC', flexBasis: `${100 / layout.gridCols - 2}%` },
              ]}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

export default function WebsiteScreen() {
  const colors = useColors();
  const router = useRouter();
  const [selectedLayoutId, setSelectedLayoutId] = useState('minimal');
  const selectedLayout = LAYOUTS.find((l) => l.id === selectedLayoutId) ?? LAYOUTS[0];

  return (
    <View style={[styles.container, { backgroundColor: 'transparent' }]}>
      <ScreenHeader title="Website & Store Builder" subtitle="Design, customize & publish your store" />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: 16, paddingBottom: 100, paddingHorizontal: 20 }}
        showsVerticalScrollIndicator={false}
      >

      {/* Store Layouts */}
      <View style={styles.layoutsHeaderRow}>
        <Text style={[styles.sectionTitle, { color: colors.foreground, marginBottom: 0 }]}>Store Layouts</Text>
        <Text style={[styles.layoutsHint, { color: colors.mutedForeground }]}>Tap a layout, then edit it</Text>
      </View>
      <View style={styles.layoutsGrid}>
        {LAYOUTS.map((layout) => {
          const isSelected = layout.id === selectedLayoutId;
          return (
            <TouchableOpacity
              key={layout.id}
              activeOpacity={0.85}
              onPress={() => setSelectedLayoutId(layout.id)}
              style={[
                styles.layoutCard,
                {
                  backgroundColor: colors.card,
                  borderColor: isSelected ? colors.primary : colors.accent,
                  borderWidth: isSelected ? 2 : 1,
                },
              ]}
            >
              <LayoutPreview layout={layout} colors={colors} />
              <View style={styles.layoutCardFooter}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.layoutName, { color: colors.foreground }]}>{layout.name}</Text>
                  <Text style={[styles.layoutDesc, { color: colors.mutedForeground }]} numberOfLines={1}>
                    {layout.desc}
                  </Text>
                </View>
                {isSelected ? (
                  <View style={[styles.layoutCheck, { backgroundColor: colors.primary }]}>
                    <Feather name="check" size={11} color={colors.primaryForeground} />
                  </View>
                ) : null}
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      <TouchableOpacity style={[styles.editBtn, { backgroundColor: colors.primary, marginBottom: 24 }]} activeOpacity={0.8}>
        <Feather name="edit-2" size={14} color={colors.primaryForeground} />
        <Text style={[styles.editBtnText, { color: colors.primaryForeground }]}>Edit "{selectedLayout.name}" Layout</Text>
      </TouchableOpacity>

      {/* SEO */}
      <View style={[styles.seoCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.seoHeader}>
          <Feather name="search" size={16} color={colors.primary} />
          <Text style={[styles.seoTitle, { color: colors.foreground }]}>SEO Score</Text>
          <Text style={[styles.seoScore, { color: colors.success }]}>82/100</Text>
        </View>
        <View style={[styles.seoBar, { backgroundColor: colors.secondary }]}>
          <View style={[styles.seoFill, { width: '82%', backgroundColor: colors.success }]} />
        </View>
        <Text style={[styles.seoTip, { color: colors.mutedForeground }]}>Tip: Add alt text to 3 product images to boost to 90+</Text>
      </View>

      {/* Pages */}
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Pages</Text>
      <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {PAGES.map((p, i) => (
          <TouchableOpacity key={p.name} activeOpacity={0.75} style={[styles.pageRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
            <View style={[styles.pageIcon, { backgroundColor: colors.secondary }]}>
              <Feather name={p.icon} size={14} color={colors.mutedForeground} />
            </View>
            <View style={styles.pageInfo}>
              <Text style={[styles.pageName, { color: colors.foreground }]}>{p.name}</Text>
              <Text style={[styles.pageViews, { color: colors.mutedForeground }]}>{p.views !== '—' ? `${p.views} views` : 'Not published'}</Text>
            </View>
            <Badge label={p.status} variant={p.status === 'Published' ? 'success' : 'warning'} />
            <Feather name="chevron-right" size={14} color={colors.mutedForeground} />
          </TouchableOpacity>
        ))}
        <TouchableOpacity activeOpacity={0.75} style={[styles.addPageRow, { borderTopWidth: 1, borderTopColor: colors.border }]}>
          <Feather name="plus" size={16} color={colors.primary} />
          <Text style={[styles.addPageText, { color: colors.primary }]}>Add New Page</Text>
        </TouchableOpacity>
      </View>

      {/* Domain */}
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Custom Domain</Text>
      <View style={[styles.domainCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Feather name="globe" size={16} color={colors.success} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.domainName, { color: colors.foreground }]}>brandthread.app</Text>
          <Text style={[styles.domainStatus, { color: colors.success }]}>Connected · SSL Active</Text>
        </View>
        <Feather name="settings" size={16} color={colors.mutedForeground} />
      </View>
    </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 20 },
  backText: { fontSize: 15, fontFamily: 'Inter_500Medium' },
  pageTitle: { fontSize: 24, fontFamily: 'Inter_700Bold', marginBottom: 4 },
  pageSubtitle: { fontSize: 13, fontFamily: 'Inter_400Regular', marginBottom: 20 },
  layoutsHeaderRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 },
  layoutsHint: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  layoutsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 16 },
  layoutCard: { width: '47%', borderRadius: 16, padding: 10 },
  layoutPreviewOuter: { borderRadius: 8, overflow: 'hidden', marginBottom: 8 },
  layoutCardFooter: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  layoutName: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  layoutDesc: { fontSize: 10, fontFamily: 'Inter_400Regular', marginTop: 1 },
  layoutCheck: { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  previewBar: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  previewDot: { width: 6, height: 6, borderRadius: 3 },
  previewContent: { borderRadius: 8, overflow: 'hidden' },
  previewHero: { height: 54, alignItems: 'center', justifyContent: 'center' },
  previewHeroText: { fontSize: 10, fontFamily: 'Inter_700Bold', letterSpacing: 1.5 },
  previewHeroSub: { fontSize: 8, fontFamily: 'Inter_400Regular', marginTop: 2 },
  previewGrid: { flexDirection: 'row', gap: 2, marginTop: 2 },
  previewProduct: { height: 26, borderRadius: 3, marginBottom: 2 },
  editBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 10, paddingVertical: 10 },
  editBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  seoCard: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 24 },
  seoHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  seoTitle: { flex: 1, fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  seoScore: { fontSize: 16, fontFamily: 'Inter_700Bold' },
  seoBar: { height: 6, borderRadius: 3, overflow: 'hidden', marginBottom: 8 },
  seoFill: { height: '100%', borderRadius: 3 },
  seoTip: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  sectionTitle: { fontSize: 17, fontFamily: 'Inter_600SemiBold', marginBottom: 12 },
  section: { borderRadius: 14, borderWidth: 1, marginBottom: 24 },
  pageRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 10 },
  pageIcon: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  pageInfo: { flex: 1 },
  pageName: { fontSize: 14, fontFamily: 'Inter_500Medium' },
  pageViews: { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 2 },
  addPageRow: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14 },
  addPageText: { fontSize: 14, fontFamily: 'Inter_500Medium' },
  domainCard: { flexDirection: 'row', alignItems: 'center', borderRadius: 14, borderWidth: 1, padding: 14, gap: 12, marginBottom: 24 },
  domainName: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  domainStatus: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
});
