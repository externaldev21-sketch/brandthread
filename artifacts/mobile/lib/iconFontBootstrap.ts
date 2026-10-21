// Side-effect entry import: start local font loads before icon components mount,
// so their own on-demand loader cannot win with font-display:auto.
import { preloadIconFonts } from './iconFonts';

void preloadIconFonts();
