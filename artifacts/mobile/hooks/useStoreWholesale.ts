import { useEffect, useState } from 'react';
import { useApi } from '@/lib/api';
import { isBuyerDevPreview, isPreviewDemoMode, isSellerDevPreview } from '@/lib/devPreview';

/**
 * Whether a store offers wholesale pricing (public endpoint, no sign-in
 * needed). Stays false until the answer arrives, and always false in the
 * signed-out web preview unless &demo=1, which never calls the API.
 */
export function useStoreWholesale(sellerId: string | null | undefined): boolean {
  const api = useApi();
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    if (!sellerId) { setEnabled(false); return; }
    if (isBuyerDevPreview() || isSellerDevPreview()) { setEnabled(isPreviewDemoMode()); return; }
    let active = true;
    api.wholesale.store(sellerId).then(info => { if (active) setEnabled(info.enabled); }).catch(() => {});
    return () => { active = false; };
  }, [api, sellerId]);
  return enabled;
}
