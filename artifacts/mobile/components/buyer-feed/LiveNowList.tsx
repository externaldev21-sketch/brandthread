/** The header's LIVE tab mounts the shared show directory in place. */
import React from 'react';
import { useHomeFeedTab } from './HomeFeedTabs';
import { LiveShowsGrid } from '@/components/live/LiveShowsGrid';
import { useOpenLive } from '@/lib/live/useLiveDirectory';

export function LiveNowList(props: {
  active: boolean;
  topInset: number;
  bottomInset: number;
  pageWidth: number;
}) {
  const openLive = useOpenLive();
  return useHomeFeedTab() === 'live' ? <LiveShowsGrid
    active={props.active}
    topInset={props.topInset}
    bottomInset={props.bottomInset}
    onOpenShow={stream => openLive({ streamId: stream.id, hostId: stream.host.id })}
  /> : null;
}
