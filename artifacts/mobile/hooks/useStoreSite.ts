/**
 * The seller's store as the app shows it: the profile from /api/growth/bio
 * (or the preview fixtures in the signed-out web preview — services/
 * growthService never calls the API there) and its product blocks, mapped to
 * the StoreSitePreview model. My Store passes its own blocks; elsewhere
 * (Share store sheet) the bio's tiles stand in as Callout cards.
 */
import { useCallback, useEffect, useState } from 'react';

import { getBio, type BioPage } from '@/services/growthService';
import type { StoreSiteCard, StoreSiteView } from '@/components/store/StoreSitePreview';
import { storeSiteTheme } from '@/lib/storeSiteDesign';
import { defaultButtonText } from '@/lib/storeBlocks';

const SOCIAL_ORDER = ['instagram', 'tiktok', 'youtube', 'x', 'facebook', 'website', 'email'];

export function storeSiteViewFromBio(page: BioPage, blocks?: StoreSiteCard[]): StoreSiteView {
  return {
    handle: page.username ?? null,
    displayName: page.displayName ?? '',
    bio: page.bio ?? '',
    logoUrl: page.logoUrl ?? page.avatarUrl ?? null,
    themeKey: storeSiteTheme(page.siteTheme ?? page.theme).key,
    socials: SOCIAL_ORDER.filter((k) => !!page.socials?.[k]),
    blocks: blocks ?? (page.products ?? []).map((p) => ({
      id: p.id, style: 'callout', kind: 'premade', title: p.name, subtitle: '', image: p.image,
      priceLabel: p.priceLabel.replace(/\.00$/, ''), compareAtLabel: '', shipByLabel: '',
      buttonText: defaultButtonText('premade'), unavailableLabel: null,
    })),
  };
}

export interface StoreSiteState {
  loading: boolean;
  failed: boolean;
  page: BioPage | null;
  site: StoreSiteView | null;
  reload: () => Promise<void>;
}

export function useStoreSite(enabled = true): StoreSiteState {
  const [page, setPage] = useState<BioPage | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [failed, setFailed] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setPage(await getBio());
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (enabled) void reload(); }, [enabled, reload]);

  return { loading, failed, page, site: page ? storeSiteViewFromBio(page) : null, reload };
}
