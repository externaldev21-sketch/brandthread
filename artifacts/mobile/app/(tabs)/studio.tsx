/**
 * Studio Screen — Brandthread Creative Workspace
 * Responsive grid using useWindowDimensions() — no percentage widths.
 */

import React, { useState, useEffect, useCallback } from 'react';
import AIBrainFAB from '@/components/AIBrainFAB';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  useWindowDimensions, Alert, ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { dismissTip, markFeatureOpened, getSetupState } from '@/lib/setupStore';
import { getProjects } from '@/services/designService';
import { DesignProject, PROJECT_TYPE_LABELS, PROJECT_STATUS_LABELS } from '@/services/designTypes';
import {
  BG, SURFACE, CARD, CARD_ELEVATED, BORDER, BORDER_ACTIVE,
  FG, MUTED, SUBTLE, PURPLE, PURPLE_LIGHT, PURPLE_DIM,
  CYAN, CYAN_DIM, SUCCESS, SUCCESS_DIM, BLUE, BLUE_DIM,
  ORANGE, ORANGE_DIM, GOLD,
  GRAD_PRIMARY, GRAD_CARD_GLOW,
  FONT, FS, SP, RADIUS, ICON,
} from '@/lib/theme';
import {
  BrandthreadCard, GradientCard, PrimaryButton, SecondaryButton,
  SectionHeader, EmptyState, GuidedTip, NewFeatureBadge, StatusBadge,
} from '@/components/BrandthreadUI';

// ─── Layout constants ─────────────────────────────────────────────────────────

const H_PAD   = 16;   // horizontal page padding (each side)
const COL_GAP = 10;   // gap between columns
const ROW_GAP = 10;   // gap between rows

function getColumns(screenWidth: number): number {
  if (screenWidth >= 600) return 3;
  if (screenWidth >= 390) return 2;
  return 2; // never 1 unless truly tiny
}

function cardWidth(screenWidth: number, cols: number): number {
  const totalGap = COL_GAP * (cols - 1);
  return Math.floor((screenWidth - H_PAD * 2 - totalGap) / cols);
}

// ─── Tool definitions ─────────────────────────────────────────────────────────

interface StudioTool {
  id: string;
  title: string;
  desc: string;
  icon: keyof typeof Feather.glyphMap;
  accent: string;
  accentDim: string;
  route: string;
  badge?: boolean;
}

const STUDIO_TOOLS: StudioTool[] = [
  {
    id: 'design-studio',
    title: 'Design Studio',
    desc: 'Create product artwork, graphics and custom designs.',
    icon: 'edit-3',
    accent: PURPLE,
    accentDim: PURPLE_DIM,
    route: '/design',
    badge: true,
  },
  {
    id: 'go-live',
    title: 'Go Live',
    desc: 'Start a live shopping stream. Tag products and chat with viewers.',
    icon: 'radio',
    accent: '#FF3B30',
    accentDim: '#FF3B3020',
    route: '/seller-go-live',
    badge: true,
  },
  {
    id: 'create-content',
    title: 'Create Content',
    desc: 'Film and edit Seller posts and videos.',
    icon: 'video',
    accent: CYAN,
    accentDim: CYAN_DIM,
    route: '/create-post',
    badge: true,
  },
  {
    id: 'ai-photoshoot',
    title: 'AI Photoshoot',
    desc: 'Generate product photos with AI.',
    icon: 'camera',
    accent: BLUE,
    accentDim: BLUE_DIM,
    route: '/design-ai-photoshoot',
  },
  {
    id: 'mockup-to-model',
    title: 'Mockup to Model',
    desc: 'Wear your design on a model.',
    icon: 'user',
    accent: ORANGE,
    accentDim: ORANGE_DIM,
    route: '/design-mockup-to-model',
  },
  {
    id: 'remove-bg',
    title: 'Remove Background',
    desc: 'Remove backgrounds instantly.',
    icon: 'scissors',
    accent: SUCCESS,
    accentDim: SUCCESS_DIM,
    route: '/design-bg-removal',
  },
  {
    id: 'bg-replace',
    title: 'Background Replace',
    desc: 'Change or generate new backgrounds.',
    icon: 'image',
    accent: '#06B6D4',
    accentDim: '#0E4A56',
    route: '/design-bg-replace',
  },
  {
    id: 'ai-design',
    title: 'AI Design',
    desc: 'Describe your idea and create unique designs.',
    icon: 'zap',
    accent: '#A78BFA',
    accentDim: '#3B2A6E',
    route: '/design-text-to-design',
  },
  {
    id: 'brand-assets',
    title: 'Brand Assets',
    desc: 'Access logos, colors, fonts and saved assets.',
    icon: 'layers',
    accent: GOLD,
    accentDim: '#3D2A0A',
    route: '/design-brand-assets',
  },
  {
    id: 'campaign-gen',
    title: 'Campaign Generator',
    desc: 'Generate marketing content and campaigns.',
    icon: 'trending-up',
    accent: '#F472B6',
    accentDim: '#4A1230',
    route: '/design-campaign',
  },
];

const DEMO_PROJECTS = [
  { name: 'Summer Collection Mockup', type: 'Design',  colors: ['#8B5CF6', '#22D3EE'] as [string,string] },
  { name: 'Product Launch Video',     type: 'Content', colors: ['#22D3EE', '#3B82F6'] as [string,string] },
  { name: 'Hoodie AI Photo',          type: 'AI',      colors: ['#3B82F6', '#8B5CF6'] as [string,string] },
];

const TEMPLATES = [
  { label: 'T-Shirt',      colors: ['#7C3AED', '#4F46E5'] as [string,string] },
  { label: 'Hoodie',       colors: ['#0EA5E9', '#6366F1'] as [string,string] },
  { label: 'Product Card', colors: ['#8B5CF6', '#3B82F6'] as [string,string] },
  { label: 'Story Reel',   colors: ['#22D3EE', '#8B5CF6'] as [string,string] },
  { label: 'Lookbook',     colors: ['#F97316', '#F59E0B'] as [string,string] },
];

const DISMISSED_TIPS_KEY = '@brandthread/dismissed_tips';

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function StudioScreen() {
  const router   = useRouter();
  const insets   = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();

  const cols    = getColumns(windowWidth);
  const toolCardWidth = cardWidth(windowWidth, cols);

  const [dismissedTips,  setDismissedTips]  = useState<string[]>([]);
  const [openedFeatures, setOpenedFeatures] = useState<string[]>([]);
  const [projects,       setProjects]       = useState<DesignProject[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);

  // load design projects
  useEffect(() => {
    getProjects()
      .then(p => { setProjects(p.filter(x => x.status !== 'archived')); setLoadingProjects(false); })
      .catch(() => setLoadingProjects(false));
  }, []);

  // load dismissed tips
  useEffect(() => {
    (async () => {
      try {
        const state = await getSetupState();
        setDismissedTips(state.dismissedTips ?? []);
        setOpenedFeatures(state.openedFeatures ?? []);
      } catch {
        try {
          const raw = await AsyncStorage.getItem(DISMISSED_TIPS_KEY);
          if (raw) setDismissedTips(JSON.parse(raw));
        } catch { /* non-fatal */ }
      }
    })();
  }, []);

  const handleDismissTip = useCallback(async (id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await dismissTip(id);
    setDismissedTips(prev => [...prev, id]);
  }, []);

  const handleToolPress = useCallback(async (tool: StudioTool) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (tool.badge) {
      await markFeatureOpened(tool.id);
      setOpenedFeatures(prev => [...prev, tool.id]);
    }
    router.push(tool.route as never);
  }, [router]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll}>

        {/* ── HEADER ── */}
        <View style={s.header}>
          <View style={s.headerLeft}>
            <Text style={s.headerTitle}>Studio</Text>
            <Text style={s.headerSubtitle}>Your creative workspace</Text>
          </View>
          <TouchableOpacity
            style={s.myProjectsBtn}
            onPress={() => router.push('/design' as never)}
            activeOpacity={0.8}
          >
            <Feather name="folder" size={14} color={PURPLE_LIGHT} />
            <Text style={s.myProjectsBtnText}>My Projects</Text>
          </TouchableOpacity>
        </View>

        {/* ── INFO BANNER ── */}
        <LinearGradient
          colors={['#1E1040', '#0E1830']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={s.banner}
        >
          <Feather name="zap" size={16} color={PURPLE_LIGHT} />
          <Text style={s.bannerText}>
            AI-powered design tools and brand kit — all in one place.
          </Text>
        </LinearGradient>

        {/* ── GUIDED TIP ── */}
        <GuidedTip
          id="studio-tip"
          text="Create designs, content and AI photos for your brand here. Only Seller posts appear on the public Thread."
          dismissedIds={dismissedTips}
          onDismiss={handleDismissTip}
          style={s.tip}
        />

        {/* ── START CREATING GRID ── */}
        <View style={s.sectionHeader}>
          <Text style={s.sectionTitle}>Start creating</Text>
          <TouchableOpacity onPress={() => router.push('/design' as never)} activeOpacity={0.7}>
            <Text style={s.sectionAction}>New project →</Text>
          </TouchableOpacity>
        </View>

        {/* Responsive grid — pixel widths, no percentages */}
        <View style={[s.toolGrid, { paddingHorizontal: H_PAD }]}>
          {STUDIO_TOOLS.map((tool) => (
            <TouchableOpacity
              key={tool.id}
              activeOpacity={0.85}
              onPress={() => handleToolPress(tool)}
              style={[s.toolCard, { width: toolCardWidth, borderColor: tool.accent + '33' }]}
            >
              {/* Icon row */}
              <View style={s.toolCardTop}>
                <View style={[s.toolIconBg, { backgroundColor: tool.accentDim }]}>
                  <Feather name={tool.icon} size={ICON.sm} color={tool.accent} />
                </View>
                {tool.badge && (
                  <NewFeatureBadge
                    featureId={tool.id}
                    openedIds={openedFeatures}
                  />
                )}
              </View>
              {/* Labels */}
              <Text style={s.toolTitle} numberOfLines={1}>{tool.title}</Text>
              <Text style={s.toolDesc}>{tool.desc}</Text>
              <Text style={[s.toolCta, { color: tool.accent }]}>Open →</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── RECENT PROJECTS ── */}
        <View style={[s.sectionHeader, s.sectionHeaderTop]}>
          <Text style={s.sectionTitle}>Recent projects</Text>
          <TouchableOpacity onPress={() => router.push('/design' as never)} activeOpacity={0.7}>
            <Text style={s.sectionAction}>View all →</Text>
          </TouchableOpacity>
        </View>

        {loadingProjects ? (
          <View style={s.loadingRow}>
            <ActivityIndicator size="small" color={PURPLE} />
          </View>
        ) : projects.length > 0 ? (
          projects.slice(0, 4).map((proj) => {
            const variant: 'purple'|'success'|'info'|'warning'|'neutral' =
              proj.status === 'saved'             ? 'success' :
              proj.status === 'exported'          ? 'info'    :
              proj.status === 'sent_product'      ? 'purple'  :
              proj.status === 'sent_manufacturer' ? 'warning' : 'neutral';
            return (
              <TouchableOpacity
                key={proj.id}
                activeOpacity={0.85}
                onPress={() => router.push(`/design-canvas?id=${proj.id}` as never)}
                style={s.projCard}
              >
                <LinearGradient
                  colors={['#7C3AED', '#2563EB']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={s.projThumb}
                />
                <View style={s.projInfo}>
                  <Text style={s.projName} numberOfLines={1}>{proj.name}</Text>
                  <View style={s.projMeta}>
                    <StatusBadge label={PROJECT_STATUS_LABELS[proj.status]} variant={variant} small />
                    <Text style={s.projType}>{PROJECT_TYPE_LABELS[proj.type]}</Text>
                  </View>
                  <Text style={s.projCta}>Tap to open →</Text>
                </View>
                <Feather name="chevron-right" size={16} color={MUTED} />
              </TouchableOpacity>
            );
          })
        ) : DEMO_PROJECTS.map((proj) => (
          <TouchableOpacity
            key={proj.name}
            activeOpacity={0.85}
            onPress={() => router.push('/design' as never)}
            style={s.projCard}
          >
            <LinearGradient
              colors={proj.colors}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={s.projThumb}
            />
            <View style={s.projInfo}>
              <Text style={s.projName} numberOfLines={1}>{proj.name}</Text>
              <View style={s.projMeta}>
                <StatusBadge
                  label={proj.type}
                  variant={proj.type === 'Design' ? 'purple' : proj.type === 'Content' ? 'info' : 'warning'}
                  small
                />
                <Text style={s.projType}>3 days ago</Text>
              </View>
              <Text style={s.projCta}>Tap to open →</Text>
            </View>
            <Feather name="chevron-right" size={16} color={MUTED} />
          </TouchableOpacity>
        ))}

        {/* ── TEMPLATES ── */}
        <View style={[s.sectionHeader, s.sectionHeaderTop]}>
          <Text style={s.sectionTitle}>Templates</Text>
          <TouchableOpacity onPress={() => router.push('/design-templates' as never)} activeOpacity={0.7}>
            <Text style={s.sectionAction}>Browse all →</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.templatesRow}
        >
          {TEMPLATES.map((tmpl) => (
            <TouchableOpacity
              key={tmpl.label}
              activeOpacity={0.85}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push('/design-templates' as never);
              }}
            >
              <LinearGradient
                colors={tmpl.colors}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={s.templateCard}
              >
                <View style={s.templateLabelWrap}>
                  <Text style={s.templateLabel}>{tmpl.label}</Text>
                </View>
              </LinearGradient>
            </TouchableOpacity>
          ))}
        </ScrollView>

      </ScrollView>
      <AIBrainFAB context={{ screen: 'design_studio' as const }} bottomOffset={72} />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BG,
  },
  scroll: {
    paddingBottom: 120,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: H_PAD,
    paddingTop: SP.sm,
    paddingBottom: SP.md,
  },
  headerLeft: {
    gap: 2,
  },
  headerTitle: {
    fontSize: FS.xxl,
    fontFamily: FONT.bold,
    color: PURPLE_LIGHT,
    letterSpacing: -0.5,
  },
  headerSubtitle: {
    fontSize: FS.xs,
    fontFamily: FONT.medium,
    color: MUTED,
  },
  myProjectsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: RADIUS.pill,
    backgroundColor: PURPLE_DIM,
    borderWidth: 1,
    borderColor: PURPLE + '44',
  },
  myProjectsBtnText: {
    fontSize: FS.xs,
    fontFamily: FONT.semibold,
    color: PURPLE_LIGHT,
  },

  // Banner
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: H_PAD,
    marginBottom: SP.sm,
    paddingHorizontal: SP.md,
    paddingVertical: 10,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: PURPLE + '33',
  },
  bannerText: {
    flex: 1,
    fontSize: FS.xs,
    fontFamily: FONT.medium,
    color: PURPLE_LIGHT,
    lineHeight: 17,
  },

  // Tip
  tip: {
    marginHorizontal: H_PAD,
    marginBottom: SP.sm,
  },

  // Section header
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: H_PAD,
    marginBottom: SP.sm,
  },
  sectionHeaderTop: {
    marginTop: SP.xl,
  },
  sectionTitle: {
    fontSize: FS.base,
    fontFamily: FONT.bold,
    color: FG,
    letterSpacing: -0.1,
  },
  sectionAction: {
    fontSize: FS.xs,
    fontFamily: FONT.semibold,
    color: PURPLE_LIGHT,
  },

  // Tool grid — flex wrap with calculated pixel widths
  toolGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: COL_GAP,
    rowGap: ROW_GAP,
  },
  toolCard: {
    backgroundColor: CARD,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    padding: SP.md,
    gap: 8,
  },
  toolCardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  toolIconBg: {
    width: 36,
    height: 36,
    borderRadius: RADIUS.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolTitle: {
    fontSize: FS.sm,
    fontFamily: FONT.bold,
    color: FG,
    letterSpacing: -0.1,
  },
  toolDesc: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: MUTED,
    lineHeight: 16,
    flexShrink: 1,
  },
  toolCta: {
    fontSize: FS.xs,
    fontFamily: FONT.semibold,
    marginTop: 2,
  },

  // Loading
  loadingRow: {
    paddingVertical: SP.lg,
    alignItems: 'center',
  },

  // Project cards (full-width rows)
  projCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.md,
    marginHorizontal: H_PAD,
    marginBottom: 8,
    backgroundColor: CARD,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: BORDER,
    padding: SP.md,
  },
  projThumb: {
    width: 52,
    height: 52,
    borderRadius: RADIUS.sm,
    flexShrink: 0,
  },
  projInfo: {
    flex: 1,
    gap: 4,
  },
  projName: {
    fontSize: FS.sm,
    fontFamily: FONT.bold,
    color: FG,
    letterSpacing: -0.1,
  },
  projMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  projType: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: MUTED,
  },
  projCta: {
    fontSize: FS.xs,
    fontFamily: FONT.medium,
    color: SUBTLE,
  },

  // Templates horizontal scroll
  templatesRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: H_PAD,
    paddingBottom: SP.sm,
  },
  templateCard: {
    width: 96,
    height: 128,
    borderRadius: RADIUS.md,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  templateLabelWrap: {
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 6,
    paddingVertical: 5,
  },
  templateLabel: {
    fontSize: FS.xs,
    fontFamily: FONT.semibold,
    color: FG,
    textAlign: 'center',
  },
});
