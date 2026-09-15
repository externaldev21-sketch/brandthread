/**
 * Studio Screen — Brandthread Creative Workspace
 * Responsive grid using useWindowDimensions() — no percentage widths.
 */

import React, { useState, useEffect, useCallback } from 'react';
import AIBrainFAB from '@/components/AIBrainFAB';
import PlanUpsellModal from '@/components/PlanUpsellModal';
import { useSubscriptionPlan } from '@/hooks/useSubscriptionPlan';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, useWindowDimensions, Alert, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { markFeatureOpened, getSetupState } from '@/lib/setupStore';
import { getProjects } from '@/services/designService';
import { DesignProject, PROJECT_TYPE_LABELS, PROJECT_STATUS_LABELS } from '@/services/designTypes';
import { BG, SCREEN_BG, SURFACE, CARD, CARD_ELEVATED, BORDER, BORDER_ACTIVE, FG, MUTED, SUBTLE, ORANGE, ORANGE_DIM, GRAD_CARD_GLOW, FONT, FS, SP, RADIUS, ICON, PURPLE, PURPLE_LIGHT, PURPLE_DIM, CYAN, CYAN_DIM } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { BrandthreadCard, GradientCard, PrimaryButton, SecondaryButton, SectionHeader, EmptyState, NewFeatureBadge, StatusBadge, LockBadge } from '@/components/BrandthreadUI';
import { GROWTH_PLAN_ENFORCEMENT_ENABLED, GROWTH_STUDIO_TOOLS, type GrowthTool, type GrowthToolId } from '@/lib/growthTools';

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

/** Tool IDs that require a Growth (or higher) subscription to use. */
const GROWTH_REQUIRED_TOOLS = new Set<string>(GROWTH_STUDIO_TOOLS.map((tool) => tool.id));

interface StudioTool extends GrowthTool {
  route: string;
  badge?: boolean;
}

const GROWTH_TOOL_ROUTES: Record<GrowthToolId, string> = {
  'design-studio': '/design',
  'ai-photoshoot': '/design-ai-photoshoot',
  'mockup-to-model': '/design-mockup-to-model',
  'remove-bg': '/design-bg-removal',
  'bg-replace': '/design-bg-replace',
  'ai-design': '/design-text-to-design',
  'brand-assets': '/design-brand-assets',
  'campaign-gen': '/design-campaign',
};

const GROWTH_STUDIO_TOOL_CARDS: StudioTool[] = GROWTH_STUDIO_TOOLS.map((tool) => ({
  ...tool,
  route: GROWTH_TOOL_ROUTES[tool.id],
  badge: tool.id === 'design-studio' || undefined,
}));

const STANDARD_STUDIO_TOOLS: StudioTool[] = [
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
];

const STUDIO_TOOLS: StudioTool[] = [
  ...GROWTH_STUDIO_TOOL_CARDS.slice(0, 1),
  ...STANDARD_STUDIO_TOOLS,
  ...GROWTH_STUDIO_TOOL_CARDS.slice(1),
];

const TEMPLATES = [
  { label: 'T-Shirt',      colors: ['#0EA5E9', '#1D4ED8'] as [string,string] },
  { label: 'Hoodie',       colors: ['#0EA5E9', '#6366F1'] as [string,string] },
  { label: 'Product Card', colors: ['#0F766E', '#3B82F6'] as [string,string] },
  { label: 'Story Reel',   colors: ['#5B5CFF', '#5B5CFF'] as [string,string] },
  { label: 'Lookbook',     colors: ['#F97316', '#F59E0B'] as [string,string] },
];

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function StudioScreen() {
  const { theme } = useAppTheme();
  const { accent: PURPLE, accentLight: PURPLE_LIGHT, accentDim: PURPLE_DIM, secondary: CYAN, secondaryDim: CYAN_DIM } = theme;
  const router   = useRouter();
  const insets   = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();

  const cols    = getColumns(windowWidth);
  const toolCardWidth = cardWidth(windowWidth, cols);

  const { hasPlan, loading: planLoading, error: planError, retry: retryPlan } = useSubscriptionPlan();

  const [openedFeatures, setOpenedFeatures] = useState<string[]>([]);
  const [projects,       setProjects]       = useState<DesignProject[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [projectsError,  setProjectsError]  = useState<string | null>(null);

  // Plan upsell state
  const [upsellVisible,  setUpsellVisible]  = useState(false);
  const [upsellFeature,  setUpsellFeature]  = useState('');

  useFocusEffect(
    useCallback(() => {
      return () => {
        setUpsellVisible(false);
        setUpsellFeature('');
      };
    }, []),
  );

  // load design projects
  const loadProjects = useCallback(() => {
    setLoadingProjects(true);
    setProjectsError(null);
    getProjects()
      .then(p => {
        setProjects(p.filter(x => x.status !== 'archived'));
        setProjectsError(null);
      })
      .catch(() => {
        setProjectsError('Could not load projects. Tap to retry.');
      })
      .finally(() => setLoadingProjects(false));
  }, []);

  useEffect(() => { loadProjects(); }, [loadProjects]);

  // load opened feature state
  useEffect(() => {
    (async () => {
      try {
        const state = await getSetupState();
        setOpenedFeatures(state.openedFeatures ?? []);
      } catch { /* non-fatal */ }
    })();
  }, []);

  const handleToolPress = useCallback(async (tool: StudioTool) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // Gate Growth-only tools for Starter sellers
    if (
      GROWTH_PLAN_ENFORCEMENT_ENABLED &&
      GROWTH_REQUIRED_TOOLS.has(tool.id) &&
      (planLoading || !!planError || !hasPlan('growth'))
    ) {
      if (planError) retryPlan();
      setUpsellFeature(tool.title);
      setUpsellVisible(true);
      return;
    }

    router.push(tool.route as never);
    if (tool.badge) {
      setOpenedFeatures(prev => [...prev, tool.id]);
      void markFeatureOpened(tool.id).catch(() => {});
    }
  }, [router, hasPlan, planError, planLoading, retryPlan]);

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

        {planError && (
          <TouchableOpacity
            style={s.planErrorBanner}
            onPress={retryPlan}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Could not load plan. Tap to retry."
          >
            <Feather name="alert-circle" size={ICON.sm} color={ORANGE} />
            <Text style={s.planErrorText}>Could not load plan — tap to retry</Text>
            <Feather name="refresh-cw" size={ICON.sm} color={ORANGE} />
          </TouchableOpacity>
        )}

        {/* ── START CREATING GRID ── */}
        <View style={s.sectionHeader}>
          <Text style={s.sectionTitle}>Start creating</Text>
          <TouchableOpacity onPress={() => router.push('/design' as never)} activeOpacity={0.7}>
            <Text style={s.sectionAction}>New project →</Text>
          </TouchableOpacity>
        </View>

        {/* Responsive grid — pixel widths, no percentages */}
        <View style={[s.toolGrid, { paddingHorizontal: H_PAD }]}>
          {STUDIO_TOOLS.map((tool) => {
            const isLocked =
              GROWTH_PLAN_ENFORCEMENT_ENABLED &&
              !planLoading &&
              !planError &&
              GROWTH_REQUIRED_TOOLS.has(tool.id) &&
              !hasPlan('growth');
            const toolAccent = tool.id === 'ai-design' ? theme.accentLight : tool.accent;
            const toolAccentDim = tool.id === 'ai-design' ? theme.accentDim : tool.accentDim;
            return (
              <TouchableOpacity
                key={tool.id}
                activeOpacity={0.85}
                onPress={() => handleToolPress(tool)}
                style={[s.toolCard, { width: toolCardWidth, borderColor: toolAccent + '33' }]}
              >
                {/* Icon row */}
                <View style={s.toolCardTop}>
                  <View style={[s.toolIconBg, { backgroundColor: toolAccentDim }]}>
                    <Feather name={tool.icon} size={ICON.sm} color={toolAccent} />
                  </View>
                  {isLocked ? (
                    <LockBadge locked />
                  ) : tool.badge ? (
                    <NewFeatureBadge
                      featureId={tool.id}
                      openedIds={openedFeatures}
                    />
                  ) : null}
                </View>
                {/* Labels */}
                <Text style={s.toolTitle} numberOfLines={1}>{tool.title}</Text>
                <Text style={s.toolDesc}>{tool.desc}</Text>
                <Text style={[s.toolCta, { color: isLocked ? MUTED : toolAccent }]}>
                  {isLocked ? 'Growth plan →' : 'Open →'}
                </Text>
              </TouchableOpacity>
            );
          })}
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
        ) : projectsError ? (
          <TouchableOpacity
            style={s.projErrorRow}
            activeOpacity={0.8}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); loadProjects(); }}
          >
            <Feather name="alert-circle" size={16} color={ORANGE} />
            <Text style={s.projErrorText}>{projectsError}</Text>
            <Feather name="refresh-cw" size={14} color={ORANGE} />
          </TouchableOpacity>
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
                  colors={theme.primaryGradient}
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
        ) : (
          <TouchableOpacity
            style={s.projEmptyRow}
            activeOpacity={0.8}
            onPress={() => router.push('/design' as never)}
          >
            <Feather name="folder" size={20} color={MUTED} style={{ marginRight: SP.sm }} />
            <Text style={s.projEmptyText}>No projects yet — tap to create your first</Text>
            <Feather name="chevron-right" size={14} color={MUTED} />
          </TouchableOpacity>
        )}

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
      {/* Plan upsell modal — shown when Starter seller taps a Growth-only tool */}
      <PlanUpsellModal
        visible={upsellVisible}
        featureName={upsellFeature}
        requiredPlan="growth"
        onClose={() => setUpsellVisible(false)}
        onUpgrade={() => {
          setUpsellVisible(false);
          router.push('/subscription' as never);
        }}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: SCREEN_BG,
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
  planErrorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    marginHorizontal: H_PAD,
    marginBottom: SP.sm,
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
    borderRadius: RADIUS.md,
    backgroundColor: '#2B1E0F',
    borderWidth: 1,
    borderColor: ORANGE,
  },
  planErrorText: {
    flex: 1,
    fontSize: FS.sm,
    fontFamily: FONT.medium,
    color: ORANGE,
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

  // Project error row
  projErrorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    marginHorizontal: H_PAD,
    marginBottom: 8,
    backgroundColor: ORANGE_DIM,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: ORANGE + '44',
    padding: SP.md,
  },
  projErrorText: {
    flex: 1,
    fontSize: FS.sm,
    fontFamily: FONT.medium,
    color: ORANGE,
  },

  // Project empty row
  projEmptyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: H_PAD,
    marginBottom: 8,
    backgroundColor: CARD,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: BORDER,
    padding: SP.md,
  },
  projEmptyText: {
    flex: 1,
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    color: MUTED,
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
