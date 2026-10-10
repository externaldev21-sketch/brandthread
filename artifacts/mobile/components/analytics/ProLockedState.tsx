import React from 'react';
import { useRouter } from 'expo-router';
import { EmptyState } from '@/components/BrandthreadUI';
import { proUpgradeHref } from '@/lib/proPerks';

/**
 * Shown in place of a Brandthread Pro analytics module for sellers on a lower
 * plan. Leads to the existing plans screen with Pro preselected.
 */
export function ProLockedState({ source, title = 'Advanced analytics is a Pro feature' }: { source: string; title?: string }) {
  const router = useRouter();
  return (
    <EmptyState
      icon="lock"
      title={title}
      description="Upgrade to Brandthread Pro to see customer cohorts, lifetime value and order value over time."
      action={{ label: 'See Brandthread Pro', icon: 'arrow-right', onPress: () => router.push(proUpgradeHref(source) as never) }}
    />
  );
}
