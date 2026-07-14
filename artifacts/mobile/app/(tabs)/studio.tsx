import React, { useState } from 'react';
import {
  ScrollView, View, Text, TouchableOpacity, StyleSheet,
  Platform, RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { DEMO_DESIGN_PROJECTS } from '@/services/data';
import type { DesignProjectType } from '@/services/types';

// ─── Theme ────────────────────────────────────────────────────────────────────
const BG     = '#07080D';
const CARD   = '#0F1018';
const BORDER = '#1C1D28';
const FG     = '#F0F2F8';
const MUTED  = '#64718A';
const GREEN  = '#39FF88';
const PURPLE = '#8B5CF6';
const BLUE   = '#3B82F6';
const CYAN   = '#06B6D4';

// ─── Creation options ─────────────────────────────────────────────────────────

interface CreationOption {
  label:    string;
  desc:     string;
  icon:     keyof typeof Feather.glyphMap;
  color:    string;
  bg:       string;
  route:    string;
  badge?:   string;
}

const CREATION_OPTIONS: CreationOption[] = [
  { label: 'Blank Canvas',     desc: 'Start from scratch',           icon: 'square',      color: FG,     bg: '#1C1D28', route: '/design-canvas' },
  { label: 'Text to Design',   desc: 'Describe and generate',        icon: 'zap',         color: PURPLE, bg: '#2A1A4A', route: '/ai-studio', badge: 'AI' },
  { label: 'Upload Sketch',    desc: 'Trace your drawing',           icon: 'edit-3',      color: CYAN,   bg: '#0E2830', route: '/design-canvas' },
  { label: 'Upload Garment',   desc: 'Place graphics on a blank',    icon: 'upload',      color: BLUE,   bg: '#0E1B30', route: '/design-canvas' },
  { label: 'Mockup to Model',  desc: 'AI model photoshoot',          icon: 'user',        color: '#F472B6', bg: '#2A0D22', route: '/ai-studio', badge: 'AI' },
  { label: 'AI Photoshoot',    desc: 'Studio-quality shots',         icon: 'camera',      color: '#FBBF24', bg: '#2A200A', route: '/ai-studio', badge: 'AI' },
  { label: 'Remove BG',        desc: 'Clean product cutouts',        icon: 'scissors',    color: GREEN,  bg: '#0D2420', route: '/bg-removal' },
  { label: 'Edit with Prompt', desc: 'Describe changes to make',     icon: 'message-square', color: '#F97316', bg: '#2A1508', route: '/ai-studio', badge: 'AI' },
  { label: 'Manual Design',    desc: 'Full drawing tools',           icon: 'pen-tool',    color: BLUE,   bg: '#0E1B30', route: '/design-canvas' },
];

// ─── Template categories ──────────────────────────────────────────────────────

const TEMPLATE_CATS = ['T-Shirts', 'Hoodies', 'Sweatpants', 'Jackets', 'Hats', 'Bags', 'Packaging', 'Social'];

const PROJECT_FILTERS: Array<{ id: string; label: string }> = [
  { id: 'all',        label: 'All' },
  { id: 'design',     label: 'Designs' },
  { id: 'mockup',     label: 'Mockups' },
  { id: 'photoshoot', label: 'Photoshoots' },
  { id: 'draft',      label: 'Drafts' },
];

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function StudioScreen() {
  const insets    = useSafeAreaInsets();
  const router    = useRouter();
  const [filter,  setFilter]  = useState('all');
  const [refresh, setRefresh] = useState(false);

  const topPad = Platform.OS === 'web' ? 20 : insets.top;

  function go(route: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(route as never);
  }

  const projects = DEMO_DESIGN_PROJECTS.filter(p =>
    filter === 'all' || p.type === filter as DesignProjectType,
  );

  const statusColor = (s: string) =>
    s === 'complete' ? GREEN : s === 'in_progress' ? CYAN : MUTED;

  const typeIcon = (t: string): keyof typeof Feather.glyphMap =>
    t === 'mockup' ? 'image' : t === 'photoshoot' ? 'camera' : t === 'draft' ? 'file-text' : 'pen-tool';

  function onRefresh() {
    setRefresh(true);
    setTimeout(() => setRefresh(false), 800);
  }

  return (
    <View style={[s.root, { paddingTop: topPad }]}>
      {/* Header */}
      <View style={s.header}>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Studio</Text>
          <Text style={s.subtitle}>Create without limits.</Text>
        </View>
        <TouchableOpacity style={s.projectsBtn} onPress={() => go('/ai-studio')} activeOpacity={0.8}>
          <Feather name="folder" size={16} color={GREEN} />
          <Text style={s.projectsBtnText}>Projects</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={refresh} onRefresh={onRefresh} tintColor={GREEN} />}
      >
        {/* ── Hero gradient banner ── */}
        <LinearGradient
          colors={['#1A0B35', '#0A1540', '#070D1A']}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={s.heroBanner}
        >
          <View style={{ flex: 1 }}>
            <Text style={s.heroTitle}>Turn any idea into a product.</Text>
            <Text style={s.heroDesc}>AI-powered design, mockups and photoshoots in one place.</Text>
            <TouchableOpacity
              style={s.heroBtn}
              onPress={() => go('/design-canvas')}
              activeOpacity={0.85}
            >
              <Feather name="plus" size={14} color="#0A0B0A" />
              <Text style={s.heroBtnText}>New Creation</Text>
            </TouchableOpacity>
          </View>
          <View style={s.heroDeco}>
            <Feather name="pen-tool" size={56} color={PURPLE} style={{ opacity: 0.4 }} />
          </View>
        </LinearGradient>

        {/* ── Creation options ── */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Start creating</Text>
          <View style={s.optionGrid}>
            {CREATION_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt.label}
                style={s.optionCard}
                onPress={() => go(opt.route)}
                activeOpacity={0.8}
              >
                {opt.badge && (
                  <View style={[s.aiBadge, { backgroundColor: opt.color + 'CC' }]}>
                    <Text style={s.aiBadgeText}>{opt.badge}</Text>
                  </View>
                )}
                <View style={[s.optionIcon, { backgroundColor: opt.bg }]}>
                  <Feather name={opt.icon} size={18} color={opt.color} />
                </View>
                <Text style={s.optionLabel}>{opt.label}</Text>
                <Text style={s.optionDesc}>{opt.desc}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* ── Recent projects ── */}
        <View style={s.section}>
          <View style={s.sectionHead}>
            <Text style={s.sectionTitle}>Recent projects</Text>
            <TouchableOpacity onPress={() => go('/ai-studio')}>
              <Text style={s.viewAll}>View All</Text>
            </TouchableOpacity>
          </View>

          {/* Filter chips */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
            <View style={s.chipRow}>
              {PROJECT_FILTERS.map((f) => (
                <TouchableOpacity
                  key={f.id}
                  style={[s.chip, filter === f.id && s.chipActive]}
                  onPress={() => { setFilter(f.id); Haptics.selectionAsync(); }}
                  activeOpacity={0.8}
                >
                  <Text style={[s.chipText, filter === f.id && s.chipTextActive]}>{f.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>

          {projects.length === 0 ? (
            <View style={s.emptyCard}>
              <Feather name="folder" size={28} color={MUTED} />
              <Text style={s.emptyText}>No projects yet</Text>
              <Text style={s.emptyDesc}>Create your first design to get started.</Text>
            </View>
          ) : (
            projects.map((proj) => (
              <TouchableOpacity
                key={proj.id}
                style={s.projectRow}
                onPress={() => go('/design-canvas')}
                activeOpacity={0.8}
              >
                <View style={s.projectThumb}>
                  <Feather name={typeIcon(proj.type)} size={18} color={MUTED} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.projectName}>{proj.name}</Text>
                  <Text style={s.projectMeta}>{proj.type.charAt(0).toUpperCase() + proj.type.slice(1)} · Edited {proj.lastEdited}</Text>
                </View>
                <View style={[s.statusDot, { backgroundColor: statusColor(proj.status) }]} />
                <Feather name="chevron-right" size={15} color={MUTED} style={{ marginLeft: 6 }} />
              </TouchableOpacity>
            ))
          )}
        </View>

        {/* ── Templates ── */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Templates</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {TEMPLATE_CATS.map((cat) => (
                <TouchableOpacity
                  key={cat}
                  style={s.templateCard}
                  onPress={() => go('/design-canvas')}
                  activeOpacity={0.8}
                >
                  <View style={s.templateIcon}>
                    <Feather name="tag" size={20} color={MUTED} />
                  </View>
                  <Text style={s.templateLabel}>{cat}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </View>

        {/* ── Quick tools ── */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Quick tools</Text>
          <View style={s.quickRow}>
            {[
              { icon: 'image'    as const, label: 'Mockups',  color: PURPLE, route: '/ai-studio' },
              { icon: 'camera'   as const, label: 'Photoshoot', color: CYAN, route: '/ai-studio' },
              { icon: 'scissors' as const, label: 'Remove BG', color: GREEN, route: '/bg-removal' },
              { icon: 'file-text'as const, label: 'Tech Pack', color: BLUE,  route: '/tech-pack-generator' },
            ].map((t) => (
              <TouchableOpacity key={t.label} style={s.quickCard} onPress={() => go(t.route)} activeOpacity={0.8}>
                <View style={[s.quickIcon, { backgroundColor: t.color + '22' }]}>
                  <Feather name={t.icon} size={18} color={t.color} />
                </View>
                <Text style={s.quickLabel}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: BG },
  header: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 20, paddingBottom: 14, paddingTop: 6, gap: 12 },
  title:  { fontSize: 28, fontFamily: 'Inter_700Bold', color: FG },
  subtitle: { fontSize: 13, fontFamily: 'Inter_400Regular', color: MUTED, marginTop: 2 },
  projectsBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: GREEN + '18', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: GREEN + '30' },
  projectsBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: GREEN },

  heroBanner: { marginHorizontal: 16, borderRadius: 20, padding: 22, flexDirection: 'row', alignItems: 'center', overflow: 'hidden', borderWidth: 1, borderColor: PURPLE + '30', marginBottom: 8 },
  heroTitle:  { fontSize: 18, fontFamily: 'Inter_700Bold', color: FG, marginBottom: 6, letterSpacing: -0.3 },
  heroDesc:   { fontSize: 12, fontFamily: 'Inter_400Regular', color: MUTED, marginBottom: 16, lineHeight: 18 },
  heroBtn:    { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: GREEN, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9, alignSelf: 'flex-start' },
  heroBtnText:{ fontSize: 13, fontFamily: 'Inter_700Bold', color: '#0A0B0A' },
  heroDeco:   { width: 80, alignItems: 'center', justifyContent: 'center' },

  section:      { paddingHorizontal: 16, marginTop: 24 },
  sectionHead:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sectionTitle: { fontSize: 16, fontFamily: 'Inter_700Bold', color: FG, marginBottom: 12 },
  viewAll:      { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: GREEN },

  optionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  optionCard: {
    width: '30.5%', backgroundColor: CARD, borderRadius: 14, borderWidth: 1, borderColor: BORDER,
    padding: 12, gap: 8, overflow: 'hidden',
  },
  aiBadge:     { position: 'absolute', top: 8, right: 8, borderRadius: 5, paddingHorizontal: 5, paddingVertical: 2 },
  aiBadgeText: { fontSize: 9, fontFamily: 'Inter_700Bold', color: '#0A0B0A' },
  optionIcon:  { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  optionLabel: { fontSize: 12, fontFamily: 'Inter_700Bold', color: FG },
  optionDesc:  { fontSize: 10, fontFamily: 'Inter_400Regular', color: MUTED, lineHeight: 14 },

  chipRow:     { flexDirection: 'row', gap: 8, paddingLeft: 0 },
  chip:        { backgroundColor: CARD, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7, borderWidth: 1, borderColor: BORDER },
  chipActive:  { backgroundColor: GREEN + '22', borderColor: GREEN },
  chipText:    { fontSize: 12, fontFamily: 'Inter_500Medium', color: MUTED },
  chipTextActive: { color: GREEN },

  projectRow:  { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: BORDER },
  projectThumb:{ width: 44, height: 44, borderRadius: 10, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  projectName: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: FG },
  projectMeta: { fontSize: 11, fontFamily: 'Inter_400Regular', color: MUTED, marginTop: 2 },
  statusDot:   { width: 6, height: 6, borderRadius: 3 },

  emptyCard: { alignItems: 'center', paddingVertical: 32, gap: 8 },
  emptyText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: FG },
  emptyDesc: { fontSize: 12, fontFamily: 'Inter_400Regular', color: MUTED },

  templateCard:  { width: 96, backgroundColor: CARD, borderRadius: 14, borderWidth: 1, borderColor: BORDER, alignItems: 'center', paddingVertical: 16, gap: 8 },
  templateIcon:  { width: 40, height: 40, borderRadius: 10, backgroundColor: '#1C1D28', alignItems: 'center', justifyContent: 'center' },
  templateLabel: { fontSize: 11, fontFamily: 'Inter_500Medium', color: MUTED, textAlign: 'center' },

  quickRow:  { flexDirection: 'row', gap: 10 },
  quickCard: { flex: 1, backgroundColor: CARD, borderRadius: 14, borderWidth: 1, borderColor: BORDER, alignItems: 'center', paddingVertical: 16, gap: 8 },
  quickIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  quickLabel:{ fontSize: 11, fontFamily: 'Inter_500Medium', color: MUTED, textAlign: 'center' },
});
