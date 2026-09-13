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
  title: 'Brandthread Woven',
  description: 'A fashion-commerce system built from thread, tension, tags, stitches, and editorial product imagery.',
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
      { id: 'colors', name: 'Color', description: 'Neutral charcoal, ember signature accent, and seller-scoped brand color.', Page: ColorsPage },
      { id: 'type', name: 'Typography', description: 'Condensed, confident editorial hierarchy.', Page: FontsPage },
      { id: 'layout', name: 'Layout', description: 'Tighter radii, deliberate spacing, full-bleed media.', Page: LayoutPage },
    ],
  },
  {
    name: 'Woven signatures',
    entries: [
      { id: 'woven-divider', name: 'Woven Divider', description: 'Stitched section separators.', Page: WovenDividerDemo },
      { id: 'thread-loader', name: 'Thread Loader', description: 'A line threads through the interface while work completes.', Page: ThreadLoaderDemo },
      { id: 'stitched-avatar', name: 'Stitched Avatar', description: 'Identity framed by a subtle sewn ring.', Page: StitchedAvatarDemo },
      { id: 'hang-tag', name: 'Hang-Tag Badge', description: 'Drop and live status as garment tags.', Page: HangTagBadgeDemo },
      { id: 'thread-tabs', name: 'Thread Tab Indicator', description: 'Navigation pulled toward the active destination.', Page: ThreadTabIndicatorDemo },
    ],
  },
];

export const ALL_ENTRIES = [OVERVIEW_ENTRY, ...NAV_GROUPS.flatMap((group) => group.entries)];