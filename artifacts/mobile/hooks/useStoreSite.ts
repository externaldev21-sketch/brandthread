/**
 * The seller's store website as the app shows it: the link-in-bio row from
 * /api/growth/bio (or the preview fixtures in the signed-out web preview —
 * services/growthService never calls the API there), mapped to the
 * StoreSitePreview model.
 */
import { useCallback, useEffect, useState } from 'react';

import { getBio, type BioPage } from '@/services/growthService';
import type { StoreSiteView } from '@/components/store/StoreSitePreview';
import { MAX_STORE_SITE_LINKS, storeSiteTheme, type ButtonStyle, type StoreSiteFont } from '@/lib/storeSiteDesign';

const SOCIAL_ORDER = ['instagram', 'tiktok', 'youtube', 'x', 'facebook', 'website', 'email'];

export function storeSiteViewFromBio(page: BioPage): StoreSiteView {
  return {
    handle: page.username ?? null,
    displayName: page.displayName ?? '',
    bio: page.bio ?? '',
    logoUrl: page.logoUrl ?? page.avatarUrl ?? null,
    bannerUrl: page.showBanner === false ? null : page.bannerUrl ?? null,
    themeKey: storeSiteTheme(page.siteTheme ?? page.theme).key,
    buttonStyle: (page.buttonStyle ?? 'rounded') as ButtonStyle,
    font: (page.font ?? 'system') as StoreSiteFont,
    socials: SOCIAL_ORDER.filter((k) => !!page.socials?.[k]),
    products: page.products ?? [],
    links: page.links.filter((l) => l.enabled).slice(0, MAX_STORE_SITE_LINKS).map((l) => l.title),
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
