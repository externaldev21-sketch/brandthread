/**
 * Studio Screen — Brandthread Creative Workspace
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  FlatList, Dimensions, Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { dismissTip, markFeatureOpened, getSetupState } from '@/lib/setupStore';
import {
  BG, SURFACE, CARD, CARD_ELEVATED, BORDER, BORDER_ACTIVE,
  FG, MUTED, SUBTLE, PURPLE, PURPLE_LIGHT, PURPLE_DIM,
  CYAN, CYAN_DIM, SUCCESS, BLUE, ORANGE, RED, GOLD,
  GRAD_PRIMARY, GRAD_CARD_GLOW,
  FONT, FS, SP, RADIUS, COMP, ICON, SHADOW_PURPLE,
} from '@/lib/theme';
import {
  BrandthreadScreen, BrandthreadCard, GradientCard, PrimaryButton,
  SecondaryButton, IconButton, SectionHeader, QuickActionCard,
  NavigationCard, EmptyState, GuidedTip, NewFeatureBadge, StatusBadge,
} from '@/components/BrandthreadUI';

// ─── Constants ────────────────────────────────────────────────────────────────

const DISMISSED_TIPS_KEY = '@brandthread/dismissed_tips';

const FILTER_CHIPS = ['All', 'Design', 'Content', 'AI', 'Photos'];

interface HeroTool {
  title: string;
  icon: keyof typeof Feather.glyphMap;
  accent: string;
  desc: string;
  badge?: boolean;
  route?: string;
}

const HERO_TOOLS: HeroTool[] = [
  { title: 'Design Studio',       icon: 'edit-3',   accent: PURPLE,  desc: 'Create product artwork',          badge: true, route: '/design' },
  { title: 'Create Content',      icon: 'video',    accent: CYAN,    desc: 'Film and edit Seller posts',      badge: true, route: '/create-post' },
  { title: 'AI Photoshoot',       icon: 'camera',   accent: BLUE,    desc: 'Generate product photos' },
  { title: 'Mockup to Model',     icon: 'user',     accent: ORANGE,  desc: 'Wear your design on a model' },
  { title: 'Remove Background',   icon: 'scissors', accent: SUCCESS, desc: 'Clean image backgrounds' },
  { title: 'Brand Kit',           icon: 'layers',   accent: GOLD,    desc: 'Logos, colors and fonts',                  route: '/brand' },
];

interface DemoProject {
  name: string;
  type: string;
  colors: [string, string];
}

const DEMO_PROJECTS: DemoProject[] = [
  { name: 'Summer Collection Mockup', type: 'Design',  colors: ['#8B5CF6', '#22D3EE'] },
  { name: 'Product Launch Video',     type: 'Content', colors: ['#22D3EE', '#3B82F6'] },
  { name: 'Hoodie AI Photo',          type: 'AI',      colors: ['#3B82F6', '#8B5CF6'] },
];

const TEMPLATES = [
  { label: 'Product Card',  colors: ['#8B5CF6', '#3B82F6'] as [string, string] },
  { label: 'Story Reel',    colors: ['#22D3EE', '#8B5CF6'] as [string, string] },
  { label: 'Lookbook',      colors: ['#F97316', '#F59E0B'] as [string, string] },
  { label: 'Launch Teaser', colors: ['#10B981', '#22D3EE'] as [string, string] },
];

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function StudioScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [activeFilter, setActiveFilter] = useState('All');
  const [dismissedTips, setDismissedTips] = useState<string[]>([]);
  const [openedFeatures, setOpenedFeatures] = useState<string[]>([]);

  // Load dismissed tips + opened features from setupStore / AsyncStorage
  useEffect(() => {
    (async () => {
      try {
        const state = await getSetupState();
        setDismissedTips(state.dismissedTips);
        setOpenedFeatures(state.openedFeatures);
      } catch {
        // fallback: read directly
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

  const handleToolPress = useCallback(async (tool: HeroTool) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // Mark feature as opened to clear "New" badge
    if (tool.badge) {
      await markFeatureOpened(tool.title);
      setOpenedFeatures(prev => [...prev, tool.title]);
    }
    if (tool.route) {
      router.push(tool.route as never);
    } else {
      Alert.alert('Coming Soon', `${tool.title} is coming soon!`);
    }
  }, [router]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* ── 1. HEADER ── */}
        <View style={styles.header}>
          <View>
            <Text style={styles.headerTitle}>Studio</Text>
            <Text style={styles.headerSubtitle}>Your creative workspace</Text>
          </View>
        </View>

        {/* ── 2. GUIDED TIP ── */}
        <GuidedTip
          id="studio-tip"
          text="Create designs, content and AI photos for your brand here. Only Seller posts can appear on the public Thread."
          dismissedIds={dismissedTips}
          onDismiss={handleDismissTip}
          style={styles.tip}
        />

        {/* ── 3. HERO TOOL CARDS ── */}
        <SectionHeader title="Start creating" style={styles.sectionHeader} />
        <View style={styles.toolGrid}>
          {HERO_TOOLS.map((tool) => (
            <GradientCard
              key={tool.title}
              colors={GRAD_CARD_GLOW}
              onPress={() => handleToolPress(tool)}
              style={[styles.toolCard, { borderColor: tool.accent + '44' }]}
            >
              {/* Icon + badge row */}
              <View style={styles.toolCardTop}>
                <View style={[styles.toolIconCircle, { backgroundColor: tool.accent + '18' }]}>
                  <Feather name={tool.icon} size={ICON.md} color={tool.accent} />
                </View>
                {tool.badge && (
                  <NewFeatureBadge
                    featureId={tool.title}
                    openedIds={openedFeatures}
                    style={styles.toolBadge}
                  />
                )}
              </View>
              {/* Title */}
              <Text style={styles.toolTitle}>{tool.title}</Text>
              {/* Desc */}
              <Text style={styles.toolDesc}>{tool.desc}</Text>
              {/* CTA */}
              <Text style={[styles.toolCta, { color: tool.accent }]}>Open →</Text>
            </GradientCard>
          ))}
        </View>

        {/* ── 4. FILTER CHIPS ── */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
          style={styles.filterScroll}
        >
          {FILTER_CHIPS.map((chip) => (
            <TouchableOpacity
              key={chip}
              onPress={() => {
                Haptics.selectionAsync();
                setActiveFilter(chip);
              }}
              style={[styles.filterChip, activeFilter === chip && styles.filterChipActive]}
              activeOpacity={0.8}
            >
              <Text style={[styles.filterChipText, activeFilter === chip && styles.filterChipTextActive]}>
                {chip}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* ── RECENT PROJECTS ── */}
        <SectionHeader
          title="Recent projects"
          action={{ label: 'View all', onPress: () => Alert.alert('Projects', 'Full project list coming soon.') }}
          style={styles.sectionHeader}
        />
        {DEMO_PROJECTS.map((proj) => (
          <BrandthreadCard
            key={proj.name}
            onPress={() => Alert.alert('Open Project', `Opening "${proj.name}"…`)}
            style={styles.projectCard}
          >
            <View style={styles.projectRow}>
              {/* Thumbnail */}
              <LinearGradient
                colors={proj.colors}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.projectThumb}
              />
              {/* Info */}
              <View style={styles.projectInfo}>
                <Text style={styles.projectName}>{proj.name}</Text>
                <View style={styles.projectMeta}>
                  <StatusBadge
                    label={proj.type}
                    variant={
                      proj.type === 'Design'  ? 'purple'  :
                      proj.type === 'Content' ? 'info'    :
                      proj.type === 'AI'      ? 'warning' : 'neutral'
                    }
                    small
                  />
                  <Text style={styles.projectAge}>3 days ago</Text>
                </View>
                <Text style={styles.projectCta}>Tap to open →</Text>
              </View>
            </View>
          </BrandthreadCard>
        ))}

        {/* ── 5. TEMPLATES ── */}
        <SectionHeader
          title="Templates"
          action={{ label: 'Browse all', onPress: () => Alert.alert('Templates', 'Full template library coming soon.') }}
          style={styles.sectionHeader}
        />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.templatesRow}
        >
          {TEMPLATES.map((tmpl) => (
            <TouchableOpacity
              key={tmpl.label}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                Alert.alert('Template', `Opening template: ${tmpl.label}`);
              }}
              activeOpacity={0.8}
            >
              <LinearGradient
                colors={tmpl.colors}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.templateCard}
              >
                <View style={styles.templateLabelWrap}>
                  <Text style={styles.templateLabel}>{tmpl.label}</Text>
                </View>
              </LinearGradient>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BG,
  },
  scrollContent: {
    paddingBottom: 160,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SP.md,
    paddingTop: SP.sm,
    paddingBottom: SP.md,
  },
  headerTitle: {
    fontSize: FS.xl,
    fontFamily: FONT.bold,
    color: PURPLE_LIGHT,
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    fontSize: FS.xs,
    fontFamily: FONT.medium,
    color: MUTED,
    marginTop: 2,
  },

  // Tip
  tip: {
    marginBottom: SP.md,
  },

  // Section header spacing
  sectionHeader: {
    marginTop: SP.lg,
    marginBottom: SP.sm,
  },

  // Hero tool grid
  toolGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    paddingHorizontal: SP.md,
  },
  toolCard: {
    width: '48%',
    padding: SP.md,
    gap: 12,
  },
  toolCardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  toolIconCircle: {
    width: 40,
    height: 40,
    borderRadius: RADIUS.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolBadge: {
    // positioned at top-right via the top row layout
  },
  toolTitle: {
    fontSize: FS.base,
    fontFamily: FONT.bold,
    color: FG,
    letterSpacing: -0.1,
  },
  toolDesc: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: MUTED,
    lineHeight: 16,
  },
  toolCta: {
    fontSize: FS.xs,
    fontFamily: FONT.semibold,
    marginTop: 2,
  },

  // Filter chips
  filterScroll: {
    marginTop: SP.lg,
  },
  filterRow: {
    flexDirection: 'row',
    gap: SP.sm,
    paddingHorizontal: SP.md,
    paddingBottom: SP.sm,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: RADIUS.pill,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
  },
  filterChipActive: {
    backgroundColor: PURPLE_DIM,
    borderColor: BORDER_ACTIVE,
  },
  filterChipText: {
    fontSize: FS.sm,
    fontFamily: FONT.medium,
    color: MUTED,
  },
  filterChipTextActive: {
    color: PURPLE_LIGHT,
    fontFamily: FONT.semibold,
  },

  // Project cards
  projectCard: {
    marginHorizontal: SP.md,
    marginBottom: SP.sm,
  },
  projectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.md,
  },
  projectThumb: {
    width: 56,
    height: 56,
    borderRadius: RADIUS.sm,
  },
  projectInfo: {
    flex: 1,
    gap: 4,
  },
  projectName: {
    fontSize: FS.base,
    fontFamily: FONT.bold,
    color: FG,
    letterSpacing: -0.1,
  },
  projectMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
  },
  projectAge: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: MUTED,
  },
  projectCta: {
    fontSize: FS.xs,
    fontFamily: FONT.medium,
    color: SUBTLE,
  },

  // Templates
  templatesRow: {
    flexDirection: 'row',
    gap: SP.sm,
    paddingHorizontal: SP.md,
    paddingBottom: SP.sm,
  },
  templateCard: {
    width: 90,
    height: 120,
    borderRadius: RADIUS.md,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  templateLabelWrap: {
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: SP.sm,
    paddingVertical: 5,
  },
  templateLabel: {
    fontSize: FS.xs,
    fontFamily: FONT.semibold,
    color: FG,
    textAlign: 'center',
  },
});
