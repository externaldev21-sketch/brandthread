import React from 'react';
import { SegmentTabs } from '@/components/reframe';

export type DiscoverFilterKey = 'forYou' | 'fits' | 'brands' | 'people' | 'drops';

export const DISCOVER_FILTERS: Array<{ key: DiscoverFilterKey; label: string }> = [
  { key: 'forYou', label: 'For You' },
  { key: 'fits', label: 'Fits' },
  { key: 'brands', label: 'Brands' },
  { key: 'people', label: 'People' },
  { key: 'drops', label: 'Drops' },
];

const TABS = DISCOVER_FILTERS.map((filter) => ({
  key: filter.key,
  label: filter.label,
  accessibilityLabel: `${filter.label} filter`,
  testID: `discover-filter-${filter.key}`,
}));

/**
 * Discover's filter row — X-style text tabs (the shared reframe
 * SegmentTabs): bold white label + short white underline on the active
 * filter, gray labels otherwise, one hairline under the row, scrolling on
 * the 16pt gutter. Same five filters as before.
 */
export function DiscoverFilterRow({
  active,
  onChange,
}: {
  active: DiscoverFilterKey;
  onChange: (key: DiscoverFilterKey) => void;
}) {
  return <SegmentTabs tabs={TABS} value={active} onChange={onChange} scrollable testID="discover-filter-row" />;
}
