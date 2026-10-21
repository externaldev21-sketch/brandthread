import { Asset } from 'expo-asset';
import { INTER_WEB_FONT_ASSETS } from './textFontAssets';

// Starts before Router, without blocking first paint. HTML preloads use the
// same asset URLs. A failed asset falls back to system-ui, never an emoji face.
if (typeof document !== 'undefined' && typeof FontFace !== 'undefined') {
  for (const [weight, source] of Object.entries(INTER_WEB_FONT_ASSETS)) {
    const existing = Array.from(document.fonts).find(face =>
      face.family.replaceAll(/["']/g, '') === 'Inter' && face.weight === weight,
    );
    const face = existing ?? new FontFace('Inter',
      `url(${JSON.stringify(Asset.fromModule(source).uri)})`,
      { weight, style: 'normal', display: 'swap' });
    if (!existing) document.fonts.add(face);
    void face.load().catch(() => {
      console.warn(`[text-fonts] Bundled Inter ${weight} unavailable; using system text.`);
    });
  }
}
