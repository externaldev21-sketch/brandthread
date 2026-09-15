import type { AppThemePreset } from '@/contexts/AppThemeContext';
import type { Feather } from '@expo/vector-icons';
import {
  BLUE,
  BLUE_DIM,
  CYAN,
  CYAN_DIM,
  GOLD,
  ORANGE,
  ORANGE_DIM,
  PURPLE,
  PURPLE_DIM,
  PURPLE_LIGHT,
  SUCCESS,
  SUCCESS_DIM,
} from '@/lib/theme';

export interface GrowthTool {
  id: string;
  title: string;
  desc: string;
  icon: keyof typeof Feather.glyphMap;
  accent: string;
  accentDim: string;
}

/**
 * Temporary testing bypass. Keep all plan definitions and entitlement data
 * intact; set this back to true to restore Growth-plan enforcement.
 */
export const GROWTH_PLAN_ENFORCEMENT_ENABLED = false;

export type GrowthToolId = (typeof GROWTH_STUDIO_TOOLS)[number]['id'];

/**
 * Canonical list of Studio tools gated behind the Growth plan.
 *
 * Keep plan gating and the Growth upsell backed by this list so adding a
 * Growth-only tool cannot leave either surface out of sync.
 */
export const GROWTH_STUDIO_TOOLS = [
  {
    id: 'design-studio',
    title: 'Design Studio',
    desc: 'Create product artwork, graphics and custom designs.',
    icon: 'edit-3',
    accent: PURPLE,
    accentDim: PURPLE_DIM,
  },
  {
    id: 'ai-photoshoot',
    title: 'AI Photoshoot',
    desc: 'Generate product photos with AI.',
    icon: 'camera',
    accent: BLUE,
    accentDim: BLUE_DIM,
  },
  {
    id: 'mockup-to-model',
    title: 'Mockup to Model',
    desc: 'Wear your design on a model.',
    icon: 'user',
    accent: ORANGE,
    accentDim: ORANGE_DIM,
  },
  {
    id: 'remove-bg',
    title: 'Remove Background',
    desc: 'Remove backgrounds instantly.',
    icon: 'scissors',
    accent: SUCCESS,
    accentDim: SUCCESS_DIM,
  },
  {
    id: 'bg-replace',
    title: 'Background Replace',
    desc: 'Change or generate new backgrounds.',
    icon: 'image',
    accent: CYAN,
    accentDim: CYAN_DIM,
  },
  {
    id: 'ai-design',
    title: 'AI Design',
    desc: 'Describe your idea and create unique designs.',
    icon: 'zap',
    accent: PURPLE_LIGHT,
    accentDim: PURPLE_DIM,
  },
  {
    id: 'brand-assets',
    title: 'Brand Assets',
    desc: 'Access logos, colors, fonts and saved assets.',
    icon: 'layers',
    accent: GOLD,
    accentDim: '#3D2A0A',
  },
  {
    id: 'campaign-gen',
    title: 'Campaign Generator',
    desc: 'Generate marketing content and campaigns.',
    icon: 'trending-up',
    accent: '#F472B6',
    accentDim: '#4A1230',
  },
] as const satisfies readonly GrowthTool[];

type PlanTheme = Pick<
  AppThemePreset,
  'accent' | 'accentLight' | 'accentDim' | 'secondary' | 'secondaryDim'
>;

/**
 * Apply the active Brandthread theme to the shared definitions without
 * changing the canonical IDs or copy.
 */
export function getGrowthStudioTools(theme: PlanTheme): GrowthTool[] {
  return GROWTH_STUDIO_TOOLS.map((tool) => {
    switch (tool.id) {
      case 'design-studio':
        return { ...tool, accent: theme.accent, accentDim: theme.accentDim };
      case 'bg-replace':
        return { ...tool, accent: theme.secondary, accentDim: theme.secondaryDim };
      case 'ai-design':
        return { ...tool, accent: theme.accentLight, accentDim: theme.accentDim };
      default:
        return { ...tool };
    }
  });
}

/** Additional Growth perks shown after the Studio tool list. */
export const GROWTH_EXTRAS = [
  { icon: 'package' as const, label: 'Unlimited products' },
  { icon: 'globe' as const, label: 'Custom storefront + domain' },
  { icon: 'truck' as const, label: 'Manufacturer Hub access' },
  { icon: 'bar-chart-2' as const, label: 'Advanced sales analytics' },
];