/**
 * Universal-link target for shared giveaways: https://brandthread.app/g/{CODE}
 * (lib/giveaways.ts SHARE_BASE_URL on the API). Forwards to the giveaway page,
 * which is guest-readable; entering is gated at the action (BT-319).
 */
import { useEffect } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { parseShareLink } from '@/lib/shareLinks';

export default function GiveawayLinkRedirect() {
  const router = useRouter();
  const { code } = useLocalSearchParams<{ code: string }>();

  useEffect(() => {
    const target = code ? parseShareLink(`/g/${encodeURIComponent(code)}`) : null;
    router.replace((target?.href ?? '/') as never);
  }, [code, router]);

  return null;
}
