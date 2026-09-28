/**
 * Named story-text fonts — Instagram's "Bubble / Deco / Squeeze / Typewriter…"
 * font-chip row. These are ONLY for text a person types onto their own story;
 * they never load into or apply to app chrome, which stays on `lib/theme.ts`'s
 * `FONT` (Inter) everywhere else. Lazy-loaded: `loadStoryFontsAsync()` is only
 * called from the story composer, once, the first time the text tool opens.
 */
import * as Font from 'expo-font';
import { Oswald_600SemiBold } from '@expo-google-fonts/oswald';
import { CourierPrime_700Bold } from '@expo-google-fonts/courier-prime';
import { Baloo2_700Bold } from '@expo-google-fonts/baloo-2';
import { PoiretOne_400Regular } from '@expo-google-fonts/poiret-one';
import { Pacifico_400Regular } from '@expo-google-fonts/pacifico';
import { ArchivoBlack_400Regular } from '@expo-google-fonts/archivo-black';
import { DMSerifDisplay_400Regular } from '@expo-google-fonts/dm-serif-display';
import { FONT as CHROME_FONT } from '@/lib/theme';

export type StoryFontKey =
  | 'classic' | 'modern' | 'strong' | 'squeeze'
  | 'typewriter' | 'bubble' | 'deco' | 'journal' | 'sparkle';

export type StoryFont = { key: StoryFontKey; label: string; fontFamily: string };

/** Chip order matches Instagram's scrollable font row. */
export const TEXT_FONTS: StoryFont[] = [
  { key: 'classic', label: 'Classic', fontFamily: CHROME_FONT.bold },
  { key: 'modern', label: 'Modern', fontFamily: CHROME_FONT.regular },
  { key: 'strong', label: 'Strong', fontFamily: 'ArchivoBlack_400Regular' },
  { key: 'squeeze', label: 'Squeeze', fontFamily: 'Oswald_600SemiBold' },
  { key: 'typewriter', label: 'Typewriter', fontFamily: 'CourierPrime_700Bold' },
  { key: 'bubble', label: 'Bubble', fontFamily: 'Baloo2_700Bold' },
  { key: 'deco', label: 'Deco', fontFamily: 'PoiretOne_400Regular' },
  { key: 'journal', label: 'Journal', fontFamily: 'DMSerifDisplay_400Regular' },
  { key: 'sparkle', label: 'Sparkle', fontFamily: 'Pacifico_400Regular' },
];

export function storyFontFamily(key: string | undefined): string {
  return TEXT_FONTS.find((f) => f.key === key)?.fontFamily ?? CHROME_FONT.bold;
}

let loadPromise: Promise<void> | null = null;

/** Idempotent — safe to call every time the text tool opens. */
export function loadStoryFontsAsync(): Promise<void> {
  if (!loadPromise) {
    loadPromise = Font.loadAsync({
      Oswald_600SemiBold,
      CourierPrime_700Bold,
      Baloo2_700Bold,
      PoiretOne_400Regular,
      Pacifico_400Regular,
      ArchivoBlack_400Regular,
      DMSerifDisplay_400Regular,
    }).catch(() => {
      // Fonts failing to load must never block posting a story — callers
      // fall back to the chrome font (storyFontFamily's default) silently.
    });
  }
  return loadPromise;
}
