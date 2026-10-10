import { GROWTH_UI_BYPASS } from '@/lib/buildFlags';
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
 * Growth-plan enforcement is ON by default and can only be bypassed in a
 * dev build (__DEV__, stripped to `false` in every production bundle) or
 * with an explicit `EXPO_PUBLIC_BT_GROWTH_BYPASS=1` build-time env var —
 * never a silent hardcoded `false` that ships to production (see
 * lib/__tests__/growthTools.test.ts for the CI assertion that production
 * config never sets the bypass var).
 *
 * This only controls the CLIENT UI's lock/upsell badges — it is not the
 * security boundary. The real gate is server-side: api-server's Growth-
 * gated routes (logo/mockup/photography/bg-removal/lifestyle/techpack,
 * manufacturer hub) require `requirePlan("growth")`/`requireGrowthSeller`
 * independent of this flag, so a paid feature is never reachable just
 * because a client build shipped with the bypass on.
 */
export const GROWTH_PLAN_ENFORCEMENT_ENABLED = !GROWTH_UI_BYPASS;

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
    title: 'Create Ad',
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
  { icon: 'package' as const, label: 'More active products' },
  { icon: 'globe' as const, label: 'Custom storefront + domain' },
  { icon: 'truck' as const, label: 'Manufacturer Hub access' },
  { icon: 'bar-chart-2' as const, label: 'Advanced sales analytics' },
];