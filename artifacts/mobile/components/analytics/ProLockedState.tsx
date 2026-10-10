import React from 'react';
import { useRouter } from 'expo-router';
import { EmptyState } from '@/components/BrandthreadUI';

/**
 * Shown in place of an advanced analytics module for sellers on Starter
 * (advanced analytics is on Growth and Pro in the server plan config).
 * Leads to the plans screen.
 */
export function ProLockedState({ source, title = 'Advanced analytics is on Growth' }: { source: string; title?: string }) {
  const router = useRouter();
  return (
    <EmptyState
      icon="lock"
      title={title}
      description="Upgrade to Growth to see customer cohorts, lifetime value and order value over time."
      action={{ label: 'See plans', icon: 'arrow-right', onPress: () => router.push(`/plans?source=${encodeURIComponent(source)}` as never) }}
    />
  );
}
