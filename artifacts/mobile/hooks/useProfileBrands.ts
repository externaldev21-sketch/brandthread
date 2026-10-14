/**
 * The brands row on a profile (components/profile/ProfileBrandsRow).
 *  - Anyone's profile: the brands this person is "Day 1" for (public).
 *  - Your own profile (`own`): also every brand you've bought from with your
 *    level there (Member / Insider / Inner Circle). Levels are only ever
 *    shown to you.
 */
import { useEffect, useState } from 'react';
import { useApi } from '@/lib/api';
import type { ProfileBrandItem } from '@/components/profile/ProfileBrandsRow';
import { LEVEL_LABEL } from '@/lib/membershipLevels';

export function useProfileBrands(userId?: string | null, own = false): ProfileBrandItem[] {
  const api = useApi();
  const [items, setItems] = useState<ProfileBrandItem[]>([]);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  useEffect(() => {
    if (!userId) { setItems([]); return; }
    let active = true;
    // Via resolved promises so a missing/mocked client becomes a quiet rejection, never a render error.
    const dayOne = Promise.resolve().then(() => api.dayOne.brands(userId)).then((r) => r.brands).catch(() => []);
    const levels = own
      ? Promise.resolve().then(() => api.brandMembership.mine()).then((r) => r.brands).catch(() => [])
      : Promise.resolve([] as Array<never>);
    Promise.all([dayOne, levels]).then(([d1, mine]) => {
      if (!active) return;
      const dayOneIds = new Set(d1.map((b) => b.sellerId));
      const out: ProfileBrandItem[] = [];
      // Highest level/spend first (the server orders by spend).
      for (const m of mine) {
        if (!m.level) continue;
        out.push({ sellerId: m.sellerId, name: m.name, avatarUrl: m.avatarUrl, tags: [LEVEL_LABEL[m.level], ...(dayOneIds.has(m.sellerId) ? ['Day 1'] : [])] });
      }
      const listed = new Set(out.map((b) => b.sellerId));
      for (const b of d1) {
        if (!listed.has(b.sellerId)) out.push({ sellerId: b.sellerId, name: b.name, avatarUrl: b.avatarUrl, tags: ['Day 1'] });
      }
      setItems(out);
      setLoadedFor(userId);
    });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, own]);
  return userId && userId === loadedFor ? items : [];
}
