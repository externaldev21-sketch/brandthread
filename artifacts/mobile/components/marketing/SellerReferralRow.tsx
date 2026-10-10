import React, { useCallback, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { ListRow } from '@/components/ui/ListRow';
import { useApi } from '@/lib/api';
import { isPreviewDemoMode } from '@/lib/devPreview';

/**
 * "Refer a brand" in Marketing → Growth (BT-313). Renders nothing until the
 * server says the program is on (SELLER_REFERRAL_ENABLED=true), so the
 * Growth list looks exactly as before while it's off.
 */
export function SellerReferralRow() {
  const api = useApi();
  const router = useRouter();
  const [state, setState] = useState<{ enabled: boolean; freeMonths: number }>({ enabled: isPreviewDemoMode(), freeMonths: 1 });

  useFocusEffect(useCallback(() => {
    if (isPreviewDemoMode()) return;
    let cancelled = false;
    api.sellerReferrals.overview()
      .then((r) => { if (!cancelled) setState(r.enabled ? { enabled: true, freeMonths: r.freeMonths } : { enabled: false, freeMonths: 1 }); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [api]));

  if (!state.enabled) return null;
  return (
    <ListRow
      icon="gift"
      title="Refer a brand"
      subtitle={state.freeMonths === 1 ? 'You both get a free month' : `You both get ${state.freeMonths} free months`}
      chevron
      onPress={() => router.push('/seller-refer' as never)}
    />
  );
}
