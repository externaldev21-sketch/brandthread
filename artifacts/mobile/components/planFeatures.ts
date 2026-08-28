import type { AppThemePreset } from '@/contexts/AppThemeContext';
import { BLUE, BLUE_DIM, GOLD, ORANGE, ORANGE_DIM, SUCCESS, SUCCESS_DIM } from '@/lib/theme';

export interface GrowthTool {
  id: string;
  title: string;
  desc: string;
  icon: keyof typeof import('@expo/vector-icons').Feather.glyphMap;
  accent: string;
  accentDim: string;
}

type PlanTheme = Pick<AppThemePreset, 'accent' | 'accentLight' | 'accentDim' | 'secondary' | 'secondaryDim'>;

/** Growth-only Studio tools shown in both the upsell and subscription comparison. */
export const getGrowthStudioTools = (theme: PlanTheme): GrowthTool[] => [
  {
    id: 'design-studio',
    title: 'Design Studio',
    desc: 'Create product artwork, graphics and custom designs.',
    icon: 'edit-3',
    accent: theme.accent,
    accentDim: theme.accentDim,
  },
  {
    id: 'ai-photoshoot',
    title: 'AI Photoshoot',
    desc: 'Generate professional product photos with AI.',
    icon: 'camera',
    accent: BLUE,
    accentDim: BLUE_DIM,
  },
  {
    id: 'mockup-to-model',
    title: 'Mockup to Model',
    desc: 'Place your design on a realistic model.',
    icon: 'user',
    accent: ORANGE,
    accentDim: ORANGE_DIM,
  },
  {
    id: 'remove-bg',
    title: 'Remove Background',
    desc: 'Remove product backgrounds in one tap.',
    icon: 'scissors',
    accent: SUCCESS,
    accentDim: SUCCESS_DIM,
  },
  {
    id: 'bg-replace',
    title: 'Background Replace',
    desc: 'Swap or generate stunning new backgrounds.',
    icon: 'image',
    accent: theme.secondary,
    accentDim: theme.secondaryDim,
  },
  {
    id: 'ai-design',
    title: 'AI Design',
    desc: 'Describe your idea and watch unique designs appear.',
    icon: 'zap',
    accent: theme.accentLight,
    accentDim: theme.accentDim,
  },
  {
    id: 'brand-assets',
    title: 'Brand Assets',
    desc: 'Store and access logos, colors, fonts and saved assets.',
    icon: 'layers',
    accent: GOLD,
    accentDim: '#3D2A0A',
  },
  {
    id: 'campaign-gen',
    title: 'Campaign Generator',
    desc: 'Generate full marketing content and campaigns.',
    icon: 'trending-up',
    accent: '#F472B6',
    accentDim: '#4A1230',
  },
];

/** Additional Growth perks shown after the Studio tool list. */
export const GROWTH_EXTRAS = [
  { icon: 'package' as const, label: 'Unlimited products' },
  { icon: 'globe' as const, label: 'Custom storefront + domain' },
  { icon: 'truck' as const, label: 'Manufacturer Hub access' },
  { icon: 'bar-chart-2' as const, label: 'Advanced sales analytics' },
];