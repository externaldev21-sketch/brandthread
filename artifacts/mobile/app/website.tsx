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

const THEMES = ['Minimal', 'Bold', 'Editorial', 'Luxe', 'Street'];

export default function WebsiteScreen() {
  const colors = useColors();
  const router = useRouter();
  const [selectedTheme, setSelectedTheme] = useState('Minimal');

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenHeader title="Website & Store Builder" subtitle="Design, customize & publish your store" />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: 16, paddingBottom: 100, paddingHorizontal: 20 }}
        showsVerticalScrollIndicator={false}
      >

      {/* Store Preview */}
      <View style={[styles.previewCard, { backgroundColor: '#17140F', borderColor: '#C1440E44' }]}>
        <View style={styles.previewBar}>
          {[...Array(3)].map((_, i) => (
            <View key={i} style={[styles.previewDot, { backgroundColor: i === 0 ? '#EF4444' : i === 1 ? '#B98A2E' : '#4C9A5E' }]} />
          ))}
          <View style={[styles.urlBar, { backgroundColor: '#1A1A1A' }]}>
            <Feather name="lock" size={10} color={colors.success} />
            <Text style={[styles.urlText, { color: colors.mutedForeground }]}>brandthread.com</Text>
          </View>
        </View>
        <View style={styles.previewContent}>
          <View style={[styles.previewHero, { backgroundColor: '#2A2A1A' }]}>
            <Text style={[styles.previewHeroText, { color: colors.primary }]}>BRANDTHREAD</Text>
            <Text style={[styles.previewHeroSub, { color: colors.mutedForeground }]}>The New Collection</Text>
          </View>
          <View style={styles.previewGrid}>
            {['#C94D1F', '#1A1A4A', '#2A3A1A', '#4A2A2A'].map((c, i) => (
              <View key={i} style={[styles.previewProduct, { backgroundColor: c + '88' }]} />
            ))}
          </View>
        </View>
        <TouchableOpacity style={[styles.editBtn, { backgroundColor: colors.primary }]} activeOpacity={0.8}>
          <Feather name="edit-2" size={14} color={colors.primaryForeground} />
          <Text style={[styles.editBtnText, { color: colors.primaryForeground }]}>Open Editor</Text>
        </TouchableOpacity>
      </View>

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

      {/* Theme */}
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Themes</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }} contentContainerStyle={{ gap: 10 }}>
        {THEMES.map((t) => (
          <TouchableOpacity
            key={t}
            onPress={() => setSelectedTheme(t)}
            activeOpacity={0.75}
            style={[styles.themeChip, {
              backgroundColor: selectedTheme === t ? colors.primary : colors.card,
              borderColor: selectedTheme === t ? colors.primary : colors.border,
            }]}
          >
            <Text style={[styles.themeText, { color: selectedTheme === t ? colors.primaryForeground : colors.mutedForeground }]}>{t}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

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
          <Text style={[styles.domainName, { color: colors.foreground }]}>brandthread.com</Text>
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
  previewCard: { borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 16 },
  previewBar: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  previewDot: { width: 8, height: 8, borderRadius: 4 },
  urlBar: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  urlText: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  previewContent: { borderRadius: 10, overflow: 'hidden', marginBottom: 12 },
  previewHero: { height: 80, alignItems: 'center', justifyContent: 'center' },
  previewHeroText: { fontSize: 14, fontFamily: 'Inter_700Bold', letterSpacing: 2 },
  previewHeroSub: { fontSize: 10, fontFamily: 'Inter_400Regular', marginTop: 2 },
  previewGrid: { flexDirection: 'row', gap: 2, marginTop: 2 },
  previewProduct: { flex: 1, height: 40, borderRadius: 4 },
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
  themeChip: { paddingHorizontal: 18, paddingVertical: 9, borderRadius: 20, borderWidth: 1 },
  themeText: { fontSize: 13, fontFamily: 'Inter_500Medium' },
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
