/** The signed-in buyer's highest membership level with any brand (null when none / signed out). */
import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/expo';
import { useApi } from '@/lib/api';
import type { MembershipLevel } from '@/lib/api';
import { bestLevel } from '@/lib/unlockableIcons';

export function useBestMembershipLevel(): MembershipLevel | null {
  const api = useApi();
  const { userId } = useAuth();
  const [best, setBest] = useState<MembershipLevel | null>(null);
  useEffect(() => {
    if (!userId) { setBest(null); return; }
    let active = true;
    Promise.resolve().then(() => api.brandMembership.mine())
      .then((r) => { if (active) setBest(bestLevel(r.brands.map((b) => b.level))); })
      .catch(() => { if (active) setBest(null); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);
  return best;
}
