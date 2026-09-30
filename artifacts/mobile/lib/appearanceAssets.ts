import { Asset } from 'expo-asset';
import type { ImageSourcePropType } from 'react-native';
import type { AppThemeId } from '@/contexts/AppThemeContext';

/**
 * Every icon/theme-preview image the Appearance screen can show, bundled as
 * local require() assets (never fetched over the network on-device). Kept in
 * one place so app start can preload them all with a single Asset.loadAsync
 * call, and the Appearance screen never has to show a loading/fade state for
 * a bitmap that was already resolved before the screen ever mounts.
 */
export const APPEARANCE_ICON_IMAGES: Record<AppThemeId, ImageSourcePropType> = {
  monochrome: require('../assets/images/app-icons/monochrome.png'),
  purple: require('../assets/images/app-icons/purple.png'),
  olive: require('../assets/images/app-icons/olive.png'),
  navy: require('../assets/images/app-icons/navy.png'),
  champagne: require('../assets/images/app-icons/champagne.png'),
  black: require('../assets/images/app-icons/black.png'),
  silver: require('../assets/images/app-icons/silver.png'),
  'black-gold': require('../assets/images/app-icons/black-gold.png'),
  'emerald-gold': require('../assets/images/app-icons/emerald-gold.png'),
  'leopard-red': require('../assets/images/app-icons/leopard-red.png'),
  maroon: require('../assets/images/app-icons/maroon.png'),
  gold: require('../assets/images/app-icons/gold.png'),
};

export const APPEARANCE_THEME_IMAGES: Record<AppThemeId, ImageSourcePropType> = {
  monochrome: require('../assets/images/themes/theme-black.png'),
  purple: require('../assets/images/themes/theme-purple.png'),
  olive: require('../assets/images/themes/theme-olive.png'),
  navy: require('../assets/images/themes/theme-navy.png'),
  champagne: require('../assets/images/themes/theme-champagne.png'),
  black: require('../assets/images/themes/theme-black.png'),
  silver: require('../assets/images/themes/theme-silver.png'),
  'black-gold': require('../assets/images/themes/theme-black-gold.png'),
  'emerald-gold': require('../assets/images/themes/theme-emerald-gold.png'),
  'leopard-red': require('../assets/images/themes/theme-leopard-red.png'),
  maroon: require('../assets/images/themes/theme-maroon.png'),
  gold: require('../assets/images/themes/theme-gold.png'),
};

let preloadStarted = false;

/**
 * Fire-and-forget preload, called once at app start (see app/_layout.tsx)
 * and defensively again on Appearance screen mount. Asset.loadAsync
 * resolves+caches local bundled assets so expo-image's memory-disk cache is
 * already warm by the time the grid renders — no fetch, no fade, no pop-in.
 * Never throws: a failed preload just means the first paint pays the normal
 * (already-fast, since these are bundled locally) resolve cost.
 */
export function preloadAppearanceAssets(): Promise<void> {
  if (preloadStarted) return Promise.resolve();
  preloadStarted = true;
  const modules = [...Object.values(APPEARANCE_ICON_IMAGES), ...Object.values(APPEARANCE_THEME_IMAGES)];
  return Asset.loadAsync(modules as number[]).then(() => undefined).catch(() => undefined);
}
