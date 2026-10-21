import * as Font from 'expo-font';
import { Platform } from 'react-native';
import { ICON_FONT_ASSETS } from './iconFontAssets';

const listeners = new Set<() => void>();
let bootReady = false;
let preload: Promise<void> | undefined;
const BOOT_WAIT_MS = 2500;

function notify() {
  for (const listener of listeners) listener();
}

export function subscribeIconFonts(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function isBundledIconFont(family: unknown): family is string {
  return typeof family === 'string' && Object.prototype.hasOwnProperty.call(ICON_FONT_ASSETS, family);
}

export function isIconFontReady(family: string): boolean {
  if (!Font.isLoaded(family)) return false;
  if (typeof document === 'undefined') return true;
  // The JS registry alone must never authorize a private-use glyph: verify
  // the corresponding browser face too, including delayed or failed loads.
  if (!document.fonts) return false;
  const name = family.replaceAll('"', '');
  return Array.from(document.fonts).some(face =>
    face.family.replaceAll(/["']/g, '') === name && face.status === 'loaded',
  ) && document.fonts.check(`16px "${name}"`);
}

export const getIconFontBootReady = () => bootReady;
export const getIconFontServerReady = () => true;
export const getIconFontServerHidden = () => false;

/** Starts once before Router renders; a failed font never blocks boot forever. */
export function preloadIconFonts(): Promise<void> {
  if (preload) return preload;
  // Static HTML generation has no browser fonts to load.
  if (Platform.OS === 'web' && typeof document === 'undefined') {
    return Promise.resolve();
  }
  if (typeof document !== 'undefined' && document.fonts) {
    document.fonts.addEventListener('loadingdone', notify);
    document.fonts.addEventListener('loadingerror', notify);
  }
  const timer = setTimeout(() => {
    bootReady = true;
    notify();
  }, BOOT_WAIT_MS);
  preload = Promise.all(Object.entries(ICON_FONT_ASSETS).map(async ([family, uri]) => {
    try {
      await Font.loadAsync(family, { uri, display: Font.FontDisplay.BLOCK });
      if (typeof document !== 'undefined' && document.fonts) {
        await document.fonts.load(`16px "${family}"`);
      }
    } catch {
      // Keep the icon slot invisible if its bundled asset genuinely fails.
      console.warn(`[icon-fonts] Bundled font unavailable: ${family}`);
    } finally {
      notify();
    }
  })).then(() => {
    clearTimeout(timer);
    bootReady = true;
    notify();
  });
  return preload;
}
