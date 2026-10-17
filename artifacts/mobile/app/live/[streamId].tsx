/**
 * Shared live-stream link: https://brandthread.app/live/STREAM_ID (built by
 * live-feed.tsx's share action). Hands off to the LIVE pager, which already
 * lands on a specific stream via `?streamId=`.
 */
import React from 'react';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { liveDeepLinkHref } from '@/lib/live/liveDeepLink';

export default function LiveStreamDeepLink() {
  const { streamId } = useLocalSearchParams<{ streamId?: string }>();
  return <Redirect href={liveDeepLinkHref(streamId) as never} />;
}
