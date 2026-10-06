/**
 * designStudioFonts.ts — real Google Fonts for the Design Studio's text
 * layer font picker (the Add Text sheet in app/design-canvas.tsx).
 *
 * Every entry here is a real, bundled `expo-font` face loaded via
 * `useFonts` (same mechanism app/_layout.tsx already uses for the app's own
 * Inter faces) — not a placeholder name that falls back to the system font.
 * `useDesignStudioFonts` is called once, in DesignCanvasScreen, and the
 * screen's own loading gate waits on it (mirroring app/_layout.tsx's own
 * "never render text in a system fallback font" rule) so the font picker
 * and any already-placed text layer always render in their real face, both
 * live on screen and in the exported SVG (renderLayerInSvg reads
 * layer.data.fontFamily — see design-canvas.tsx — so once a family here is
 * loaded app-wide, export picks it up for free).
 *
 * The static font list lives in lib/designStudioFontsList.ts (no
 * react-native/expo-font import, so it's directly unit-testable); this file
 * re-exports it so design-canvas.tsx only needs one import.
 */
import { useFonts } from 'expo-font';

import { Inter_400Regular } from '@expo-google-fonts/inter';
import { PlayfairDisplay_400Regular } from '@expo-google-fonts/playfair-display';
import { BebasNeue_400Regular } from '@expo-google-fonts/bebas-neue';
import { Anton_400Regular } from '@expo-google-fonts/anton';
import { DMSerifDisplay_400Regular } from '@expo-google-fonts/dm-serif-display';
import { SpaceGrotesk_400Regular } from '@expo-google-fonts/space-grotesk';
import { ArchivoBlack_400Regular } from '@expo-google-fonts/archivo-black';
import { Oswald_400Regular } from '@expo-google-fonts/oswald';
import { Montserrat_400Regular } from '@expo-google-fonts/montserrat';
import { Poppins_400Regular } from '@expo-google-fonts/poppins';
import { PermanentMarker_400Regular } from '@expo-google-fonts/permanent-marker';
import { Caveat_400Regular } from '@expo-google-fonts/caveat';
// Already-installed bonus faces (pre-dated this change; not part of Dev's
// named list, but free to include since they're already a dependency and
// widen the picker beyond the 12 explicitly requested).
import { Baloo2_400Regular } from '@expo-google-fonts/baloo-2';
import { CourierPrime_400Regular } from '@expo-google-fonts/courier-prime';
import { Pacifico_400Regular } from '@expo-google-fonts/pacifico';
import { PoiretOne_400Regular } from '@expo-google-fonts/poiret-one';

export { DESIGN_STUDIO_FONTS, DEFAULT_DESIGN_STUDIO_FONT } from './designStudioFontsList';
export type { DesignStudioFont } from './designStudioFontsList';

/**
 * useDesignStudioFonts — loads every face in DESIGN_STUDIO_FONTS. Safe to
 * call alongside app/_layout.tsx's own useFonts call for Inter's other
 * weights: expo-font's underlying cache is keyed by family name, so loading
 * Inter_400Regular here is a no-op if the root layout already loaded it
 * (and vice versa) — neither call blocks or duplicates the other's work.
 */
export function useDesignStudioFonts(): [boolean, Error | null] {
  return useFonts({
    Inter_400Regular,
    PlayfairDisplay_400Regular,
    BebasNeue_400Regular,
    Anton_400Regular,
    DMSerifDisplay_400Regular,
    SpaceGrotesk_400Regular,
    ArchivoBlack_400Regular,
    Oswald_400Regular,
    Montserrat_400Regular,
    Poppins_400Regular,
    PermanentMarker_400Regular,
    Caveat_400Regular,
    Baloo2_400Regular,
    CourierPrime_400Regular,
    Pacifico_400Regular,
    PoiretOne_400Regular,
  });
}
