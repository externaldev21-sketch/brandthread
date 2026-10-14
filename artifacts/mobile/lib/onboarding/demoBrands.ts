/**
 * Brands for onboarding's "Follow a few brands" step in the dev/web preview
 * with `demo=1` only (lib/devPreview.ts isPreviewDemoMode()). Real sign-ups
 * always get GET /api/public/brands/discover. Photos are the app's own
 * bundled preview posters, the same ones the other demo overlays use.
 */
import { Asset } from 'expo-asset';
import type { DiscoverBrand } from '@/services/discoverService';

const POSTERS = [
  require('../../assets/videos/fashion_runway_01.jpg'),
  require('../../assets/videos/fashion_runway_02.jpg'),
  require('../../assets/videos/fashion_runway_03.jpg'),
  require('../../assets/videos/fashion_runway_04.jpg'),
  require('../../assets/videos/fashion_runway_05.jpg'),
  require('../../assets/images/products/leather-ankle-boots.jpg'),
];

const uri = (i: number) => Asset.fromModule(POSTERS[i % POSTERS.length]).uri;

export function demoOnboardingBrands(): DiscoverBrand[] {
  const brand = (id: string, name: string, handle: string, count: number, photos: number[]): DiscoverBrand => ({
    id: `preview-brand-${id}`, sellerId: `preview-brand-${id}`, handle, name, brandType: null,
    logoUrl: uri(photos[0]), verified: true, productCount: count, productImages: photos.map(uri),
  });
  return [
    brand('northline', 'Northline Studio', 'northlinestudio', 48, [0, 1, 2]),
    brand('ember', 'Ember & Ash', 'emberandash', 31, [3, 4, 5]),
    brand('field', 'Field Office', 'fieldoffice', 19, [1, 3, 5]),
    brand('quiet', 'Quiet Hours', 'quiethours', 12, [2, 4, 0]),
  ];
}
