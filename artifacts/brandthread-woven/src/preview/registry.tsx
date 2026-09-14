import { lazy, type ComponentType } from 'react';
import { ColorsPage, FontsPage, LayoutPage, OverviewPage } from './foundations';

function lazyPage(load: () => Promise<ComponentType>) {
  return lazy(async () => ({ default: await load() }));
}

const WovenDividerDemo = lazyPage(() => import('./demos/woven-divider').then((m) => m.WovenDividerDemo));
const ThreadLoaderDemo = lazyPage(() => import('./demos/thread-loader').then((m) => m.ThreadLoaderDemo));
const StitchedAvatarDemo = lazyPage(() => import('./demos/stitched-avatar').then((m) => m.StitchedAvatarDemo));
const HangTagBadgeDemo = lazyPage(() => import('./demos/hang-tag-badge').then((m) => m.HangTagBadgeDemo));
const ThreadTabIndicatorDemo = lazyPage(() => import('./demos/thread-tab-indicator').then((m) => m.ThreadTabIndicatorDemo));

export type PreviewEntry = {
  id: string;
  name: string;
  description: string;
  Page: ComponentType;
};
export type NavGroup = { name: string; entries: PreviewEntry[] };

export const DESIGN_SYSTEM = {
  title: 'Brandthread',
  description: 'A true-black fashion-commerce system with bold sans typography and one confident blue-violet accent.',
} as const;

export const OVERVIEW_ENTRY: PreviewEntry = {
  id: 'overview',
  name: 'Overview',
  description: 'The definitive Brandthread visual language.',
  Page: OverviewPage,
};

export const NAV_GROUPS: NavGroup[] = [
  {
    name: 'Foundations',
    entries: [
      { id: 'colors', name: 'Color', description: 'True black, neutral graphite, and one saturated blue-violet accent.', Page: ColorsPage },
      { id: 'type', name: 'Typography', description: 'Bold, confident sans-serif hierarchy.', Page: FontsPage },
      { id: 'layout', name: 'Layout', description: 'Tighter radii, deliberate spacing, full-bleed media.', Page: LayoutPage },
    ],
  },
  {
    name: 'Primitives',
    entries: [
      { id: 'woven-divider', name: 'Divider', description: 'A restrained separator for dense information.', Page: WovenDividerDemo },
      { id: 'thread-loader', name: 'Loader', description: 'A simple accent progress indicator.', Page: ThreadLoaderDemo },
      { id: 'stitched-avatar', name: 'Avatar', description: 'Clean circular identity presentation.', Page: StitchedAvatarDemo },
      { id: 'hang-tag', name: 'Status Badge', description: 'Compact status and urgency labels.', Page: HangTagBadgeDemo },
      { id: 'thread-tabs', name: 'Tab Indicator', description: 'A clean accent marker for active navigation.', Page: ThreadTabIndicatorDemo },
    ],
  },
];

export const ALL_ENTRIES = [OVERVIEW_ENTRY, ...NAV_GROUPS.flatMap((group) => group.entries)];