/**
 * Buyer Threads Home header tabs: LIVE · Following · Threads, on the shared
 * underline SegmentedControl (same font, white active label + sliding
 * underline, dimmed inactive labels).
 *
 * Owns its own selected state so a tap re-renders only this row — the label
 * and underline react in the same frame — while the feed screen's much
 * heavier content swap runs afterwards in a transition (onChange is called
 * inside startTransition).
 */
import React, { memo, startTransition, useEffect, useState, useSyncExternalStore } from 'react';
import { SegmentedControl } from '@/components/ui/SegmentedControl';

export type HomeFeedTabId = 'live' | 'following' | 'for-you';

// The tab the header is showing, readable without re-rendering the feed
// screen: the LIVE body (LiveNowList) subscribes to this directly so it can
// cover/uncover the feed in the same frame as the tap.
let currentTab: HomeFeedTabId = 'for-you';
const listeners = new Set<() => void>();
function setCurrentTab(tab: HomeFeedTabId) {
  if (tab === currentTab) return;
  currentTab = tab;
  listeners.forEach(l => l());
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function useHomeFeedTab(): HomeFeedTabId {
  return useSyncExternalStore(subscribe, () => currentTab, () => currentTab);
}

const OPTIONS: { id: HomeFeedTabId; label: string }[] = [
  { id: 'live', label: 'LIVE' },
  { id: 'following', label: 'Following' },
  { id: 'for-you', label: 'Threads' },
];
// Watch Threads (seller): Following · Threads only (Dev: no LIVE there).
const OPTIONS_WITHOUT_LIVE = OPTIONS.filter(o => o.id !== 'live');

/** Always opens on Threads (the feed's own default tab). */
export const HomeFeedTabs = memo(function HomeFeedTabs({
  onChange, testID, withLive = true,
}: {
  onChange: (tab: HomeFeedTabId) => void;
  testID?: string;
  /** False drops the LIVE tab (Watch Threads). */
  withLive?: boolean;
}) {
  const [selected, setSelected] = useState<HomeFeedTabId>('for-you');
  // The next Home mount starts on Threads again, like the feed itself.
  useEffect(() => () => setCurrentTab('for-you'), []);
  return (
    <SegmentedControl
      variant="underline"
      size="compact"
      testID={testID}
      options={withLive ? OPTIONS : OPTIONS_WITHOUT_LIVE}
      selectedId={selected}
      onChange={(id) => {
        const next = id as HomeFeedTabId;
        setSelected(next);
        setCurrentTab(next);
        startTransition(() => onChange(next));
      }}
    />
  );
});
