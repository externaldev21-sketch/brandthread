/**
 * Brandthread Design Studio — Home Screen
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, ActivityIndicator, FlatList,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import {
  BG, SURFACE, CARD, CARD_ELEVATED,
  BORDER, BORDER_SUBTLE,
  FG, MUTED, SUBTLE,
  SUCCESS, SUCCESS_DIM, BLUE, BLUE_DIM, ORANGE, ORANGE_DIM,
  GOLD,
  FONT, FS, SP, RADIUS, ICON,
} from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import {
  BrandthreadScreen, BrandthreadHeader, BrandthreadCard,
  PrimaryButton, SecondaryButton, FilterChip, StatusBadge,
  SectionHeader, EmptyState,
} from '@/components/BrandthreadUI';
import { getProjects, deleteProject, duplicateProject, archiveProject, updateProject, exportProject } from '@/services/designService';
import {
  DesignProject, PROJECT_TYPE_LABELS, PROJECT_STATUS_LABELS,
  GARMENT_TEMPLATES, DesignProjectType, DesignProjectStatus,
} from '@/services/designTypes';

// ─── Creation type cards ──────────────────────────────────────────────────────

type CreationCard = {
  icon: string;
  label: string;
  desc: string;
  accent: string;
  route: string;
};

const creationCards = (theme: ReturnType<typeof useAppTheme>['theme']): CreationCard[] => [
  { icon: 'edit-2',      label: 'Blank Canvas',        desc: 'Start from scratch',              accent: theme.accent,       route: '/design-project?type=canvas' },
  { icon: 'layers',      label: 'Garment Design',       desc: 'Design any apparel piece',        accent: theme.secondary,         route: '/design-project?type=garment' },
  { icon: 'zap',         label: 'AI Design',            desc: 'Generate from a prompt',          accent: BLUE,         route: '/design-text-to-design' },
  { icon: 'box',         label: 'Product Mockup',        desc: 'Realistic product visuals',       accent: ORANGE,       route: '/design-project?type=mockup' },
  { icon: 'camera',      label: 'AI Photoshoot',        desc: 'AI model & scene photography',    accent: theme.accentLight, route: '/design-ai-photoshoot' },
  { icon: 'trending-up', label: 'Campaign',             desc: 'Multi-format content kit',        accent: SUCCESS,      route: '/design-campaign' },
  { icon: 'scissors',    label: 'Background Removal',   desc: 'Clean cutouts instantly',         accent: GOLD,         route: '/design-bg-removal' },
];

// ─── AI tools quick row ───────────────────────────────────────────────────────

type AITool = { icon: string; label: string; route: string; accent: string };

const aiTools = (theme: ReturnType<typeof useAppTheme>['theme']): AITool[] => [
  { icon: 'zap',         label: 'Text to Design',     route: '/design-text-to-design',   accent: BLUE },
  { icon: 'upload',      label: 'Upload Sketch',       route: '/design-sketch-upload',    accent: theme.accent },
  { icon: 'image',       label: 'Mockup to Model',     route: '/design-mockup-model',     accent: theme.secondary },
  { icon: 'edit',        label: 'Edit with Prompt',    route: '/design-prompt-edit',      accent: ORANGE },
  { icon: 'refresh-cw',  label: 'Replace BG',          route: '/design-bg-replace',       accent: SUCCESS },
];

// ─── Filter chips ─────────────────────────────────────────────────────────────

type FilterKind = 'all' | 'garment' | 'mockup' | 'campaign' | 'draft' | 'archived';

const FILTERS: { key: FilterKind; label: string }[] = [
  { key: 'all',      label: 'All' },
  { key: 'garment',  label: 'Designs' },
  { key: 'mockup',   label: 'Mockups' },
  { key: 'campaign', label: 'Campaigns' },
  { key: 'draft',    label: 'Drafts' },
  { key: 'archived', label: 'Archived' },
];

// ─── Template quick cards ─────────────────────────────────────────────────────

const quickTemplates = (theme: ReturnType<typeof useAppTheme>['theme']) => [
  { label: 'T-Shirt',      garmentType: 'tshirt',     accent: theme.accent,      route: '/design-project?type=garment&garmentType=tshirt' },
  { label: 'Hoodie',       garmentType: 'hoodie',     accent: theme.secondary,        route: '/design-project?type=garment&garmentType=hoodie' },
  { label: 'Sweatshirt',   garmentType: 'sweatshirt', accent: BLUE,        route: '/design-project?type=garment&garmentType=sweatshirt' },
  { label: 'Hat',          garmentType: 'hat',        accent: GOLD,        route: '/design-project?type=garment&garmentType=hat' },
  { label: 'Bag',          garmentType: 'bag',        accent: SUCCESS,     route: '/design-project?type=garment&garmentType=bag' },
  { label: 'Product Card', garmentType: null,         accent: ORANGE,      route: '/design-project?type=mockup' },
  { label: 'Social Post',  garmentType: null,         accent: theme.accentLight,route: '/design-project?type=social' },
  { label: 'Story',        garmentType: null,         accent: theme.secondary,        route: '/design-project?type=social' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function typeAccent(type: DesignProjectType, theme: ReturnType<typeof useAppTheme>['theme']): string {
  switch (type) {
    case 'garment':   return theme.accent;
    case 'canvas':    return theme.secondary;
    case 'mockup':    return ORANGE;
    case 'campaign':  return BLUE;
    case 'social':    return theme.accentLight;
    case 'packaging': return GOLD;
    default:          return theme.accent;
  }
}

function statusVariant(status: DesignProjectStatus): 'success' | 'warning' | 'neutral' | 'error' | 'purple' {
  switch (status) {
    case 'saved':              return 'success';
    case 'exported':           return 'purple';
    case 'sent_product':       return 'success';
    case 'sent_manufacturer':  return 'purple';
    case 'archived':           return 'neutral';
    default:                   return 'warning';
  }
}

function filterProjects(projects: DesignProject[], filter: FilterKind): DesignProject[] {
  switch (filter) {
    case 'garment':  return projects.filter(p => p.type === 'garment' || p.type === 'canvas');
    case 'mockup':   return projects.filter(p => p.type === 'mockup');
    case 'campaign': return projects.filter(p => p.type === 'campaign' || p.type === 'social');
    case 'draft':    return projects.filter(p => p.status === 'draft');
    case 'archived': return projects.filter(p => p.status === 'archived');
    default:         return projects;
  }
}

// ─── Project Card ─────────────────────────────────────────────────────────────

interface ProjectCardProps {
  project: DesignProject;
  onOpen: () => void;
  onMore: () => void;
}

function ProjectCard({ project, onOpen, onMore }: ProjectCardProps) {
  const { theme } = useAppTheme();
  const accent = typeAccent(project.type, theme);
  return (
    <TouchableOpacity style={styles.projectCard} onPress={onOpen} activeOpacity={0.82}>
      <LinearGradient
        colors={[accent + '33', accent + '11']}
        style={styles.projectThumbnail}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <Feather
          name={project.type === 'garment' ? 'layers' : project.type === 'campaign' ? 'trending-up' : project.type === 'mockup' ? 'box' : 'edit-2'}
          size={ICON.xl}
          color={accent}
        />
      </LinearGradient>
      <View style={styles.projectInfo}>
        <Text style={styles.projectName} numberOfLines={1}>{project.name}</Text>
        <Text style={styles.projectType}>{PROJECT_TYPE_LABELS[project.type]}</Text>
        <View style={styles.projectMeta}>
          <StatusBadge
            label={PROJECT_STATUS_LABELS[project.status]}
            variant={statusVariant(project.status)}
            small
          />
          <Text style={styles.projectTime}>{timeAgo(project.updatedAt)}</Text>
        </View>
      </View>
      <TouchableOpacity style={styles.moreBtn} onPress={onMore} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
        <Feather name="more-horizontal" size={ICON.md} color={MUTED} />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function DesignScreen() {
  const { theme } = useAppTheme();
  const creationCardItems = creationCards(theme);
  const aiToolItems = aiTools(theme);
  const quickTemplateItems = quickTemplates(theme);
  const router = useRouter();
  const [projects, setProjects] = useState<DesignProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKind>('all');

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getProjects();
      setProjects(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  function handleMore(project: DesignProject) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert(project.name, undefined, [
      { text: 'Open', onPress: () => router.push(`/design-canvas?id=${project.id}`) },
      {
        text: 'Rename', onPress: () => Alert.prompt(
          'Rename Project', 'New name:',
          async (name) => { if (!name?.trim()) return; await updateProject(project.id, { name: name.trim() }); loadData(); },
          'plain-text', project.name,
        ),
      },
      {
        text: 'Duplicate', onPress: async () => {
          await duplicateProject(project.id);
          loadData();
        },
      },
      {
        text: 'Archive', onPress: async () => {
          await archiveProject(project.id);
          loadData();
        },
      },
      {
        text: 'Delete', style: 'destructive', onPress: () =>
          Alert.alert('Delete project?', 'This cannot be undone.', [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Delete', style: 'destructive', onPress: async () => {
                await deleteProject(project.id);
                loadData();
              },
            },
          ]),
      },
      {
        text: 'Export',
        onPress: () => exportProject(project.id, 'png')
          .then(() => Alert.alert('Exported', 'Design saved to your device.'))
          .catch(() => Alert.alert('Export failed', 'Could not export. Please try again.')),
      },
      { text: 'Create product', onPress: () => router.push(('/add-product?designId=' + project.id) as never) },
      { text: 'Send to manufacturer', onPress: () => router.push(('/manufacturer-hub?designId=' + project.id) as never) },
      { text: 'Create Seller post', onPress: () => router.push('/create-post') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  const filtered = filterProjects(projects, filter);

  return (
    <BrandthreadScreen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Header */}
        <BrandthreadHeader
          title="Design Studio"
          onBack={() => router.back()}
          gradient
        />

        {/* Hero */}
        <View style={styles.hero}>
          <Text style={styles.heroHeading}>Design your next drop.</Text>
          <Text style={styles.heroSubtitle}>
            From sketch to product visual to campaign content — all from your phone.
          </Text>
          <PrimaryButton
            label="Create new project"
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); router.push('/design-project'); }}
            icon="plus"
          />
        </View>

        {/* Creation type grid */}
        <View style={styles.sectionLabel}>
          <Text style={styles.sectionTitle}>Start creating</Text>
        </View>
        <View style={styles.grid}>
          {creationCardItems.map(card => (
            <TouchableOpacity
              key={card.label}
              style={[styles.creationCard, { borderColor: card.accent + '33' }]}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push(card.route as any); }}
              activeOpacity={0.8}
            >
              <View style={[styles.creationIcon, { backgroundColor: card.accent + '22' }]}>
                <Feather name={card.icon as any} size={ICON.lg} color={card.accent} />
              </View>
              <Text style={styles.creationLabel}>{card.label}</Text>
              <Text style={styles.creationDesc}>{card.desc}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* AI Tools quick row */}
        <View style={styles.sectionLabel}>
          <Text style={styles.sectionTitle}>AI Tools</Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pillRow}>
          {aiToolItems.map(tool => (
            <TouchableOpacity
              key={tool.label}
              style={[styles.aiPill, { borderColor: tool.accent + '44', backgroundColor: tool.accent + '14' }]}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push(tool.route as any); }}
              activeOpacity={0.8}
            >
              <Feather name={tool.icon as any} size={ICON.sm} color={tool.accent} />
              <Text style={[styles.aiPillLabel, { color: tool.accent }]}>{tool.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Recent Projects */}
        <View style={styles.sectionLabel}>
          <Text style={styles.sectionTitle}>Recent projects</Text>
        </View>

        {/* Filter chips */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          {FILTERS.map(f => (
            <FilterChip
              key={f.key}
              label={f.label}
              active={filter === f.key}
              onPress={() => setFilter(f.key)}
            />
          ))}
        </ScrollView>

        {/* Project list */}
        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={theme.accent} size="large" />
          </View>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon="edit-3"
            title="No projects yet."
            description="Start a garment design, mockup, or campaign and it'll live here."
            action={{ label: 'Start a project', onPress: () => router.push('/design-project') }}
          />
        ) : (
          filtered.map(project => (
            <ProjectCard
              key={project.id}
              project={project}
              onOpen={() => router.push(`/design-canvas?id=${project.id}` as any)}
              onMore={() => handleMore(project)}
            />
          ))
        )}

        {/* Templates section */}
        <SectionHeader
          title="Templates"
          action={{ label: 'View all', onPress: () => router.push('/design-templates' as any) }}
          style={styles.templateHeader}
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.templateRow}>
          {quickTemplateItems.map((tmpl, idx) => (
            <TouchableOpacity
              key={idx}
              style={styles.templateCard}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push(tmpl.route as any); }}
              activeOpacity={0.8}
            >
              <LinearGradient
                colors={[tmpl.accent + '44', tmpl.accent + '11']}
                style={styles.templateThumb}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
              >
                <Feather name="layers" size={ICON.lg} color={tmpl.accent} />
              </LinearGradient>
              <Text style={styles.templateLabel}>{tmpl.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <View style={styles.bottomPad} />
      </ScrollView>
    </BrandthreadScreen>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  scroll: {
    paddingBottom: 120,
  },
  hero: {
    paddingHorizontal: SP.lg,
    paddingTop: SP.md,
    paddingBottom: SP.lg,
    gap: SP.sm,
  },
  heroHeading: {
    fontFamily: FONT.bold,
    fontSize: FS.h2,
    color: FG,
    lineHeight: 36,
  },
  heroSubtitle: {
    fontFamily: FONT.regular,
    fontSize: FS.base,
    color: MUTED,
    lineHeight: 22,
    marginBottom: SP.sm,
  },
  sectionLabel: {
    paddingHorizontal: SP.lg,
    paddingTop: SP.lg,
    paddingBottom: SP.sm,
  },
  sectionTitle: {
    fontFamily: FONT.semibold,
    fontSize: FS.base,
    color: FG,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: SP.md,
    gap: SP.sm,
  },
  creationCard: {
    width: '47%',
    backgroundColor: CARD,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    padding: SP.md,
    gap: SP.xs,
  },
  creationIcon: {
    width: 44,
    height: 44,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SP.xs,
  },
  creationLabel: {
    fontFamily: FONT.semibold,
    fontSize: FS.sm,
    color: FG,
  },
  creationDesc: {
    fontFamily: FONT.regular,
    fontSize: FS.xs,
    color: MUTED,
  },
  pillRow: {
    paddingHorizontal: SP.lg,
    gap: SP.sm,
    paddingBottom: SP.xs,
  },
  aiPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
  },
  aiPillLabel: {
    fontFamily: FONT.medium,
    fontSize: FS.sm,
  },
  filterRow: {
    paddingHorizontal: SP.lg,
    gap: SP.sm,
    paddingBottom: SP.sm,
  },
  loadingBox: {
    paddingVertical: 48,
    alignItems: 'center',
  },
  projectCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CARD,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: BORDER,
    marginHorizontal: SP.lg,
    marginBottom: SP.sm,
    overflow: 'hidden',
  },
  projectThumbnail: {
    width: 72,
    height: 72,
    alignItems: 'center',
    justifyContent: 'center',
  },
  projectInfo: {
    flex: 1,
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
    gap: 3,
  },
  projectName: {
    fontFamily: FONT.semibold,
    fontSize: FS.base,
    color: FG,
  },
  projectType: {
    fontFamily: FONT.regular,
    fontSize: FS.xs,
    color: MUTED,
  },
  projectMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    marginTop: 2,
  },
  projectTime: {
    fontFamily: FONT.regular,
    fontSize: FS.xs,
    color: SUBTLE,
  },
  moreBtn: {
    paddingHorizontal: SP.md,
    paddingVertical: SP.lg,
  },
  templateHeader: {
    marginTop: SP.lg,
  },
  templateRow: {
    paddingHorizontal: SP.lg,
    gap: SP.sm,
    paddingBottom: SP.xs,
  },
  templateCard: {
    width: 110,
    alignItems: 'center',
    gap: SP.xs,
  },
  templateThumb: {
    width: 110,
    height: 80,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  templateLabel: {
    fontFamily: FONT.medium,
    fontSize: FS.xs,
    color: MUTED,
    textAlign: 'center',
  },
  bottomPad: {
    height: SP.xl,
  },
});
