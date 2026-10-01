/**
 * designStudioFontsList.ts — the static font list for the Design Studio's
 * text layer font picker, split out from lib/designStudioFonts.ts so it has
 * NO react-native/expo-font import (those pull in Flow-typed sources vitest
 * can't parse directly). This file is safe to unit test directly; the hook
 * that actually loads these faces lives in lib/designStudioFonts.ts, which
 * re-exports everything here too.
 */

export interface DesignStudioFont {
  /** The exact RN font-family name — pass this straight to a `fontFamily` style. */
  family: string;
  /** Human-readable name shown in the picker. */
  label: string;
}

export const DESIGN_STUDIO_FONTS: DesignStudioFont[] = [
  { family: 'Inter_400Regular', label: 'Inter' },
  { family: 'PlayfairDisplay_400Regular', label: 'Playfair Display' },
  { family: 'BebasNeue_400Regular', label: 'Bebas Neue' },
  { family: 'Anton_400Regular', label: 'Anton' },
  { family: 'DMSerifDisplay_400Regular', label: 'DM Serif Display' },
  { family: 'SpaceGrotesk_400Regular', label: 'Space Grotesk' },
  { family: 'ArchivoBlack_400Regular', label: 'Archivo Black' },
  { family: 'Oswald_400Regular', label: 'Oswald' },
  { family: 'Montserrat_400Regular', label: 'Montserrat' },
  { family: 'Poppins_400Regular', label: 'Poppins' },
  { family: 'PermanentMarker_400Regular', label: 'Permanent Marker' },
  { family: 'Caveat_400Regular', label: 'Caveat' },
  { family: 'Baloo2_400Regular', label: 'Baloo 2' },
  { family: 'CourierPrime_400Regular', label: 'Courier Prime' },
  { family: 'Pacifico_400Regular', label: 'Pacifico' },
  { family: 'PoiretOne_400Regular', label: 'Poiret One' },
];

/** Default font for a freshly-added text layer. */
export const DEFAULT_DESIGN_STUDIO_FONT = 'Inter_400Regular';
