/**
 * Discover — immersive, full-screen, TikTok-style swipeable "For You" feed.
 *
 * Separate route from the scrollable app/(buyer)/discover.tsx grid — reached
 * by pushing here from that screen's "For You" full-screen entry point via
 * useThreadPull().push('/(buyer)/discover-feed').
 *
 * All layout/data/animation logic lives in components/discover/DiscoverPager
 * so it stays unit-testable without expo-router in the loop.
 */
import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { DiscoverPager } from '@/components/discover/DiscoverPager';

export default function DiscoverFeedScreen() {
  return (
    <>
      <StatusBar style="light" />
      <DiscoverPager />
    </>
  );
}
