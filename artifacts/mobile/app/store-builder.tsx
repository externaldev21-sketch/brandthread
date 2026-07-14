import React, { useState } from 'react';
import {
  ScrollView, View, Text, TouchableOpacity, StyleSheet,
  Alert, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

const BG     = '#0A0B0A';
const CARD   = '#111311';
const BORDER = '#1E221E';
const FG     = '#EAF2ED';
const MUTED  = '#5A6B5C';
const GREEN  = '#39FF88';
const BLUE   = '#3B82F6';
const PURPLE = '#8B5CF6';
const CYAN   = '#06B6D4';
const ORANGE = '#F97316';

const SECTIONS_DATA = [
  { id: 's1', type: 'Hero',               icon: 'monitor'   as const, visible: true,  color: PURPLE },
  { id: 's2', type: 'Featured Collection',icon: 'grid'      as const, visible: true,  color: BLUE   },
  { id: 's3', type: 'Product Grid',       icon: 'box'       as const, visible: true,  color: GREEN  },
  { id: 's4', type: 'Brand Story',        icon: 'type'      as const, visible: false, color: CYAN   },
  { id: 's5', type: 'Video',              icon: 'video'     as const, visible: false, color: ORANGE },
  { id: 's6', type: 'Reviews',            icon: 'star'      as const, visible: true,  color: '#FBBF24' },
  { id: 's7', type: 'Newsletter',         icon: 'mail'      as const, visible: false, color: MUTED  },
];

const NAV_SECTIONS = [
  { label: 'Store Overview', icon: 'home'       as const, desc: 'Performance and live status.' },
  { label: 'Theme',          icon: 'sliders'    as const, desc: 'Colors, fonts and brand identity.' },
  { label: 'Pages',          icon: 'file-text'  as const, desc: 'Manage store pages.' },
  { label: 'Navigation',     icon: 'menu'       as const, desc: 'Header and footer menus.' },
  { label: 'Collections',    icon: 'layers'     as const, desc: 'Group products into collections.' },
  { label: 'Domains',        icon: 'link'       as const, desc: 'Connect a custom domain.' },
  { label: 'Payments',       icon: 'credit-card'as const, desc: 'Accept payments from customers.' },
  { label: 'Shipping',       icon: 'truck'      as const, desc: 'Set rates and delivery zones.' },
  { label: 'Taxes',          icon: 'percent'    as const, desc: 'Tax rates and compliance.' },
  { label: 'Policies',       icon: 'shield'     as const, desc: 'Refund, privacy and terms.' },
  { label: 'SEO',            icon: 'search'     as const, desc: 'Search engine optimisation.' },
];

const THEME_COLORS = ['#39FF88', '#8B5CF6', '#3B82F6', '#EC4899', '#F97316', '#EF4444', '#FBBF24', '#06B6D4'];

export default function StoreBuilderScreen() {
  const insets  = useSafeAreaInsets();
  const router  = useRouter();
  const topPad  = Platform.OS === 'web' ? 20 : insets.top;

  const [activeTab, setActiveTab]     = useState<'overview' | 'theme' | 'sections'>('overview');
  const [sections,  setSections]      = useState(SECTIONS_DATA);
  const [accentColor, setAccentColor] = useState(THEME_COLORS[0]);

  function back() { router.back(); }

  function toggleSection(id: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSections(prev => prev.map(s => s.id === id ? { ...s, visible: !s.visible } : s));
  }

  function publishStore() {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert('Store Published', 'Your store is now live. Changes may take a moment to appear.', [{ text: 'OK' }]);
  }

  return (
    <View style={[s.root, { paddingTop: topPad }]}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={back}>
          <Feather name="arrow-left" size={20} color={FG} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Store Builder</Text>
          <View style={s.liveRow}>
            <View style={s.liveDot} />
            <Text style={s.liveText}>Live · brandthread.co/devonsbrand</Text>
          </View>
        </View>
        <TouchableOpacity style={s.publishBtn} onPress={publishStore} activeOpacity={0.85}>
          <Text style={s.publishText}>Publish</Text>
        </TouchableOpacity>
      </View>

      {/* Tab bar */}
      <View style={s.tabBar}>
        {(['overview', 'theme', 'sections'] as const).map(tab => (
          <TouchableOpacity
            key={tab}
            style={[s.tab, activeTab === tab && s.tabActive]}
            onPress={() => { setActiveTab(tab); Haptics.selectionAsync(); }}
            activeOpacity={0.8}
          >
            <Text style={[s.tabText, activeTab === tab && s.tabTextActive]}>
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, paddingBottom: 120, gap: 16 }}>

        {/* ── Overview tab ── */}
        {activeTab === 'overview' && (
          <>
            {/* Store preview card */}
            <LinearGradient
              colors={['#1A0B35', '#0A1540', '#070D1A']}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={s.previewCard}
            >
              <View style={s.previewMockup}>
                <View style={s.previewPhone}>
                  <View style={s.previewHeader} />
                  <View style={s.previewHero} />
                  <View style={s.previewGrid}>
                    {[0,1,2,3].map(i => <View key={i} style={s.previewProduct} />)}
                  </View>
                </View>
              </View>
              <View style={{ flex: 1, gap: 8 }}>
                <Text style={s.previewTitle}>Devon's Brand</Text>
                <Text style={s.previewUrl}>brandthread.co/devonsbrand</Text>
                <View style={s.previewStats}>
                  <View style={s.previewStat}>
                    <Text style={s.previewStatVal}>3,241</Text>
                    <Text style={s.previewStatLabel}>Visitors</Text>
                  </View>
                  <View style={s.previewStat}>
                    <Text style={s.previewStatVal}>1.5%</Text>
                    <Text style={s.previewStatLabel}>Conv.</Text>
                  </View>
                  <View style={s.previewStat}>
                    <Text style={s.previewStatVal}>$18.4K</Text>
                    <Text style={s.previewStatLabel}>Revenue</Text>
                  </View>
                </View>
                <TouchableOpacity style={s.previewBtn} onPress={() => {}} activeOpacity={0.85}>
                  <Text style={s.previewBtnText}>Preview Store</Text>
                  <Feather name="external-link" size={12} color={PURPLE} />
                </TouchableOpacity>
              </View>
            </LinearGradient>

            {/* Nav sections */}
            <View style={s.navCard}>
              {NAV_SECTIONS.map((item, i) => (
                <TouchableOpacity
                  key={item.label}
                  style={[s.navRow, i > 0 && s.navBorder]}
                  onPress={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}
                  activeOpacity={0.8}
                >
                  <View style={s.navIcon}>
                    <Feather name={item.icon} size={16} color={MUTED} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.navLabel}>{item.label}</Text>
                    <Text style={s.navDesc}>{item.desc}</Text>
                  </View>
                  <Feather name="chevron-right" size={15} color={MUTED} />
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}

        {/* ── Theme tab ── */}
        {activeTab === 'theme' && (
          <>
            <Text style={s.sectionTitle}>Brand accent colour</Text>
            <View style={s.colourRow}>
              {THEME_COLORS.map(c => (
                <TouchableOpacity
                  key={c}
                  style={[s.colourSwatch, { backgroundColor: c, borderWidth: accentColor === c ? 3 : 0, borderColor: FG }]}
                  onPress={() => { setAccentColor(c); Haptics.selectionAsync(); }}
                  activeOpacity={0.85}
                />
              ))}
            </View>

            {[
              { label: 'Logo',             icon: 'image'       as const, desc: 'Upload your brand logo' },
              { label: 'Typography',       icon: 'type'        as const, desc: 'Headings: Inter Bold · Body: Inter Regular' },
              { label: 'Button style',     icon: 'square'      as const, desc: 'Rounded · Filled' },
              { label: 'Product cards',    icon: 'grid'        as const, desc: '2-column grid with price and name' },
              { label: 'Announcement bar', icon: 'alert-circle'as const, desc: 'Free shipping on orders over $80' },
            ].map((item, i) => (
              <TouchableOpacity key={item.label} style={[s.themeRow, i > 0 && { marginTop: -1 }]} onPress={() => {}} activeOpacity={0.8}>
                <View style={s.themeIcon}><Feather name={item.icon} size={16} color={MUTED} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={s.themeLabel}>{item.label}</Text>
                  <Text style={s.themeDesc}>{item.desc}</Text>
                </View>
                <Feather name="chevron-right" size={15} color={MUTED} />
              </TouchableOpacity>
            ))}
          </>
        )}

        {/* ── Sections tab ── */}
        {activeTab === 'sections' && (
          <>
            <View style={s.sectHead}>
              <Text style={s.sectionTitle}>Homepage sections</Text>
              <TouchableOpacity
                style={s.addSectionBtn}
                onPress={() => Alert.alert('Add Section', 'Choose a section type to add to your homepage.')}
                activeOpacity={0.85}
              >
                <Feather name="plus" size={14} color={GREEN} />
                <Text style={s.addSectionText}>Add</Text>
              </TouchableOpacity>
            </View>

            <View style={s.navCard}>
              {sections.map((sec, i) => (
                <View key={sec.id} style={[s.sectionRow, i > 0 && s.navBorder]}>
                  <TouchableOpacity style={s.dragHandle}>
                    <Feather name="menu" size={14} color={MUTED} />
                  </TouchableOpacity>
                  <View style={[s.sectionIcon, { backgroundColor: sec.color + '20' }]}>
                    <Feather name={sec.icon} size={14} color={sec.color} />
                  </View>
                  <Text style={[s.sectionType, !sec.visible && { color: MUTED }]}>{sec.type}</Text>
                  <View style={s.sectionActions}>
                    <TouchableOpacity style={s.sectionBtn} onPress={() => {}}>
                      <Feather name="edit-2" size={13} color={MUTED} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={s.sectionBtn}
                      onPress={() => toggleSection(sec.id)}
                    >
                      <Feather name={sec.visible ? 'eye' : 'eye-off'} size={13} color={sec.visible ? GREEN : MUTED} />
                    </TouchableOpacity>
                    <TouchableOpacity style={s.sectionBtn} onPress={() => {}}>
                      <Feather name="trash-2" size={13} color={MUTED} />
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </View>

            <TouchableOpacity style={s.previewFullBtn} onPress={() => {}} activeOpacity={0.85}>
              <Feather name="eye" size={15} color={GREEN} />
              <Text style={s.previewFullText}>Preview full homepage</Text>
            </TouchableOpacity>
          </>
        )}

      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: BG },
  header:  { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  backBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  title:   { fontSize: 18, fontFamily: 'Inter_700Bold', color: FG },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: GREEN },
  liveText:{ fontSize: 11, fontFamily: 'Inter_400Regular', color: MUTED },
  publishBtn: { backgroundColor: GREEN, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  publishText:{ fontSize: 13, fontFamily: 'Inter_700Bold', color: '#0A0B0A' },

  tabBar:      { flexDirection: 'row', paddingHorizontal: 16, gap: 6, marginBottom: 4 },
  tab:         { flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, alignItems: 'center' },
  tabActive:   { backgroundColor: GREEN + '20', borderColor: GREEN },
  tabText:     { fontSize: 13, fontFamily: 'Inter_500Medium', color: MUTED },
  tabTextActive: { color: GREEN, fontFamily: 'Inter_700Bold' },

  previewCard:  { borderRadius: 18, padding: 16, flexDirection: 'row', gap: 16, borderWidth: 1, borderColor: PURPLE + '30' },
  previewPhone: { width: 70, height: 110, borderRadius: 10, backgroundColor: '#1A1C2A', overflow: 'hidden', gap: 4, padding: 6 },
  previewHeader:{ height: 8, backgroundColor: '#2A2C3A', borderRadius: 3 },
  previewHero:  { height: 36, backgroundColor: '#3A3C4A', borderRadius: 6 },
  previewGrid:  { flexDirection: 'row', flexWrap: 'wrap', gap: 3 },
  previewProduct:{ width: 24, height: 20, backgroundColor: '#2A2C3A', borderRadius: 3 },
  previewMockup:{ alignItems: 'center', justifyContent: 'center' },
  previewTitle: { fontSize: 15, fontFamily: 'Inter_700Bold', color: FG },
  previewUrl:   { fontSize: 11, fontFamily: 'Inter_400Regular', color: MUTED },
  previewStats: { flexDirection: 'row', gap: 12 },
  previewStat:  { gap: 2 },
  previewStatVal:{ fontSize: 13, fontFamily: 'Inter_700Bold', color: FG },
  previewStatLabel: { fontSize: 9, fontFamily: 'Inter_400Regular', color: MUTED },
  previewBtn:   { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: PURPLE + '20', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  previewBtnText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: PURPLE },

  navCard:    { backgroundColor: CARD, borderRadius: 16, borderWidth: 1, borderColor: BORDER, overflow: 'hidden' },
  navRow:     { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 13 },
  navBorder:  { borderTopWidth: 1, borderTopColor: BORDER },
  navIcon:    { width: 32, height: 32, borderRadius: 9, backgroundColor: '#1A1E1A', alignItems: 'center', justifyContent: 'center' },
  navLabel:   { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: FG },
  navDesc:    { fontSize: 11, fontFamily: 'Inter_400Regular', color: MUTED, marginTop: 1 },

  sectionTitle:{ fontSize: 16, fontFamily: 'Inter_700Bold', color: FG, marginBottom: 12 },
  colourRow:   { flexDirection: 'row', gap: 10, flexWrap: 'wrap', marginBottom: 20 },
  colourSwatch:{ width: 36, height: 36, borderRadius: 18 },

  themeRow:  { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: CARD, borderRadius: 12, borderWidth: 1, borderColor: BORDER, paddingHorizontal: 14, paddingVertical: 13 },
  themeIcon: { width: 32, height: 32, borderRadius: 9, backgroundColor: '#1A1E1A', alignItems: 'center', justifyContent: 'center' },
  themeLabel:{ fontSize: 14, fontFamily: 'Inter_600SemiBold', color: FG },
  themeDesc: { fontSize: 11, fontFamily: 'Inter_400Regular', color: MUTED, marginTop: 1 },

  sectHead:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  addSectionBtn:{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: GREEN + '18', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: GREEN + '33' },
  addSectionText:{ fontSize: 12, fontFamily: 'Inter_600SemiBold', color: GREEN },

  sectionRow:    { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
  dragHandle:    { padding: 4 },
  sectionIcon:   { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  sectionType:   { flex: 1, fontSize: 13, fontFamily: 'Inter_600SemiBold', color: FG },
  sectionActions:{ flexDirection: 'row', gap: 4 },
  sectionBtn:    { width: 28, height: 28, borderRadius: 7, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1A1E1A' },

  previewFullBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: GREEN + '15', borderRadius: 12, paddingVertical: 14, borderWidth: 1, borderColor: GREEN + '33' },
  previewFullText:{ fontSize: 14, fontFamily: 'Inter_600SemiBold', color: GREEN },
});
