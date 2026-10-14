/**
 * The brands row on a profile (components/profile/ProfileBrandsRow): the
 * brands this person is "Day 1" for. Public, so it shows on anyone's profile.
 */
import { useEffect, useState } from 'react';
import { useApi } from '@/lib/api';
import type { ProfileBrandItem } from '@/components/profile/ProfileBrandsRow';

export function useProfileBrands(userId?: string | null): ProfileBrandItem[] {
  const api = useApi();
  const [items, setItems] = useState<ProfileBrandItem[]>([]);
  useEffect(() => {
    if (!userId) { setItems([]); return; }
    let active = true;
    // Via a resolved promise so a missing/mocked client becomes a quiet rejection, never a render error.
    Promise.resolve().then(() => api.dayOne.brands(userId))
      .then((r) => {
        if (!active) return;
        setItems(r.brands.map((b) => ({ sellerId: b.sellerId, name: b.name, avatarUrl: b.avatarUrl, tags: ['Day 1'] })));
      })
      .catch(() => { if (active) setItems([]); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);
  return items;
}
